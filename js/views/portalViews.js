import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { getState } from "../core/state.js";
import { selectFolder, loadFolders, createFolder } from "../workspace/folders.js";
import { openCreateFolder } from "../workspace/folderTree.js";
import { openFolderSharing } from "../workspace/folderPermissions.js";
import { selectModule } from "../core/moduleRegistry.js";
import { emit, on } from "../core/events.js";

const TYPE_META = {
  folder: { label: "Folder", module: "conversation", icon: "folder" },
  board: { label: "Board", module: "boards", icon: "board" },
  conversation: { label: "Conversation", module: "conversation", icon: "chat" },
  doc: { label: "Document", module: "docs", icon: "doc" },
  file: { label: "File", module: "files", icon: "file" },
  embed: { label: "Embed", module: null, icon: "link" },
  invoice: { label: "Invoice", module: "invoices", icon: "invoice" },
  task: { label: "Task", module: "boards", icon: "task" }
};

function el(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}
function btn(label, className = "ap-btn ap-btn--secondary") {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}
function icon(name) {
  const span = el("span", `ap-line-icon ap-line-icon--${name}`);
  span.setAttribute("aria-hidden", "true");
  return span;
}
function titleBlock(title, subtitle = "") {
  const wrap = el("div", "ap-view-title");
  wrap.append(el("h1", "ap-view-title__heading", title));
  if (subtitle) wrap.append(el("p", "ap-view-title__subtitle", subtitle));
  return wrap;
}
function folderById(id) { return AppCore.getFolders().find((f) => f.id === id) || null; }
function safeDate(value) { return value ? AppCore.utils.formatDate(value, "short") : "—"; }
function visibilityText(row) { return row.client_visible ? "Client" : "Internal"; }

async function navigateItem(item) {
  if (item.type === "embed") {
    if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (!item.folder_id) return;
  await selectFolder(item.folder_id, { skipOverview: true });
  const moduleName = TYPE_META[item.type]?.module || "conversation";
  await selectModule(moduleName);
}

function buildFilterBar({ placeholder = "Search…", onInput, visibility = false, extra = [] } = {}) {
  const bar = el("div", "ap-collection-filters");
  const search = el("input", "ap-collection-search");
  search.type = "search";
  search.placeholder = placeholder;
  search.setAttribute("aria-label", placeholder.replace("…", ""));
  const run = AppCore.utils.debounce(() => onInput?.(search.value, controls), 150);
  search.addEventListener("input", run);
  bar.append(search);
  const controls = {};
  if (visibility) {
    const select = el("select", "ap-filter-select");
    [["", "Visibility"], ["client", "Client-visible"], ["internal", "Internal"]].forEach(([value, label]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option);
    });
    select.addEventListener("change", () => onInput?.(search.value, controls));
    controls.visibility = select;
    bar.append(select);
  }
  for (const spec of extra) {
    const select = el("select", "ap-filter-select");
    spec.options.forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option); });
    select.addEventListener("change", () => onInput?.(search.value, controls));
    controls[spec.key] = select;
    bar.append(select);
  }
  return { bar, search, controls };
}

function renderDataTable(host, items, { showVisibility = true, onOpen = navigateItem, actions = null } = {}) {
  host.replaceChildren();
  const table = el("div", "ap-library-table");
  const head = el("div", "ap-library-table__row ap-library-table__row--head");
  head.append(el("span", "", "Name"), el("span", "", "Kind"));
  if (showVisibility) head.append(el("span", "", "Visibility"));
  head.append(el("span", "", "Created"), el("span", "", ""));
  table.append(head);
  for (const item of items) {
    const row = el("div", "ap-library-table__row");
    row.dataset.itemId = item.id;
    const nameCell = el("div", "ap-library-name");
    const iconWrap = el("span", "ap-library-name__icon"); iconWrap.append(icon(TYPE_META[item.type]?.icon || "file"));
    const text = el("div"); text.append(el("strong", "", item.title));
    if (item.subtitle) text.append(el("small", "", item.subtitle));
    nameCell.append(iconWrap, text);
    const open = btn("", "ap-library-row-button");
    open.setAttribute("aria-label", `Open ${item.title}`);
    open.addEventListener("click", () => onOpen(item));
    nameCell.append(open);
    row.append(nameCell, el("span", "ap-library-muted", TYPE_META[item.type]?.label || item.type));
    if (showVisibility) row.append(el("span", "ap-library-muted", item.visibility === "Client" ? "Shared with clients" : item.visibility === "Internal" ? "--" : (item.visibility || "--")));
    row.append(el("span", "ap-library-muted", safeDate(item.created_at)));
    const actionCell = el("div", "ap-library-actions");
    if (actions) actions(item, actionCell);
    else { const arrow = btn("›", "ap-icon-button"); arrow.addEventListener("click", () => onOpen(item)); actionCell.append(arrow); }
    row.append(actionCell);
    table.append(row);
  }
  host.append(table);
}

