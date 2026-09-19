import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { on } from "../core/events.js";

const MODULE_BY_ENTITY = Object.freeze({
  folder: "conversation",
  task: "boards",
  doc: "docs",
  conversation: "conversation",
  file: "files",
  embed: null
});

const state = {
  container: null,
  context: null,
  input: null,
  inputHandler: null,
  offEvents: [],
  requestId: 0
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clear() {
  state.container?.replaceChildren();
}

async function runSearch(query) {
  const value = query.trim();
  if (value.length < 2 || !state.context?.agencyId) {
    clear();
    return;
  }
  const currentRequest = ++state.requestId;
  const loading = el("div", "ap-search-results ap-search-results--loading");
  loading.dataset.module = "search";
  loading.append(el("p", "ap-search-results__message", "Searching…"));
  state.container.replaceChildren(loading);

  const { data, error } = await supabase.rpc("search_workspace", {
    p_agency: state.context.agencyId,
    p_query: value
  });
  if (currentRequest !== state.requestId) return;
  if (error) {
    AppCore.ui.renderError(state.container, error, () => runSearch(value));
    return;
  }
  renderResults(data || []);
}

function renderResults(results) {
  const root = el("div", "ap-search-results");
  root.dataset.module = "search";
  if (!results.length) {
    root.append(el("p", "ap-search-results__message", "No matching results."));
    state.container.replaceChildren(root);
    return;
  }

  const list = el("div", "ap-search-results__list");
  for (const result of results) {
    const item = el("button", "ap-search-result");
    item.type = "button";
    item.dataset.entityType = result.entity_type;
    item.dataset.entityId = result.entity_id;
    const type = el("span", "ap-search-result__type", result.entity_type);
    const title = el("strong", "ap-search-result__title", result.title || "Untitled");
    item.append(type, title);
    if (result.snippet) item.append(el("span", "ap-search-result__snippet", result.snippet));
    item.addEventListener("click", async () => {
      try {
        if (result.entity_type === "embed") {
          const { data, error } = await supabase.from("embeds").select("url").eq("id", result.entity_id).single();
          if (error) throw error;
          if (!/^https?:\/\//i.test(data.url)) throw new Error("This embed link is invalid.");
          window.open(data.url, "_blank", "noopener,noreferrer");
          clear();
          if (state.input) state.input.value = "";
          return;
        }
        const moduleName = MODULE_BY_ENTITY[result.entity_type] || "conversation";
        await AppCore.selectFolder(result.folder_id, { skipOverview: true });
        await AppCore.selectModule(moduleName);
        clear();
        if (state.input) state.input.value = "";
      } catch (error) {
        AppCore.ui.toast(AppCore.ui.describeError(error), "error");
      }
    });
    list.append(item);
  }
  root.append(list);
  state.container.replaceChildren(root);
}

function findSearchInput() {
  const host = document.getElementById("global-search");
  if (!host) return null;
  return host.querySelector("input[type='search'], input");
}

async function mount(container, context) {
  state.container = container;
  state.context = context;
  state.input = findSearchInput();
  if (!state.input) {
    clear();
    console.warn("Agency Portal search: #global-search contains no input element.");
    return;
  }
  state.input.setAttribute("autocomplete", "off");
  state.input.setAttribute("aria-controls", "global-search-results");
  state.inputHandler = AppCore.utils.debounce((event) => runSearch(event.target.value), 250);
  state.input.addEventListener("input", state.inputHandler);
  state.offEvents.push(on("agency:selected", ({ detail }) => {
    if (state.context) state.context = { ...state.context, agencyId: detail.agencyId, role: detail.role };
    clear();
    if (state.input) state.input.value = "";
  }));
  state.offEvents.push(on("app:teardown", clear));
}

async function unmount() {
  if (state.input && state.inputHandler) state.input.removeEventListener("input", state.inputHandler);
  state.offEvents.splice(0).forEach((off) => off?.());
  clear();
  state.container = null;
  state.context = null;
  state.input = null;
  state.inputHandler = null;
  state.requestId += 1;
}

async function refresh(context) {
  state.context = context;
  clear();
}

export async function mountGlobalSearch(context = AppCore.getModuleContext()) {
  const container = document.getElementById("global-search-results");
  if (!container || !context) return false;
  await searchModule.unmount();
  await searchModule.mount(container, context);
  return true;
}

const searchModule = { name: "search", mount, unmount, refresh };
export default searchModule;
