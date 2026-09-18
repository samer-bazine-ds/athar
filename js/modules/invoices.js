import { supabase } from "../supabaseClient.js";
import { AppCore } from "../core/appCore.js";
import { emit, on } from "../core/events.js";
import { payInvoice } from "./payments.js";

const state = {
  container: null,
  context: null,
  invoices: [],
  clients: [],
  offEvents: []
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
  node.rows = 4;
  node.value = value ?? "";
  return node;
}

function selectControl(options, value) {
  const node = el("select", "ap-select");
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    item.selected = String(option.value) === String(value ?? "");
    node.append(item);
  }
  return node;
}

function statusVariant(status) {
  return ({ paid: "success", overdue: "danger", sent: "info", draft: "neutral", void: "warning" })[status] || "neutral";
}

function statusLabel(status) {
  return ({ paid: "Paid", overdue: "Overdue", sent: "Sent", draft: "Draft", void: "Void" })[status] || status;
}

function clientName(clientId) {
  return state.clients.find((client) => client.id === clientId)?.name || "Client";
}

function parseCents(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
}

function parseMilli(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d{0,3})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3))).toString();
}

function centsToInput(cents) {
  const value = BigInt(cents || 0);
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function milliToInput(milli) {
  const value = BigInt(milli || 1000);
  const whole = value / 1000n;
  const fraction = String(value % 1000n).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

async function loadInvoices() {
  if (!state.context.folderId) {
    state.invoices = [];
    state.clients = [];
    return;
  }
  const invoiceQuery = supabase
    .from("invoices")
    .select("*")
    .eq("folder_id", state.context.folderId)
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false });

  const promises = [invoiceQuery];
  if (state.context.isStaff) {
    promises.push(supabase.from("clients").select("id, name").eq("agency_id", state.context.agencyId).is("archived_at", null).order("name", { ascending: true }));
  }
  const results = await Promise.all(promises);
  if (results[0].error) throw results[0].error;
  state.invoices = results[0].data || [];
  if (results[1]) {
    if (results[1].error) throw results[1].error;
    state.clients = results[1].data || [];
  }
}

async function loadAndRender() {
  if (!state.container) return;
  if (!state.context.folderId) {
    AppCore.ui.renderEmpty(state.container, { title: "Choose a folder", message: "Select a folder to view its invoices." });
    return;
  }
  AppCore.ui.renderLoading(state.container, "Loading invoices…");
  try {
    await loadInvoices();
    render();
  } catch (error) {
    AppCore.ui.renderError(state.container, error, loadAndRender);
  }
}

function render() {
  const root = el("section", "ap-invoices");
  root.dataset.module = "invoices";
  const header = el("div", "ap-invoices__header");
  const heading = el("div", "ap-invoices__heading");
  heading.append(el("h2", "ap-invoices__title", "Invoices"), el("p", "ap-invoices__subtitle", state.context.isClient ? "Invoices for your company in this project." : "Create, send, and track invoices for this folder."));
  header.append(heading);
  if (state.context.isStaff) {
    const create = button("New invoice", "primary");
    create.disabled = !state.clients.length;
    create.title = state.clients.length ? "" : "Create a client company first.";
    create.addEventListener("click", () => openInvoiceEditor());
    header.append(create);
  }
  root.append(header);

  if (!state.invoices.length) {
    const empty = el("div", "ap-invoices__empty");
    empty.append(el("h3", "ap-invoices__empty-title", state.context.isClient ? "No invoices here yet" : "No invoices yet"), el("p", "ap-invoices__empty-text", state.context.isClient ? "Invoices sent to your company will appear here." : "Create an invoice when this project is ready to bill."));
    root.append(empty);
    state.container.replaceChildren(root);
    return;
  }

  const tableWrap = el("div", "ap-invoices__table-wrap");
  const table = el("table", "ap-table ap-invoices__table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Invoice", ...(state.context.isStaff ? ["Client"] : []), "Issued", "Due", "Status", "Total", ""].forEach((name) => headRow.append(el("th", "ap-invoices__cell", name)));
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const invoice of state.invoices) tbody.append(renderInvoiceRow(invoice));
  table.append(thead, tbody);
  tableWrap.append(table);
  root.append(tableWrap);
  state.container.replaceChildren(root);
}

