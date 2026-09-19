function root(id) { return document.getElementById(id); }
function button(label, variant = "secondary") { const b=document.createElement("button"); b.type="button"; b.className=`ap-btn ap-btn--${variant}`; b.textContent=label; return b; }
export function describeError(error) {
  const code = error?.code || error?.details || ""; const message = String(error?.message || error || "");
  if (error?.userMessage && message) return message;
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "You don't have permission to do that.";
  if (code === "PGRST116") return "That item no longer exists.";
  if (code === "23505") return "That already exists.";
  if (code === "23514") return "Some of those values aren't valid.";
  if (error instanceof TypeError && /fetch/i.test(message)) return "Can't reach the server. Check your connection and try again.";
  console.error(error); return "Something went wrong. Please try again.";
}
export function toast(message, variant = "info") {
  const host = root("toast-container"); if (!host) return;
  const item=document.createElement("div"); item.className=`ap-toast ap-toast--${variant}`; item.setAttribute("role","status"); item.textContent=message;
  host.append(item); setTimeout(()=>item.remove(),4500);
}
let currentModal = null;
export function closeModal() { currentModal?.close?.(); currentModal=null; }
export function openModal({ title, content, actions = [], onClose }) {
  closeModal(); const host=root("modal-root"); if (!host) return { close(){} };
  const previous=document.activeElement; const backdrop=document.createElement("div"); backdrop.className="ap-modal-backdrop";
  const dialog=document.createElement("section"); dialog.className="ap-modal"; dialog.setAttribute("role","dialog"); dialog.setAttribute("aria-modal","true");
  const header=document.createElement("header"); header.className="ap-modal__header"; const h=document.createElement("h2"); h.textContent=title||""; const x=button("Close","ghost"); x.classList.add("ap-btn--icon"); header.append(h,x);
  const body=document.createElement("div"); body.className="ap-modal__body"; if (content instanceof Node) body.append(content); else body.textContent=String(content||"");
  const footer=document.createElement("footer"); footer.className="ap-modal__footer";
  for (const action of actions) { if (action instanceof Node) footer.append(action); else { const b=button(action.label,action.variant||"secondary"); b.addEventListener("click",()=>action.onClick?.()); footer.append(b); } }
  dialog.append(header,body); if (actions.length) dialog.append(footer); backdrop.append(dialog); host.replaceChildren(backdrop);
  const api={ close(){ if(!backdrop.isConnected) return; backdrop.remove(); document.removeEventListener("keydown",key); onClose?.(); previous?.focus?.(); if(currentModal===api) currentModal=null; } };
  const key=(e)=>{ if(e.key==="Escape") api.close(); if(e.key==="Tab"){ const focus=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled); if(!focus.length)return; const first=focus[0],last=focus.at(-1); if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();} else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} } };
  x.addEventListener("click",api.close); backdrop.addEventListener("mousedown",e=>{ if(e.target===backdrop)api.close(); }); document.addEventListener("keydown",key); currentModal=api; queueMicrotask(()=>dialog.querySelector("input,button,select,textarea")?.focus()); return api;
}
export async function confirm({ title="Confirm", message="Are you sure?", confirmLabel="Confirm", danger=false }) {
  return new Promise((resolve)=>{ const wrap=document.createElement("div"); const p=document.createElement("p"); p.textContent=message; wrap.append(p); let settled=false; const finish=v=>{ if(settled)return; settled=true; closeModal(); resolve(v);};
    const cancel=button("Cancel","secondary"); cancel.addEventListener("click",()=>finish(false)); const ok=button(confirmLabel,danger?"danger":"primary"); ok.addEventListener("click",()=>finish(true)); openModal({title,content:wrap,actions:[cancel,ok],onClose:()=>finish(false)}); });
}
export function renderLoading(container,label="Loading…") { container.replaceChildren(); const d=document.createElement("div"); d.className="ap-loading"; d.innerHTML='<span class="ap-spinner" aria-hidden="true"></span>'; const t=document.createElement("span"); t.textContent=label; d.append(t); container.append(d); }
export function renderEmpty(container,{icon,title,message,actionLabel,onAction}={}) { container.replaceChildren(); const d=document.createElement("div"); d.className="ap-empty"; if(icon){const i=document.createElement("div");i.className="ap-empty__icon";i.textContent=icon;d.append(i);} const h=document.createElement("h3");h.textContent=title||"Nothing here yet";const p=document.createElement("p");p.textContent=message||"";d.append(h,p);if(actionLabel&&onAction){const b=button(actionLabel,"primary");b.addEventListener("click",onAction);d.append(b);}container.append(d);return d; }
export function renderError(container,error,onRetry) { container.replaceChildren(); const d=document.createElement("div");d.className="ap-empty ap-empty--error";const h=document.createElement("h3");h.textContent="Couldn't load this";const p=document.createElement("p");p.textContent=describeError(error);d.append(h,p);if(onRetry){const b=button("Try again","secondary");b.addEventListener("click",onRetry);d.append(b);}container.append(d); }
