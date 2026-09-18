import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";

export async function startCheckout(invoiceId) {
  const { data, error } = await supabase.functions.invoke("create-checkout-session", {
    body: { invoice_id: invoiceId }
  });
  if (error) {
    const message = error?.message || "Online payment isn't configured for this workspace yet.";
    throw new Error(message);
  }
  if (!data?.url) throw new Error("Online payment isn't configured for this workspace yet.");
  window.location.assign(data.url);
}

export async function payInvoice(invoiceId) {
  try {
    await startCheckout(invoiceId);
  } catch (error) {
    AppCore.ui.toast(error?.message || "Online payment isn't configured for this workspace yet.", "warning");
    throw error;
  }
}
