import { getState } from "../core/state.js";
import { selectFolder, createFolder, updateFolder, archiveFolder, trashFolder, moveFolder, reorderFolderRelative } from "./folders.js";
import { AppCore } from "../core/appCore.js";

const expanded = new Set();
function button(text, cls = "") { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; return b; }
function childrenOf(parentId) { return getState().folders.filter((f) => (f.parent_id || null) === (parentId || null) && !f.archived_at && !f.trashed_at).sort((a,b)=>(a.position-b.position)||a.created_at.localeCompare(b.created_at)); }

export function renderFolderTree() {
  const host = document.getElementById("folder-tree"); if (!host) return; host.replaceChildren();
  const roots = childrenOf(null);
  if (!roots.length) { const p = document.createElement("p"); p.className = "ap-sidebar-empty"; p.textContent = getState().role === "client" ? "No folders shared yet." : "No folders yet."; host.append(p); return; }
  const ul = document.createElement("ul"); ul.className = "ap-folder-tree"; for (const folder of roots) ul.append(renderNode(folder)); host.append(ul);
}

function renderNode(folder) {
  const li = document.createElement("li"); li.className = "ap-folder-tree__node"; li.dataset.folderId = folder.id;
  const row = document.createElement("div"); row.className = "ap-folder-tree__row"; if (folder.id === getState().selectedFolderId) row.classList.add("ap-folder-tree__row--active");
  const kids = childrenOf(folder.id);
  const toggle = button(kids.length ? (expanded.has(folder.id) ? "▾" : "▸") : "", "ap-folder-tree__toggle"); toggle.disabled = !kids.length; toggle.setAttribute("aria-label", "Toggle subfolders"); toggle.addEventListener("click", () => { expanded.has(folder.id) ? expanded.delete(folder.id) : expanded.add(folder.id); renderFolderTree(); });
  const folderIcon = document.createElement("span"); folderIcon.className = "ap-folder-mini"; folderIcon.style.setProperty("--folder-color", folder.color || "#F4B400");
  const label = button(folder.name, "ap-folder-tree__label"); label.addEventListener("click", () => selectFolder(folder.id).then(renderFolderTree)); row.append(toggle, folderIcon, label);
  if (getState().role !== "client") {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", folder.id));
    row.addEventListener("dragover", (e) => { e.preventDefault(); const r = row.getBoundingClientRect(); const y = e.clientY - r.top; row.dataset.dropZone = y < r.height / 3 ? "before" : y > r.height * 2 / 3 ? "after" : "inside"; });
    row.addEventListener("dragleave", () => delete row.dataset.dropZone);
    row.addEventListener("drop", async (e) => { e.preventDefault(); const moved = e.dataTransfer.getData("text/plain"); const zone = row.dataset.dropZone || "inside"; delete row.dataset.dropZone; if (moved && moved !== folder.id) { try { if (zone === "inside") { await moveFolder(moved, folder.id); expanded.add(folder.id); } else await reorderFolderRelative(moved, folder.id, zone === "before"); renderFolderTree(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } } });
    const menu = button("•••", "ap-folder-tree__menu"); menu.setAttribute("aria-label", `Actions for ${folder.name}`); menu.addEventListener("click", () => openFolderActions(folder)); row.append(menu);
  }
  li.append(row);
  if (kids.length && expanded.has(folder.id)) { const ul = document.createElement("ul"); ul.className = "ap-folder-tree ap-folder-tree--nested"; for (const kid of kids) ul.append(renderNode(kid)); li.append(ul); }
  return li;
}

function openFolderActions(folder) {
  const wrap = document.createElement("form"); wrap.className = "ap-stack";
  const name = document.createElement("input"); name.className = "ap-input"; name.value = folder.name; name.maxLength = 120;
  const color = document.createElement("input"); color.type = "color"; color.value = folder.color;
  const save = button("Save", "ap-btn ap-btn--primary"); save.addEventListener("click", async (e) => { e.preventDefault(); try { await updateFolder(folder.id, { name: name.value, color: color.value }); AppCore.ui.closeModal(); renderFolderTree(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } });
  const add = button("Add subfolder", "ap-btn ap-btn--secondary"); add.addEventListener("click", (e) => { e.preventDefault(); AppCore.ui.closeModal(); openCreateFolder(folder.id); });
  const archive = button("Archive", "ap-btn ap-btn--secondary"); archive.addEventListener("click", async (e) => { e.preventDefault(); if (await AppCore.ui.confirm({ title: "Archive folder?", message: "The folder will move to Library → Archive.", confirmLabel: "Archive", danger: false })) { try { await archiveFolder(folder.id); AppCore.ui.closeModal(); renderFolderTree(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } } });
  const trash = button("Move to Trash", "ap-btn ap-btn--danger"); trash.addEventListener("click", async (e) => { e.preventDefault(); if (await AppCore.ui.confirm({ title: "Move folder to Trash?", message: "It will disappear from the folder list until restored.", confirmLabel: "Move to Trash", danger: true })) { try { await trashFolder(folder.id); AppCore.ui.closeModal(); renderFolderTree(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } } });
  wrap.append(name, color, save, add, archive, trash); AppCore.ui.openModal({ title: "Folder settings", content: wrap, actions: [] });
}

export function openCreateFolder(parentId = null) {
  const form = document.createElement("form"); form.className = "ap-stack";
  const name = document.createElement("input"); name.className = "ap-input"; name.placeholder = "Folder name"; name.required = true;
  const color = document.createElement("input"); color.type = "color"; color.value = "#F4B400";
  const submit = button("Create folder", "ap-btn ap-btn--primary"); submit.type = "submit";
  form.append(name, color, submit);
  form.addEventListener("submit", async (e) => { e.preventDefault(); submit.disabled = true; try { const folder = await createFolder({ name: name.value, parentId, color: color.value }); AppCore.ui.closeModal(); if (parentId) expanded.add(parentId); renderFolderTree(); await selectFolder(folder.id); renderFolderTree(); } catch (err) { AppCore.ui.toast(AppCore.ui.describeError(err), "error"); } finally { submit.disabled = false; } });
  AppCore.ui.openModal({ title: parentId ? "New subfolder" : "New folder", content: form, actions: [] }); name.focus();
}
