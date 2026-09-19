import { supabase } from "../supabaseClient.js";
import { getState } from "../core/state.js";
import { emit } from "../core/events.js";
import { AppCore } from "../core/appCore.js";

export async function openFolderSharing(folderId) {
  const state = getState();
  if (!state.role || state.role === "client") return;

  const [{ data: clients, error: clientError }, { data: grants, error: grantError }] = await Promise.all([
    supabase.from("clients").select("id,name").eq("agency_id", state.agency.id).is("archived_at", null).order("name"),
    supabase.from("folder_permissions").select("*").eq("folder_id", folderId)
  ]);
  if (clientError) throw clientError;
  if (grantError) throw grantError;

  const grantMap = new Map((grants || []).map((grant) => [grant.client_id, grant]));
  const wrap = document.createElement("div");
  wrap.className = "ap-share-list";

  for (const client of clients || []) {
    const row = document.createElement("div");
    row.className = "ap-share-list__row";
    const label = document.createElement("strong");
    label.textContent = client.name;
    const access = document.createElement("input");
    access.type = "checkbox";
    access.checked = grantMap.has(client.id);
    const upload = document.createElement("input");
    upload.type = "checkbox";
    upload.checked = grantMap.get(client.id)?.can_upload ?? true;
    upload.disabled = !access.checked;

    access.addEventListener("change", async () => {
      access.disabled = true;
      upload.disabled = true;
      try {
        if (access.checked) {
          const { data, error } = await supabase.from("folder_permissions").insert({
            agency_id: state.agency.id,
            folder_id: folderId,
            client_id: client.id,
            can_upload: upload.checked,
            created_by: state.user.id
          }).select().single();
          if (error) throw error;
          grantMap.set(client.id, data);
        } else {
          const { error } = await supabase.from("folder_permissions").delete().eq("folder_id", folderId).eq("client_id", client.id);
          if (error) throw error;
          grantMap.delete(client.id);
        }
        emit("data:changed", { entity: "folder", entityId: folderId, folderId, action: "updated" });
      } catch (error) {
        access.checked = !access.checked;
        AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      } finally {
        access.disabled = false;
        upload.disabled = !access.checked;
      }
    });

    upload.addEventListener("change", async () => {
      if (!access.checked) return;
      const previous = !upload.checked;
      upload.disabled = true;
      const { data, error } = await supabase.from("folder_permissions")
        .update({ can_upload: upload.checked })
        .eq("folder_id", folderId)
        .eq("client_id", client.id)
        .select()
        .single();
      if (error) {
        upload.checked = previous;
        AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      } else {
        grantMap.set(client.id, data);
        emit("data:changed", { entity: "folder", entityId: folderId, folderId, action: "updated" });
      }
      upload.disabled = false;
    });

    const accessLabel = document.createElement("label");
    accessLabel.className = "ap-checkbox-label";
    accessLabel.append(access, document.createTextNode(" Access"));
    const uploadLabel = document.createElement("label");
    uploadLabel.className = "ap-checkbox-label";
    uploadLabel.append(upload, document.createTextNode(" Upload"));
    row.append(label, accessLabel, uploadLabel);
    wrap.append(row);
  }

  if (!(clients || []).length) {
    const empty = document.createElement("p");
    empty.textContent = "Create a client company first.";
    wrap.append(empty);
  }
  AppCore.ui.openModal({ title: "Share folder", content: wrap, actions: [] });
}
