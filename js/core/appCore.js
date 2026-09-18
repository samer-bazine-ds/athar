import { supabase } from "../supabaseClient.js";
import { getState, subscribe } from "./state.js";
import * as ui from "./ui.js";
import * as utils from "./utils.js";
import { selectFolder as selectFolderImpl } from "../workspace/folders.js";
import { selectModule as selectModuleImpl } from "./moduleRegistry.js";

export const AppCore = {
  supabase,
  getCurrentSession:()=>getState().session,
  getCurrentUser:()=>getState().user,
  getCurrentProfile:()=>getState().profile,
  getCurrentAgency:()=>getState().agency,
  getCurrentMembership:()=>getState().membership,
  getCurrentRole:()=>getState().role,
  getCurrentClientId:()=>getState().clientId,
  isStaff:()=>["owner","team"].includes(getState().role),
  isOwner:()=>getState().role==="owner",
  isClient:()=>getState().role==="client",
  getSelectedFolderId:()=>getState().selectedFolderId,
  getSelectedFolder:()=>getState().folders.find(f=>f.id===getState().selectedFolderId)||null,
  getFolders:()=>[...getState().folders],
  getFolderPath(folderId){ const rows=getState().folders; const map=new Map(rows.map(f=>[f.id,f])); const path=[]; let cur=map.get(folderId); const seen=new Set(); while(cur&&!seen.has(cur.id)){seen.add(cur.id);path.unshift(cur);cur=cur.parent_id?map.get(cur.parent_id):null;} return path; },
  selectFolder:selectFolderImpl,
  getSelectedModule:()=>getState().selectedModule,
  selectModule:selectModuleImpl,
  getModuleContext(){ const s=getState(); return {supabase,agencyId:s.agency?.id||null,agency:s.agency,folderId:s.selectedFolderId,folder:s.folders.find(f=>f.id===s.selectedFolderId)||null,role:s.role,membership:s.membership,clientId:s.clientId,user:s.user,profile:s.profile,isStaff:["owner","team"].includes(s.role),isOwner:s.role==="owner",isClient:s.role==="client",surface:s.surface,AppCore}; },
  getState,
  subscribe,
  ui,
  utils
};
window.AppCore=AppCore;
export default AppCore;