function renderInvoiceRow(invoice) {
  const row = document.createElement("tr");
  row.dataset.invoiceId = invoice.id;
  const addCell = (nodeOrText) => {
    const cell = el("td", "ap-invoices__cell");
    if (nodeOrText instanceof Node) cell.append(nodeOrText); else cell.textContent = nodeOrText ?? "—";
    row.append(cell);
  };
  const link = button(invoice.invoice_number, "ghost");
  link.classList.add("ap-invoices__invoice-link");
  link.addEventListener("click", () => openInvoiceDetail(invoice));
  addCell(link);
  if (state.context.isStaff) addCell(clientName(invoice.client_id));
  addCell(AppCore.utils.formatDate(invoice.issue_date, "short"));
  addCell(invoice.due_date ? AppCore.utils.formatDate(invoice.due_date, "short") : "—");
  addCell(el("span", `ap-badge ap-badge--${statusVariant(invoice.status)}`, statusLabel(invoice.status)));
  addCell(AppCore.utils.formatMoney(invoice.total_cents, invoice.currency));
  const actions = el("div", "ap-invoices__actions");
  const view = button("View", "secondary");
  view.classList.add("ap-btn--sm");
  view.addEventListener("click", () => openInvoiceDetail(invoice));
  actions.append(view);
  if (state.context.isClient && ["sent", "overdue"].includes(invoice.status) && Number(invoice.total_cents) > 0) {
    const pay = button("Pay", "primary");
    pay.classList.add("ap-btn--sm");
    pay.addEventListener("click", async () => {
      pay.disabled = true;
      try { await payInvoice(invoice.id); } catch { pay.disabled = false; }
    });
    actions.append(pay);
  }
  addCell(actions);
  return row;
}

async function fetchInvoiceDetail(invoiceId) {
  const [{ data: items, error: itemError }, { data: payments, error: paymentError }] = await Promise.all([
    supabase.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).order("position", { ascending: true }),
    supabase.from("payments").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: false })
  ]);
  if (itemError) throw itemError;
  if (paymentError) throw paymentError;
  return { items: items || [], payments: payments || [] };
}

