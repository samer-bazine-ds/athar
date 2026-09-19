import { restoreAuth, signOut } from "./auth/auth.js";
import { getState, setState } from "./core/state.js";
import { emit } from "./core/events.js";
import { activateAgency } from "./workspace/agencies.js";
import { renderFolderTree, openCreateFolder } from "./workspace/folderTree.js";
import { renderBreadcrumb, selectFolder } from "./workspace/folders.js";
import { openFolderSharing } from "./workspace/folderPermissions.js";
import { renderClientsView } from "./workspace/clients.js?v=emailjs-1";
import { selectModule, unmountActiveModule } from "./core/moduleRegistry.js";
import { mountGlobalSearch } from "./modules/search.js";
import { AppCore } from "./core/appCore.js";
import { renderHome, renderTasksHub, renderInvoicesHub, renderLibrary, renderInbox, openTemplates, renderFolderOverview, renderProfileView } from "./views/portalViews.js";
import { renderSettingsHub } from "./views/kitchenSettings.js?v=emailjs-1";

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
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "ap-profile-trigger"; trigger.setAttribute("aria-label","Profile menu");
  const avatar = document.createElement("span"); avatar.className = "ap-profile-avatar"; avatar.textContent = AppCore.utils.initials(s.profile?.full_name || s.profile?.email || s.user?.email || "U");
  trigger.append(avatar);
  const menu = document.createElement("div"); menu.className = "ap-profile-menu"; menu.hidden = true;
  const items = [["Profile", () => openProfile()],["Notifications", () => AppCore.ui.toast("Notification preferences can be configured here.", "info")],["Support", () => AppCore.ui.toast("Connect your support desk here.", "info")],["Log out", signOut]];
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
  if (kind === "clients") return showView("clients");
  if (kind === "team") return showView("settings", { settingsSection: "members" });
  if (kind === "settings") return showView("settings");
}

function renderProposalsHub(container) {
  container.replaceChildren(); container.className = "ap-module-content k-page-panel k-proposals-page";
  const root = document.createElement("section"); root.className = "k-proposals-hub";
  const head = document.createElement("div"); head.className = "k-proposals-head";
  const title = document.createElement("h1"); title.textContent = "Proposals";
  const create = document.createElement("button"); create.type = "button"; create.className = "k-btn k-btn--primary"; create.textContent = "+  Create Proposal";
  create.addEventListener("click", () => AppCore.ui.toast("Connect a proposal provider in Settings → Proposals to create proposals.", "info"));
  head.append(title, create); root.append(head);
  const empty = document.createElement("div"); empty.className = "k-proposals-empty"; empty.innerHTML = '<div class="k-proposals-empty__icon">▤</div><h2>No proposals yet</h2><p>Create, send, and manage client proposals from here.</p>';
  root.append(empty); container.append(root);
}

async function renderInboxPage(container, context) {
  container.replaceChildren(); container.className = "ap-module-content k-inbox-page-shell";
  const layout = document.createElement("div"); layout.className = "k-inbox-layout";
  const left = document.createElement("section"); left.className = "k-inbox-left"; left.dataset.page = "true";
  const right = document.createElement("section"); right.className = "k-inbox-right";
  layout.append(left, right); container.append(layout);
  await Promise.all([renderInbox(left, context), renderHome(right, context)]);
}

function hideFolderChrome() { document.getElementById("page-header").hidden = true; document.getElementById("module-tabs").hidden = true; }
function showModuleChrome() { document.getElementById("page-header").hidden = false; document.getElementById("module-tabs").hidden = true; renderBreadcrumb(); renderFolderActions(); }

function markNavigation(view) {
  const rootView = view.startsWith("settings") ? "settings" : view;
  document.querySelectorAll("[data-global-view]").forEach((b) => b.classList.toggle("ap-rail-item--active", b.dataset.globalView === rootView || (rootView.startsWith("library-") && b.dataset.globalView === "library-everything")));
  document.querySelectorAll("[data-workspace-view]").forEach((b) => b.classList.toggle("ap-workspace-link--active", b.dataset.workspaceView === view));
  document.querySelectorAll("[data-library-view]").forEach((b) => b.classList.toggle("ap-library-nav__active", view === `library-${b.dataset.libraryView}`));
}

