import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";
import { AppCore } from "../core/appCore.js";
import { saveBranding } from "../workspace/branding.js";
import { openTeamInvite } from "../workspace/members.js?v=emailjs-1";

const NAV = [
  ["Home", "home"],
  ["Branding", "branding"],
  ["@Features", null],
  ["Proposals", "proposals"],
  ["Invoices", "invoices"],
  ["Quotes", "quotes"],
  ["Tasks", "tasks"],
  ["Forms", "forms"],
  ["@Integrations", null],
  ["Zapier", "zapier"],
  ["Pabbly Connect", "pabbly"],
  ["@Administration", null],
  ["Members", "members"],
  ["Permissions", "permissions"],
  ["Teams", "teams"],
  ["Billing", "billing"]
];

const ICONS = {
  chef:'<svg viewBox="0 0 32 32"><path d="M9.5 12.2a5.7 5.7 0 0 1 10.6-3.5 5 5 0 0 1 7.4 4.4 5 5 0 0 1-3.1 4.7V24H7.6v-6.2a5.1 5.1 0 0 1 1.9-9.7Z"/><path d="M10.2 24h13.6v3.2H10.2z"/></svg>',
  brand:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11M8.5 19.5l11-11M4.5 15.5l11-11"/></svg>',
  proposal:'<svg viewBox="0 0 24 24"><path d="M7 3h10v18H7z"/><path d="M10 7h4M10 11h5"/></svg>',
  file:'<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4"/></svg>',
  quote:'<svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  fields:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  form:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h2M13 8h3M8 13h2M13 13h3"/></svg>',
  members:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.3-3.2 2.4-5 5.5-5s5.2 1.8 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.5c3-.3 5 1.3 5.3 4.5"/></svg>',
  shield:'<svg viewBox="0 0 24 24"><path d="m12 3 7 3v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10V6z"/><path d="M12 9v4M12 16h.01"/></svg>',
  billing:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18"/></svg>',
  globe:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2 2.3 3 5 3 8s-1 5.7-3 8c-2-2.3-3-5-3-8s1-5.7 3-8Z"/></svg>',
  mail:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m4 7 8 6 8-6"/></svg>',
  palette:'<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 0 0 16h1.3c1.1 0 1.7-1.2 1.1-2.1-.5-.8.1-1.9 1.1-1.9H18a3 3 0 0 0 3-3c0-5-4-9-9-9Z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15" cy="9" r="1"/></svg>',
  login:'<svg viewBox="0 0 24 24"><path d="M14 4h5v16h-5"/><path d="m10 8 4 4-4 4M14 12H4"/></svg>',
  upload:'<svg viewBox="0 0 24 24"><path d="M12 17V5M8 9l4-4 4 4"/><path d="M5 19h14"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>'
};

