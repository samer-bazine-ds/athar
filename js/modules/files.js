import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { emit, on } from "../core/events.js";

const MAX_UPLOAD_BYTES = 26214400;
const ALLOWED_EXACT_MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const BLOCKED_EXTENSIONS = new Set(["exe", "bat", "sh", "ps1"]);
const BLOCKED_MIME = new Set(["application/x-msdownload", "application/x-sh"]);

const state = {
  container: null,
  context: null,
  files: [],
  canUpload: false,
  offEvents: []
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

function extension(name) {
  const dot = String(name || "").lastIndexOf(".");
  return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : "";
}

function isAllowedFile(file) {
  if (!file || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return false;
  if (BLOCKED_EXTENSIONS.has(extension(file.name))) return false;
  if (BLOCKED_MIME.has(file.type)) return false;
  return file.type.startsWith("image/") || file.type.startsWith("text/") || ALLOWED_EXACT_MIME.has(file.type) || file.type.startsWith("application/vnd.openxmlformats-officedocument.");
}

async function resolveCanUpload() {
  if (!state.context.folderId) return false;
  if (state.context.isStaff) return true;
  try {
    const { data, error } = await supabase.rpc("can_upload_to_folder", { p_folder: state.context.folderId });
    if (error) throw error;
    return Boolean(data);
  } catch {
    return false;
  }
}

async function loadFiles() {
  if (!state.context.folderId) {
    state.files = [];
    state.canUpload = false;
    return;
  }
  const [{ data, error }, canUpload] = await Promise.all([
    supabase.from("files").select("*").eq("folder_id", state.context.folderId).order("created_at", { ascending: false }),
    resolveCanUpload()
  ]);
  if (error) throw error;
  state.files = data || [];
  state.canUpload = canUpload;
}

async function loadAndRender() {
  if (!state.container) return;
  if (!state.context.folderId) {
    AppCore.ui.renderEmpty(state.container, { title: "Choose a folder", message: "Select a folder to view its files." });
    return;
  }
  AppCore.ui.renderLoading(state.container, "Loading files…");
  try {
    await loadFiles();
    render();
  } catch (error) {
    AppCore.ui.renderError(state.container, error, loadAndRender);
  }
}

function render() {
  const root = el("section", "ap-files");
  root.dataset.module = "files";
  const header = el("div", "ap-files__header");
  const heading = el("div", "ap-files__heading");
  heading.append(el("h2", "ap-files__title", "Files"), el("p", "ap-files__subtitle", state.context.isClient ? "Files shared with you in this folder." : "Upload and share files for this folder."));
  header.append(heading);
  if (state.canUpload) {
    const upload = button("Upload file", "primary");
    upload.addEventListener("click", openUploadModal);
    header.append(upload);
  }
  root.append(header);

  if (!state.files.length) {
    const empty = el("div", "ap-files__empty");
    empty.append(el("h3", "ap-files__empty-title", state.context.isClient ? "No files have been shared with you yet" : "No files yet"));
    if (state.canUpload) {
      const upload = button("Upload file", "primary");
      upload.addEventListener("click", openUploadModal);
      empty.append(upload);
    }
    root.append(empty);
    state.container.replaceChildren(root);
    return;
  }

  const list = el("div", "ap-files__list");
  for (const file of state.files) list.append(renderFile(file));
  root.append(list);
  state.container.replaceChildren(root);
}

function renderFile(file) {
  const row = el("article", "ap-file");
  row.dataset.fileId = file.id;
  const icon = el("div", "ap-file__icon", file.mime_type === "application/pdf" ? "PDF" : file.mime_type.startsWith("image/") ? "IMG" : "FILE");
  const info = el("div", "ap-file__info");
  info.append(el("h3", "ap-file__name", file.original_name));
  const meta = el("div", "ap-file__meta");
  meta.append(el("span", "ap-file__meta-item", AppCore.utils.formatBytes(file.size_bytes)), el("span", "ap-file__meta-item", AppCore.utils.formatDate(file.created_at, "relative")));
  if (file.client_visible && state.context.isStaff) meta.append(el("span", "ap-badge ap-badge--info", "Client visible"));
  info.append(meta);
  const actions = el("div", "ap-file__actions");
  const open = button("Open", "secondary");
  open.classList.add("ap-btn--sm");
  open.addEventListener("click", () => openFile(file));
  actions.append(open);

  if (state.context.isStaff) {
    const visibility = el("label", "ap-file__visibility");
    const check = el("input", "ap-checkbox");
    check.type = "checkbox";
    check.checked = Boolean(file.client_visible);
    const label = el("span", "ap-file__visibility-label", "Share");
    visibility.append(check, label);
    check.addEventListener("change", async () => {
      check.disabled = true;
      const { error } = await supabase.from("files").update({ client_visible: check.checked }).eq("id", file.id);
      if (error) {
        check.checked = !check.checked;
        AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      } else {
        file.client_visible = check.checked;
        emit("data:changed", { entity: "file", entityId: file.id, folderId: state.context.folderId, action: "updated" });
      }
      check.disabled = false;
    });
    actions.append(visibility);
  }

  const canDelete = state.context.isStaff || file.uploaded_by === state.context.user.id;
  if (canDelete) {
    const remove = button("Delete", "danger");
    remove.classList.add("ap-btn--sm");
    remove.addEventListener("click", () => deleteFile(file));
    actions.append(remove);
  }
  row.append(icon, info, actions);
  return row;
}

function openUploadModal() {
  const content = el("div", "ap-file-upload");
  const fileInput = el("input", "ap-input");
  fileInput.type = "file";
  fileInput.accept = "image/*,application/pdf,text/*,application/zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
  const chooser = el("label", "ap-field");
  chooser.append(el("span", "ap-field__label", "Choose file"), fileInput, el("span", "ap-field__hint", "Maximum 25 MiB. Executable files are not accepted."));
  content.append(chooser);

  let visible = null;
  if (state.context.isStaff) {
    visible = el("input", "ap-checkbox");
    visible.type = "checkbox";
    visible.checked = false;
    const vis = el("label", "ap-file-upload__visibility");
    vis.append(visible, el("span", "ap-file-upload__visibility-label", "Visible to clients"));
    content.append(vis);
  }

  const actions = el("div", "ap-module-form__actions");
  const cancel = button("Cancel", "secondary");
  const upload = button("Upload", "primary");
  cancel.addEventListener("click", () => AppCore.ui.closeModal());
  upload.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) return fileInput.focus();
    if (!isAllowedFile(file)) {
      AppCore.ui.toast(file.size > MAX_UPLOAD_BYTES ? "That file is larger than 25 MiB." : "That file type is not allowed.", "warning");
      return;
    }
    upload.disabled = true;
    upload.textContent = "Uploading…";
    try {
      await uploadFile(file, state.context.isClient ? true : Boolean(visible?.checked));
      AppCore.ui.closeModal();
      AppCore.ui.toast("File uploaded.", "success");
      await loadAndRender();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally {
      upload.disabled = false;
      upload.textContent = "Upload";
    }
  });
  actions.append(cancel, upload);
  content.append(actions);
  AppCore.ui.openModal({ title: "Upload file", content, actions: [] });
}

