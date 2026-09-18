const INITIAL = Object.freeze({
  session: null,
  user: null,
  profile: null,
  memberships: [],
  agency: null,
  membership: null,
  role: null,
  clientId: null,
  folders: [],
  selectedFolderId: null,
  selectedModule: null,
  surface: null,
  ready: false
});

let state = { ...INITIAL };
const listeners = new Set();

export function getState() { return Object.freeze({ ...state }); }
export function setState(patch) {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) {
    try { listener(getState()); } catch (error) { console.error(error); }
  }
  return getState();
}
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function resetState() {
  state = { ...INITIAL };
  for (const listener of [...listeners]) listener(getState());
  return getState();
}
