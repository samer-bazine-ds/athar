import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";

export async function listConversations(folderId){if(!folderId)return[];const {data,error}=await supabase.from("conversations").select("*").eq("folder_id",folderId).is("archived_at",null).is("trashed_at",null).order("last_message_at",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false});if(error)throw error;return data||[];}
export async function createConversation({folderId,title,clientVisible=false}){const s=getState();const {data,error}=await supabase.from("conversations").insert({agency_id:s.agency.id,folder_id:folderId,title:title.trim(),client_visible:clientVisible,created_by:s.user.id}).select().single();if(error)throw error;return data;}
export async function updateConversation(id,changes){const {data,error}=await supabase.from("conversations").update(changes).eq("id",id).select().single();if(error)throw error;return data;}