async function uploadFile(file, clientVisible) {
  const fileId = AppCore.utils.uuid();
  const safeName = AppCore.utils.sanitizeFilename(file.name);
  const storagePath = `${state.context.agencyId}/${state.context.folderId}/${fileId}/${safeName}`;
  const metadata = {
    id: fileId,
    agency_id: state.context.agencyId,
    folder_id: state.context.folderId,
    uploaded_by: state.context.user.id,
    bucket_name: "project-files",
    storage_path: storagePath,
    original_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    client_visible: Boolean(clientVisible)
  };

  const { error: metadataError } = await supabase.from("files").insert(metadata);
  if (metadataError) throw metadataError;

  const { error: uploadError } = await supabase.storage.from("project-files").upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });
  if (uploadError) {
    await supabase.from("files").delete().eq("id", fileId);
    throw uploadError;
  }

  emit("data:changed", { entity: "file", entityId: fileId, folderId: state.context.folderId, action: "created" });
  return fileId;
}

async function openFile(file) {
  try {
    const { data, error } = await supabase.storage.from("project-files").createSignedUrl(file.storage_path, 60);
    if (error) throw error;
    const opened = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(data.signedUrl);
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

async function deleteFile(file) {
  const confirmed = await AppCore.ui.confirm({ title: "Delete file?", message: `Delete ${file.original_name}? This cannot be undone.`, confirmLabel: "Delete", danger: true });
  if (!confirmed) return;
  try {
    const { error: storageError } = await supabase.storage.from("project-files").remove([file.storage_path]);
    if (storageError) throw storageError;
    const { error: rowError } = await supabase.from("files").delete().eq("id", file.id);
    if (rowError) throw rowError;
    emit("data:changed", { entity: "file", entityId: file.id, folderId: state.context.folderId, action: "deleted" });
    AppCore.ui.toast("File deleted.", "success");
    await loadAndRender();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

const filesModule = {
  name: "files",
  async mount(container, context) {
    state.container = container;
    state.context = context;
    state.offEvents.push(on("app:teardown", () => { state.files = []; }));
    await loadAndRender();
  },
  async unmount() {
    state.offEvents.splice(0).forEach((off) => off?.());
    state.container?.replaceChildren();
    state.container = null;
    state.context = null;
    state.files = [];
    state.canUpload = false;
  },
  async refresh(context) {
    state.context = context;
    await loadAndRender();
  }
};

export default filesModule;
