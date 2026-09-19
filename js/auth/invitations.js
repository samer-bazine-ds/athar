import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";

export async function acceptInvitation(token){const {data,error}=await supabase.rpc("accept_invitation",{p_token:token});if(error)throw error;return data?.[0]||null;}

async function invocationMessage(error, result) {
  if (typeof result?.error === "string" && result.error.trim()) return result.error.trim();
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // The function may have returned a non-JSON gateway error.
    }
    try {
      const text = (await response.clone().text()).trim();
      if (text && !/^<(!doctype|html)/i.test(text)) return text.slice(0, 240);
    } catch {
      // Fall through to the SDK error below.
    }
  }
  return String(error?.message || "").trim();
}

export async function inviteMember({email,role="team",clientId=null}){
  const s=getState();
  if(!s.agency?.id||!s.user?.id)throw Object.assign(new Error("Sign in and select a workspace before inviting someone."),{userMessage:true});
  const normalizedEmail=String(email||"").trim().toLowerCase();
  if(!normalizedEmail)throw Object.assign(new Error("Enter an email address."),{userMessage:true});
  if(!["owner","team","client"].includes(role))throw new TypeError("Invalid invitation role");
  if(role==="client"&&!clientId)throw new TypeError("A client invitation requires a client company");
  const payload={agency_id:s.agency.id,email:normalizedEmail,intended_role:role,client_id:role==="client"?clientId:null,invited_by:s.user.id};
  const {data,error}=await supabase.from("invitations").insert(payload).select().single();
  if(error)throw error;
  const {data:emailResult,error:emailError}=await supabase.functions.invoke("send-invitation-email",{body:{invitation_id:data.id}});
  if(emailError||emailResult?.error||!emailResult?.email_sent||!emailResult?.link){
    const {error:revokeError}=await supabase.from("invitations").update({status:"revoked"}).eq("id",data.id).eq("status","pending");
    if(revokeError)console.error("Failed to revoke an undelivered invitation",revokeError);
    const functionMessage=await invocationMessage(emailError,emailResult);
    const failure=new Error(functionMessage||"The invitation email could not be sent. Check the function logs and email settings.");
    failure.userMessage=true;
    throw failure;
  }
  return {...data,link:emailResult.link,emailSent:true};
}
export async function listInvitations(){const agencyId=getState().agency?.id;if(!agencyId)return[];const {data,error}=await supabase.from("invitations").select("*").eq("agency_id",agencyId).order("created_at",{ascending:false});if(error)throw error;return data||[];}
export async function revokeInvitation(id){const {error}=await supabase.from("invitations").update({status:"revoked"}).eq("id",id);if(error)throw error;}
