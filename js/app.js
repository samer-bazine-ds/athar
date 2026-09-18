import { restoreAuth, signOut } from "./auth/auth.js";
import { getState, setState } from "./core/state.js";
import { emit } from "./core/events.js";
import { activateAgency } from "./workspace/agencies.js";
import { renderFolderTree, openCreateFolder } from "./workspace/folderTree.js";
import { renderBreadcrumb, selectFolder } from "./workspace/folders.js";
import { openFolderSharing } from "./workspace/folderPermissions.js";
import { renderClientsView } from "./workspace/clients.js";
import { renderMembersView } from "./workspace/members.js";
import { saveBranding } from "./workspace/branding.js";
import { selectModule, unmountActiveModule, updateTabs } from "./core/moduleRegistry.js";
import { mountGlobalSearch } from "./modules/search.js";
import { AppCore } from "./core/appCore.js";
import { renderHome, renderTasksHub, renderInvoicesHub, renderLibrary, renderInbox, openTemplates, renderFolderOverview, renderProfileView } from "./views/portalViews.js";

let currentView = "home";
let currentLibraryView = "everything";

function bindTabs() {
  document.querySelectorAll("#module-tabs [data-module]").forEach((btn) => btn.addEventListener("click", () => selectModule(btn.dataset.module)));
}

function renderAgencyIdentity() {
  const host = document.getElementById("agency-identity"); host.replaceChildren(); const s = getState();
  const logo = document.createElement("img"); logo.className = "ap-workspace-logo"; logo.alt = ""; if (s.agency.logo_url) logo.src = s.agency.logo_url; else logo.hidden = true;
  const select = document.createElement("select"); select.className = "ap-workspace-switcher"; select.setAttribute("aria-label", "Workspace");
  for (const m of s.memberships.filter((x) => ["owner", "team"].includes(x.role))) { const o = document.createElement("option"); o.value = m.agency_id; o.textContent = m.agencies?.name || "Workspace"; o.selected = m.agency_id === s.agency.id; select.append(o); }
  select.addEventListener("change", async () => { emit("app:teardown", { reason: "agency-switch" }); await unmountActiveModule(); await activateAgency(select.value); renderShell(); await showView("home"); });
  const add = document.createElement("button"); add.type = "button"; add.className = "ap-icon-button"; add.textContent = "+"; add.title = "Create folder"; add.addEventListener("click", () => openCreateFolder());
  host.append(logo, select, add);
}

