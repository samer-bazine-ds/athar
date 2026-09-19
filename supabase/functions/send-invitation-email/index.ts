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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character] || character));
}

function providerMessage(body: string) {
  try {
    const parsed = JSON.parse(body);
    const message = typeof parsed?.message === "string" ? parsed.message : typeof parsed?.error === "string" ? parsed.error : "";
    return message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  } catch {
    return "";
  }
}

async function revokeInvitation(client: ReturnType<typeof createClient>, invitationId: string) {
  const { error } = await client.from("invitations").update({ status: "revoked" }).eq("id", invitationId).eq("status", "pending");
  if (error) console.error("Failed to revoke invitation", invitationId, error);
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

  if (!authorization) return json({ error: "Authentication required" }, 401);
  const missingSettings = [
    ["SUPABASE_URL", supabaseUrl],
    ["SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ["RESEND_API_KEY", resendApiKey],
    ["INVITATION_FROM_EMAIL", fromEmail],
    ["APP_BASE_URL", appBaseUrl]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingSettings.length) {
    console.error("Invitation email service is missing settings", missingSettings);
    return json({ error: `Invitation email is not configured. Missing: ${missingSettings.join(", ")}.` }, 503);
  }

  let payload: { invitation_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!payload.invitation_id || typeof payload.invitation_id !== "string") {
    return json({ error: "invitation_id is required" }, 400);
  }

  const requestClient = createClient(supabaseUrl!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } }
  });
  const serviceClient = createClient(supabaseUrl!, serviceRoleKey!, {
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

  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    await serviceClient.from("invitations").update({ status: "expired" }).eq("id", invitation.id).eq("status", "pending");
    return json({ error: "This invitation has expired. Create a new invitation." }, 410);
  }

  const agency = Array.isArray(invitation.agencies) ? invitation.agencies[0] : invitation.agencies;
  const agencyLabel = agency?.name || "your workspace";
  const link = `${appBaseUrl!}/login.html?invite=${encodeURIComponent(invitation.token)}`;
  const agencyName = escapeHtml(agencyLabel);
  const roleLabel = invitation.intended_role === "client" ? "client portal" : "team workspace";
  const html = `<p>You have been invited to join <strong>${agencyName}</strong>.</p>
    <p>Use the button below to create your account and join the ${roleLabel}.</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#3f5bf6;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p>
    <p>This invitation expires in 14 days.</p>`;

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey!}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [invitation.email],
        subject: `Invitation to join ${agencyLabel}`,
        html
      })
    });
  } catch (error) {
    console.error("Invitation email provider could not be reached", error);
    await revokeInvitation(serviceClient, invitation.id);
    return json({ error: "The email provider could not be reached. Try again shortly." }, 502);
  }
  if (!response.ok) {
    const details = await response.text();
    console.error("Invitation email provider failed", response.status, details);
    await revokeInvitation(serviceClient, invitation.id);
    const reason = providerMessage(details);
    return json({ error: reason ? `Email provider rejected the invitation: ${reason}` : "The email provider rejected the invitation. Check the sender domain and API key." }, 502);
  }

  return json({ link, email_sent: true });
});