function el(tag, className="", text=null){const n=document.createElement(tag);if(className)n.className=className;if(text!==null)n.textContent=text;return n;}
function button(text, className="k-btn k-btn--soft"){const b=el("button",className,text);b.type="button";return b;}
function icon(name,className="k-icon"){const s=el("span",className);s.innerHTML=ICONS[name]||ICONS.file;return s;}
function settingKey(name){return `kitchen-clone:${getState().agency?.id||"workspace"}:${name}`;}
function getBool(name, fallback=false){const v=localStorage.getItem(settingKey(name));return v===null?fallback:v==="true";}
function setBool(name,value){localStorage.setItem(settingKey(name),String(value));}
function shortDate(value){if(!value)return "—";return new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric"});}
function slugify(v){return String(v||"workspace").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"workspace";}
function initials(v){return String(v||"U").split(/\s+|@/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"U";}

function sectionTitle(name, subtitle, iconName){const h=el("div","k-settings-title");if(iconName)h.append(icon(iconName,"k-settings-title__icon"));const text=el("div");text.append(el("h1","",name));if(subtitle)text.append(el("p","",subtitle));h.append(text);return h;}
function groupTitle(text){return el("div","k-settings-group-title",text);}
function row({iconName="file",title,subtitle="",right=null,onClick=null}){const r=el("div","k-setting-row");r.append(icon(iconName,"k-setting-row__icon"));const t=el("div","k-setting-row__text");t.append(el("strong","",title));if(subtitle)t.append(el("span","",subtitle));r.append(t);if(right instanceof Node)r.append(right);else if(right!==null)r.append(el("div","k-setting-row__right",String(right)));if(onClick){r.classList.add("k-setting-row--clickable");r.addEventListener("click",onClick);}return r;}
function arrow(){return el("span","k-setting-arrow","→");}
function pencil(){const b=button("✎","k-icon-button");b.setAttribute("aria-label","Edit");return b;}
function upgrade(){return el("span","k-upgrade-badge","Upgrade");}
function switcher(value,onChange){const label=el("label","k-switch");const input=document.createElement("input");input.type="checkbox";input.checked=value;const s=el("span","k-switch__track");input.addEventListener("change",()=>onChange?.(input.checked));label.append(input,s);return label;}

function shell(container,section){container.replaceChildren();container.className="ap-module-content k-settings-page";const root=el("section","k-settings-shell");const side=el("aside","k-settings-sidebar");side.append(el("h2","k-settings-sidebar__title","Settings"));const nav=el("nav","k-settings-nav");for(const [label,key] of NAV){if(label.startsWith("@")){nav.append(el("div","k-settings-nav__group",label.slice(1)));continue;}const b=button(label,"k-settings-nav__item");b.dataset.settingsSection=key;if(section===key)b.classList.add("k-settings-nav__item--active");b.addEventListener("click",()=>document.dispatchEvent(new CustomEvent("kitchen:settings-nav",{detail:{section:key}})));nav.append(b);}side.append(nav);const main=el("div","k-settings-content");root.append(side,main);container.append(root);return main;}

function openWorkspaceNameEditor(context, rerender){const s=getState();const form=el("form","ap-stack");const input=el("input","ap-input");input.value=s.agency.name;input.required=true;const save=button("Save","ap-btn ap-btn--primary");save.type="submit";form.append(input,save);form.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;try{await saveBranding({name:input.value,primaryColor:s.agency.primary_color||"#1769e0",logoFile:null});AppCore.ui.closeModal();rerender();}catch(err){AppCore.ui.toast(AppCore.ui.describeError(err),"error");}finally{save.disabled=false;}});AppCore.ui.openModal({title:"Workspace Name",content:form,actions:[]});input.focus();input.select();}

async function renderHome(main,context,rerender){const s=getState();const page=el("div","k-settings-inner k-settings-home");const identity=el("div","k-settings-workspace-identity");identity.append(icon("chef","k-settings-workspace-logo"));const idText=el("div");idText.append(el("h1","",s.agency.name),el("p","",`${slugify(s.agency.name)}.workspace • Created ${shortDate(s.agency.created_at)}`));identity.append(idText);page.append(identity);

page.append(groupTitle("General"));
const editName=pencil();editName.addEventListener("click",e=>{e.stopPropagation();openWorkspaceNameEditor(context,rerender);});page.append(row({iconName:"fields",title:"Workspace Name",subtitle:"Update how your workspace is named",right:editName}));
const logoBtn=button("Upload","k-btn k-btn--soft");const logoInput=document.createElement("input");logoInput.type="file";logoInput.accept="image/*";logoInput.hidden=true;logoBtn.addEventListener("click",()=>logoInput.click());logoInput.addEventListener("change",async()=>{const f=logoInput.files?.[0];if(!f)return;logoBtn.disabled=true;try{await saveBranding({name:s.agency.name,primaryColor:s.agency.primary_color||"#1769e0",logoFile:f});AppCore.ui.toast("Logo updated.","success");rerender();}catch(err){AppCore.ui.toast(AppCore.ui.describeError(err),"error");}finally{logoBtn.disabled=false;}});const logoRight=el("div","k-setting-row__buttonwrap");logoRight.append(logoInput,logoBtn);page.append(row({iconName:"file",title:"Logo Icon",subtitle:"Shown across your workspace, login, emails, and portals",right:logoRight}));
const favicon=button("Upload","k-btn k-btn--soft");favicon.addEventListener("click",()=>AppCore.ui.toast("Favicon upload can be wired to your deployment assets.","info"));page.append(row({iconName:"file",title:"Favicon",subtitle:"Displayed within the browser tabs and bookmarks bar",right:favicon}));

page.append(groupTitle("Domains"));const domainRight=el("div","k-setting-inline");domainRight.append(upgrade(),el("span","k-setting-arrow","↑"));page.append(row({iconName:"globe",title:"Domain",subtitle:"Use your own domain for a fully branded client experience",right:domainRight}));const emailRight=el("div","k-setting-inline");emailRight.append(upgrade(),el("span","k-setting-arrow","↑"));page.append(row({iconName:"mail",title:"Email Domain",subtitle:"Send emails from your own domain",right:emailRight}));

page.append(groupTitle("Localization"));page.append(row({iconName:"globe",title:"Language",subtitle:"Set the default language for your workspace",right:pencil()}));page.append(row({iconName:"form",title:"Date Format",subtitle:"Set the default date and time format for your workspace",right:pencil()}));page.append(row({iconName:"file",title:"First Day of the Week",subtitle:"Set the default first day of the week for your workspace",right:pencil()}));page.append(row({iconName:"quote",title:"Currency",subtitle:"Set the default currency and format",right:pencil()}));

page.append(groupTitle("Data"));const exp=button("Export","k-btn k-btn--soft");exp.addEventListener("click",()=>AppCore.ui.toast("Export request prepared. Connect this button to your export job when ready.","info"));page.append(row({iconName:"upload",title:"Export",subtitle:"Download your workspace data",right:exp}));

page.append(groupTitle("Danger Zone"));const del=button("Delete","k-btn k-btn--soft");del.addEventListener("click",async()=>{const ok=await AppCore.ui.confirm({title:"Delete workspace?",message:"This action is intentionally not executed by the visual clone. Use your database administration flow for permanent deletion.",confirmLabel:"Close",danger:true});if(ok)AppCore.ui.toast("Workspace was not deleted.","info");});page.append(row({iconName:"trash",title:"Delete Workspace",subtitle:"Permanently delete this workspace and all its data",right:del}));
main.append(page);}

