import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { emit } from "../core/events.js";

export const POSITION_STEP = 100;

export function sortByPosition(rows = []) {
  return [...rows].sort((a, b) => (a.position - b.position) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

export function nextPosition(rows = []) {
  if (!rows.length) return POSITION_STEP;
  return Math.max(...rows.map((row) => Number(row.position) || 0)) + POSITION_STEP;
}

export function needsRenormalize(rows = []) {
  const sorted = sortByPosition(rows);
  for (let i = 1; i < sorted.length; i += 1) {
    if ((sorted[i].position - sorted[i - 1].position) < 2) return true;
  }
  return false;
}

export function insertionPosition(sortedRows, index) {
  const rows = sortByPosition(sortedRows);
  if (!rows.length) return POSITION_STEP;
  if (index <= 0) return Math.floor(rows[0].position / 2);
  if (index >= rows.length) return rows[rows.length - 1].position + POSITION_STEP;
  return Math.floor((rows[index - 1].position + rows[index].position) / 2);
}

export async function renormalizeTasks(rows) {
  const ordered = sortByPosition(rows).map((row, index) => ({ ...row, position: (index + 1) * POSITION_STEP }));
  if (!ordered.length) return ordered;
  const results = await Promise.all(ordered.map((row) =>
    supabase.from("tasks").update({ position: row.position }).eq("id", row.id)
  ));
  const failure = results.find((result) => result.error);
  if (failure?.error) throw failure.error;
  return ordered;
}

export async function fetchAssignableProfiles(agencyId) {
  const { data: members, error: memberError } = await supabase
    .from("agency_members")
    .select("profile_id, role, client_id")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true });
  if (memberError) throw memberError;

  const ids = [...new Set((members || []).map((m) => m.profile_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", ids);
  if (profileError) throw profileError;

  const membershipByProfile = new Map((members || []).map((m) => [m.profile_id, m]));
  return (profiles || []).map((profile) => ({ ...profile, membership: membershipByProfile.get(profile.id) || null }));
}

export async function fetchProfilesByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", unique);
  if (error) throw error;
  return new Map((data || []).map((profile) => [profile.id, profile]));
}

export async function createTask({ context, boardId, columnId, title, description, assigneeId, dueDate, priority, clientVisible, siblings }) {
  const row = {
    agency_id: context.agencyId,
    folder_id: context.folderId,
    board_id: boardId,
    column_id: columnId,
    title: title.trim(),
    description: description?.trim() || null,
    assignee_id: assigneeId || null,
    due_date: dueDate || null,
    priority: priority || "normal",
    client_visible: Boolean(clientVisible),
    position: nextPosition(siblings),
    created_by: context.user.id
  };
  const { data, error } = await supabase.from("tasks").insert(row).select().single();
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: data.id, folderId: context.folderId, action: "created" });
  return data;
}

export async function updateTask(taskId, patch, folderId) {
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", taskId).select().single();
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: taskId, folderId, action: "updated" });
  return data;
}

export async function deleteTask(taskId, folderId) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: taskId, folderId, action: "deleted" });
}

export async function moveTask({ task, targetColumnId, insertionIndex, targetRows }) {
  let siblings = sortByPosition(targetRows.filter((row) => row.id !== task.id));

  if (needsRenormalize(siblings)) {
    siblings = await renormalizeTasks(siblings);
  }

  let position = insertionPosition(siblings, insertionIndex);
  const previous = siblings[insertionIndex - 1] || null;
  const next = siblings[insertionIndex] || null;
  if ((previous && previous.position === position) || (next && next.position === position)) {
    siblings = await renormalizeTasks(siblings);
    position = insertionPosition(siblings, insertionIndex);
  }

  const patch = { column_id: targetColumnId, position };
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", task.id).select().single();
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: task.id, folderId: task.folder_id, action: "updated" });
  return data;
}

export async function fetchTaskComments(taskId) {
  const { data, error } = await supabase
    .from("task_comments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const profiles = await fetchProfilesByIds((data || []).map((row) => row.author_id));
  return (data || []).map((row) => ({ ...row, author: profiles.get(row.author_id) || null }));
}

export async function createTaskComment({ context, taskId, body, clientVisible }) {
  const row = {
    agency_id: context.agencyId,
    task_id: taskId,
    author_id: context.user.id,
    body: body.trim(),
    client_visible: context.isClient ? true : Boolean(clientVisible)
  };
  const { data, error } = await supabase.from("task_comments").insert(row).select().single();
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: taskId, folderId: context.folderId, action: "updated" });
  return data;
}

export async function deleteTaskComment(comment, context) {
  const canDelete = comment.author_id === context.user.id || context.isOwner;
  if (!canDelete) throw new Error("You do not have permission to delete this comment.");
  const { error } = await supabase.from("task_comments").delete().eq("id", comment.id);
  if (error) throw error;
  emit("data:changed", { entity: "task", entityId: comment.task_id, folderId: context.folderId, action: "updated" });
}

export function profileLabel(profile) {
  return profile?.full_name?.trim() || profile?.email || "Unknown user";
}

export function priorityLabel(priority) {
  return ({ low: "Low", normal: "Normal", high: "High", urgent: "Urgent" })[priority] || "Normal";
}

export function describeTaskError(error) {
  return AppCore.ui.describeError(error);
}
