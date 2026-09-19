import Stripe from "npm:stripe@16.12.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const successUrl = Deno.env.get("APP_SUCCESS_URL");
  const cancelUrl = Deno.env.get("APP_CANCEL_URL");
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeKey || !successUrl || !cancelUrl) {
    return json({ error: "Payment service is not configured" }, 503);
  }
  if (!authorization) return json({ error: "Authentication required" }, 401);

  let payload: { invoice_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!payload?.invoice_id || typeof payload.invoice_id !== "string") {
    return json({ error: "invoice_id is required" }, 400);
  }

  const requestClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } }
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await requestClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Authentication required" }, 401);

  const { data: invoice, error: invoiceError } = await requestClient
    .from("invoices")
    .select("id, agency_id, client_id, invoice_number, status, currency, total_cents")
    .eq("id", payload.invoice_id)
    .maybeSingle();

  // Missing and forbidden deliberately collapse to the same response.
  if (invoiceError || !invoice) return json({ error: "Invoice not found" }, 404);
  if (!["sent", "overdue"].includes(invoice.status)) return json({ error: "Invoice not found" }, 404);

  const { data: callerClientId, error: clientError } = await requestClient.rpc("current_client_id", {
    p_agency: invoice.agency_id
  });
  if (clientError || !callerClientId || callerClientId !== invoice.client_id) {
    return json({ error: "Invoice not found" }, 404);
  }

  const amount = Number(invoice.total_cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: "Invoice cannot be paid online" }, 409);
  const currency = String(invoice.currency || "").toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) return json({ error: "Invoice currency is invalid" }, 500);

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: { name: `Invoice ${invoice.invoice_number}` }
        }
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: invoice.id,
      metadata: { invoice_id: invoice.id },
      payment_intent_data: { metadata: { invoice_id: invoice.id } }
    });
  } catch (error) {
    console.error("Stripe session creation failed", error);
    return json({ error: "Unable to create payment session" }, 502);
  }

  const { error: paymentError } = await serviceClient.from("payments").insert({
    agency_id: invoice.agency_id,
    invoice_id: invoice.id,
    amount_cents: amount,
    currency: invoice.currency,
    provider: "stripe",
    provider_session_id: session.id,
    status: "pending"
  });

  if (paymentError) {
    console.error("Pending payment insert failed", paymentError);
    try { await stripe.checkout.sessions.expire(session.id); } catch { /* best-effort cleanup */ }
    return json({ error: "Unable to initialize payment" }, 500);
  }

  return json({ url: session.url });
});
