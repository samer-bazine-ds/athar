export function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

const ALLOWED_TAGS = new Set(["P","BR","STRONG","EM","U","S","H1","H2","H3","UL","OL","LI","BLOCKQUOTE","CODE","PRE","A","HR"]);
export function sanitizeHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${String(html ?? "")}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  function clean(parent) {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node;
      if (el.tagName === "TEMPLATE") { el.remove(); continue; }
      clean(el);
      if (!ALLOWED_TAGS.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const rawHref = el.tagName === "A" ? (el.getAttribute("href") || "") : "";
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      if (el.tagName === "A") {
        if (/^(https?:|mailto:)/i.test(rawHref)) el.setAttribute("href", rawHref);
        el.setAttribute("rel", "noopener noreferrer nofollow");
        el.setAttribute("target", "_blank");
      }
    }
  }
  clean(root);
  return root.innerHTML;
}

export function sanitizeFilename(name) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD").replace(/[^\w\-. ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "file";
  const ext = (dot > 0 ? name.slice(dot + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return ext ? `${base}.${ext}` : base;
}

export function formatDate(value, style = "short") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  if (style === "relative") {
    const delta = date.getTime() - Date.now();
    const abs = Math.abs(delta);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (abs < 60_000) return rtf.format(Math.round(delta / 1000), "second");
    if (abs < 3_600_000) return rtf.format(Math.round(delta / 60_000), "minute");
    if (abs < 86_400_000) return rtf.format(Math.round(delta / 3_600_000), "hour");
    return rtf.format(Math.round(delta / 86_400_000), "day");
  }
  const opts = style === "datetime" ? { dateStyle: "medium", timeStyle: "short" } : style === "long" ? { dateStyle: "long" } : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(undefined, opts).format(date);
}
export function formatBytes(bytes) {
  const value = Number(bytes || 0); if (!value) return "0 B";
  const units = ["B","KB","MB","GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
export function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents || 0) / 100);
}
export function initials(nameOrEmail) {
  return String(nameOrEmail || "?").split(/\s+|@/).filter(Boolean).slice(0,2).map(x => x[0]?.toUpperCase()).join("") || "?";
}
export function debounce(fn, ms) {
  let timer = null; let lastArgs = null;
  const wrapped = (...args) => { lastArgs = args; clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(...lastArgs); }, ms); };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); timer = null; fn(...(lastArgs || [])); } };
  return wrapped;
}
export function uuid() { return crypto.randomUUID(); }
