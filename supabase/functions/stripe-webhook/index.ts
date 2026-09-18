import Stripe from "npm:stripe@16.12.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function paymentIntentId(value: string | Stripe.PaymentIntent | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !stripeKey || !webhookSecret) {
    return json({ error: "Webhook is not configured" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing signature" }, 400);
  const rawBody = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe signature verification failed", error);
    return json({ error: "Invalid signature" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoice_id;
      if (!invoiceId) return json({ received: true });

      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, agency_id, invoice_number, status, currency, total_cents")
        .eq("id", invoiceId)
        .maybeSingle();
      if (invoiceError || !invoice) {
        console.error("Webhook invoice not found", invoiceError);
        return json({ received: true });
      }

      const amountTotal = Number(session.amount_total || 0);
      const expectedTotal = Number(invoice.total_cents);
      const currencyMatches = String(session.currency || "").toUpperCase() === String(invoice.currency).toUpperCase();
      if (!Number.isSafeInteger(amountTotal) || amountTotal !== expectedTotal || !currencyMatches) {
        console.error("Webhook amount/currency mismatch", { invoiceId, amountTotal, expectedTotal, sessionCurrency: session.currency, invoiceCurrency: invoice.currency });
        await supabase.from("payments").update({ status: "failed" }).eq("provider_session_id", session.id).eq("status", "pending");
        return json({ received: true });
      }

      const providerPaymentId = paymentIntentId(session.payment_intent);
      const paidAt = new Date().toISOString();
      const { error: paymentUpdateError } = await supabase
        .from("payments")
        .update({
          status: "succeeded",
          provider_payment_id: providerPaymentId,
          paid_at: paidAt,
          amount_cents: amountTotal,
          currency: invoice.currency
        })
        .eq("provider_session_id", session.id);
      if (paymentUpdateError) throw paymentUpdateError;

      if (invoice.status !== "paid") {
        const { error: invoiceUpdateError } = await supabase
          .from("invoices")
          .update({ status: "paid", paid_at: paidAt })
          .eq("id", invoice.id);
        if (invoiceUpdateError) throw invoiceUpdateError;

        const { error: logError } = await supabase.from("activity_logs").insert({
          agency_id: invoice.agency_id,
          actor_id: null,
          action: "invoice.paid",
          entity_type: "invoice",
          entity_id: invoice.id,
          metadata: { invoice_number: invoice.invoice_number, provider_session_id: session.id }
        });
        if (logError) console.error("Activity log insert failed", logError);
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { error } = await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("provider_session_id", session.id)
        .eq("status", "pending");
      if (error) throw error;
    }
  } catch (error) {
    console.error("Stripe webhook processing error", error);
    // Stripe should retry transient processing failures.
    return json({ error: "Webhook processing failed" }, 500);
  }

  return json({ received: true });
});
