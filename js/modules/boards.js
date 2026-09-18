import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { emit, on } from "../core/events.js";
import { subscribeChannel, unsubscribeByPrefix } from "../core/realtime.js";
import {
  POSITION_STEP,
  sortByPosition,
  nextPosition,
  insertionPosition,
  needsRenormalize,
  fetchAssignableProfiles,
  fetchProfilesByIds,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  fetchTaskComments,
  createTaskComment,
  deleteTaskComment,
  profileLabel,
  priorityLabel
} from "./tasks.js";

const state = {
  container: null,
  context: null,
  boards: [],
  boardId: null,
  columns: [],
  tasks: [],
  profiles: new Map(),
  assignees: [],
  draggedTaskId: null,
  draggedColumnId: null,
  offEvents: [],
  refreshTimer: null
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

function field(labelText, control, hint) {
  const wrapper = el("label", "ap-field");
  wrapper.append(el("span", "ap-field__label", labelText), control);
  if (hint) wrapper.append(el("span", "ap-field__hint", hint));
  return wrapper;
}

function input(value = "", type = "text") {
  const node = el("input", "ap-input");
  node.type = type;
  node.value = value ?? "";
  return node;
}

function textarea(value = "") {
  const node = el("textarea", "ap-textarea");
  node.value = value ?? "";
  node.rows = 4;
  return node;
}

function selectControl(options, value) {
  const node = el("select", "ap-select");
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.value ?? "";
    item.textContent = option.label;
    item.selected = String(item.value) === String(value ?? "");
    node.append(item);
  }
  return node;
}

function checkboxControl(checked = false) {
  const node = el("input", "ap-checkbox");
  node.type = "checkbox";
  node.checked = Boolean(checked);
  return node;
}

function currentBoard() {
  return state.boards.find((board) => board.id === state.boardId) || null;
}

function tasksInColumn(columnId) {
  return sortByPosition(state.tasks.filter((task) => task.column_id === columnId));
}

function scheduleRealtimeRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    if (state.container?.isConnected) loadActiveBoard().catch(showError);
  }, 120);
}

function showError(error) {
  if (!state.container) return;
  AppCore.ui.renderError(state.container, error, () => loadFolder());
}

async function loadBoards() {
  const { folderId } = state.context;
  if (!folderId) {
    state.boards = [];
    state.boardId = null;
    return;
  }
  const { data, error } = await supabase
    .from("boards")
    .select("*")
    .eq("folder_id", folderId)
    .is("archived_at", null)
    .is("trashed_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.boards = data || [];
  if (!state.boards.some((board) => board.id === state.boardId)) {
    state.boardId = state.boards[0]?.id || null;
  }
}

async function loadActiveBoard() {
  unsubscribeByPrefix("tasks:board:");
  unsubscribeByPrefix("columns:board:");

  if (!state.boardId) {
    state.columns = [];
    state.tasks = [];
    state.profiles = new Map();
    render();
    return;
  }

  const [{ data: columns, error: columnsError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase.from("board_columns").select("*").eq("board_id", state.boardId).order("position", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("tasks").select("*").eq("board_id", state.boardId).order("position", { ascending: true }).order("created_at", { ascending: true })
  ]);
  if (columnsError) throw columnsError;
  if (tasksError) throw tasksError;

  state.columns = columns || [];
  state.tasks = tasks || [];
  state.profiles = await fetchProfilesByIds(state.tasks.map((task) => task.assignee_id));
  if (state.context.isStaff) state.assignees = await fetchAssignableProfiles(state.context.agencyId);

  subscribeChannel(`tasks:board:${state.boardId}`, (channel) =>
    channel.on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `board_id=eq.${state.boardId}` }, scheduleRealtimeRefresh)
  );
  subscribeChannel(`columns:board:${state.boardId}`, (channel) =>
    channel.on("postgres_changes", { event: "*", schema: "public", table: "board_columns", filter: `board_id=eq.${state.boardId}` }, scheduleRealtimeRefresh)
  );

  render();
}

