import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";
import { APP_CONFIG } from "../config.js";

export async function acceptInvitation(token){const {data,error}=await supabase.rpc("accept_invitation",{p_token:token});if(error)throw error;return data?.[0]||null;}

function invitationLink(token){const url=new URL("login.html",window.location.href);url.searchParams.set("invite",token);return url.toString();}
async function sendInvitationEmail({toEmail,link}){let response;try{response=await fetch("https://api.emailjs.com/api/v1.0/email/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service_id:APP_CONFIG.EMAILJS_SERVICE_ID,template_id:APP_CONFIG.EMAILJS_TEMPLATE_ID,user_id:APP_CONFIG.EMAILJS_PUBLIC_KEY,template_params:{to_email:toEmail,invite_link:link}})});}catch{throw new Error("Could not reach EmailJS. Check your internet connection and try again.");}if(!response.ok){const detail=(await response.text()).trim();throw new Error(detail||"EmailJS rejected the invitation email.");}}

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
  const link=invitationLink(data.token);
  try{await sendInvitationEmail({toEmail:normalizedEmail,link});}catch(emailError){
    const {error:revokeError}=await supabase.from("invitations").update({status:"revoked"}).eq("id",data.id).eq("status","pending");
    if(revokeError)console.error("Failed to revoke an undelivered invitation",revokeError);
    const failure=new Error(emailError?.message||"The invitation email could not be sent. Check your EmailJS settings.");
    failure.userMessage=true;
    throw failure;
  }
  return {...data,link,emailSent:true};
}
export async function listInvitations(){const agencyId=getState().agency?.id;if(!agencyId)return[];const {data,error}=await supabase.from("invitations").select("*").eq("agency_id",agencyId).order("created_at",{ascending:false});if(error)throw error;return data||[];}
export async function revokeInvitation(id){const {error}=await supabase.from("invitations").update({status:"revoked"}).eq("id",id);if(error)throw error;}