async function queryRecentItems(agencyId) {
  const results = await Promise.all([
    supabase.from("files").select("id,folder_id,original_name,mime_type,client_visible,created_at").eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(4),
    supabase.from("docs").select("id,folder_id,title,client_visible,created_at,trashed_at").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }).limit(4),
    supabase.from("boards").select("id,folder_id,title,client_visible,created_at,trashed_at").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }).limit(4),
    supabase.from("conversations").select("id,folder_id,title,client_visible,created_at,trashed_at").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("last_message_at", { ascending: false, nullsFirst: false }).limit(4)
  ]);
  const failures = results.filter((r) => r.error);
  if (failures.length) throw failures[0].error;
  return [
    ...(results[0].data || []).map((r) => ({ id: r.id, type: "file", folder_id: r.folder_id, title: r.original_name, subtitle: r.mime_type, visibility: visibilityText(r), created_at: r.created_at })),
    ...(results[1].data || []).map((r) => ({ id: r.id, type: "doc", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at })),
    ...(results[2].data || []).map((r) => ({ id: r.id, type: "board", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at })),
    ...(results[3].data || []).map((r) => ({ id: r.id, type: "conversation", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
}

export async function renderHome(container, context) {
  AppCore.ui.renderLoading(container, "Loading workspace…");
  try {
    const recentItems = await queryRecentItems(context.agencyId);
    container.replaceChildren();
    if (container.id === "module-content") container.className = "ap-module-content k-page-panel k-home-page";
    else container.classList.add("k-home-embedded");
    const root = el("section", "ap-hub-view ap-home-view");
    root.dataset.view = "home";
    const displayName = context.profile?.full_name || context.profile?.email?.split("@")[0] || "there";
    const hero = el("div", "ap-home-hero");
    hero.append(el("h1", "k-home-welcome", `👋 Welcome, ${displayName}!`));
    root.append(hero);

    const liveFolders = AppCore.getFolders().filter((f) => !f.archived_at && !f.trashed_at).slice(0, 4);
    const folderSection = el("section", "ap-home-section");
    folderSection.append(el("h2", "ap-section-label", "Recent Folders"));
    const cards = el("div", "ap-folder-cards");
    for (const folder of liveFolders) {
      const card = btn("", "ap-folder-card");
      const tile = el("span", "ap-folder-card__tile");
      tile.style.setProperty("--folder-color", folder.color || "#ffbd0a");
      tile.append(icon("folder"));
      const count = recentItems.filter((item) => item.folder_id === folder.id).length;
      card.append(tile, el("strong", "ap-folder-card__name", folder.name), el("small", "ap-folder-card__meta", `${count} item${count === 1 ? "" : "s"}`));
      card.addEventListener("click", () => selectFolder(folder.id));
      cards.append(card);
    }
    if (!liveFolders.length) cards.append(el("div", "ap-soft-empty", "Your folders will appear here."));
    folderSection.append(cards); root.append(folderSection);

    const recent = el("section", "ap-home-section k-home-recent");
    recent.append(el("h2", "ap-section-label", "Recent Items"));
    const recentHost = el("div");
    if (recentItems.length) renderDataTable(recentHost, recentItems, { showVisibility: true });
    else recentHost.append(el("p", "ap-soft-empty", "Your recent work will appear here."));
    recent.append(recentHost); root.append(recent);

    if (context.isStaff) {
      const create = el("section", "ap-home-section k-home-create");
      create.append(el("h2", "ap-section-label", "Create"));
      const createCards = el("div", "ap-create-grid");
      const specs = [
        ["New Folder", "Organize everything", "folder", () => openCreateFolder()],
        ["Board", "Track projects", "board", () => chooseFolder("Choose a folder for the board", async (folderId) => { await selectFolder(folderId, { skipOverview: true }); await selectModule("boards"); })],
        ["Conversation", "Discuss anything", "chat", () => chooseFolder("Choose a folder for the conversation", async (folderId) => { await selectFolder(folderId, { skipOverview: true }); await selectModule("conversation"); })],
        ["Embed", "Add third-party apps", "link", () => openEmbedForm(context)],
        ["Document", "Curate content", "doc", () => chooseFolder("Choose a folder for the document", async (folderId) => { await selectFolder(folderId, { skipOverview: true }); await selectModule("docs"); })],
        ["Client", "Invite clients", "members", () => document.dispatchEvent(new CustomEvent("kitchen:clients"))]
      ];
      for (const [label, sub, iconName, handler] of specs) {
        const card = btn("", "ap-create-card"); card.append(icon(iconName), el("strong", "", label), el("small", "", sub)); card.addEventListener("click", handler); createCards.append(card);
      }
      create.append(createCards); root.append(create);
    }
    container.append(root);
  } catch (error) { AppCore.ui.renderError(container, error, () => renderHome(container, context)); }
}

export async function renderFolderOverview(container, context, folderId = context.folderId) {
  const folder = AppCore.getFolders().find((f) => f.id === folderId);
  if (!folder) return AppCore.ui.renderEmpty(container, { title: "Folder not found", message: "This folder is not available." });
  AppCore.ui.renderLoading(container, "Loading folder…");
  try {
    const [boards, conversations, docs, files, embeds] = await Promise.all([
      supabase.from("boards").select("*").eq("folder_id", folderId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }),
      supabase.from("conversations").select("*").eq("folder_id", folderId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }),
      supabase.from("docs").select("*").eq("folder_id", folderId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }),
      supabase.from("files").select("*").eq("folder_id", folderId).order("created_at", { ascending: false }),
      supabase.from("embeds").select("*").eq("folder_id", folderId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false })
    ]);
    const failure = [boards, conversations, docs, files, embeds].find((r) => r.error);
    if (failure) throw failure.error;
    const items = [
      ...(boards.data || []).map((r) => ({ id:r.id,type:"board",folder_id:folderId,title:r.title,visibility:visibilityText(r),created_at:r.created_at })),
      ...(conversations.data || []).map((r) => ({ id:r.id,type:"conversation",folder_id:folderId,title:r.title,visibility:visibilityText(r),created_at:r.created_at })),
      ...(docs.data || []).map((r) => ({ id:r.id,type:"doc",folder_id:folderId,title:r.title,visibility:visibilityText(r),created_at:r.created_at })),
      ...(files.data || []).map((r) => ({ id:r.id,type:"file",folder_id:folderId,title:r.original_name,subtitle:AppCore.utils.formatBytes(r.size_bytes),visibility:visibilityText(r),created_at:r.created_at })),
      ...(embeds.data || []).map((r) => ({ id:r.id,type:"embed",folder_id:folderId,title:r.title,subtitle:r.url,url:r.url,visibility:visibilityText(r),created_at:r.created_at }))
    ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    container.replaceChildren();
    const root=el("section","ap-hub-view ap-folder-overview");
    const heading=el("div","ap-library-heading");
    const headingText=titleBlock(folder.name,`${items.length} item${items.length===1?"":"s"}`);
    heading.append(headingText);
    if(context.isStaff){const actions=el("div","ap-invoice-global-actions");const share=btn("Share","ap-btn ap-btn--secondary ap-btn--sm");share.addEventListener("click",()=>openFolderSharing(folderId).catch(error=>AppCore.ui.toast(AppCore.ui.describeError(error),"error")));const create=btn("+ Create","ap-btn ap-btn--primary ap-btn--sm");create.addEventListener("click",()=>openFolderCreateMenu(context,folderId));actions.append(share,create);heading.append(actions);}
    root.append(heading);
    let filtered=items;const host=el("div");
    const apply=(q,controls)=>{const text=q.trim().toLowerCase();const vis=controls.visibility?.value||"";filtered=items.filter(item=>(!text||`${item.title} ${item.subtitle||""}`.toLowerCase().includes(text))&&(!vis||(vis==="client"?item.visibility==="Client":item.visibility==="Internal")));if(!filtered.length){host.replaceChildren();const empty=el("div","ap-centered-empty");empty.append(icon("folder"),el("h3","","This folder is empty"),el("p","","Create a board, conversation, document, file or embed to get started."));host.append(empty);}else renderDataTable(host,filtered,{showVisibility:true});};
    const {bar,search,controls}=buildFilterBar({placeholder:"Search this folder…",visibility:true,onInput:apply});
    root.append(bar,host);container.append(root);apply(search.value,controls);
  } catch(error) {
    if(String(error?.message||error).includes("embeds")){container.replaceChildren();const root=el("section","ap-hub-view");root.append(titleBlock(folder.name,"Run migration 0300_portal_experience.sql to enable the complete folder view."));container.append(root);return;}
    AppCore.ui.renderError(container,error,()=>renderFolderOverview(container,context,folderId));
  }
}