async function loadFolder() {
  if (!state.container) return;
  if (!state.context.folderId) {
    state.boards = [];
    state.boardId = null;
    AppCore.ui.renderEmpty(state.container, {
      title: "Choose a folder",
      message: "Select a folder to view its board."
    });
    return;
  }
  AppCore.ui.renderLoading(state.container, "Loading board…");
  await loadBoards();
  await loadActiveBoard();
}

function renderToolbar(root) {
  const toolbar = el("div", "ap-board__toolbar");
  const left = el("div", "ap-board__toolbar-group");
  const right = el("div", "ap-board__toolbar-group");

  if (state.boards.length) {
    const selector = selectControl(state.boards.map((board) => ({ value: board.id, label: board.title })), state.boardId);
    selector.setAttribute("aria-label", "Select board");
    selector.addEventListener("change", async () => {
      state.boardId = selector.value;
      AppCore.ui.renderLoading(state.container, "Loading board…");
      try { await loadActiveBoard(); } catch (error) { showError(error); }
    });
    left.append(selector);
  }

  if (state.context.isStaff) {
    const newBoard = button("New board", "primary");
    newBoard.addEventListener("click", () => openBoardForm());
    right.append(newBoard);

    if (currentBoard()) {
      const editBoard = button("Board settings", "secondary");
      editBoard.addEventListener("click", () => openBoardForm(currentBoard()));
      const newColumn = button("Add column", "secondary");
      newColumn.addEventListener("click", () => openColumnForm());
      right.append(editBoard, newColumn);
    }
  }

  toolbar.append(left, right);
  root.append(toolbar);
}

function render() {
  if (!state.container) return;
  state.container.replaceChildren();
  const root = el("section", "ap-board");
  root.dataset.module = "boards";
  renderToolbar(root);

  if (!state.boards.length) {
    const empty = el("div", "ap-board__empty");
    const title = el("h2", "ap-board__empty-title", state.context.isClient ? "No board has been shared yet" : "No boards yet");
    const message = el("p", "ap-board__empty-text", state.context.isClient ? "When a board is shared with you, it will appear here." : "Create a board to organize this folder's work.");
    empty.append(title, message);
    if (state.context.isStaff) {
      const create = button("Create board", "primary");
      create.addEventListener("click", () => openBoardForm());
      empty.append(create);
    }
    root.append(empty);
    state.container.append(root);
    return;
  }

  const board = currentBoard();
  const header = el("div", "ap-board__header");
  const info = el("div", "ap-board__heading");
  info.append(el("h2", "ap-board__title", board?.title || "Board"));
  if (board?.description) info.append(el("p", "ap-board__description", board.description));
  if (board?.client_visible) info.append(el("span", "ap-badge ap-badge--info", "Client visible"));
  header.append(info);
  root.append(header);

  const canvas = el("div", "ap-board__canvas");
  canvas.setAttribute("aria-label", "Kanban board");

  for (const column of sortByPosition(state.columns)) {
    canvas.append(renderColumn(column));
  }

  if (!state.columns.length) {
    const empty = el("div", "ap-board__empty");
    empty.append(el("p", "ap-board__empty-text", state.context.isClient ? "This board has no columns yet." : "Add a column to start organizing tasks."));
    if (state.context.isStaff) {
      const add = button("Add column", "primary");
      add.addEventListener("click", () => openColumnForm());
      empty.append(add);
    }
    root.append(empty);
  } else {
    root.append(canvas);
  }
  state.container.append(root);
}