async function openInvoiceDetail(invoice) {
  let detail;
  try { detail = await fetchInvoiceDetail(invoice.id); }
  catch (error) { return AppCore.ui.toast(AppCore.ui.describeError(error), "error"); }

  const content = el("div", "ap-invoice-detail");
  const summary = el("div", "ap-invoice-detail__summary");
  const addSummary = (label, value) => {
    const block = el("div", "ap-invoice-detail__summary-item");
    block.append(el("span", "ap-invoice-detail__summary-label", label), el("strong", "ap-invoice-detail__summary-value", value));
    summary.append(block);
  };
  if (state.context.isStaff) addSummary("Client", clientName(invoice.client_id));
  addSummary("Status", statusLabel(invoice.status));
  addSummary("Issue date", AppCore.utils.formatDate(invoice.issue_date, "long"));
  addSummary("Due date", invoice.due_date ? AppCore.utils.formatDate(invoice.due_date, "long") : "—");
  content.append(summary);

  const items = el("div", "ap-invoice-detail__items");
  for (const item of detail.items) {
    const line = el("div", "ap-invoice-line");
    const description = el("div", "ap-invoice-line__description", item.description);
    const qty = el("div", "ap-invoice-line__quantity", `× ${milliToInput(item.quantity_milli)}`);
    const amount = el("div", "ap-invoice-line__amount", AppCore.utils.formatMoney(item.amount_cents, invoice.currency));
    line.append(description, qty, amount);
    items.append(line);
  }
  content.append(items);

  const totals = el("dl", "ap-invoice-detail__totals");
  const addTotal = (label, value, strong = false) => {
    totals.append(el("dt", strong ? "ap-invoice-detail__total-label ap-invoice-detail__total-label--strong" : "ap-invoice-detail__total-label", label), el("dd", strong ? "ap-invoice-detail__total-value ap-invoice-detail__total-value--strong" : "ap-invoice-detail__total-value", value));
  };
  addTotal("Subtotal", AppCore.utils.formatMoney(invoice.subtotal_cents, invoice.currency));
  if (Number(invoice.discount_cents)) addTotal("Discount", `−${AppCore.utils.formatMoney(invoice.discount_cents, invoice.currency)}`);
  if (Number(invoice.tax_cents)) addTotal(`Tax (${(Number(invoice.tax_rate_bp) / 100).toFixed(2)}%)`, AppCore.utils.formatMoney(invoice.tax_cents, invoice.currency));
  addTotal("Total", AppCore.utils.formatMoney(invoice.total_cents, invoice.currency), true);
  content.append(totals);
  if (invoice.notes) content.append(el("p", "ap-invoice-detail__notes", invoice.notes));

  if (detail.payments.length) {
    const paymentList = el("div", "ap-invoice-detail__payments");
    paymentList.append(el("h3", "ap-invoice-detail__payments-title", "Payments"));
    for (const payment of detail.payments) {
      const row = el("div", "ap-invoice-payment");
      row.append(el("span", `ap-badge ap-badge--${payment.status === "succeeded" ? "success" : payment.status === "failed" ? "danger" : "neutral"}`, payment.status), el("span", "ap-invoice-payment__amount", AppCore.utils.formatMoney(payment.amount_cents, payment.currency)));
      paymentList.append(row);
    }
    content.append(paymentList);
  }

  const actions = el("div", "ap-module-form__actions");
  if (state.context.isStaff && invoice.status === "draft") {
    const edit = button("Edit draft", "secondary");
    edit.addEventListener("click", () => { AppCore.ui.closeModal(); openInvoiceEditor(invoice, detail.items); });
    const send = button("Send invoice", "primary");
    send.addEventListener("click", () => changeInvoiceStatus(invoice, "sent"));
    actions.append(edit, send);
    if (state.context.isOwner) {
      const remove = button("Delete", "danger");
      remove.addEventListener("click", () => deleteInvoice(invoice));
      actions.append(remove);
    }
  }
  if (state.context.isStaff && invoice.status === "sent") {
    const overdue = button("Mark overdue", "secondary");
    overdue.addEventListener("click", () => changeInvoiceStatus(invoice, "overdue"));
    const voidButton = button("Void invoice", "danger");
    voidButton.addEventListener("click", () => changeInvoiceStatus(invoice, "void"));
    actions.append(overdue, voidButton);
  }
  if (state.context.isStaff && invoice.status === "overdue") {
    const voidButton = button("Void invoice", "danger");
    voidButton.addEventListener("click", () => changeInvoiceStatus(invoice, "void"));
    actions.append(voidButton);
  }
  if (state.context.isClient && ["sent", "overdue"].includes(invoice.status) && Number(invoice.total_cents) > 0) {
    const pay = button("Pay invoice", "primary");
    pay.addEventListener("click", async () => {
      pay.disabled = true;
      try { await payInvoice(invoice.id); } catch { pay.disabled = false; }
    });
    actions.append(pay);
  }
  content.append(actions);
  AppCore.ui.openModal({ title: invoice.invoice_number, content, actions: [] });
}

function createLineItemEditor(item = {}) {
  const row = el("div", "ap-invoice-editor__line");
  const description = input(item.description || "");
  description.placeholder = "Description";
  description.maxLength = 300;
  const quantity = input(milliToInput(item.quantity_milli || 1000), "text");
  quantity.inputMode = "decimal";
  const unitPrice = input(centsToInput(item.unit_price_cents || 0), "text");
  unitPrice.inputMode = "decimal";
  const remove = button("Remove", "ghost");
  remove.classList.add("ap-btn--sm");
  remove.addEventListener("click", () => row.remove());
  row.append(field("Description", description), field("Quantity", quantity), field("Unit price", unitPrice), remove);
  row.__controls = { description, quantity, unitPrice };
  return row;
}

