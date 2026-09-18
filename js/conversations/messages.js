import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";

export async function listMessages(conversationId){const {data,error}=await supabase.from("messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:true});if(error)throw error;const ids=[...new Set((data||[]).map(m=>m.sender_id))];let profiles=[];if(ids.length){const result=await supabase.from("profiles").select("id,full_name,email,avatar_url").in("id",ids);if(result.error)throw result.error;profiles=result.data||[];}const map=new Map(profiles.map(p=>[p.id,p]));return (data||[]).map(m=>({...m,sender:map.get(m.sender_id)||null}));}
export async function sendMessage({conversationId,body,clientVisible=true,replyToMessageId=null}){const s=getState();const {data,error}=await supabase.from("messages").insert({agency_id:s.agency.id,conversation_id:conversationId,sender_id:s.user.id,body:body.trim(),client_visible:clientVisible,reply_to_message_id:replyToMessageId}).select().single();if(error)throw error;return data;}
export async function deleteMessage(id){const {error}=await supabase.from("messages").delete().eq("id",id);if(error)throw error;}
