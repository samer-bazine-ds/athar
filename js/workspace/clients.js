import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";
import { AppCore } from "../core/appCore.js";
import { inviteMember } from "../auth/invitations.js?v=invite-email-4";

export async function listClients(){const s=getState();const {data,error}=await supabase.from("clients").select("*").eq("agency_id",s.agency.id).is("archived_at",null).order("created_at",{ascending:false});if(error)throw error;return data||[];}
export async function createClientCompany({name,email,notes}){const s=getState();const {error}=await supabase.from("clients").insert({agency_id:s.agency.id,name:name.trim(),contact_email:email?.trim()||null,notes:notes?.trim()||null,created_by:s.user.id});if(error)throw error;}

function el(tag,cls="",text=null){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==null)n.textContent=text;return n;}
function button(text,cls){const b=el("button",cls,text);b.type="button";return b;}
function shortDate(value){return value?new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric"}):"—";}
function initial(name){return String(name||"C").trim()[0]?.toUpperCase()||"C";}

export async function renderClientsView(container){
  AppCore.ui.renderLoading(container,"Loading clients…");
  try{
    const clients=await listClients();
    container.replaceChildren();container.className="ap-module-content k-page-panel k-clients-page";
    const root=el("section","k-clients-view");
    const tabs=el("div","k-client-tabs");
    const clientsTab=button("","k-client-tab k-client-tab--active");clientsTab.innerHTML='<span class="k-client-tab__icon">▦</span><span>Client companies</span>';
    clientsTab.setAttribute("aria-current","page");tabs.append(clientsTab);root.append(tabs);

    const controls=el("div","k-client-controls");
    const left=el("div","k-client-controls__left");
    const searchWrap=el("label","k-client-search");searchWrap.innerHTML='<span>⌕</span>';const search=el("input");search.type="search";search.placeholder=`Search ${clients.length} client${clients.length===1?"":"s"}...`;searchWrap.append(search);
    const sort=el("select","k-client-sort");[["desc","Created"],["asc","Oldest"]].forEach(([v,t])=>{const o=el("option","",t);o.value=v;sort.append(o);});left.append(searchWrap,sort);
    const create=button("+  Create Client","k-btn k-btn--primary k-create-client");create.addEventListener("click",()=>openClientForm(null,()=>renderClientsView(container)));
    controls.append(left,create);root.append(controls);

    const host=el("div","k-client-table-wrap");root.append(host);container.append(root);
    const draw=()=>{
      const q=search.value.trim().toLowerCase();let rows=clients.filter(c=>!q||`${c.name} ${c.contact_email||""}`.toLowerCase().includes(q));rows.sort((a,b)=>(sort.value==="asc"?1:-1)*(new Date(a.created_at)-new Date(b.created_at)));
      host.replaceChildren();
      if(!rows.length){const empty=el("div","k-client-empty","No clients found");host.append(empty);return;}
      const table=el("div","k-client-table");const head=el("div","k-client-row k-client-row--head");["Name ↑","Email","Created","▥"].forEach(t=>head.append(el("span","",t)));table.append(head);
      rows.forEach(client=>{const row=el("div","k-client-row");const name=el("div","k-client-name");name.append(el("span","k-client-avatar",initial(client.name)),el("strong","",client.name));row.append(name,el("span","",client.contact_email||"—"),el("span","",shortDate(client.created_at)));const menu=button("⋯","k-icon-button k-client-menu");menu.addEventListener("click",()=>openClientActions(client,()=>renderClientsView(container)));row.append(menu);row.addEventListener("dblclick",()=>openClientForm(client,()=>renderClientsView(container)));table.append(row);});
      host.append(table,el("div","k-client-count",`1-${rows.length} of ${rows.length}`));
    };
    search.addEventListener("input",draw);sort.addEventListener("change",draw);
    draw();
  }catch(error){AppCore.ui.renderError(container,error,()=>renderClientsView(container));}
}

export function openCreateClient(done){openClientForm(null,done);}

function openClientActions(client,done){
  const wrap=el("div","ap-stack");
  const invite=button("Invite contact","ap-btn ap-btn--secondary");invite.addEventListener("click",()=>{AppCore.ui.closeModal();openInvite(client);});
  const edit=button("Edit client","ap-btn ap-btn--secondary");edit.addEventListener("click",()=>{AppCore.ui.closeModal();openClientForm(client,done);});
  const archive=button("Archive","ap-btn ap-btn--danger");archive.addEventListener("click",async()=>{if(!await AppCore.ui.confirm({title:"Archive client?",message:"Client portal access will stop immediately.",confirmLabel:"Archive",danger:true}))return;try{const {error}=await supabase.from("clients").update({archived_at:new Date().toISOString()}).eq("id",client.id);if(error)throw error;AppCore.ui.closeModal();done?.();}catch(err){AppCore.ui.toast(AppCore.ui.describeError(err),"error");}});
  wrap.append(invite,edit,archive);AppCore.ui.openModal({title:client.name,content:wrap,actions:[]});
}

function openClientForm(client,done){const form=el("form","ap-stack");const name=input("Client name"),email=input("Email","email",false),notes=el("textarea","ap-textarea");notes.placeholder="Notes";name.value=client?.name||"";email.value=client?.contact_email||"";notes.value=client?.notes||"";const save=button(client?"Save":"Create Client","ap-btn ap-btn--primary");save.type="submit";form.append(name,email,notes,save);form.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;try{if(client){const {error}=await supabase.from("clients").update({name:name.value.trim(),contact_email:email.value||null,notes:notes.value||null}).eq("id",client.id);if(error)throw error;}else await createClientCompany({name:name.value,email:email.value,notes:notes.value});AppCore.ui.closeModal();done?.();}catch(err){AppCore.ui.toast(AppCore.ui.describeError(err),"error");}finally{save.disabled=false;}});AppCore.ui.openModal({title:client?"Edit Client":"Create Client",content:form,actions:[]});name.focus();}
function openInvite(client){const form=el("form","ap-stack");const email=input("Client email","email");email.value=client.contact_email||"";const submit=button("Send invitation","ap-btn ap-btn--primary");submit.type="submit";const result=el("div","ap-invite-result");form.append(email,submit,result);form.addEventListener("submit",async e=>{e.preventDefault();submit.disabled=true;try{const inv=await inviteMember({email:email.value,role:"client",clientId:client.id});result.replaceChildren();result.append(el("p","ap-inline-message ap-inline-message--success",`Invitation email sent to ${email.value.trim()}.`),el("p","","You can also copy the invitation link: "),el("code","",inv.link));const copy=button("Copy link","ap-btn ap-btn--secondary");copy.type="button";copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(inv.link);AppCore.ui.toast("Invitation link copied.","success");}catch{AppCore.ui.toast("Could not copy the invitation link.","error");}});result.append(copy);}catch(err){AppCore.ui.toast(AppCore.ui.describeError(err),"error");}finally{submit.disabled=false;}});AppCore.ui.openModal({title:`Invite to ${client.name}`,content:form,actions:[]});}
function input(placeholder,type="text",required=true){const x=el("input","ap-input");x.placeholder=placeholder;x.type=type;x.required=required;return x;}