function renderBranding(main){const page=el("div","k-settings-inner");page.append(sectionTitle("Branding","Customize how your workspace looks for your team and clients","brand"));page.append(groupTitle("Workspace"));page.append(row({iconName:"palette",title:"Theme & Colors",subtitle:"Colors, fonts, and interface styling",right:arrow(),onClick:()=>AppCore.ui.toast("Theme editor can be added here.","info")}));page.append(row({iconName:"login",title:"Login",subtitle:"Background, logo, and styling of your login pages",right:arrow(),onClick:()=>AppCore.ui.toast("Login branding can be added here.","info")}));page.append(row({iconName:"mail",title:"Emails",subtitle:"The style and content of email notifications",right:arrow(),onClick:()=>AppCore.ui.toast("Email branding can be added here.","info")}));main.append(page);}

function renderFeatureToggle(main,key,title,subtitle,iconName){const page=el("div","k-settings-inner");page.append(sectionTitle(title,subtitle,iconName));page.append(el("div","k-settings-spacer"));const tog=switcher(getBool(key,false),v=>setBool(key,v));page.append(row({iconName:"login",title:`Enable ${title}`,subtitle:`Turn on to create and manage ${title.toLowerCase()}`,right:tog}));main.append(page);}

function renderProposals(main){const page=el("div","k-settings-inner");page.append(sectionTitle("Proposals","Create, send, and sign proposals and contracts with clients. Proposals can be connected to your preferred document-signing provider.","proposal"));const buttons=el("div","k-settings-hero-buttons");buttons.append(button("Connect Proposal Provider ↗","k-btn k-btn--primary"),button("Learn More ↗","k-btn k-btn--soft"));page.append(buttons,el("div","k-settings-spacer"));const tog=switcher(getBool("proposals-enabled",true),v=>setBool("proposals-enabled",v));page.append(row({iconName:"login",title:"Proposals Enabled",subtitle:"Internal users with proposal permissions can create and manage proposals",right:tog}));page.append(groupTitle("Connect"));const connect=button("Connect","k-btn k-btn--soft");page.append(row({iconName:"proposal",title:"Connect provider",subtitle:"Connect your proposal account to use proposals & contracts in this workspace.",right:connect}));main.append(page);}

