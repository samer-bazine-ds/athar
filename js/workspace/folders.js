import { supabase } from "../supabaseClient.js";
import { getState, setState } from "../core/state.js";
import { emit } from "../core/events.js";

export async function loadFolders() {
  const s = getState();
  if (!s.agency) { setState({ folders: [] }); return []; }
  let query = supabase.from("folders").select("*").eq("agency_id", s.agency.id).is("trashed_at", null).order("position", { ascending: true }).order("created_at", { ascending: true });
  if (s.role === "client") query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  setState({ folders: data || [] });
  return data || [];
}

export async function selectFolder(folderId, options = {}) {
  const s = getState();
  if (folderId === s.selectedFolderId && !options.force) return;
  const folder = folderId ? s.folders.find((f) => f.id === folderId) : null;
  if (folderId && !folder) return;
  setState({ selectedFolderId: folderId });
  emit("folder:selected", { folderId, agencyId: s.agency?.id || null, skipOverview: Boolean(options.skipOverview) });
  const current = getState().selectedModule;
  if (current && options.refreshModule !== false) {
    const { refreshActiveModule } = await import("../core/moduleRegistry.js");
    await refreshActiveModule();
  }
  renderBreadcrumb();
}

export function nextPosition(parentId = null) {
  const siblings = getState().folders.filter((f) => (f.parent_id || null) === (parentId || null) && !f.archived_at && !f.trashed_at);
  return siblings.length ? Math.max(...siblings.map((x) => x.position || 0)) + 100 : 100;
}

export async function createFolder({ name, parentId = null, color = "#F4B400" }) {
  const s = getState();
  const { data, error } = await supabase.from("folders").insert({ agency_id: s.agency.id, parent_id: parentId, name: name.trim(), color, position: nextPosition(parentId), created_by: s.user.id }).select().single();
  if (error) throw error;
  await loadFolders();
  emit("folder:created", { folderId: data.id, parentId, agencyId: s.agency.id });
  return data;
}

export async function updateFolder(id, changes) {
  const s = getState();
  const allowed = {};
  for (const key of ["name", "color", "parent_id", "position", "archived_at", "trashed_at"]) if (key in changes) allowed[key] = changes[key];
  const { data, error } = await supabase.from("folders").update(allowed).eq("id", id).select().single();
  if (error) throw error;
  await loadFolders();
  emit("folder:updated", { folderId: id, agencyId: s.agency.id, changes: Object.keys(allowed) });
  return data;
}

export async function archiveFolder(id) {
  const s = getState();
  const { error } = await supabase.from("folders").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  if (s.selectedFolderId === id) await selectFolder(null);
  await loadFolders();
  emit("folder:deleted", { folderId: id, agencyId: s.agency.id });
}

export async function trashFolder(id) {
  const s = getState();
  const { error } = await supabase.from("folders").update({ trashed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  if (s.selectedFolderId === id) await selectFolder(null);
  await loadFolders();
  emit("folder:deleted", { folderId: id, agencyId: s.agency.id });
}

export async function moveFolder(id, parentId) { return updateFolder(id, { parent_id: parentId, position: nextPosition(parentId) }); }

export async function reorderFolderRelative(movedId, targetId, before = true) {
  const s = getState();
  const moved = s.folders.find((f) => f.id === movedId), target = s.folders.find((f) => f.id === targetId);
  if (!moved || !target || moved.id === target.id) return;
  const parentId = target.parent_id || null;
  const siblings = s.folders.filter((f) => f.id !== movedId && (f.parent_id || null) === parentId && !f.archived_at && !f.trashed_at).sort((a, b) => (a.position - b.position) || a.created_at.localeCompare(b.created_at));
  const targetIndex = siblings.findIndex((f) => f.id === targetId); if (targetIndex < 0) return;
  const index = before ? targetIndex : targetIndex + 1;
  const prev = siblings[index - 1] || null, next = siblings[index] || null;
  let position = prev && next ? Math.floor((prev.position + next.position) / 2) : prev ? prev.position + 100 : next ? Math.floor(next.position / 2) : 100;
  if ((prev && position <= prev.position) || (next && position >= next.position)) {
    const ordered = [...siblings]; ordered.splice(index, 0, { ...moved, parent_id: parentId });
    const results = await Promise.all(ordered.map((row, i) => supabase.from("folders").update({ parent_id: parentId, position: (i + 1) * 100 }).eq("id", row.id)));
    const failure = results.find((result) => result.error); if (failure?.error) throw failure.error;
  } else {
    const { error } = await supabase.from("folders").update({ parent_id: parentId, position }).eq("id", movedId); if (error) throw error;
  }
  await loadFolders();
  emit("folder:updated", { folderId: movedId, agencyId: s.agency.id, changes: ["parent_id", "position"] });
}

export function renderBreadcrumb() {
  const host = document.getElementById("breadcrumb");
  const header = document.querySelector("#page-header h1");
  if (!host) return;
  host.replaceChildren();
  const s = getState();
  if (!s.selectedFolderId) { if (header) header.textContent = "Workspace"; return; }
  const map = new Map(s.folders.map((f) => [f.id, f]));
  const path = []; let cur = map.get(s.selectedFolderId), guard = 0;
  while (cur && guard++ < 100) { path.unshift(cur); cur = cur.parent_id ? map.get(cur.parent_id) : null; }
  path.forEach((folder, index) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "ap-breadcrumb__item"; b.textContent = folder.name; b.addEventListener("click", () => selectFolder(folder.id)); host.append(b);
    if (index < path.length - 1) { const sep = document.createElement("span"); sep.textContent = "/"; sep.className = "ap-breadcrumb__sep"; host.append(sep); }
  });
  if (header) header.textContent = path.at(-1)?.name || "Workspace";
}