function openFolderCreateMenu(context,folderId){
  const wrap=el("div","ap-create-menu");
  const specs=[["Board","board","boards"],["Conversation","chat","conversation"],["Document","doc","docs"],["File","file","files"]];
  for(const [label,iconName,moduleName] of specs){const item=btn("","ap-create-menu__item");item.append(icon(iconName),el("div","",label));item.addEventListener("click",async()=>{AppCore.ui.closeModal();await selectFolder(folderId,{skipOverview:true});await selectModule(moduleName);});wrap.append(item);}
  const embed=btn("","ap-create-menu__item");embed.append(icon("link"),el("div","","Embed"));embed.addEventListener("click",()=>{AppCore.ui.closeModal();openEmbedForm({...context,folderId});});wrap.append(embed);AppCore.ui.openModal({title:"Create",content:wrap,actions:[]});
}

async function chooseFolder(title, callback) {
  const folders = AppCore.getFolders().filter((f) => !f.archived_at && !f.trashed_at);
  if (!folders.length) return AppCore.ui.toast("Create a folder first.", "warning");
  const wrap = el("div", "ap-folder-picker");
  for (const folder of folders) {
    const item = btn("", "ap-folder-picker__item"); item.append(icon("folder"), el("span", "", folder.name));
    item.addEventListener("click", async () => { AppCore.ui.closeModal(); await callback(folder.id); });
    wrap.append(item);
  }
  AppCore.ui.openModal({ title, content: wrap, actions: [] });
}

function openEmbedForm(context, existing = null, onDone = null) {
  const form = el("form", "ap-stack");
  const title = el("input", "ap-input"); title.placeholder = "Embed title"; title.required = true; title.maxLength = 200; title.value = existing?.title || "";
  const url = el("input", "ap-input"); url.type = "url"; url.placeholder = "https://…"; url.required = true; url.value = existing?.url || "";
  const description = el("textarea", "ap-textarea"); description.rows = 3; description.placeholder = "Optional description"; description.value = existing?.description || "";
  const folder = el("select", "ap-select");
  for (const f of AppCore.getFolders().filter((x) => !x.archived_at && !x.trashed_at)) { const o = document.createElement("option"); o.value = f.id; o.textContent = f.name; o.selected = f.id === (existing?.folder_id || context.folderId); folder.append(o); }
  const visibleLabel = el("label", "ap-checkbox-label"); const visible = document.createElement("input"); visible.type = "checkbox"; visible.checked = existing?.client_visible || false; visibleLabel.append(visible, document.createTextNode(" Visible to clients"));
  const submit = btn(existing ? "Save embed" : "Create embed", "ap-btn ap-btn--primary"); submit.type = "submit";
  form.append(title, url, description, folder, visibleLabel, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); submit.disabled = true;
    try {
      const payload = { agency_id: context.agencyId, folder_id: folder.value, title: title.value.trim(), url: url.value.trim(), description: description.value.trim() || null, client_visible: visible.checked };
      let result;
      if (existing) result = await supabase.from("embeds").update(payload).eq("id", existing.id).select().single();
      else result = await supabase.from("embeds").insert({ ...payload, created_by: context.user.id }).select().single();
      if (result.error) throw result.error;
      AppCore.ui.closeModal(); AppCore.ui.toast(existing ? "Embed updated." : "Embed created.", "success"); emit("data:changed", { entity: "embed", entityId: result.data.id, folderId: result.data.folder_id, action: existing ? "updated" : "created" }); onDone?.();
    } catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
    finally { submit.disabled = false; }
  });
  AppCore.ui.openModal({ title: existing ? "Edit embed" : "New embed", content: form, actions: [] });
}

async function fetchLibraryItems(context, category) {
  const agencyId = context.agencyId;
  const fetchers = {
    boards: async () => { const { data, error } = await supabase.from("boards").select("*").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }); if (error) throw error; return (data || []).map((r) => ({ id: r.id, type: "board", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at, raw: r })); },
    conversations: async () => { const { data, error } = await supabase.from("conversations").select("*").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }); if (error) throw error; return (data || []).map((r) => ({ id: r.id, type: "conversation", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at, raw: r })); },
    docs: async () => { const { data, error } = await supabase.from("docs").select("*").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }); if (error) throw error; return (data || []).map((r) => ({ id: r.id, type: "doc", folder_id: r.folder_id, title: r.title, visibility: visibilityText(r), created_at: r.created_at, raw: r })); },
    files: async () => { const { data, error } = await supabase.from("files").select("*").eq("agency_id", agencyId).order("created_at", { ascending: false }); if (error) throw error; return (data || []).map((r) => ({ id: r.id, type: "file", folder_id: r.folder_id, title: r.original_name, subtitle: AppCore.utils.formatBytes(r.size_bytes), visibility: visibilityText(r), created_at: r.created_at, raw: r })); },
    embeds: async () => { const { data, error } = await supabase.from("embeds").select("*").eq("agency_id", agencyId).is("archived_at", null).is("trashed_at", null).order("updated_at", { ascending: false }); if (error) throw error; return (data || []).map((r) => ({ id: r.id, type: "embed", folder_id: r.folder_id, title: r.title, subtitle: r.url, url: r.url, visibility: visibilityText(r), created_at: r.created_at, raw: r })); }
  };
  if (category === "everything") {
    const chunks = await Promise.all(Object.values(fetchers).map((fn) => fn()));
    return chunks.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return fetchers[category]?.() || [];
}

