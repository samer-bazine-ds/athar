import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { emit, on } from "../core/events.js";

const state = {
  container: null,
  context: null,
  docs: [],
  activeId: null,
  dirty: false,
  saving: false,
  offEvents: [],
  saveDebounced: null
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(label, variant = "secondary") {
  const node = el("button", `ap-btn ap-btn--${variant}`, label);
  node.type = "button";
  return node;
}

function activeDoc() {
  return state.docs.find((doc) => doc.id === state.activeId) || null;
}

async function loadDocs() {
  if (!state.context.folderId) {
    state.docs = [];
    state.activeId = null;
    return;
  }
  const { data, error } = await supabase
    .from("docs")
    .select("*")
    .eq("folder_id", state.context.folderId)
    .is("archived_at", null)
    .is("trashed_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  state.docs = data || [];
  if (!state.docs.some((doc) => doc.id === state.activeId)) state.activeId = state.docs[0]?.id || null;
}

async function loadAndRender() {
  if (!state.container) return;
  if (!state.context.folderId) {
    AppCore.ui.renderEmpty(state.container, { title: "Choose a folder", message: "Select a folder to view its documents." });
    return;
  }
  AppCore.ui.renderLoading(state.container, "Loading documents…");
  try {
    await loadDocs();
    render();
  } catch (error) {
    AppCore.ui.renderError(state.container, error, loadAndRender);
  }
}

function render() {
  const root = el("section", "ap-docs");
  root.dataset.module = "docs";
  const sidebar = el("aside", "ap-docs__sidebar");
  const sidebarHead = el("div", "ap-docs__sidebar-header");
  sidebarHead.append(el("h2", "ap-docs__sidebar-title", "Documents"));
  if (state.context.isStaff) {
    const add = button("New", "primary");
    add.classList.add("ap-btn--sm");
    add.addEventListener("click", createDocument);
    sidebarHead.append(add);
  }
  sidebar.append(sidebarHead);

  const list = el("div", "ap-docs__list");
  if (!state.docs.length) {
    list.append(el("p", "ap-docs__empty", state.context.isClient ? "No documents have been shared with you yet." : "No documents yet."));
  }
  for (const doc of state.docs) {
    const item = button(doc.title, "ghost");
    item.className = `ap-docs__item${doc.id === state.activeId ? " ap-docs__item--active" : ""}`;
    item.dataset.docId = doc.id;
    item.setAttribute("aria-current", doc.id === state.activeId ? "page" : "false");
    const name = el("span", "ap-docs__item-title", doc.title);
    const meta = el("span", "ap-docs__item-meta", AppCore.utils.formatDate(doc.updated_at, "relative"));
    item.replaceChildren(name, meta);
    item.addEventListener("click", async () => {
      if (state.dirty && state.context.isStaff) await saveCurrentDocument();
      state.activeId = doc.id;
      render();
    });
    list.append(item);
  }
  sidebar.append(list);

  const content = el("div", "ap-docs__content");
  const doc = activeDoc();
  if (!doc) {
    const empty = el("div", "ap-docs__content-empty");
    empty.append(el("h3", "ap-docs__empty-title", state.context.isClient ? "Nothing shared here yet" : "Create your first document"));
    if (state.context.isStaff) {
      const create = button("Create document", "primary");
      create.addEventListener("click", createDocument);
      empty.append(create);
    }
    content.append(empty);
  } else {
    content.append(renderEditor(doc));
  }

  root.append(sidebar, content);
  state.container.replaceChildren(root);
}

function renderEditor(doc) {
  const wrapper = el("article", "ap-doc");
  wrapper.dataset.docId = doc.id;
  const header = el("div", "ap-doc__header");
  const title = el("input", "ap-input ap-doc__title-input");
  title.value = doc.title;
  title.maxLength = 200;
  title.readOnly = state.context.isClient;
  title.setAttribute("aria-label", "Document title");
  header.append(title);

  const status = el("span", "ap-doc__save-status", state.context.isClient ? AppCore.utils.formatDate(doc.updated_at, "relative") : "Saved");
  header.append(status);

  if (state.context.isStaff) {
    const visibility = el("label", "ap-doc__visibility");
    const check = el("input", "ap-checkbox");
    check.type = "checkbox";
    check.checked = Boolean(doc.client_visible);
    visibility.append(check, el("span", "ap-doc__visibility-label", "Visible to clients"));
    check.addEventListener("change", () => {
      doc.client_visible = check.checked;
      markDirty(status);
    });
    header.append(visibility);

    const archive = button("Archive", "danger");
    archive.classList.add("ap-btn--sm");
    archive.addEventListener("click", () => archiveDocument(doc));
    header.append(archive);
  }

  wrapper.append(header);

  if (state.context.isStaff) {
    const toolbar = el("div", "ap-doc__toolbar");
    const commands = [
      ["bold", "Bold"], ["italic", "Italic"], ["underline", "Underline"],
      ["formatBlock", "Heading", "h2"], ["insertUnorderedList", "Bullets"], ["insertOrderedList", "Numbered"]
    ];
    for (const [command, label, value] of commands) {
      const control = button(label, "ghost");
      control.classList.add("ap-btn--sm");
      control.addEventListener("mousedown", (event) => event.preventDefault());
      control.addEventListener("click", () => {
        document.execCommand(command, false, value || null);
        editor.focus();
        markDirty(status);
      });
      toolbar.append(control);
    }
    const link = button("Link", "ghost");
    link.classList.add("ap-btn--sm");
    link.addEventListener("mousedown", (event) => event.preventDefault());
    link.addEventListener("click", () => {
      const href = window.prompt("Link URL (https:// or mailto:)");
      if (href && /^(https?:|mailto:)/i.test(href)) document.execCommand("createLink", false, href);
      editor.focus();
      markDirty(status);
    });
    toolbar.append(link);
    wrapper.append(toolbar);
  }

  const editor = el("div", "ap-doc__editor");
  editor.dataset.module = "docs";
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.contentEditable = state.context.isStaff ? "true" : "false";
  const sanitized = AppCore.utils.sanitizeHtml(doc.content_html || "");
  editor.innerHTML = sanitized;
  if (!sanitized && state.context.isStaff) editor.dataset.placeholder = "Start writing…";

  if (state.context.isStaff) {
    title.addEventListener("input", () => {
      doc.title = title.value;
      markDirty(status);
    });
    editor.addEventListener("input", () => markDirty(status));
    editor.addEventListener("blur", () => state.saveDebounced?.flush?.());
    wrapper.__editor = editor;
    wrapper.__title = title;
    wrapper.__status = status;
  }
  wrapper.append(editor);
  return wrapper;
}

function markDirty(status) {
  state.dirty = true;
  status.textContent = "Unsaved changes";
  state.saveDebounced?.();
}

async function saveCurrentDocument() {
  if (!state.context?.isStaff || !state.activeId || !state.dirty || state.saving) return;
  const doc = activeDoc();
  const wrapper = state.container?.querySelector(`.ap-doc[data-doc-id="${state.activeId}"]`);
  if (!doc || !wrapper) return;
  const editor = wrapper.__editor || wrapper.querySelector(".ap-doc__editor");
  const title = wrapper.__title || wrapper.querySelector(".ap-doc__title-input");
  const status = wrapper.__status || wrapper.querySelector(".ap-doc__save-status");
  const safeHtml = AppCore.utils.sanitizeHtml(editor?.innerHTML || "");
  const contentText = (editor?.textContent || "").trim();
  const safeTitle = (title?.value || doc.title || "Untitled document").trim() || "Untitled document";

  state.saving = true;
  if (status) status.textContent = "Saving…";
  try {
    const { data, error } = await supabase.from("docs").update({
      title: safeTitle,
      content_html: safeHtml,
      content_text: contentText,
      client_visible: Boolean(doc.client_visible),
      last_edited_by: state.context.user.id
    }).eq("id", doc.id).select().single();
    if (error) throw error;
    Object.assign(doc, data);
    state.dirty = false;
    if (status) status.textContent = "Saved";
    emit("data:changed", { entity: "doc", entityId: doc.id, folderId: state.context.folderId, action: "updated" });
  } catch (error) {
    if (status) status.textContent = "Error saving";
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  } finally {
    state.saving = false;
  }
}

async function createDocument() {
  try {
    const { data, error } = await supabase.from("docs").insert({
      agency_id: state.context.agencyId,
      folder_id: state.context.folderId,
      title: "Untitled document",
      content_html: "",
      content_text: "",
      client_visible: false,
      created_by: state.context.user.id,
      last_edited_by: state.context.user.id
    }).select().single();
    if (error) throw error;
    emit("data:changed", { entity: "doc", entityId: data.id, folderId: state.context.folderId, action: "created" });
    await loadDocs();
    state.activeId = data.id;
    render();
    state.container.querySelector(".ap-doc__title-input")?.select();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

async function archiveDocument(doc) {
  const confirmed = await AppCore.ui.confirm({ title: "Archive document?", message: "It will no longer appear in this folder.", confirmLabel: "Archive", danger: true });
  if (!confirmed) return;
  try {
    const { error } = await supabase.from("docs").update({ archived_at: new Date().toISOString() }).eq("id", doc.id);
    if (error) throw error;
    emit("data:changed", { entity: "doc", entityId: doc.id, folderId: state.context.folderId, action: "deleted" });
    state.activeId = null;
    state.dirty = false;
    await loadAndRender();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

const docsModule = {
  name: "docs",
  async mount(container, context) {
    state.container = container;
    state.context = context;
    state.saveDebounced = AppCore.utils.debounce(() => saveCurrentDocument(), 800);
    state.offEvents.push(on("app:teardown", () => saveCurrentDocument()));
    await loadAndRender();
  },
  async unmount() {
    if (state.dirty) await saveCurrentDocument();
    state.offEvents.splice(0).forEach((off) => off?.());
    state.container?.replaceChildren();
    state.container = null;
    state.context = null;
    state.docs = [];
    state.activeId = null;
    state.dirty = false;
    state.saving = false;
    state.saveDebounced = null;
  },
  async refresh(context) {
    if (state.dirty) await saveCurrentDocument();
    state.context = context;
    state.activeId = null;
    state.dirty = false;
    await loadAndRender();
  }
};

export default docsModule;