function renderColumn(column) {
  const columnNode = el("section", "ap-board-column");
  columnNode.dataset.columnId = column.id;
  columnNode.dataset.module = "boards";
  if (state.context.isStaff) {
    columnNode.draggable = true;
    columnNode.addEventListener("dragstart", (event) => {
      if (event.target.closest(".ap-task-card")) return;
      state.draggedColumnId = column.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `column:${column.id}`);
      columnNode.classList.add("ap-board-column--dragging");
    });
    columnNode.addEventListener("dragend", () => {
      state.draggedColumnId = null;
      columnNode.classList.remove("ap-board-column--dragging");
    });
    columnNode.addEventListener("dragover", (event) => {
      if (state.draggedColumnId) event.preventDefault();
    });
    columnNode.addEventListener("drop", (event) => {
      if (!state.draggedColumnId || event.target.closest(".ap-task-card")) return;
      event.preventDefault();
      reorderColumn(state.draggedColumnId, column.id, event.clientX > columnNode.getBoundingClientRect().left + columnNode.getBoundingClientRect().width / 2).catch((error) => AppCore.ui.toast(AppCore.ui.describeError(error), "error"));
    });
  }

  const header = el("div", "ap-board-column__header");
  const titleWrap = el("div", "ap-board-column__title-wrap");
  const dot = el("span", "ap-dot");
  dot.style.backgroundColor = column.color;
  dot.setAttribute("aria-hidden", "true");
  titleWrap.append(dot, el("h3", "ap-board-column__title", column.name), el("span", "ap-badge ap-badge--neutral", String(tasksInColumn(column.id).length)));
  header.append(titleWrap);

  if (state.context.isStaff) {
    const actions = el("div", "ap-board-column__actions");
    const edit = button("Edit", "ghost");
    edit.classList.add("ap-btn--sm");
    edit.addEventListener("click", () => openColumnForm(column));
    const add = button("+ Task", "ghost");
    add.classList.add("ap-btn--sm");
    add.addEventListener("click", () => openTaskForm(column.id));
    actions.append(add, edit);
    header.append(actions);
  }

  const list = el("div", "ap-board-column__tasks");
  list.dataset.columnId = column.id;
  list.addEventListener("dragover", (event) => {
    if (state.draggedTaskId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  });
  list.addEventListener("drop", (event) => handleTaskDrop(event, column.id));

  const tasks = tasksInColumn(column.id);
  for (const task of tasks) list.append(renderTaskCard(task));
  if (!tasks.length) list.append(el("p", "ap-board-column__empty", "No tasks"));

  columnNode.append(header, list);
  return columnNode;
}

