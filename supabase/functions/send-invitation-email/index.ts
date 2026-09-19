import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character] || character));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("INVITATION_FROM_EMAIL");
  const appBaseUrl = Deno.env.get("APP_BASE_URL")?.replace(/\/+$/, "");
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !fromEmail || !appBaseUrl) {
    return json({ error: "Invitation email service is not configured" }, 503);
  }
  if (!authorization) return json({ error: "Authentication required" }, 401);

  let payload: { invitation_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!payload.invitation_id || typeof payload.invitation_id !== "string") {
    return json({ error: "invitation_id is required" }, 400);
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

  const { data: invitation, error: invitationError } = await requestClient
    .from("invitations")
    .select("id, agency_id, email, intended_role, token, status, expires_at, agencies(name)")
    .eq("id", payload.invitation_id)
    .eq("status", "pending")
    .maybeSingle();
  if (invitationError || !invitation) return json({ error: "Invitation not found" }, 404);

  const link = `${appBaseUrl}/login.html?invite=${encodeURIComponent(invitation.token)}`;
  const agencyName = escapeHtml(invitation.agencies?.name || "your workspace");
  const roleLabel = invitation.intended_role === "client" ? "client portal" : "team workspace";
  const html = `<p>You have been invited to join <strong>${agencyName}</strong>.</p>
    <p>Use the button below to create your account and join the ${roleLabel}.</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#3f5bf6;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p>
    <p>This invitation expires in 14 days.</p>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [invitation.email],
      subject: `Invitation to join ${invitation.agencies?.name || "your workspace"}`,
      html
    })
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("Invitation email provider failed", response.status, details);
    await serviceClient.from("invitations").update({ status: "revoked" }).eq("id", invitation.id).eq("status", "pending");
    return json({ error: "The invitation email could not be sent" }, 502);
  }

  return json({ link, email_sent: true });
});
