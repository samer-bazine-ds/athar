export const EVENTS = Object.freeze({
  APP_READY: "app:ready",
  AUTH_CHANGED: "auth:changed",
  AGENCY_SELECTED: "agency:selected",
  FOLDER_SELECTED: "folder:selected",
  FOLDER_CREATED: "folder:created",
  FOLDER_UPDATED: "folder:updated",
  FOLDER_DELETED: "folder:deleted",
  MODULE_SELECTED: "module:selected",
  MODULE_MOUNTED: "module:mounted",
  MODULE_UNMOUNTED: "module:unmounted",
  BRANDING_CHANGED: "branding:changed",
  APP_TEARDOWN: "app:teardown",
  DATA_CHANGED: "data:changed"
});
export function emit(name, detail = {}) { document.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, handler) { document.addEventListener(name, handler); return () => off(name, handler); }
export function off(name, handler) { document.removeEventListener(name, handler); }