export async function renderLibrary(container, context, category = "everything") {
  const labels = { everything: "Everything", boards: "Boards", conversations: "Conversations", docs: "Documents", embeds: "Embeds", files: "Files", archive: "Archive", trash: "Trash" };
  AppCore.ui.renderLoading(container, `Loading ${labels[category] || "library"}…`);
  try {
    if (category === "archive") return renderArchive(container, context);
    if (category === "trash") return renderTrash(container, context);
    const items = await fetchLibraryItems(context, category);
    container.replaceChildren();
    const root = el("section", "ap-hub-view ap-library-view"); root.dataset.view = `library-${category}`;
    const top = el("div", "ap-library-heading"); top.append(titleBlock(labels[category] || "Library", category === "everything" ? "Browse every item in your workspace." : `Browse ${labels[category].toLowerCase()} across every folder.`));
    if (context.isStaff && category === "embeds") { const create = btn("Create Embed", "ap-btn ap-btn--primary ap-btn--sm"); create.addEventListener("click", () => openEmbedForm(context, null, () => renderLibrary(container, context, category))); top.append(create); }
    root.append(top);
    let filtered = items;
    const listHost = el("div");
    const apply = (query, controls) => {
      const q = query.trim().toLowerCase(); const vis = controls.visibility?.value || "";
      filtered = items.filter((item) => (!q || `${item.title} ${item.subtitle || ""}`.toLowerCase().includes(q)) && (!vis || (vis === "client" ? item.visibility === "Client" : item.visibility === "Internal")));
      if (!filtered.length) { listHost.replaceChildren(); const empty = el("div", "ap-centered-empty"); empty.append(icon(category === "embeds" ? "link" : "library"), el("h3", "", `No ${labels[category].toLowerCase()} yet`), el("p", "", "New work will appear here as your team creates it.")); listHost.append(empty); }
      else renderDataTable(listHost, filtered, { showVisibility: true, actions: (item, cell) => {
        if (item.type === "embed" && context.isStaff) { const edit = btn("•••", "ap-icon-button"); edit.addEventListener("click", () => openEmbedActions(context, item.raw, () => renderLibrary(container, context, category))); cell.append(edit); }
        else { const open = btn("›", "ap-icon-button"); open.addEventListener("click", () => navigateItem(item)); cell.append(open); }
      }});
    };
    const { bar, search, controls } = buildFilterBar({ placeholder: `Search ${labels[category].toLowerCase()}…`, visibility: category !== "files" ? true : true, onInput: apply });
    root.append(bar, listHost); container.append(root); apply(search.value, controls);
  } catch (error) {
    if (String(error?.message || error).includes("embeds")) {
      container.replaceChildren(); const root = el("section", "ap-hub-view"); root.append(titleBlock("Embeds", "Run migration 0300_portal_experience.sql to enable this view.")); container.append(root); return;
    }
    AppCore.ui.renderError(container, error, () => renderLibrary(container, context, category));
  }
}

function openEmbedActions(context, embed, onDone) {
  const wrap = el("div", "ap-menu-list");
  const open = btn("Open link", "ap-menu-list__item"); open.addEventListener("click", () => window.open(embed.url, "_blank", "noopener,noreferrer"));
  const edit = btn("Edit", "ap-menu-list__item"); edit.addEventListener("click", () => { AppCore.ui.closeModal(); openEmbedForm(context, embed, onDone); });
  const archive = btn("Archive", "ap-menu-list__item"); archive.addEventListener("click", async () => { const { error } = await supabase.from("embeds").update({ archived_at: new Date().toISOString() }).eq("id", embed.id); if (error) return AppCore.ui.toast(AppCore.ui.describeError(error), "error"); AppCore.ui.closeModal(); onDone?.(); });
  const trash = btn("Move to Trash", "ap-menu-list__item ap-menu-list__item--danger"); trash.addEventListener("click", async () => { const { error } = await supabase.from("embeds").update({ trashed_at: new Date().toISOString() }).eq("id", embed.id); if (error) return AppCore.ui.toast(AppCore.ui.describeError(error), "error"); AppCore.ui.closeModal(); onDone?.(); });
  wrap.append(open, edit, archive, trash); AppCore.ui.openModal({ title: embed.title, content: wrap, actions: [] });
}