function openInvoiceEditor(invoice = null, existingItems = []) {
  const content = el("div", "ap-invoice-editor");
  const client = selectControl(state.clients.map((item) => ({ value: item.id, label: item.name })), invoice?.client_id || state.clients[0]?.id || "");
  const currency = input(invoice?.currency || "USD");
  currency.maxLength = 3;
  currency.value = currency.value.toUpperCase();
  const issueDate = input(invoice?.issue_date || new Date().toISOString().slice(0, 10), "date");
  const dueDate = input(invoice?.due_date || "", "date");
  const tax = input(((Number(invoice?.tax_rate_bp || 0)) / 100).toFixed(2), "text");
  tax.inputMode = "decimal";
  const discount = input(centsToInput(invoice?.discount_cents || 0), "text");
  discount.inputMode = "decimal";
  const notes = textarea(invoice?.notes || "");
  content.append(field("Client", client), field("Currency", currency, "Three-letter ISO code, for example USD."), field("Issue date", issueDate), field("Due date", dueDate), field("Tax %", tax), field("Discount", discount), field("Notes", notes));

  const lines = el("div", "ap-invoice-editor__lines");
  const lineHeader = el("div", "ap-invoice-editor__lines-header");
  lineHeader.append(el("h3", "ap-invoice-editor__lines-title", "Line items"));
  const addLine = button("Add line", "secondary");
  addLine.classList.add("ap-btn--sm");
  addLine.addEventListener("click", () => lines.append(createLineItemEditor()));
  lineHeader.append(addLine);
  content.append(lineHeader, lines);
  const seedItems = existingItems.length ? existingItems : [{ description: "", quantity_milli: 1000, unit_price_cents: 0 }];
  seedItems.forEach((item) => lines.append(createLineItemEditor(item)));

  const actions = el("div", "ap-module-form__actions");
  const cancel = button("Cancel", "secondary");
  const save = button(invoice ? "Save draft" : "Create invoice", "primary");
  cancel.addEventListener("click", () => AppCore.ui.closeModal());
  save.addEventListener("click", async () => {
    const lineRows = [...lines.querySelectorAll(".ap-invoice-editor__line")];
    const parsed = [];
    for (const line of lineRows) {
      const { description, quantity, unitPrice } = line.__controls;
      const quantityMilli = parseMilli(quantity.value);
      const unitCents = parseCents(unitPrice.value);
      if (!description.value.trim() || quantityMilli === null || unitCents === null) {
        AppCore.ui.toast("Each line needs a description, valid quantity, and valid unit price.", "warning");
        return;
      }
      parsed.push({ description: description.value.trim(), quantity_milli: quantityMilli, unit_price_cents: unitCents });
    }
    if (!parsed.length) return AppCore.ui.toast("Add at least one line item.", "warning");
    const taxRate = Number.parseFloat(tax.value || "0");
    const discountCents = parseCents(discount.value || "0");
    const currencyCode = currency.value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode) || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 || discountCents === null) {
      return AppCore.ui.toast("Check currency, tax, and discount values.", "warning");
    }
    save.disabled = true;
    try {
      await saveInvoiceDraft({ invoice, clientId: client.value, currency: currencyCode, issueDate: issueDate.value, dueDate: dueDate.value, taxRateBp: Math.round(taxRate * 100), discountCents, notes: notes.value, items: parsed });
      AppCore.ui.closeModal();
      AppCore.ui.toast(invoice ? "Draft updated." : "Invoice created.", "success");
      await loadAndRender();
    } catch (error) {
      AppCore.ui.toast(AppCore.ui.describeError(error), "error");
    } finally { save.disabled = false; }
  });
  actions.append(cancel, save);
  content.append(actions);
  AppCore.ui.openModal({ title: invoice ? `Edit ${invoice.invoice_number}` : "New invoice", content, actions: [] });
}

