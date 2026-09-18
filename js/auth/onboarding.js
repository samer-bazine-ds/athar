import { supabase } from "../supabaseClient.js";
import { getState, setState } from "../core/state.js";
import { loadIdentity } from "./auth.js";

export function slugify(value){return String(value||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-").replace(/-+/g,"-").slice(0,50).replace(/^-|-$/g,"")||`agency-${Date.now()}`;}
export async function completeProfile(fullName){const user=getState().user;if(!user)throw new Error("Authentication required");const {data,error}=await supabase.from("profiles").update({full_name:fullName.trim()}).eq("id",user.id).select().single();if(error)throw error;setState({profile:data});return data;}
export async function createAgency(name){const user=getState().user;if(!user)throw new Error("Authentication required");let base=slugify(name),slug=base;for(let i=0;i<5;i++){const {data,error}=await supabase.from("agencies").insert({name:name.trim(),slug,created_by:user.id}).select().single();if(!error){await loadIdentity();return data;}if(error.code!=="23505")throw error;slug=`${base}-${Math.floor(1000+Math.random()*9000)}`;}throw new Error("Could not create a unique workspace URL.");}