function renderUserMenu() {
  const host = document.getElementById("user-menu"); host.replaceChildren(); const s = getState();
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "ap-profile-trigger";
  const avatar = document.createElement("span"); avatar.className = "ap-profile-avatar"; avatar.textContent = AppCore.utils.initials(s.profile?.full_name || s.profile?.email || s.user?.email || "U");
  const name = document.createElement("span"); name.textContent = s.profile?.full_name || s.profile?.email || s.user?.email || "User";
  trigger.append(avatar, name, document.createTextNode("⌄"));
  const menu = document.createElement("div"); menu.className = "ap-profile-menu"; menu.hidden = true;
  const items = [
    ["Profile", () => openProfile()],
    ["Notifications", () => AppCore.ui.toast("Notification preferences are coming next.", "info")],
    ["Support", () => AppCore.ui.toast("Support can be connected to your help desk later.", "info")],
    ["Get a 1:1 Demo", () => AppCore.ui.toast("Demo booking can be connected later.", "info")],
    ["Log out", signOut]
  ];
  items.forEach(([label, handler]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", () => { menu.hidden = true; handler(); }); menu.append(b); });
  trigger.addEventListener("click", () => { menu.hidden = !menu.hidden; });
  host.append(trigger, menu);
}

function openProfile() {
  showView("profile");
}

function renderFolderActions() {
  const host = document.getElementById("folder-actions"); host.replaceChildren(); const s = getState(); if (!s.selectedFolderId) return;
  const share = document.createElement("button"); share.className = "ap-btn ap-btn--primary ap-btn--sm"; share.type = "button"; share.textContent = "Share";
  share.addEventListener("click", () => openFolderSharing(s.selectedFolderId).catch((e) => AppCore.ui.toast(AppCore.ui.describeError(e), "error"))); host.append(share);
}

function renderSidebarAdmin() {
  const host = document.getElementById("sidebar-admin"); host.replaceChildren();
  for (const [label, handler, ownerOnly] of [["Clients", () => openAdmin("clients"), false], ["Team", () => openAdmin("team"), false], ["Settings", () => openAdmin("settings"), true]]) {
    if (ownerOnly && getState().role !== "owner") continue;
    const b = document.createElement("button"); b.type = "button"; b.className = "ap-sidebar-admin-link"; b.textContent = label; b.addEventListener("click", handler); host.append(b);
  }
}

async function openAdmin(kind) {
  await unmountActiveModule(); setState({ selectedModule: null, selectedFolderId: null }); renderFolderTree(); hideFolderChrome(); currentView = `admin-${kind}`; markNavigation(currentView);
  const content = document.getElementById("module-content");
  if (kind === "clients") await renderClientsView(content);
  if (kind === "team") await renderMembersView(content);
  if (kind === "settings") renderSettings(content);
}

function renderSettings(container) {
  const s = getState(); container.replaceChildren(); const root = document.createElement("section"); root.className = "ap-hub-view ap-settings-view";
  const h = document.createElement("div"); h.className = "ap-view-title"; h.innerHTML = "<h1 class='ap-view-title__heading'>Workspace Settings</h1><p class='ap-view-title__subtitle'>Manage your agency identity and branding.</p>";
  const form = document.createElement("form"); form.className = "ap-settings-form";
  const name = document.createElement("input"); name.className = "ap-input"; name.value = s.agency.name;
  const color = document.createElement("input"); color.type = "color"; color.value = s.agency.primary_color;
  const logo = document.createElement("input"); logo.type = "file"; logo.accept = "image/*";
  const save = document.createElement("button"); save.className = "ap-btn ap-btn--primary"; save.textContent = "Save settings";
  form.append(field("Workspace name", name), field("Primary color", color), field("Logo", logo), save);
  form.addEventListener("submit", async (e) => { e.preventDefault(); save.disabled = true; try { await saveBranding({ name: name.value, primaryColor: color.value, logoFile: logo.files[0] || null }); AppCore.ui.toast("Settings saved.", "success"); renderAgencyIdentity(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } finally { save.disabled = false; } });
  root.append(h, form); container.append(root);
}
function field(labelText, input) { const label = document.createElement("label"); label.className = "ap-field"; const span = document.createElement("span"); span.className = "ap-field__label"; span.textContent = labelText; label.append(span, input); return label; }

function hideFolderChrome() { document.getElementById("page-header").hidden = true; document.getElementById("module-tabs").hidden = true; }
function showModuleChrome() { document.getElementById("page-header").hidden = false; document.getElementById("module-tabs").hidden = true; renderBreadcrumb(); renderFolderActions(); }

function markNavigation(view) {
  document.querySelectorAll("[data-global-view]").forEach((b) => b.classList.toggle("ap-rail-item--active", b.dataset.globalView === view || (view === "my-tasks" && b.dataset.globalView === "tasks")));
  document.querySelectorAll("[data-workspace-view]").forEach((b) => b.classList.toggle("ap-workspace-link--active", b.dataset.workspaceView === view));
  document.querySelectorAll("[data-library-view]").forEach((b) => b.classList.toggle("ap-library-nav__active", view === `library-${b.dataset.libraryView}`));
}

async function showView(view, options = {}) {
  currentView = view; await unmountActiveModule(); setState({ selectedModule: null, selectedFolderId: null }); renderFolderTree(); hideFolderChrome(); markNavigation(view);
  const content = document.getElementById("module-content"); content.classList.remove("ap-inbox-page"); const context = AppCore.getModuleContext();
  if (view === "home") await renderHome(content, context);
  else if (view === "inbox") await renderInbox(content, context);
  else if (view === "my-tasks") await renderTasksHub(content, context, { mineOnly: true });
  else if (view === "tasks") await renderTasksHub(content, context, { mineOnly: false });
  else if (view === "invoices") await renderInvoicesHub(content, context);
  else if (view === "profile") renderProfileView(content, context, { onBack: () => showView("home"), onLogout: signOut });
  else if (view.startsWith("library-")) { currentLibraryView = view.slice(8); await renderLibrary(content, context, currentLibraryView); }
  if (!options.noHash) history.replaceState(null, "", `#/${view}`);
}

async function showFolderOverview(folderId) {
  currentView = "folder"; await unmountActiveModule(); setState({ selectedModule: null, selectedFolderId: null }); renderFolderTree(); hideFolderChrome(); markNavigation("folder"); renderFolderTree();
  await renderFolderOverview(document.getElementById("module-content"), AppCore.getModuleContext(), folderId);
  history.replaceState(null, "", `#/folder/${folderId}`);
}

function toggleLibrary() { const toggle = document.querySelector(".ap-library-toggle"); const nav = document.querySelector(".ap-library-nav"); const open = toggle.getAttribute("aria-expanded") !== "false"; toggle.setAttribute("aria-expanded", String(!open)); nav.hidden = open; }

function openMoreMenu() {
  const menu = document.getElementById("more-menu"); menu.replaceChildren();
  const items = [["Templates", () => openTemplates(AppCore.getModuleContext())], ["Clients", () => openAdmin("clients")], ["Team", () => openAdmin("team")], ["Settings", () => openAdmin("settings")]];
  items.forEach(([label, handler]) => { if (label === "Settings" && getState().role !== "owner") return; const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", () => { menu.hidden = true; handler(); }); menu.append(b); });
  menu.hidden = !menu.hidden;
}

function bindShell() {
  bindTabs();
  document.getElementById("new-folder")?.addEventListener("click", () => openCreateFolder());
  document.querySelector(".ap-library-toggle")?.addEventListener("click", toggleLibrary);
  document.querySelectorAll("[data-workspace-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.workspaceView)));
  document.querySelectorAll("[data-library-view]").forEach((b) => b.addEventListener("click", () => showView(`library-${b.dataset.libraryView}`)));
  document.querySelectorAll("[data-global-view]").forEach((b) => b.addEventListener("click", () => {
    const view = b.dataset.globalView;
    if (view === "inbox") return showView("inbox");
    if (view === "more") return openMoreMenu();
    showView(view);
  }));
  document.getElementById("back-to-folder")?.addEventListener("click", () => { const id = getState().selectedFolderId; if (id) showFolderOverview(id); });
  document.getElementById("sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("ap-sidebar-open"));
  document.getElementById("sidebar-backdrop").addEventListener("click", () => document.body.classList.remove("ap-sidebar-open"));
  document.addEventListener("folder:selected", (event) => {
    renderFolderTree(); renderBreadcrumb(); renderFolderActions(); document.body.classList.remove("ap-sidebar-open");
    if (event.detail?.folderId && !event.detail?.skipOverview) showFolderOverview(event.detail.folderId);
    else if (!event.detail?.folderId && currentView === "folder") showView("home");
  });
  document.addEventListener("module:mounted", () => showModuleChrome());
  document.addEventListener("inbox:close", () => showView("home"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { document.body.classList.remove("ap-sidebar-open"); document.getElementById("inbox-panel").classList.remove("ap-inbox-panel--open"); document.getElementById("more-menu").hidden = true; } });
}

function renderShell() { renderAgencyIdentity(); renderUserMenu(); renderFolderTree(); renderBreadcrumb(); renderFolderActions(); renderSidebarAdmin(); }

async function boot() {
  try {
    const session = await restoreAuth("team"); if (!session) { location.replace("login.html"); return; }
    const staff = getState().memberships.filter((m) => ["owner", "team"].includes(m.role)); if (!staff.length) { location.replace("client-view.html"); return; }
    const remembered = localStorage.getItem("ap.lastAgencyId"); const initial = staff.find((m) => m.agency_id === remembered) || staff[0];
    await activateAgency(initial.agency_id); bindShell(); renderShell(); await mountGlobalSearch(AppCore.getModuleContext());
    setState({ ready: true }); emit("app:ready", { agencyId: getState().agency.id, userId: getState().user.id, role: getState().role, surface: "team" });
    const hash = location.hash;
    const folderMatch = hash.match(/^#\/folder\/([0-9a-f-]+)$/i);
    const moduleMatch = hash.match(/^#\/f\/([0-9a-f-]+)\/(conversation|boards|docs|files|invoices)$/i);
    if (moduleMatch && getState().folders.some((f) => f.id === moduleMatch[1])) { await selectFolder(moduleMatch[1], { skipOverview: true }); await selectModule(moduleMatch[2]); }
    else if (folderMatch && getState().folders.some((f) => f.id === folderMatch[1])) { await selectFolder(folderMatch[1]); }
    else if (/^#\/library-/.test(hash)) await showView(hash.slice(2), { noHash: true });
    else if (["#/home", "#/inbox", "#/my-tasks", "#/tasks", "#/invoices", "#/profile"].includes(hash)) await showView(hash.slice(2), { noHash: true });
    else await showView("home");
  } catch (error) {
    console.error(error); const content = document.getElementById("module-content"); if (content) AppCore.ui.renderError(content, error, () => location.reload());
  }
}
boot();
