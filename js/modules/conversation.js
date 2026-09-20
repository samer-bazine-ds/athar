import { AppCore } from "../core/appCore.js";
import { on, emit } from "../core/events.js";
import { subscribeChannel, unsubscribeByPrefix } from "../core/realtime.js";
import { listConversations, createConversation, updateConversation } from "../conversations/conversations.js";
import { listMessages, sendMessage, deleteMessage, openMessageAttachment, validateMessageAttachment } from "../conversations/messages.js";

const state = { container:null, context:null, conversations:[], activeId:null, messages:[], off:[], replyTo:null, timer:null };
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function initials(value = "") {
  return value.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "?";
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const delta = Date.now() - date.getTime();
  if (delta < 60 * 1000) return "Now";
  if (delta < 60 * 60 * 1000) return `${Math.floor(delta / 60000)}m`;
  if (delta < 24 * 60 * 60 * 1000) return `${Math.floor(delta / 3600000)}h`;
  if (delta < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(delta / 86400000)}d`;
  return date.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

async function load() {
  if (!state.context.folderId) {
    AppCore.ui.renderEmpty(state.container, { title:"Choose a folder", message:"Select a folder to open its conversations." });
    return;
  }
  AppCore.ui.renderLoading(state.container, "Loading conversations...");
  try {
    state.conversations = await listConversations(state.context.folderId);
    if (!state.conversations.some(conversation => conversation.id === state.activeId)) state.activeId = state.conversations[0]?.id || null;
    await loadMessages();
    render();
    subscribe();
  } catch (error) {
    AppCore.ui.renderError(state.container, error, load);
  }
}

async function loadMessages() {
  state.messages = state.activeId ? await listMessages(state.activeId) : [];
}

function subscribe() {
  unsubscribeByPrefix("messages:conversation:");
  unsubscribeByPrefix("conversations:folder:");
  if (state.activeId) subscribeChannel(`messages:conversation:${state.activeId}`, channel => channel.on(
    "postgres_changes", { event:"*", schema:"public", table:"messages", filter:`conversation_id=eq.${state.activeId}` }, () => schedule()
  ));
  if (state.context.folderId) subscribeChannel(`conversations:folder:${state.context.folderId}`, channel => channel.on(
    "postgres_changes", { event:"*", schema:"public", table:"conversations", filter:`folder_id=eq.${state.context.folderId}` }, () => schedule()
  ));
}

function schedule() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => load().catch(console.error), 120);
}

function renderThread(conversation) {
  const active = conversation.id === state.activeId;
  const title = conversation.title || "Untitled conversation";
  const button = el("button", `k-conversation-thread${active ? " k-conversation-thread--active" : ""}`);
  button.type = "button";
  button.setAttribute("aria-current", active ? "page" : "false");
  const avatar = el("span", "k-conversation-thread__avatar", initials(title));
  const copy = el("span", "k-conversation-thread__copy");
  const heading = el("span", "k-conversation-thread__heading");
  heading.append(el("strong", "", title));
  heading.append(el("time", "", relativeTime(conversation.last_message_at || conversation.created_at)));
  copy.append(heading, el("span", "k-conversation-thread__preview", conversation.client_visible ? "Shared with client" : "Internal conversation"));
  button.append(avatar, copy);
  button.addEventListener("click", async () => {
    state.activeId = conversation.id;
    state.replyTo = null;
    await loadMessages();
    subscribe();
    render();
  });
  return button;
}

function render() {
  const root = el("section", "ap-conversation ap-conversation--kitchen");
  root.dataset.module = "conversation";

  const side = el("aside", "ap-conversation__list k-conversation-sidebar");
  const sideHead = el("div", "k-conversation-sidebar__header");
  const sideCopy = el("div", "");
  sideCopy.append(el("p", "k-conversation-eyebrow", "CONVERSATIONS"), el("h2", "", "Messages"));
  sideHead.append(sideCopy);
  if (state.context.isStaff) {
    const create = el("button", "k-conversation-new", "+");
    create.type = "button";
    create.title = "New conversation";
    create.setAttribute("aria-label", "New conversation");
    create.addEventListener("click", openCreate);
    sideHead.append(create);
  }
  side.append(sideHead);

  const threadList = el("div", "k-conversation-thread-list");
  if (state.conversations.length) state.conversations.forEach(conversation => threadList.append(renderThread(conversation)));
  else {
    const empty = el("div", "k-conversation-sidebar__empty");
    empty.append(el("strong", "", "No conversations"), el("span", "", state.context.isStaff ? "Create one to start collaborating." : "Your shared messages will appear here."));
    threadList.append(empty);
  }
  side.append(threadList);

  const main = el("div", "ap-conversation__main k-conversation-main");
  const current = state.conversations.find(conversation => conversation.id === state.activeId);
  if (!current) {
    const empty = el("div", "k-conversation-empty");
    empty.append(el("span", "k-conversation-empty__icon", "✦"), el("h3", "", state.context.isClient ? "Nothing shared yet" : "Select or create a conversation"), el("p", "", state.context.isClient ? "When your team shares a conversation, it will appear here." : "Keep client feedback and project discussions in one place."));
    if (state.context.isStaff) {
      const button = el("button", "ap-btn ap-btn--primary", "New conversation");
      button.type = "button";
      button.addEventListener("click", openCreate);
      empty.append(button);
    }
    main.append(empty);
  } else {
    const header = el("header", "ap-conversation__header k-conversation-header");
    const heading = el("div", "");
    heading.append(el("p", "k-conversation-eyebrow", current.client_visible ? "SHARED CONVERSATION" : "INTERNAL CONVERSATION"), el("h2", "", current.title));
    header.append(heading);
    const tools = el("div", "k-conversation-header__tools");
    tools.append(el("span", `k-conversation-visibility${current.client_visible ? "" : " k-conversation-visibility--internal"}`, current.client_visible ? "Shared" : "Internal"));
    if (state.context.isStaff) {
      const settings = el("button", "k-conversation-more", "•••");
      settings.type = "button";
      settings.title = "Conversation settings";
      settings.setAttribute("aria-label", "Conversation settings");
      settings.addEventListener("click", () => openSettings(current));
      tools.append(settings);
    }
    header.append(tools);
    main.append(header);

    const feed = el("div", "ap-message-feed k-message-feed");
    if (!state.messages.length) {
      const starter = el("div", "k-message-starter");
      starter.append(el("span", "", "Start the conversation"), el("p", "", "Share an update, ask a question, or leave feedback here."));
      feed.append(starter);
    } else {
      state.messages.forEach(message => feed.append(renderMessage(message)));
    }
    main.append(feed, renderComposer(current));
    queueMicrotask(() => { feed.scrollTop = feed.scrollHeight; });
  }
  root.append(side, main);
  state.container.replaceChildren(root);
}

function renderMessage(message) {
  const mine = message.sender_id === state.context.user.id;
  const senderName = message.sender?.full_name || message.sender?.email || "Member";
  const card = el("article", `ap-message k-message${mine ? " ap-message--mine k-message--mine" : ""}${!message.client_visible ? " ap-message--internal k-message--internal" : ""}`);
  const avatar = el("span", "k-message__avatar", initials(senderName));
  const content = el("div", "k-message__content");
  const meta = el("div", "ap-message__meta k-message__meta");
  meta.append(el("strong", "", mine ? "You" : senderName), el("span", "", AppCore.utils.formatDate(message.created_at, "relative")));
  if (!message.client_visible && state.context.isStaff) meta.append(el("span", "k-message__internal-label", "Internal"));
  const body = message.body ? el("p", "ap-message__body", message.body) : null;
  const attachments = el("div", "k-message-attachments");
  for (const attachment of message.attachments || []) attachments.append(renderAttachment(attachment));
  const actions = el("div", "ap-message__actions k-message__actions");
  const reply = el("button", "", "Reply");
  reply.type = "button";
  reply.addEventListener("click", () => { state.replyTo = message.reply_to_message_id || message.id; render(); });
  actions.append(reply);
  if (mine || state.context.isOwner) {
    const remove = el("button", "", "Delete");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!await AppCore.ui.confirm({ title:"Delete message?", message:"This cannot be undone.", confirmLabel:"Delete", danger:true })) return;
      try {
        await deleteMessage(message);
        await loadMessages();
        render();
      } catch (error) {
        AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      }
    });
    actions.append(remove);
  }
  content.append(meta);
  if (body) content.append(body);
  if (attachments.childElementCount) content.append(attachments);
  content.append(actions);
  card.append(avatar, content);
  return card;
}

function renderAttachment(attachment) {
  const file = el("button", `k-message-attachment${attachment.mime_type.startsWith("image/") ? " k-message-attachment--image" : attachment.mime_type.startsWith("video/") ? " k-message-attachment--video" : ""}`);
  file.type = "button";
  file.title = `Open ${attachment.original_name}`;
  const icon = attachment.mime_type.startsWith("image/") ? "IMG" : attachment.mime_type.startsWith("video/") ? "VID" : attachment.mime_type === "application/pdf" ? "PDF" : "FILE";
  const copy = el("span", "k-message-attachment__copy");
  copy.append(el("strong", "", attachment.original_name), el("small", "", AppCore.utils.formatBytes(attachment.size_bytes)));
  file.append(el("span", "k-message-attachment__icon", icon), copy, el("span", "k-message-attachment__open", "Open"));
  file.addEventListener("click", async () => {
    try { await openMessageAttachment(attachment); }
    catch (error) { AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }
  });
  return file;
}

function renderComposer(current) {
  const form = el("form", "ap-message-composer k-message-composer");
  if (state.replyTo) {
    const replyBar = el("div", "ap-replying k-message-replying");
    replyBar.append(el("span", "", "Replying to a message"));
    const cancel = el("button", "", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { state.replyTo = null; render(); });
    replyBar.append(cancel);
    form.append(replyBar);
  }
  const textarea = el("textarea", "ap-textarea");
  textarea.placeholder = "Write a message...";
  textarea.maxLength = 20000;
  textarea.setAttribute("aria-label", "Write a message");
  textarea.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") form.requestSubmit();
  });
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,video/*,audio/*,application/pdf,text/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";
  fileInput.hidden = true;
  const attachedFiles = [];
  const attachmentList = el("div", "k-composer-attachments");
  const renderSelectedFiles = () => {
    attachmentList.replaceChildren();
    attachedFiles.forEach((file, index) => {
      const chip = el("span", "k-composer-attachment", file.name);
      const remove = el("button", "", "×");
      remove.type = "button";
      remove.title = `Remove ${file.name}`;
      remove.addEventListener("click", () => { attachedFiles.splice(index, 1); renderSelectedFiles(); });
      chip.append(remove);
      attachmentList.append(chip);
    });
  };
  fileInput.addEventListener("change", () => {
    for (const file of Array.from(fileInput.files || [])) {
      const problem = validateMessageAttachment(file);
      if (problem) { AppCore.ui.toast(problem, "warning"); continue; }
      if (!attachedFiles.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) attachedFiles.push(file);
    }
    fileInput.value = "";
    renderSelectedFiles();
  });
  const bottom = el("div", "ap-message-composer__bottom k-message-composer__bottom");
  const details = el("div", "k-message-composer__details");
  const attach = el("button", "k-message-attach", "Attach files");
  attach.type = "button";
  attach.addEventListener("click", () => fileInput.click());
  details.append(attach);
  let visible = null;
  if (state.context.isStaff) {
    const label = el("label", "ap-checkbox-label k-message-visibility-control");
    visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = true;
    label.append(visible, document.createTextNode(" Share with client"));
    details.append(label);
  }
  details.append(el("span", "k-message-shortcut", "Ctrl + Enter to send"));
  const send = el("button", "ap-btn ap-btn--primary k-message-send", "Send");
  send.type = "submit";
  bottom.append(details, send);
  form.append(textarea, fileInput, attachmentList, bottom);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body && !attachedFiles.length) return;
    send.disabled = true;
    attach.disabled = true;
    send.textContent = attachedFiles.length ? "Uploading..." : "Sending...";
    try {
      await sendMessage({ conversationId:current.id, body, clientVisible:state.context.isClient ? true : (visible?.checked ?? true), replyToMessageId:state.replyTo, attachments:attachedFiles });
      state.replyTo = null;
      await loadMessages();
      render();
      emit("data:changed", { entity:"message", entityId:null, folderId:state.context.folderId, action:"created" });
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally {
      send.disabled = false;
      attach.disabled = false;
      send.textContent = "Send";
    }
  });
  return form;
}

function openCreate() {
  const form = el("form", "ap-stack");
  const title = el("input", "ap-input");
  title.placeholder = "Conversation title";
  title.required = true;
  const label = el("label", "ap-checkbox-label");
  const visible = document.createElement("input");
  visible.type = "checkbox";
  label.append(visible, document.createTextNode(" Visible to clients"));
  const save = el("button", "ap-btn ap-btn--primary", "Create");
  save.type = "submit";
  form.append(title, label, save);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const conversation = await createConversation({ folderId:state.context.folderId, title:title.value, clientVisible:visible.checked });
      state.activeId = conversation.id;
      AppCore.ui.closeModal();
      await load();
      emit("data:changed", { entity:"conversation", entityId:conversation.id, folderId:state.context.folderId, action:"created" });
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    }
  });
  AppCore.ui.openModal({ title:"New conversation", content:form, actions:[] });
  title.focus();
}

function openSettings(conversation) {
  const form = el("form", "ap-stack");
  const title = el("input", "ap-input");
  title.value = conversation.title;
  const label = el("label", "ap-checkbox-label");
  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = conversation.client_visible;
  label.append(visible, document.createTextNode(" Visible to clients"));
  const save = el("button", "ap-btn ap-btn--primary", "Save");
  save.type = "submit";
  const archive = el("button", "ap-btn ap-btn--danger", "Archive");
  archive.type = "button";
  archive.addEventListener("click", async () => {
    try {
      await updateConversation(conversation.id, { archived_at:new Date().toISOString() });
      AppCore.ui.closeModal();
      state.activeId = null;
      await load();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    }
  });
  form.append(title, label, save, archive);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await updateConversation(conversation.id, { title:title.value.trim(), client_visible:visible.checked });
      AppCore.ui.closeModal();
      await load();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    }
  });
  AppCore.ui.openModal({ title:"Conversation settings", content:form, actions:[] });
}

const module = {
  name:"conversation",
  async mount(container, context) {
    state.container = container;
    state.context = context;
    state.off = [on("folder:selected", () => {})];
    await load();
  },
  async unmount() {
    state.off.forEach(off => off());
    state.off = [];
    unsubscribeByPrefix("messages:conversation:");
    unsubscribeByPrefix("conversations:folder:");
    clearTimeout(state.timer);
    state.container?.replaceChildren();
    state.container = null;
  },
  async refresh(context) {
    state.context = context;
    state.activeId = null;
    await load();
  }
};

export default module;
