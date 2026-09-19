import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appBaseUrl = Deno.env.get("APP_BASE_URL")?.replace(/\/+$/, "");
  if (!url || !serviceKey || !appBaseUrl) return json({ error: "Client access is not configured" }, 500);

  let token = "";
  try { token = String((await req.json()).token || ""); } catch { return json({ error: "Invalid request" }, 400); }
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(token)) return json({ error: "Invalid invitation link" }, 400);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: invitation, error: invitationError } = await admin.from("invitations").select("email,intended_role,status,expires_at").eq("token", token).maybeSingle();
  if (invitationError) return json({ error: "Could not validate invitation" }, 500);
  if (!invitation || invitation.intended_role !== "client" || invitation.status !== "pending") return json({ error: "This invitation is no longer valid" }, 400);
  if (new Date(invitation.expires_at).getTime() < Date.now()) return json({ error: "This invitation has expired" }, 400);

  const redirectTo = `${appBaseUrl}/login.html?invite=${encodeURIComponent(token)}&client_access=complete`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: invitation.email, options: { redirectTo } });
  if (linkError || !linkData?.properties?.action_link) return json({ error: "Could not create client access" }, 500);
  return json({ action_link: linkData.properties.action_link });
});
