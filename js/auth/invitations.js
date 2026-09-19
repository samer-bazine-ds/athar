import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";

export async function acceptInvitation(token){const {data,error}=await supabase.rpc("accept_invitation",{p_token:token});if(error)throw error;return data?.[0]||null;}
export async function inviteMember({email,role="team",clientId=null}){
  const s=getState();
  const payload={agency_id:s.agency.id,email:email.trim().toLowerCase(),intended_role:role,client_id:clientId||null,invited_by:s.user.id};
  const {data,error}=await supabase.from("invitations").insert(payload).select().single();
  if(error)throw error;
  const {data:emailResult,error:emailError}=await supabase.functions.invoke("send-invitation-email",{body:{invitation_id:data.id}});
  if(emailError||!emailResult?.link){
    await supabase.from("invitations").update({status:"revoked"}).eq("id",data.id);
    let functionMessage=emailResult?.error||"";
    if(!functionMessage&&emailError?.context){try{functionMessage=(await emailError.context.json())?.error||"";}catch{} }
    const failure=new Error(functionMessage||emailError?.message||"The invitation email could not be sent.");
    failure.userMessage=true;
    throw failure;
  }
  return {...data,link:emailResult.link,emailSent:true};
}
export async function listInvitations(){const agencyId=getState().agency?.id;if(!agencyId)return[];const {data,error}=await supabase.from("invitations").select("*").eq("agency_id",agencyId).order("created_at",{ascending:false});if(error)throw error;return data||[];}
export async function revokeInvitation(id){const {error}=await supabase.from("invitations").update({status:"revoked"}).eq("id",id);if(error)throw error;}