function renderTaskFields(main){const page=el("div","k-settings-inner");page.append(sectionTitle("Task Fields","Create global task custom fields that can be used on any board","fields"));const add=button("+  Create Custom Field","k-btn k-btn--primary");page.append(add,el("div","k-settings-spacer k-settings-spacer--sm"));const host=el("div","k-custom-fields");const load=()=>{host.replaceChildren();let fields=[];try{fields=JSON.parse(localStorage.getItem(settingKey("task-fields"))||"[]");}catch{}if(!fields.length){host.append(el("div","k-empty-line","No Custom Fields yet"));return;}fields.forEach((f,i)=>{const del=button("×","k-icon-button");del.addEventListener("click",()=>{fields.splice(i,1);localStorage.setItem(settingKey("task-fields"),JSON.stringify(fields));load();});host.append(row({iconName:"fields",title:f,subtitle:"Custom field",right:del}));});};add.addEventListener("click",()=>{const f=prompt("Custom field name");if(!f?.trim())return;let fields=[];try{fields=JSON.parse(localStorage.getItem(settingKey("task-fields"))||"[]");}catch{}fields.push(f.trim());localStorage.setItem(settingKey("task-fields"),JSON.stringify(fields));load();});load();page.append(host);main.append(page);}

function renderForms(main){const page=el("div","k-settings-inner");page.append(sectionTitle("Contact Forms","Create and embed contact forms on your website","form"));page.append(button("+  Create Form","k-btn k-btn--primary"));const notice=el("div","k-plan-notice");notice.append(el("div","k-plan-notice__icon","↑"));const text=el("div");text.append(el("strong","","Your plan has only 1 forms left"),el("span","","Please upgrade to the next plan to create more forms."));notice.append(text,button("Upgrade","k-btn k-btn--warning"));page.append(notice,el("div","k-empty-line","No Forms yet"));main.append(page);}

function renderIntegration(main,type){const zapier=type==="zapier";const page=el("div","k-settings-inner k-integration-page");const mark=el("div",`k-integration-mark ${zapier?"k-integration-mark--zapier":"k-integration-mark--pabbly"}`,zapier?"✣":"P");const title=el("div","k-integration-title");title.append(mark,el("h1","",zapier?"Zapier":"Pabbly Connect"));page.append(title);page.append(el("p","k-integration-copy",zapier?"Zapier lets you connect this workspace with thousands of apps using simple, no-code automations. Create workflows that react to events in your workspace and automatically pass data between your tools, without writing a single line of code.":"Pabbly Connect gives you a simple way to automate workflows between this workspace and thousands of apps. Connect your tools, react to events in your workspace, and move data automatically, all without code or complex setup."));page.append(el("p","k-integration-copy",zapier?"Build trigger-based workflows to sync boards, tasks, comments, and files with the apps you rely on every day. Send notifications, keep systems in sync, and automate repetitive work so your team can focus on what matters.":"Use triggers and actions to keep your work in sync across apps. Automatically create tasks, send notifications, update records, or move files when something happens so routine work runs in the background while your team stays focused."));const actions=el("div","k-settings-hero-buttons");actions.append(button("View Docs ↗","k-btn k-btn--soft"),button(`Go to ${zapier?"Zapier":"Pabbly Connect"} ↗`,`k-btn k-btn--soft`));page.append(actions);main.append(page);}

async function renderMembers(main,context){const page=el("div","k-settings-inner");page.append(sectionTitle("Members","Manage members and invite new users","members"));if(context.isOwner){const invite=button("+  Invite Members","k-btn k-btn--primary");invite.addEventListener("click",()=>openTeamInvite(async()=>{main.replaceChildren();await renderMembers(main,AppCore.getModuleContext());}));page.append(invite);}const {data:members,error}=await supabase.from("agency_members").select("id,profile_id,role,created_at").eq("agency_id",context.agencyId).in("role",["owner","team"]);if(error)throw error;const ids=(members||[]).map(x=>x.profile_id);let profiles=[];if(ids.length){const r=await supabase.from("profiles").select("id,email,full_name,updated_at").in("id",ids);if(r.error)throw r.error;profiles=r.data||[];}const pmap=new Map(profiles.map(p=>[p.id,p]));const table=el("div","k-members-table");const head=el("div","k-members-row k-members-row--head");["Name","Last Login","Created",""].forEach(x=>head.append(el("span","",x)));table.append(head);for(const m of members||[]){const p=pmap.get(m.profile_id)||{};const name=el("div","k-member-name");name.append(el("span","k-member-avatar",initials(p.full_name||p.email)),el("div","",null));name.lastChild.append(el("strong","",p.full_name||p.email||"Member"),el("span","",`${p.email||""}${m.role==="owner"?" • Owner":""}`));const r=el("div","k-members-row");r.append(name,el("span","",shortDate(p.updated_at)),el("span","",shortDate(m.created_at)),el("span","k-setting-arrow","→"));table.append(r);}page.append(table);main.append(page);}