async function saveInvoiceDraft({ invoice, clientId, currency, issueDate, dueDate, taxRateBp, discountCents, notes, items }) {
  let invoiceRow = invoice;
  if (invoice) {
    if (invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");
    const { data, error } = await supabase.from("invoices").update({
      client_id: clientId,
      currency,
      issue_date: issueDate,
      due_date: dueDate || null,
      tax_rate_bp: taxRateBp,
      discount_cents: discountCents,
      notes: notes.trim() || null
    }).eq("id", invoice.id).select().single();
    if (error) throw error;
    invoiceRow = data;
    const { error: deleteError } = await supabase.from("invoice_line_items").delete().eq("invoice_id", invoice.id);
    if (deleteError) throw deleteError;
  } else {
    const { data, error } = await supabase.from("invoices").insert({
      agency_id: state.context.agencyId,
      folder_id: state.context.folderId,
      client_id: clientId,
      status: "draft",
      currency,
      issue_date: issueDate,
      due_date: dueDate || null,
      tax_rate_bp: taxRateBp,
      discount_cents: discountCents,
      notes: notes.trim() || null,
      created_by: state.context.user.id
    }).select().single();
    if (error) throw error;
    invoiceRow = data;
  }

  const lineRows = items.map((item, index) => ({
    agency_id: state.context.agencyId,
    invoice_id: invoiceRow.id,
    description: item.description,
    quantity_milli: item.quantity_milli,
    unit_price_cents: item.unit_price_cents,
    position: (index + 1) * 100
  }));
  const { error: lineError } = await supabase.from("invoice_line_items").insert(lineRows);
  if (lineError) throw lineError;
  emit("data:changed", { entity: "invoice", entityId: invoiceRow.id, folderId: state.context.folderId, action: invoice ? "updated" : "created" });
}

async function changeInvoiceStatus(invoice, status) {
  const patch = { status };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  const label = status === "sent" ? "Send invoice?" : status === "void" ? "Void invoice?" : "Mark invoice overdue?";
  const confirmed = await AppCore.ui.confirm({ title: label, message: `Change ${invoice.invoice_number} to ${statusLabel(status).toLowerCase()}?`, confirmLabel: statusLabel(status), danger: status === "void" });
  if (!confirmed) return;
  try {
    const { error } = await supabase.from("invoices").update(patch).eq("id", invoice.id);
    if (error) throw error;
    if (status === "sent") {
      await supabase.from("activity_logs").insert({
        agency_id: state.context.agencyId,
        actor_id: state.context.user.id,
        action: "invoice.sent",
        entity_type: "invoice",
        entity_id: invoice.id,
        metadata: { invoice_number: invoice.invoice_number }
      });
    }
    emit("data:changed", { entity: "invoice", entityId: invoice.id, folderId: state.context.folderId, action: "updated" });
    AppCore.ui.closeModal();
    await loadAndRender();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

async function deleteInvoice(invoice) {
  const confirmed = await AppCore.ui.confirm({ title: "Delete draft invoice?", message: "This permanently deletes the draft and its line items.", confirmLabel: "Delete", danger: true });
  if (!confirmed) return;
  try {
    const { error } = await supabase.from("invoices").delete().eq("id", invoice.id);
    if (error) throw error;
    emit("data:changed", { entity: "invoice", entityId: invoice.id, folderId: state.context.folderId, action: "deleted" });
    AppCore.ui.closeModal();
    await loadAndRender();
  } catch (error) {
    AppCore.ui.toast(AppCore.ui.describeError(error), "error");
  }
}

const invoicesModule = {
  name: "invoices",
  async mount(container, context) {
    state.container = container;
    state.context = context;
    state.offEvents.push(on("app:teardown", () => { state.invoices = []; }));
    state.offEvents.push(on("invoice:create-requested", () => { if (state.context?.isStaff && state.clients.length) openInvoiceEditor(); }));
    await loadAndRender();
  },
  async unmount() {
    state.offEvents.splice(0).forEach((off) => off?.());
    state.container?.replaceChildren();
    state.container = null;
    state.context = null;
    state.invoices = [];
    state.clients = [];
  },
  async refresh(context) {
    state.context = context;
    await loadAndRender();
  }
};

export default invoicesModule;
