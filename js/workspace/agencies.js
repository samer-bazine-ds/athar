import { supabase } from "../supabaseClient.js";
import { getState, setState } from "../core/state.js";
import { emit } from "../core/events.js";
import { applyBranding } from "./branding.js";
import { loadFolders } from "./folders.js";

export async function activateAgency(agencyId){const membership=getState().memberships.find(m=>m.agency_id===agencyId);if(!membership)throw new Error("Workspace unavailable");let agency=membership.agencies||null;if(!agency){const {data,error}=await supabase.from("agencies").select("*").eq("id",agencyId).single();if(error)throw error;agency=data;}setState({agency,membership,role:membership.role,clientId:membership.client_id||null,selectedFolderId:null,selectedModule:null,folders:[]});applyBranding(agency);emit("agency:selected",{agencyId,role:membership.role});localStorage.setItem("ap.lastAgencyId",agencyId);await loadFolders();return agency;}
export async function chooseInitialAgency(){const memberships=getState().memberships;if(!memberships.length)return null;const remembered=localStorage.getItem("ap.lastAgencyId");const member=memberships.find(m=>m.agency_id===remembered)||memberships[0];await activateAgency(member.agency_id);return member;}