function renderPermissions(main){const page=el("div","k-settings-inner");page.append(sectionTitle("Roles & Permissions","Create custom roles to control what each member can access and manage in your workspace.","shield"));page.append(button("+  Create Role","k-btn k-btn--primary"));const table=el("div","k-role-table");const head=el("div","k-role-row k-role-row--head");head.append(el("span","","Name"),el("span","","Created"),el("span","",""));table.append(head);[["O","Owner","Full Access • 1 member"],["A","Admin","Full Access • 0 members"],["M","Member","Limited Access • 0 members"]].forEach(([letter,name,sub])=>{const first=el("div","k-role-name");first.append(el("span","k-role-letter",letter));const txt=el("div");txt.append(el("strong","",name),el("span","",sub));first.append(txt);const r=el("div","k-role-row");r.append(first,el("span","","-"),el("span","k-role-info","ⓘ"));table.append(r);});page.append(table);main.append(page);}

function renderTeams(main){const page=el("div","k-settings-inner k-teams-page");const empty=el("div","k-teams-empty");empty.append(el("div","k-teams-empty__icon","♟"),el("h1","","No teams—yet"),el("p","","Create teams to invite multiple members to resources at once"),button("+  Create Team","k-btn k-btn--primary"));empty.querySelector("button").addEventListener("click",()=>AppCore.ui.toast("Team creation UI can be connected to your membership model.","info"));page.append(empty);main.append(page);}

async function renderBilling(main,context){const page=el("div","k-settings-inner");page.append(sectionTitle("Billing","Manage your plan and workspace limits","billing"));const buttons=el("div","k-settings-hero-buttons");buttons.append(button("Buy Lifetime Access","k-btn k-btn--primary"),button("Enter Activation Code","k-btn k-btn--primary"));page.append(buttons);const [{count:memberCount,error:mErr},{data:files,error:fErr}]=await Promise.all([supabase.from("agency_members").select("id",{count:"exact",head:true}).eq("agency_id",context.agencyId).in("role",["owner","team"]),supabase.from("files").select("size_bytes").eq("agency_id",context.agencyId)]);if(mErr)throw mErr;if(fErr)throw fErr;const bytes=(files||[]).reduce((n,f)=>n+(Number(f.size_bytes)||0),0);const notice=el("div","k-billing-notice");notice.append(el("div","k-billing-notice__bang","!"),el("p","","Your free plan includes 2 seats\nUpgrade now to add more team members."),button("Upgrade","k-btn k-btn--warning"));page.append(notice,groupTitle("Plan Information"));page.append(row({iconName:"fields",title:"Plan",subtitle:"Your current plan",right:"Free"}));page.append(row({iconName:"members",title:"Members",subtitle:"Number of internal seats included in your plan",right:`${memberCount||0} of 2 added`}));page.append(row({iconName:"file",title:"Storage",subtitle:"How much storage your workspace is using",right:`${AppCore.utils.formatBytes(bytes)} / 2 GB`}));page.append(groupTitle("Account Owner"));const owner=getState().profile;const ownerRight=pencil();page.append(row({iconName:"members",title:owner?.full_name||owner?.email||"Owner",subtitle:"The person who created this workspace",right:ownerRight}));main.append(page);}

export async function renderSettingsHub(container,context,section="home"){
  const main=shell(container,section);
  const rerender=()=>renderSettingsHub(container,AppCore.getModuleContext(),section);
  try{
    if(section==="home") await renderHome(main,context,rerender);
    else if(section==="branding") renderBranding(main);
    else if(section==="proposals") renderProposals(main);
    else if(section==="invoices") renderFeatureToggle(main,"invoices-enabled","Invoices","Bill your clients easily. Create one-time and recurring invoices.","file");
    else if(section==="quotes") renderFeatureToggle(main,"quotes-enabled","Quotes","Create and send quick price quotes to clients","quote");
    else if(section==="tasks") renderTaskFields(main);
    else if(section==="forms") renderForms(main);
    else if(section==="zapier"||section==="pabbly") renderIntegration(main,section);
    else if(section==="members") await renderMembers(main,context);
    else if(section==="permissions") renderPermissions(main);
    else if(section==="teams") renderTeams(main);
    else if(section==="billing") await renderBilling(main,context);
    else await renderHome(main,context,rerender);
  }catch(error){main.replaceChildren();AppCore.ui.renderError(main,error,()=>renderSettingsHub(container,context,section));}
}
