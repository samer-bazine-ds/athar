import { getState, setState } from "./state.js";
import { emit } from "./events.js";
import { AppCore } from "./appCore.js";

const MODULE_LOADERS = {
  conversation:()=>import("../modules/conversation.js?v=conversation-ui-4"),
  boards:()=>import("../modules/boards.js"),
  docs:()=>import("../modules/docs.js"),
  files:()=>import("../modules/files.js"),
  invoices:()=>import("../modules/invoices.js")
};
let activeModule=null;
export const MODULE_NAMES=Object.freeze(Object.keys(MODULE_LOADERS));

async function safeUnmount() {
  if(!activeModule) return;
  const name=activeModule.name;
  try { await activeModule.unmount?.(); } catch(error){ console.error(error); }
  activeModule=null; emit("module:unmounted",{module:name});
}
export async function selectModule(moduleName) {
  if(!MODULE_LOADERS[moduleName]) { console.warn("Unknown module",moduleName); return; }
  const s=getState(); if(s.selectedModule===moduleName&&activeModule) return;
  const previousModule=s.selectedModule; emit("module:selected",{module:moduleName,previousModule,folderId:s.selectedFolderId,agencyId:s.agency?.id||null});
  await safeUnmount(); const container=document.getElementById("module-content"); if(!container)return; container.replaceChildren(); setState({selectedModule:moduleName});
  history.replaceState(null,"",s.selectedFolderId?`#/f/${s.selectedFolderId}/${moduleName}`:`#/${moduleName}`);
  try { const mod=await MODULE_LOADERS[moduleName](); if(typeof mod.default?.mount!=="function") throw new TypeError("Module contract missing mount()"); activeModule=mod.default; await activeModule.mount(container,AppCore.getModuleContext()); emit("module:mounted",{module:moduleName,folderId:getState().selectedFolderId}); }
  catch(error){ console.error(error); if(/Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(error))) AppCore.ui.renderEmpty(container,{title:`${moduleName} module`,message:"This module will load here."}); else AppCore.ui.renderError(container,error,()=>selectModule(moduleName)); }
  updateTabs();
}
export async function refreshActiveModule(){ if(activeModule?.refresh) { try{await activeModule.refresh(AppCore.getModuleContext()); return;}catch(error){console.error(error);} } const name=getState().selectedModule; if(name){await safeUnmount();setState({selectedModule:null});await selectModule(name);} }
export async function unmountActiveModule(){await safeUnmount();}
export function updateTabs(){const selected=getState().selectedModule;document.querySelectorAll("#module-tabs [data-module]").forEach(btn=>{const on=btn.dataset.module===selected;btn.classList.toggle("ap-tab--active",on);btn.setAttribute("aria-selected",String(on));});}
