import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";
import { AppCore } from "../core/appCore.js";

export const MAX_MESSAGE_ATTACHMENT_BYTES = 26214400;
const BLOCKED_EXTENSIONS = new Set(["exe", "bat", "cmd", "com", "msi", "sh", "ps1", "vbs", "js"]);
const BLOCKED_MIME = new Set(["application/x-msdownload", "application/x-sh", "application/x-msdos-program"]);

function extension(name = "") {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

export function validateMessageAttachment(file) {
  if (!file || file.size <= 0) return "Choose a valid file.";
  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) return "Each attachment must be 25 MiB or smaller.";
  if (BLOCKED_EXTENSIONS.has(extension(file.name)) || BLOCKED_MIME.has(file.type)) return "That file type is not allowed.";
  return "";
}

export async function listMessages(conversationId) {
  const { data, error } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending:true });
  if (error) throw error;
  const messages = data || [];
  const senderIds = [...new Set(messages.map(message => message.sender_id))];
  const messageIds = messages.map(message => message.id);
  const [profileResult, attachmentResult] = await Promise.all([
    senderIds.length ? supabase.from("profiles").select("id,full_name,email,avatar_url").in("id", senderIds) : Promise.resolve({ data:[], error:null }),
    messageIds.length ? supabase.from("message_attachments").select("*").in("message_id", messageIds).order("created_at", { ascending:true }) : Promise.resolve({ data:[], error:null })
  ]);
  if (profileResult.error) throw profileResult.error;
  if (attachmentResult.error) throw attachmentResult.error;
  const profiles = new Map((profileResult.data || []).map(profile => [profile.id, profile]));
  const attachmentsByMessage = new Map();
  for (const attachment of attachmentResult.data || []) {
    const attachments = attachmentsByMessage.get(attachment.message_id) || [];
    attachments.push(attachment);
    attachmentsByMessage.set(attachment.message_id, attachments);
  }
  return messages.map(message => ({ ...message, sender:profiles.get(message.sender_id) || null, attachments:attachmentsByMessage.get(message.id) || [] }));
}

export async function sendMessage({ conversationId, body = "", clientVisible = true, replyToMessageId = null, attachments = [] }) {
  const text = body.trim();
  if (!text && !attachments.length) throw new Error("Write a message or attach at least one file.");
  for (const file of attachments) {
    const problem = validateMessageAttachment(file);
    if (problem) throw new Error(problem);
  }
  const state = getState();
  const { data:message, error } = await supabase.from("messages").insert({
    agency_id:state.agency.id, conversation_id:conversationId, sender_id:state.user.id,
    body:text, client_visible:clientVisible, reply_to_message_id:replyToMessageId
  }).select().single();
  if (error) throw error;
  const uploaded = [];
  try {
    for (const file of attachments) uploaded.push(await uploadAttachment({ file, message, state }));
    return { ...message, attachments:uploaded };
  } catch (uploadError) {
    await cleanupMessageUpload(message.id, uploaded);
    throw uploadError;
  }
}

async function uploadAttachment({ file, message, state }) {
  const id = AppCore.utils.uuid();
  const safeName = AppCore.utils.sanitizeFilename(file.name) || "attachment";
  const storagePath = [state.agency.id, message.conversation_id, message.id, id, safeName].join("/");
  const attachment = {
    id, agency_id:state.agency.id, conversation_id:message.conversation_id, message_id:message.id,
    uploaded_by:state.user.id, storage_path:storagePath, original_name:file.name,
    mime_type:file.type || "application/octet-stream", size_bytes:file.size
  };
  const { error:metadataError } = await supabase.from("message_attachments").insert(attachment);
  if (metadataError) throw metadataError;
  const { error:storageError } = await supabase.storage.from("conversation-attachments").upload(storagePath, file, {
    cacheControl:"3600", upsert:false, contentType:attachment.mime_type
  });
  if (storageError) {
    await supabase.from("message_attachments").delete().eq("id", id);
    throw storageError;
  }
  return attachment;
}

async function cleanupMessageUpload(messageId, attachments) {
  if (attachments.length) {
    await supabase.storage.from("conversation-attachments").remove(attachments.map(attachment => attachment.storage_path));
    await supabase.from("message_attachments").delete().in("id", attachments.map(attachment => attachment.id));
  }
  await supabase.from("messages").delete().eq("id", messageId);
}

export async function openMessageAttachment(attachment) {
  const { data, error } = await supabase.storage.from("conversation-attachments").createSignedUrl(attachment.storage_path, 120);
  if (error) throw error;
  const popup = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  if (!popup) window.location.assign(data.signedUrl);
}

export async function deleteMessage(message) {
  const id = typeof message === "string" ? message : message.id;
  const attachments = typeof message === "string" ? [] : (message.attachments || []);
  if (attachments.length) {
    const { error:storageError } = await supabase.storage.from("conversation-attachments").remove(attachments.map(attachment => attachment.storage_path));
    if (storageError) throw storageError;
  }
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) throw error;
}