async function showView(view, options = {}) {
  currentView = view; await unmountActiveModule(); setState({ selectedModule: null, selectedFolderId: null }); renderFolderTree(); hideFolderChrome(); markNavigation(view);
  const content = document.getElementById("module-content"); content.className = "ap-module-content"; const context = AppCore.getModuleContext();
  if (view === "home") await renderHome(content, context);
  else if (view === "inbox") await renderInboxPage(content, context);
  else if (view === "proposals") renderProposalsHub(content);
  else if (view === "clients") await renderClientsView(content);
  else if (view === "my-tasks" || view === "tasks") await renderTasksHub(content, context, { mineOnly: view === "my-tasks" });
  else if (view === "invoices") await renderInvoicesHub(content, context);
  else if (view === "settings") await renderSettingsHub(content, context, options.settingsSection || "home");
  else if (view === "profile") renderProfileView(content, context, { onBack: () => showView("home"), onLogout: signOut });
  else if (view.startsWith("library-")) { currentLibraryView = view.slice(8); await renderLibrary(content, context, currentLibraryView); }
  content.setAttribute("aria-busy", "false");
  if (!options.noHash) {
    if (view === "settings") history.replaceState(null, "", `#/settings/${options.settingsSection || "home"}`);
    else history.replaceState(null, "", `#/${view}`);
  }
}

async function showFolderOverview(folderId) {
  currentView = "folder"; await unmountActiveModule(); setState({ selectedModule: null, selectedFolderId: folderId }); hideFolderChrome(); markNavigation("folder"); renderFolderTree();
  const content = document.getElementById("module-content"); content.className = "ap-module-content";
  await renderFolderOverview(content, AppCore.getModuleContext(), folderId);
  content.setAttribute("aria-busy", "false");
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
    if (view === "more") return openMoreMenu();
    showView(view);
  }));
  document.getElementById("back-to-folder")?.addEventListener("click", () => { const id = getState().selectedFolderId; if (id) showFolderOverview(id); });
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => document.body.classList.toggle("ap-sidebar-open"));
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => document.body.classList.remove("ap-sidebar-open"));
  document.addEventListener("folder:selected", (event) => {
    renderFolderTree(); renderBreadcrumb(); renderFolderActions(); document.body.classList.remove("ap-sidebar-open");
    if (event.detail?.folderId && !event.detail?.skipOverview) showFolderOverview(event.detail.folderId);
    else if (!event.detail?.folderId && currentView === "folder") showView("home");
  });
  document.addEventListener("module:mounted", () => { document.getElementById("module-content").className = "ap-module-content"; showModuleChrome(); });
  document.addEventListener("inbox:close", () => showView("home"));
  document.addEventListener("kitchen:clients", () => showView("clients"));
  document.addEventListener("kitchen:settings-nav", (event) => showView("settings", { settingsSection: event.detail?.section || "home" }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { document.body.classList.remove("ap-sidebar-open"); document.getElementById("inbox-panel").classList.remove("ap-inbox-panel--open"); document.getElementById("more-menu").hidden = true; } });
}

function renderShell() { renderAgencyIdentity(); renderUserMenu(); renderFolderTree(); renderBreadcrumb(); renderFolderActions(); renderSidebarAdmin(); const input=document.querySelector("#global-search input"); if(input) input.placeholder=`Search ${getState().agency?.name || "workspace"}...`; }

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
    else if (/^#\/settings\//.test(hash)) await showView("settings", { settingsSection: hash.split("/")[2] || "home", noHash: true });
    else if (/^#\/library-/.test(hash)) await showView(hash.slice(2), { noHash: true });
    else if (["#/home", "#/inbox", "#/proposals", "#/clients", "#/my-tasks", "#/tasks", "#/invoices", "#/profile"].includes(hash)) await showView(hash.slice(2), { noHash: true });
    else await showView("home");
  } catch (error) {
    console.error(error); const content = document.getElementById("module-content"); if (content) AppCore.ui.renderError(content, error, () => location.reload());
  }
}
boot();