async function renderArchive(container, context) {
  const q = [
    supabase.from("folders").select("id,name,created_at,archived_at,trashed_at").eq("agency_id", context.agencyId).not("archived_at", "is", null).is("trashed_at", null),
    supabase.from("boards").select("id,folder_id,title,created_at,archived_at,trashed_at").eq("agency_id", context.agencyId).not("archived_at", "is", null).is("trashed_at", null),
    supabase.from("conversations").select("id,folder_id,title,created_at,archived_at,trashed_at").eq("agency_id", context.agencyId).not("archived_at", "is", null).is("trashed_at", null),
    supabase.from("docs").select("id,folder_id,title,created_at,archived_at,trashed_at").eq("agency_id", context.agencyId).not("archived_at", "is", null).is("trashed_at", null),
    supabase.from("embeds").select("id,folder_id,title,url,created_at,archived_at,trashed_at").eq("agency_id", context.agencyId).not("archived_at", "is", null).is("trashed_at", null)
  ];
  const rows = await Promise.all(q); const fail = rows.find((r) => r.error); if (fail) throw fail.error;
  const items = [
    ...(rows[0].data || []).map((r) => ({ id:r.id,type:"folder",folder_id:r.id,title:r.name,created_at:r.archived_at,raw:r })),
    ...(rows[1].data || []).map((r) => ({ id:r.id,type:"board",folder_id:r.folder_id,title:r.title,created_at:r.archived_at,raw:r })),
    ...(rows[2].data || []).map((r) => ({ id:r.id,type:"conversation",folder_id:r.folder_id,title:r.title,created_at:r.archived_at,raw:r })),
    ...(rows[3].data || []).map((r) => ({ id:r.id,type:"doc",folder_id:r.folder_id,title:r.title,created_at:r.archived_at,raw:r })),
    ...(rows[4].data || []).map((r) => ({ id:r.id,type:"embed",folder_id:r.folder_id,title:r.title,url:r.url,created_at:r.archived_at,raw:r }))
  ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  container.replaceChildren(); const root=el("section","ap-hub-view"); root.append(titleBlock("Archive","Items you archived stay here until you restore or move them to Trash."));
  const host=el("div"); if(!items.length){const empty=el("div","ap-centered-empty");empty.append(icon("archive"),el("h3","","Archive is empty"),el("p","","Archived work will appear here."));host.append(empty);}else renderDataTable(host,items,{showVisibility:false,actions:(item,cell)=>{
    const restore=btn("Restore","ap-btn ap-btn--secondary ap-btn--sm");restore.addEventListener("click",()=>restoreArchived(item,()=>renderArchive(container,context))); const trash=btn("Trash","ap-btn ap-btn--ghost ap-btn--sm");trash.addEventListener("click",()=>trashItem(item,()=>renderArchive(container,context)));cell.append(restore,trash);
  }}); root.append(host);container.append(root);
}

async function restoreArchived(item, done) {
  const table = ({folder:"folders",board:"boards",conversation:"conversations",doc:"docs",embed:"embeds"})[item.type];
  const {error}=await supabase.from(table).update({archived_at:null}).eq("id",item.id); if(error)return AppCore.ui.toast(AppCore.ui.describeError(error),"error"); if(item.type==="folder")await loadFolders(); AppCore.ui.toast("Restored.","success"); done?.();
}
async function trashItem(item, done) {
  const table=({folder:"folders",board:"boards",conversation:"conversations",doc:"docs",embed:"embeds"})[item.type];
  const {error}=await supabase.from(table).update({trashed_at:new Date().toISOString()}).eq("id",item.id); if(error)return AppCore.ui.toast(AppCore.ui.describeError(error),"error"); if(item.type==="folder")await loadFolders(); done?.();
}

async function renderTrash(container, context) {
  const qs=[
    supabase.from("folders").select("id,name,trashed_at").eq("agency_id",context.agencyId).not("trashed_at","is",null),
    supabase.from("boards").select("id,folder_id,title,trashed_at").eq("agency_id",context.agencyId).not("trashed_at","is",null),
    supabase.from("conversations").select("id,folder_id,title,trashed_at").eq("agency_id",context.agencyId).not("trashed_at","is",null),
    supabase.from("docs").select("id,folder_id,title,trashed_at").eq("agency_id",context.agencyId).not("trashed_at","is",null),
    supabase.from("embeds").select("id,folder_id,title,url,trashed_at").eq("agency_id",context.agencyId).not("trashed_at","is",null)
  ];
  const rows=await Promise.all(qs);const fail=rows.find(r=>r.error);if(fail)throw fail.error;
  const items=[...(rows[0].data||[]).map(r=>({id:r.id,type:"folder",folder_id:r.id,title:r.name,created_at:r.trashed_at})),...(rows[1].data||[]).map(r=>({id:r.id,type:"board",folder_id:r.folder_id,title:r.title,created_at:r.trashed_at})),...(rows[2].data||[]).map(r=>({id:r.id,type:"conversation",folder_id:r.folder_id,title:r.title,created_at:r.trashed_at})),...(rows[3].data||[]).map(r=>({id:r.id,type:"doc",folder_id:r.folder_id,title:r.title,created_at:r.trashed_at})),...(rows[4].data||[]).map(r=>({id:r.id,type:"embed",folder_id:r.folder_id,title:r.title,url:r.url,created_at:r.trashed_at}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  container.replaceChildren();const root=el("section","ap-hub-view");const heading=el("div","ap-library-heading");heading.append(titleBlock("Trash","Deleted items stay here until permanently removed."));if(context.isStaff&&items.length){const empty=btn("Empty Trash","ap-btn ap-btn--danger ap-btn--sm");empty.addEventListener("click",()=>emptyTrash(items,()=>renderTrash(container,context)));heading.append(empty);}root.append(heading);const host=el("div");if(!items.length){const empty=el("div","ap-centered-empty");empty.append(icon("trash"),el("h3","","Trash is empty"),el("p","","Items moved to Trash will appear here."));host.append(empty);}else renderDataTable(host,items,{showVisibility:false,actions:(item,cell)=>{const restore=btn("Restore","ap-btn ap-btn--secondary ap-btn--sm");restore.addEventListener("click",()=>restoreTrash(item,()=>renderTrash(container,context)));cell.append(restore);}});root.append(host);container.append(root);
}
async function restoreTrash(item,done){const table=({folder:"folders",board:"boards",conversation:"conversations",doc:"docs",embed:"embeds"})[item.type];const {error}=await supabase.from(table).update({trashed_at:null}).eq("id",item.id);if(error)return AppCore.ui.toast(AppCore.ui.describeError(error),"error");if(item.type==="folder")await loadFolders();done?.();}
async function emptyTrash(items,done){if(!await AppCore.ui.confirm({title:"Empty Trash?",message:"This permanently deletes every item currently in Trash. This cannot be undone.",confirmLabel:"Empty Trash",danger:true}))return;for(const item of items){const table=({folder:"folders",board:"boards",conversation:"conversations",doc:"docs",embed:"embeds"})[item.type];const {error}=await supabase.from(table).delete().eq("id",item.id);if(error)return AppCore.ui.toast(AppCore.ui.describeError(error),"error");}await loadFolders();AppCore.ui.toast("Trash emptied.","success");done?.();}

async function loadTasks(context, mineOnly = false) {
  let query=supabase.from("tasks").select("*").eq("agency_id",context.agencyId).order("due_date",{ascending:true,nullsFirst:false}).order("updated_at",{ascending:false});
  if(mineOnly)query=query.eq("assignee_id",context.user.id);
  const {data,error}=await query;if(error)throw error;return data||[];
}

export async function renderTasksHub(container, context, { mineOnly = false } = {}) {
  AppCore.ui.renderLoading(container,"Loading tasks…");
  try {
    const [tasks,{data:boards,error:bErr}] = await Promise.all([
      loadTasks(context,mineOnly),
      supabase.from("boards").select("id,title").eq("agency_id",context.agencyId)
    ]);
    if (bErr) throw bErr;
    const boardMap = new Map((boards||[]).map(b=>[b.id,b.title]));
    container.replaceChildren();
    if (container.id === "module-content") container.className = "ap-module-content k-page-panel k-tasks-page";
    const root=el("section","ap-hub-view ap-tasks-hub");
    const openTasks=tasks.filter(t=>!t.completed_at), completedTasks=tasks.filter(t=>!!t.completed_at);
    const top=el("div","k-task-top");
    const statusTabs=el("div","k-task-status-tabs");
    const all=btn("","k-task-status-tab k-task-status-tab--active");all.append(document.createTextNode("All Tasks "),el("small","",String(openTasks.length)));
    const completed=btn("Completed","k-task-status-tab");statusTabs.append(all,completed);
    const actions=el("div","k-task-actions");["▽","↕","☷","•••"].forEach(x=>actions.append(btn(x,"k-task-action")));top.append(statusTabs,actions);root.append(top);
    const modes=el("div","k-task-mode-tabs");const tableBtn=btn("Table","k-task-mode-tab k-task-mode-tab--active"),calBtn=btn("Calendar","k-task-mode-tab");modes.append(tableBtn,calBtn);root.append(modes);
    const host=el("div","k-task-host");root.append(host);container.append(root);
    let mode="table",filter="all",calendarDate=new Date();
    const draw=()=>{const list=filter==="completed"?completedTasks:openTasks;if(mode==="calendar")renderTaskCalendar(host,list,calendarDate,(next)=>{calendarDate=next;draw();});else renderTaskTable(host,list,boardMap);};
    tableBtn.addEventListener("click",()=>{mode="table";root.classList.remove("k-calendar-mode");tableBtn.classList.add("k-task-mode-tab--active");calBtn.classList.remove("k-task-mode-tab--active");draw();});
    calBtn.addEventListener("click",()=>{mode="calendar";root.classList.add("k-calendar-mode");calBtn.classList.add("k-task-mode-tab--active");tableBtn.classList.remove("k-task-mode-tab--active");draw();});
    all.addEventListener("click",()=>{filter="all";all.classList.add("k-task-status-tab--active");completed.classList.remove("k-task-status-tab--active");draw();});
    completed.addEventListener("click",()=>{filter="completed";completed.classList.add("k-task-status-tab--active");all.classList.remove("k-task-status-tab--active");draw();});
    draw();
  } catch(error) { AppCore.ui.renderError(container,error,()=>renderTasksHub(container,context,{mineOnly})); }
}
function renderTaskTable(host,tasks,boardMap=new Map()){
  host.replaceChildren();
  const table=el("div","k-task-table");
  const head=el("div","k-task-row k-task-row--head");["Task","Board","Members","Due Date"].forEach(x=>head.append(el("span","",x)));table.append(head);
  if(!tasks.length){table.append(el("div","k-task-empty","No tasks in this view"));host.append(table);return;}
  for(const t of tasks){const row=el("div","k-task-row");const task=el("div","k-task-name");const check=btn("","k-task-check");check.setAttribute("aria-label","Open task");check.addEventListener("click",()=>navigateItem({type:"task",folder_id:t.folder_id}));task.append(check,el("strong","",t.title));row.append(task,el("span","",boardMap.get(t.board_id)||"—"),el("span","k-task-muted",t.assignee_id?"1":"--"),el("span","k-task-muted",t.due_date?safeDate(t.due_date):"--"));table.append(row);}
  host.append(table,el("div","k-task-count",`1-${tasks.length} of ${tasks.length}`));
}
function renderTaskCalendar(host,tasks,focusDate=new Date(),onNavigate){
  host.replaceChildren();
  const year=focusDate.getFullYear(),month=focusDate.getMonth();
  const first=new Date(year,month,1),last=new Date(year,month+1,0);
  const start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
  const end=new Date(last);end.setDate(last.getDate()+(6-((last.getDay()+6)%7)));
  const wrap=el("div","k-calendar");const toolbar=el("div","k-calendar-toolbar");
  const prev=btn("‹","k-calendar-nav"),next=btn("›","k-calendar-nav");
  prev.addEventListener("click",()=>onNavigate?.(new Date(year,month-1,1)));next.addEventListener("click",()=>onNavigate?.(new Date(year,month+1,1)));
  const title=el("strong","",focusDate.toLocaleDateString(undefined,{month:"long",year:"numeric"}));toolbar.append(prev,title,next);wrap.append(toolbar);
  const week=el("div","k-calendar-weekdays");["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(d=>week.append(el("span","",d)));wrap.append(week);
  const grid=el("div","k-calendar-grid");
  const weeks=Math.round((end-start)/86400000+1)/7;grid.style.gridTemplateRows=`repeat(${weeks},minmax(100px,1fr))`;
  const today=new Date();today.setHours(0,0,0,0);
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const date=new Date(d),cell=el("div","k-calendar-cell");if(date.getMonth()!==month)cell.classList.add("k-calendar-cell--muted");
    const num=el("span","k-calendar-date",String(date.getDate()));if(+date===+today)num.classList.add("k-calendar-date--today");cell.append(num);
    const iso=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    tasks.filter(t=>t.due_date===iso).slice(0,3).forEach(t=>{const chip=btn(t.title,"k-calendar-task");chip.addEventListener("click",()=>navigateItem({type:"task",folder_id:t.folder_id}));cell.append(chip);});grid.append(cell);
  }
  wrap.append(grid);host.append(wrap);
}

export async function renderInvoicesHub(container,context){AppCore.ui.renderLoading(container,"Loading invoices…");try{const [{data:invoices,error:iErr},{data:clients,error:cErr}]=await Promise.all([supabase.from("invoices").select("*").eq("agency_id",context.agencyId).order("created_at",{ascending:false}),context.isStaff?supabase.from("clients").select("id,name").eq("agency_id",context.agencyId).is("archived_at",null):Promise.resolve({data:[],error:null})]);if(iErr)throw iErr;if(cErr)throw cErr;const clientMap=new Map((clients||[]).map(c=>[c.id,c.name]));container.replaceChildren();const root=el("section","ap-hub-view ap-global-invoices");const heading=el("div","ap-library-heading");heading.append(titleBlock("Invoices","Create, send and track billing across the whole workspace."));if(context.isStaff){const actions=el("div","ap-invoice-global-actions");const upload=btn("Upload Invoice","ap-btn ap-btn--secondary ap-btn--sm");upload.addEventListener("click",()=>AppCore.ui.toast("Invoice upload is not enabled yet.","info"));const create=btn("Create Invoice","ap-btn ap-btn--primary ap-btn--sm");create.addEventListener("click",()=>openInvoiceCreateMenu(context));actions.append(upload,create);heading.append(actions);}root.append(heading);let filtered=invoices||[];const host=el("div");const apply=(q,controls)=>{const text=q.trim().toLowerCase(),status=controls.status?.value||"",client=controls.client?.value||"";filtered=(invoices||[]).filter(inv=>(!text||`${inv.invoice_number} ${clientMap.get(inv.client_id)||""}`.toLowerCase().includes(text))&&(!status||inv.status===status)&&(!client||inv.client_id===client));renderInvoiceRows(host,filtered,clientMap);};const extra=[{key:"status",options:[["","Status"],["draft","Draft"],["sent","Sent"],["overdue","Overdue"],["paid","Paid"],["void","Void"]]}];if(context.isStaff)extra.push({key:"client",options:[["","Client"],...(clients||[]).map(c=>[c.id,c.name])]});const {bar,search,controls}=buildFilterBar({placeholder:"Search invoices…",extra,onInput:apply});root.append(bar,host);container.append(root);apply(search.value,controls);}catch(error){AppCore.ui.renderError(container,error,()=>renderInvoicesHub(container,context));}}
function renderInvoiceRows(host,invoices,clientMap){host.replaceChildren();if(!invoices.length){const empty=el("div","ap-centered-empty");empty.append(icon("invoice"),el("h3","","No invoices yet"),el("p","","Create an invoice when a project is ready to bill."));host.append(empty);return;}const table=el("div","ap-library-table ap-invoice-hub-table");const head=el("div","ap-library-table__row ap-library-table__row--head");["Invoice","Client","Status","Amount","Due",""] .forEach(x=>head.append(el("span","",x)));table.append(head);for(const inv of invoices){const row=el("div","ap-library-table__row");row.append(el("strong","",inv.invoice_number),el("span","ap-library-muted",clientMap.get(inv.client_id)||"Client"),el("span",`ap-badge ap-badge--${inv.status==="paid"?"success":inv.status==="overdue"?"danger":inv.status==="sent"?"info":"neutral"}`,inv.status),el("span","",AppCore.utils.formatMoney(inv.total_cents,inv.currency)),el("span","ap-library-muted",safeDate(inv.due_date)));const open=btn("›","ap-icon-button");open.addEventListener("click",async()=>{if(inv.folder_id){await selectFolder(inv.folder_id,{skipOverview:true});await selectModule("invoices");}});row.append(open);table.append(row);}host.append(table);}
function openInvoiceCreateMenu(context){const wrap=el("div","ap-create-menu");const one=btn("","ap-create-menu__item");one.append(icon("invoice"),el("div","","One-time Invoice"));one.addEventListener("click",()=>{AppCore.ui.closeModal();chooseFolder("Choose a project",async(folderId)=>{await selectFolder(folderId,{skipOverview:true});await selectModule("invoices");document.dispatchEvent(new CustomEvent("invoice:create-requested"));});});const recurring=btn("","ap-create-menu__item");recurring.append(icon("repeat"),el("div","","Recurring Invoice"));recurring.addEventListener("click",()=>AppCore.ui.toast("Recurring invoices are planned for the next version.","info"));wrap.append(one,recurring);AppCore.ui.openModal({title:"Create Invoice",content:wrap,actions:[]});}

export async function renderInbox(panel,context,initialTab="chats"){
  panel.replaceChildren();
  const isPage=panel.id==="module-content"||panel.dataset.page==="true";
  panel.classList.toggle("ap-inbox-page",isPage);
  if(!isPage)panel.classList.add("ap-inbox-panel--open");
  const shell=el("section","ap-inbox-shell");
  const head=el("div","ap-inbox-head");head.append(el("h2","","Inbox"));
  const tools=el("div","k-inbox-tools");tools.append(btn("▽","k-inbox-tool"),btn("•••","k-inbox-tool"));head.append(tools);shell.append(head);
  const tabs=el("div","ap-inbox-tabs");const body=el("div","ap-inbox-body");
  const labels=[["chats","Chats"],["tasks","Tasks"],["files","Files"],["updates","Updates"]];
  for(const [key,label] of labels){const b=btn(label,"ap-inbox-tab");if(key===initialTab)b.classList.add("ap-inbox-tab--active");b.addEventListener("click",async()=>{tabs.querySelectorAll("button").forEach(x=>x.classList.remove("ap-inbox-tab--active"));b.classList.add("ap-inbox-tab--active");await renderInboxTab(body,context,key);});tabs.append(b);}shell.append(tabs,body);panel.append(shell);await renderInboxTab(body,context,initialTab);
}
async function renderInboxTab(host,context,tab){AppCore.ui.renderLoading(host,"Loading…");try{let rows=[];if(tab==="chats"){const {data,error}=await supabase.from("conversations").select("*").eq("agency_id",context.agencyId).is("archived_at",null).is("trashed_at",null).order("last_message_at",{ascending:false,nullsFirst:false}).limit(30);if(error)throw error;rows=(data||[]).map(r=>({title:r.title,sub:"Conversation",date:r.last_message_at||r.created_at,onClick:()=>navigateItem({type:"conversation",folder_id:r.folder_id})}));}else if(tab==="tasks"){const {data,error}=await supabase.from("tasks").select("*").eq("agency_id",context.agencyId).order("updated_at",{ascending:false}).limit(30);if(error)throw error;rows=(data||[]).map(r=>({title:r.title,sub:r.completed_at?"Completed task":"Task updated",date:r.updated_at,onClick:()=>navigateItem({type:"task",folder_id:r.folder_id})}));}else if(tab==="files"){const {data,error}=await supabase.from("files").select("*").eq("agency_id",context.agencyId).order("created_at",{ascending:false}).limit(30);if(error)throw error;rows=(data||[]).map(r=>({title:r.original_name,sub:"File added",date:r.created_at,onClick:()=>navigateItem({type:"file",folder_id:r.folder_id})}));}else{const {data,error}=await supabase.from("activity_logs").select("*").eq("agency_id",context.agencyId).order("created_at",{ascending:false}).limit(30);if(error)throw error;rows=(data||[]).map(r=>({title:r.action.replaceAll("."," · "),sub:r.entity_type||"Workspace update",date:r.created_at,onClick:null}));}host.replaceChildren();if(!rows.length){const empty=el("div","ap-inbox-empty");empty.append(icon(tab==="chats"?"chat":tab==="tasks"?"task":tab==="files"?"file":"bell"),el("h3","",tab==="chats"?"All quiet in chats.":tab==="tasks"?"No task activity":tab==="files"?"No file activity":"No updates yet"),el("p","",tab==="chats"?"When someone sends you a message, you’ll see it here.":"New activity will show up here."));host.append(empty);return;}for(const row of rows){const item=btn("","ap-inbox-item");const text=el("div");text.append(el("strong","",row.title),el("span","",row.sub),el("small","",AppCore.utils.formatDate(row.date,"relative")));item.append(text);if(row.onClick)item.addEventListener("click",()=>{document.getElementById("inbox-panel")?.classList.remove("ap-inbox-panel--open");row.onClick();});host.append(item);}}catch(error){AppCore.ui.renderError(host,error,()=>renderInboxTab(host,context,tab));}}

const BUILTIN_TEMPLATES=[
  {name:"Client Workspace",description:"A clean structure for a new client.",folders:["Kickoff","Briefs","Deliverables","Feedback"]},
  {name:"Project Launch",description:"Plan, produce, review and deliver.",folders:["Planning","Production","Review","Delivery"]},
  {name:"Annual Retainer",description:"Organize a long-running client engagement.",folders:["Q1","Q2","Q3","Q4"]}
];
export function openTemplates(context){const wrap=el("div","ap-template-browser");const intro=el("div","ap-template-browser__intro");intro.append(el("h3","","Templates"),el("p","","Create consistent folder structures in seconds."));wrap.append(intro);const grid=el("div","ap-template-grid");for(const template of BUILTIN_TEMPLATES){const card=btn("","ap-template-card");card.append(icon("folder"),el("strong","",template.name),el("span","",template.description));card.addEventListener("click",()=>openTemplateUse(template,context));grid.append(card);}wrap.append(grid);AppCore.ui.openModal({title:"Templates",content:wrap,actions:[]});}
function openTemplateUse(template,context){AppCore.ui.closeModal();const form=el("form","ap-stack");const name=el("input","ap-input");name.required=true;name.value=template.name;name.select();const submit=btn("Create from template","ap-btn ap-btn--primary");submit.type="submit";form.append(el("p","ap-muted-text",`This creates ${template.folders.length+1} folders.`),name,submit);form.addEventListener("submit",async e=>{e.preventDefault();submit.disabled=true;try{const root=await createFolder({name:name.value.trim(),color:"#F4B400"});for(const child of template.folders)await createFolder({name:child,parentId:root.id,color:"#F4B400"});AppCore.ui.closeModal();await loadFolders();AppCore.ui.toast("Template created.","success");await selectFolder(root.id);}catch(error){AppCore.ui.toast(AppCore.ui.describeError(error),"error");}finally{submit.disabled=false;}});AppCore.ui.openModal({title:template.name,content:form,actions:[]});}

export function bindViewRefresh(callback){return on("data:changed",()=>callback?.());}

export function renderProfileView(container, context, { onBack, onLogout } = {}) {
  container.replaceChildren();
  const root = el("section", "ap-hub-view ap-profile-view");
  const back = btn("←", "ap-icon-button");
  back.setAttribute("aria-label", "Back to workspace");
  back.addEventListener("click", () => onBack?.());
  const heading = el("div", "ap-profile-view__heading");
  const avatar = el("div", "ap-profile-view__avatar", AppCore.utils.initials(context.profile?.full_name || context.profile?.email || context.user?.email || "U"));
  const identity = el("div");
  identity.append(el("h1", "ap-profile-view__title", context.profile?.full_name || context.profile?.email || context.user?.email || "Profile"));
  identity.append(el("p", "ap-profile-view__meta", context.profile?.email || context.user?.email || ""));
  heading.append(back, avatar, identity);

  const sections = el("div", "ap-profile-view__sections");
  const personal = el("section", "ap-profile-section");
  personal.append(el("h2", "ap-profile-section__title", "Personal Information"));
  personal.append(profileRow("Name", context.profile?.full_name || "Not set"), profileRow("Email", context.profile?.email || context.user?.email || "Not set"), profileRow("Display name", context.profile?.full_name ? `@${context.profile.full_name.toLowerCase().replace(/\\s+/g, "")}` : "Not set"), profileRow("Phone number", "Not set"));
  const localization = el("section", "ap-profile-section");
  localization.append(el("h2", "ap-profile-section__title", "Localization"));
  localization.append(profileRow("Interface Language", "English (United States)"), profileRow("Timezone", "Your local time"), profileRow("Date Format", "Sep 18, 2026 | 12-Hour"), profileRow("First Day of the Week", "Monday"));
  const notifications = el("section", "ap-profile-section");
  notifications.append(el("h2", "ap-profile-section__title", "Notifications"), profileRow("Notifications", "Change your notifications"));
  sections.append(personal, localization, notifications);
  const logout = btn("Log out", "ap-btn ap-btn--ghost ap-profile-view__logout");
  logout.addEventListener("click", () => onLogout?.());
  root.append(heading, sections, logout);
  container.append(root);
}

function profileRow(label, value) {
  const row = el("div", "ap-profile-row");
  row.append(el("span", "ap-profile-row__label", label), el("span", "ap-profile-row__value", value));
  return row;
}