function renderTaskCard(task) {
  const card = el("article", "ap-task-card");
  card.dataset.taskId = task.id;
  card.dataset.module = "boards";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open task ${task.title}`);
  if (state.context.isStaff) {
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      state.draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `task:${task.id}`);
      card.classList.add("ap-task-card--dragging");
    });
    card.addEventListener("dragend", () => {
      state.draggedTaskId = null;
      card.classList.remove("ap-task-card--dragging");
    });
  }
  const open = () => openTaskDetail(task).catch((error) => AppCore.ui.toast(AppCore.ui.describeError(error), "error"));
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  const top = el("div", "ap-task-card__top");
  top.append(el("span", `ap-badge ap-task-card__priority ap-task-card__priority--${task.priority}`, priorityLabel(task.priority)));
  if (task.client_visible && state.context.isStaff) top.append(el("span", "ap-badge ap-badge--info", "Client"));
  if (task.completed_at) top.append(el("span", "ap-badge ap-badge--success", "Completed"));
  card.append(top, el("h4", "ap-task-card__title", task.title));

  if (task.description) card.append(el("p", "ap-task-card__description", task.description));
  const meta = el("div", "ap-task-card__meta");
  if (task.due_date) meta.append(el("span", "ap-task-card__meta-item", `Due ${AppCore.utils.formatDate(task.due_date, "short")}`));
  const profile = state.profiles.get(task.assignee_id);
  if (profile) meta.append(el("span", "ap-task-card__meta-item", profileLabel(profile)));
  card.append(meta);
  return card;
}

async function handleTaskDrop(event, columnId) {
  if (!state.context.isStaff || !state.draggedTaskId) return;
  event.preventDefault();
  event.stopPropagation();
  const dragged = state.tasks.find((task) => task.id === state.draggedTaskId);
  if (!dragged) return;

  const targetCard = event.target.closest(".ap-task-card");
  const siblings = tasksInColumn(columnId).filter((task) => task.id !== dragged.id);
  let index = siblings.length;
  if (targetCard) {
    const targetId = targetCard.dataset.taskId;
    const targetIndex = siblings.findIndex((task) => task.id === targetId);
    if (targetIndex >= 0) {
      const rect = targetCard.getBoundingClientRect();
      index = targetIndex + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    }
  }

  try {
    await moveTask({ task: dragged, targetColumnId: columnId, insertionIndex: index, targetRows: siblings });
    await loadActiveBoard();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    await loadActiveBoard();
  } finally {
    state.draggedTaskId = null;
  }
}

function columnUpsertRow(column) {
  return {
    id: column.id,
    agency_id: column.agency_id,
    board_id: column.board_id,
    name: column.name,
    color: column.color,
    position: column.position
  };
}

async function reorderColumn(draggedId, targetId, after) {
  if (draggedId === targetId) return;
  const dragged = state.columns.find((column) => column.id === draggedId);
  let siblings = sortByPosition(state.columns.filter((column) => column.id !== draggedId));
  const targetIndex = siblings.findIndex((column) => column.id === targetId);
  if (!dragged || targetIndex < 0) return;

  if (needsRenormalize(siblings)) {
    siblings = siblings.map((column, index) => ({ ...column, position: (index + 1) * POSITION_STEP }));
    const { error } = await supabase.from("board_columns").upsert(siblings.map(columnUpsertRow), { onConflict: "id" });
    if (error) throw error;
  }

  const index = Math.min(siblings.length, targetIndex + (after ? 1 : 0));
  let position = insertionPosition(siblings, index);
  const previous = siblings[index - 1];
  const next = siblings[index];
  if ((previous && previous.position === position) || (next && next.position === position)) {
    siblings = siblings.map((column, idx) => ({ ...column, position: (idx + 1) * POSITION_STEP }));
    const { error } = await supabase.from("board_columns").upsert(siblings.map(columnUpsertRow), { onConflict: "id" });
    if (error) throw error;
    position = insertionPosition(siblings, index);
  }

  const { error } = await supabase.from("board_columns").update({ position }).eq("id", dragged.id);
  if (error) throw error;
  emit("data:changed", { entity: "board", entityId: state.boardId, folderId: state.context.folderId, action: "updated" });
  await loadActiveBoard();
}

function openBoardForm(board = null) {
  const form = el("form", "ap-module-form");
  const title = input(board?.title || "");
  title.required = true;
  title.maxLength = 160;
  const description = textarea(board?.description || "");
  const visible = checkboxControl(board?.client_visible || false);
  form.append(field("Board title", title), field("Description", description), field("Visible to clients", visible, "Clients still need folder access."));

  const actions = el("div", "ap-module-form__actions");
  const cancel = button("Cancel", "secondary");
  const save = button(board ? "Save board" : "Create board", "primary");
  cancel.addEventListener("click", () => AppCore.ui.closeModal());
  actions.append(cancel, save);
  form.append(actions);

  save.addEventListener("click", async () => {
    if (!title.value.trim()) return title.focus();
    save.disabled = true;
    try {
      if (board) {
        const { error } = await supabase.from("boards").update({
          title: title.value.trim(), description: description.value.trim() || null, client_visible: visible.checked
        }).eq("id", board.id);
        if (error) throw error;
        emit("data:changed", { entity: "board", entityId: board.id, folderId: state.context.folderId, action: "updated" });
      } else {
        const position = nextPosition(state.boards);
        const { data: created, error } = await supabase.from("boards").insert({
          agency_id: state.context.agencyId,
          folder_id: state.context.folderId,
          title: title.value.trim(),
          description: description.value.trim() || null,
          client_visible: visible.checked,
          position,
          created_by: state.context.user.id
        }).select().single();
        if (error) throw error;
        const defaults = ["To Do", "In Progress", "Done"].map((name, index) => ({
          agency_id: state.context.agencyId,
          board_id: created.id,
          name,
          position: (index + 1) * POSITION_STEP
        }));
        const { error: columnsError } = await supabase.from("board_columns").insert(defaults);
        if (columnsError) throw columnsError;
        state.boardId = created.id;
        emit("data:changed", { entity: "board", entityId: created.id, folderId: state.context.folderId, action: "created" });
      }
      AppCore.ui.closeModal();
      AppCore.ui.toast(board ? "Board updated." : "Board created.", "success");
      await loadFolder();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally {
      save.disabled = false;
    }
  });

  if (board) {
    const archive = button("Archive board", "danger");
    archive.addEventListener("click", async () => {
      const confirmed = await AppCore.ui.confirm({ title: "Archive board?", message: "The board and its tasks will disappear from normal views.", confirmLabel: "Archive", danger: true });
      if (!confirmed) return;
      const { error } = await supabase.from("boards").update({ archived_at: new Date().toISOString() }).eq("id", board.id);
      if (error) return AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      emit("data:changed", { entity: "board", entityId: board.id, folderId: state.context.folderId, action: "deleted" });
      AppCore.ui.closeModal();
      await loadFolder();
    });
    form.append(archive);
  }

  AppCore.ui.openModal({ title: board ? "Board settings" : "New board", content: form, actions: [] });
  title.focus();
}

function openColumnForm(column = null) {
  const form = el("form", "ap-module-form");
  const name = input(column?.name || "");
  name.required = true;
  name.maxLength = 60;
  const color = input(column?.color || "#8A90A6", "color");
  form.append(field("Column name", name), field("Color", color));
  const actions = el("div", "ap-module-form__actions");
  const cancel = button("Cancel", "secondary");
  const save = button(column ? "Save column" : "Add column", "primary");
  cancel.addEventListener("click", () => AppCore.ui.closeModal());
  actions.append(cancel, save);
  form.append(actions);

  save.addEventListener("click", async () => {
    if (!name.value.trim()) return name.focus();
    save.disabled = true;
    try {
      if (column) {
        const { error } = await supabase.from("board_columns").update({ name: name.value.trim(), color: color.value }).eq("id", column.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("board_columns").insert({
          agency_id: state.context.agencyId,
          board_id: state.boardId,
          name: name.value.trim(),
          color: color.value,
          position: nextPosition(state.columns)
        });
        if (error) throw error;
      }
      emit("data:changed", { entity: "board", entityId: state.boardId, folderId: state.context.folderId, action: "updated" });
      AppCore.ui.closeModal();
      await loadActiveBoard();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally { save.disabled = false; }
  });

  if (column) {
    const remove = button("Delete column", "danger");
    remove.addEventListener("click", async () => {
      if (tasksInColumn(column.id).length) {
        AppCore.ui.toast("Move or delete this column's tasks first.", "warning");
        return;
      }
      const confirmed = await AppCore.ui.confirm({ title: "Delete column?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
      if (!confirmed) return;
      const { error } = await supabase.from("board_columns").delete().eq("id", column.id);
      if (error) return AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      AppCore.ui.closeModal();
      await loadActiveBoard();
    });
    form.append(remove);
  }

  AppCore.ui.openModal({ title: column ? "Edit column" : "Add column", content: form, actions: [] });
  name.focus();
}

function taskFormFields(task = {}) {
  const title = input(task.title || "");
  title.required = true;
  title.maxLength = 200;
  const description = textarea(task.description || "");
  const dueDate = input(task.due_date || "", "date");
  const priority = selectControl([
    { value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }
  ], task.priority || "normal");
  const assignee = selectControl([
    { value: "", label: "Unassigned" },
    ...state.assignees.map((profile) => ({ value: profile.id, label: profileLabel(profile) }))
  ], task.assignee_id || "");
  const visible = checkboxControl(task.client_visible || false);
  const completed = checkboxControl(Boolean(task.completed_at));
  return { title, description, dueDate, priority, assignee, visible, completed };
}

function openTaskForm(columnId) {
  const fields = taskFormFields();
  const form = el("form", "ap-module-form");
  form.append(
    field("Task title", fields.title), field("Description", fields.description), field("Assignee", fields.assignee),
    field("Due date", fields.dueDate), field("Priority", fields.priority), field("Visible to clients", fields.visible)
  );
  const actions = el("div", "ap-module-form__actions");
  const cancel = button("Cancel", "secondary");
  const save = button("Create task", "primary");
  cancel.addEventListener("click", () => AppCore.ui.closeModal());
  actions.append(cancel, save);
  form.append(actions);
  save.addEventListener("click", async () => {
    if (!fields.title.value.trim()) return fields.title.focus();
    save.disabled = true;
    try {
      await createTask({
        context: state.context,
        boardId: state.boardId,
        columnId,
        title: fields.title.value,
        description: fields.description.value,
        assigneeId: fields.assignee.value,
        dueDate: fields.dueDate.value,
        priority: fields.priority.value,
        clientVisible: fields.visible.checked,
        siblings: tasksInColumn(columnId)
      });
      AppCore.ui.closeModal();
      AppCore.ui.toast("Task created.", "success");
      await loadActiveBoard();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally { save.disabled = false; }
  });
  AppCore.ui.openModal({ title: "New task", content: form, actions: [] });
  fields.title.focus();
}

async function openTaskDetail(task) {
  const wrapper = el("div", "ap-task-detail");
  const fields = state.context.isStaff ? taskFormFields(task) : null;

  if (fields) {
    wrapper.append(
      field("Task title", fields.title), field("Description", fields.description), field("Assignee", fields.assignee),
      field("Due date", fields.dueDate), field("Priority", fields.priority), field("Visible to clients", fields.visible),
      field("Completed", fields.completed)
    );
    const actions = el("div", "ap-module-form__actions");
    const save = button("Save task", "primary");
    const remove = button("Delete task", "danger");
    save.addEventListener("click", async () => {
      if (!fields.title.value.trim()) return fields.title.focus();
      save.disabled = true;
      try {
        await updateTask(task.id, {
          title: fields.title.value.trim(),
          description: fields.description.value.trim() || null,
          assignee_id: fields.assignee.value || null,
          due_date: fields.dueDate.value || null,
          priority: fields.priority.value,
          client_visible: fields.visible.checked,
          completed_at: fields.completed.checked ? (task.completed_at || new Date().toISOString()) : null
        }, state.context.folderId);
        AppCore.ui.toast("Task updated.", "success");
        await loadActiveBoard();
      } catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
      finally { save.disabled = false; }
    });
    remove.addEventListener("click", async () => {
      const confirmed = await AppCore.ui.confirm({ title: "Delete task?", message: "This task and its comments will be deleted.", confirmLabel: "Delete", danger: true });
      if (!confirmed) return;
      try {
        await deleteTask(task.id, state.context.folderId);
        AppCore.ui.closeModal();
        await loadActiveBoard();
      } catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
    });
    actions.append(save, remove);
    wrapper.append(actions);
  } else {
    const description = el("p", "ap-task-detail__description", task.description || "No description.");
    wrapper.append(description);
    const meta = el("dl", "ap-task-detail__meta");
    const addMeta = (label, value) => {
      meta.append(el("dt", "ap-task-detail__meta-label", label), el("dd", "ap-task-detail__meta-value", value));
    };
    addMeta("Priority", priorityLabel(task.priority));
    if (task.due_date) addMeta("Due", AppCore.utils.formatDate(task.due_date, "long"));
    const profile = state.profiles.get(task.assignee_id);
    if (profile) addMeta("Assigned to", profileLabel(profile));
    wrapper.append(meta);
  }

  const commentSection = el("section", "ap-task-comments");
  wrapper.append(commentSection);
  await renderComments(commentSection, task);
  AppCore.ui.openModal({ title: task.title, content: wrapper, actions: [] });
}

async function renderComments(container, task) {
  container.replaceChildren(el("h3", "ap-task-comments__title", "Comments"));
  let comments;
  try { comments = await fetchTaskComments(task.id); }
  catch (error) {
    container.append(el("p", "ap-task-comments__error", AppCore.ui.describeError(error)));
    return;
  }

  const list = el("div", "ap-task-comments__list");
  if (!comments.length) list.append(el("p", "ap-task-comments__empty", "No comments yet."));
  for (const comment of comments) {
    const item = el("article", "ap-task-comment");
    const heading = el("div", "ap-task-comment__header");
    heading.append(el("strong", "ap-task-comment__author", profileLabel(comment.author)), el("span", "ap-task-comment__time", AppCore.utils.formatDate(comment.created_at, "relative")));
    if (!comment.client_visible && state.context.isStaff) heading.append(el("span", "ap-badge ap-badge--warning", "Internal"));
    item.append(heading, el("p", "ap-task-comment__body", comment.body));
    if (comment.author_id === state.context.user.id || state.context.isOwner) {
      const remove = button("Delete", "ghost");
      remove.classList.add("ap-btn--sm");
      remove.addEventListener("click", async () => {
        const confirmed = await AppCore.ui.confirm({ title: "Delete comment?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
        if (!confirmed) return;
        try { await deleteTaskComment(comment, state.context); await renderComments(container, task); }
        catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
      });
      item.append(remove);
    }
    list.append(item);
  }
  container.append(list);

  const form = el("form", "ap-task-comments__form");
  const body = textarea("");
  body.placeholder = "Write a comment…";
  const controls = el("div", "ap-task-comments__controls");
  let visible = null;
  if (state.context.isStaff) {
    visible = checkboxControl(true);
    controls.append(field("Visible to client", visible));
  }
  const send = button("Post comment", "primary");
  controls.append(send);
  form.append(body, controls);
  send.addEventListener("click", async () => {
    const value = body.value.trim();
    if (!value) return body.focus();
    send.disabled = true;
    try {
      await createTaskComment({ context: state.context, taskId: task.id, body: value, clientVisible: state.context.isClient ? true : visible.checked });
      body.value = "";
      await renderComments(container, task);
    } catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
    finally { send.disabled = false; }
  });
  container.append(form);
}

async function refresh(context) {
  state.context = context;
  state.boardId = null;
  await loadFolder();
}

const boardsModule = {
  name: "boards",
  async mount(container, context) {
    state.container = container;
    state.context = context;
    state.offEvents.push(on("app:teardown", () => {
      unsubscribeByPrefix("tasks:board:");
      unsubscribeByPrefix("columns:board:");
    }));
    await loadFolder();
  },
  async unmount() {
    clearTimeout(state.refreshTimer);
    state.offEvents.splice(0).forEach((off) => off?.());
    unsubscribeByPrefix("tasks:board:");
    unsubscribeByPrefix("columns:board:");
    state.container?.replaceChildren();
    state.container = null;
    state.context = null;
    state.boards = [];
    state.boardId = null;
    state.columns = [];
    state.tasks = [];
    state.profiles = new Map();
    state.assignees = [];
    state.draggedTaskId = null;
    state.draggedColumnId = null;
  },
  async refresh(context) {
    await refresh(context);
  }
};

export default boardsModule;
