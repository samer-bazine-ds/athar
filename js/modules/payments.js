import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";

async function functionMessage(error, data) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // Fall back to the stable user-facing message below.
    }
  }
  return "Online payment isn't configured for this workspace yet.";
}

export async function startCheckout(invoiceId) {
  const { data, error } = await supabase.functions.invoke("create-checkout-session", {
    body: { invoice_id: invoiceId }
  });
  if (error || data?.error) {
    throw Object.assign(new Error(await functionMessage(error, data)), { userMessage: true });
  }
  let checkoutUrl;
  try {
    checkoutUrl = new URL(data?.url);
  } catch {
    throw Object.assign(new Error("The payment service returned an invalid checkout link."), { userMessage: true });
  }
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
    throw Object.assign(new Error("The payment service returned an untrusted checkout link."), { userMessage: true });
  }
  window.location.assign(checkoutUrl.href);
}

export async function payInvoice(invoiceId) {
  try {
    await startCheckout(invoiceId);
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "warning");
    throw error;
  }
}
