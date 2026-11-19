import { supabase } from "../api/supabaseClient"

/**
 * MARINE INVOICING -- Swahili Marine & Diving (Marine Services Division of
 * GEC Limited).
 *
 * Pure helpers (money maths, payload building, validation) plus the Supabase
 * data-access layer. The database (migration
 * 20261119090000_smd_marine_invoicing.sql) is the authority for numbering,
 * status changes, immutability and the final totals; computeMarineTotals()
 * below mirrors marine_recalculate() exactly so the editor shows the same
 * figures the server will store.
 */

// ── Permanent identity (never editable, never read from settings) ─────
export const MARINE_BRAND = Object.freeze({
  division: "SWAHILI MARINE & DIVING",
  divisionLine: "MARINE SERVICES DIVISION",
  parentLine: "A division of GEC LIMITED",
  parent: "GEC LIMITED",
  // Official GEC Limited logo (JPEG, white background) -- public/brand/gec-logo.jpg.
  logoUrl: "/brand/gec-logo.jpg",
})

/**
 * Marine Invoicing is STRICTLY Owner-only (migration
 * 20261119120000_smd_marine_invoicing_owner_only.sql). Used by the sidebar,
 * App()'s route gate and the page itself. Deliberately an exact match on the
 * real stv-pos role slug -- NOT isOwner, which is true for Admin and every
 * other role at or above admin level. RLS + the RPC role checks remain the
 * actual security boundary; this only decides what the UI shows.
 */
export function canAccessMarine(role) {
  return role === "owner"
}

export const DOC_TYPES = Object.freeze({
  QUOTATION: { id: "QUOTATION", label: "Quotation", title: "QUOTATION", prefix: "SMD-QTN", short: "QTN" },
  PROFORMA:  { id: "PROFORMA",  label: "Proforma Invoice", title: "PROFORMA INVOICE", prefix: "SMD-PI", short: "PI" },
  INVOICE:   { id: "INVOICE",   label: "Final Invoice", title: "INVOICE", prefix: "SMD-INV", short: "INV" },
})
export const DOC_TYPE_ORDER = ["QUOTATION", "PROFORMA", "INVOICE"]

export const STATUSES = Object.freeze({
  DRAFT:     { label: "Draft",     color: "#7A5A12", bg: "#FBF0D9" },
  ISSUED:    { label: "Issued",    color: "#13315C", bg: "#E4ECF7" },
  CONVERTED: { label: "Converted", color: "#2F6B4F", bg: "#E6F2EC" },
  CANCELLED: { label: "Cancelled", color: "#A34E33", bg: "#F7E9E4" },
})

/** Forward-only conversion paths (also enforced by convert_marine_document). */
export const CONVERSION_TARGETS = Object.freeze({
  QUOTATION: ["PROFORMA", "INVOICE"],
  PROFORMA: ["INVOICE"],
  INVOICE: [],
})

export const UNITS = ["service", "pieces", "metres", "hours", "days", "trips", "sets", "lots", "kg", "litres", "dives"]
export const CATALOG_CATEGORIES = ["Service", "Material", "Equipment", "Labour", "Transport", "Other"]

export const CUSTOMER_FIELDS = Object.freeze([
  { key: "customer_name",  label: "Customer / Company Name" },
  { key: "taxpayer_name",  label: "Taxpayer Name" },
  { key: "z_number",       label: "Z Number" },
  { key: "ztn_number",     label: "ZTN Number" },
  { key: "ztn_location",   label: "ZTN Location" },
  { key: "tin_number",     label: "TIN Number" },
  { key: "vrn_number",     label: "VRN Number" },
  { key: "street_address", label: "Street Address" },
  { key: "tax_office",     label: "Tax Office" },
  { key: "customer_phone", label: "Phone Number" },
  { key: "customer_email", label: "Email Address" },
])

export const CONTACT_TYPES = ["email", "phone", "whatsapp", "website", "other"]

/** Used only if the settings row can't be read; mirrors the migration seed. */
export const DEFAULT_SETTINGS = Object.freeze({
  bank_name: "NMB",
  bank_account_name: "GOLDEN EMPIRE COMPANY LIMITED",
  bank_account_number: "22910118721",
  bank_branch: "Zanzibar (229)",
  currency: "TZS",
  default_vat_percent: 15,
  contacts: [
    { type: "email", label: "Email", value: "contact@mygoldenempire.com" },
    { type: "phone", label: "Additional contact", value: "+86 156 91833253" },
  ],
  footer_line: "SWAHILI MARINE & DIVING | GEC LIMITED",
  default_notes: "",
})

// ── Exact decimal maths (integer cents / thousandths via BigInt) ──────
const DEC_RE = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/

/** Parses a decimal string/number into a BigInt scaled by 10^places, rounding half up. Returns null when not a number. */
export function toScaled(value, places) {
  if (value === null || value === undefined) return null
  let s = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(Math.min(places + 3, 20)) : "") : String(value).replace(/,/g, "")
  const m = DEC_RE.exec(s)
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) return null
  const neg = !!m[1]
  const intPart = m[2] || "0"
  const frac = (m[3] || "")
  const kept = (frac + "0".repeat(places)).slice(0, places)
  let n = BigInt(intPart + kept)
  const next = frac.charCodeAt(places) - 48
  if (next >= 5 && next <= 9) n += 1n
  return neg ? -n : n
}
export const toCents = (v) => toScaled(v, 2)

/** a / b rounded half away from zero (b > 0). */
function divRound(a, b) {
  const neg = a < 0n
  const abs = neg ? -a : a
  const q = (abs * 2n + b) / (2n * b)
  return neg ? -q : q
}

const centsToNumber = (c) => Number(c) / 100

/** round(quantity * unit_price, 2) -- identical to the generated column. */
export function lineAmountCents(quantity, unitPrice) {
  const q = toScaled(quantity, 3)
  const p = toCents(unitPrice)
  if (q === null || p === null) return 0n
  return divRound(q * p, 1000n)
}
export const lineAmount = (quantity, unitPrice) => centsToNumber(lineAmountCents(quantity, unitPrice))

const blank = (v) => v === null || v === undefined || String(v).trim() === ""

/**
 * Mirrors marine_recalculate():
 *   subtotal       = Σ round(qty × price, 2)
 *   taxable        = subtotal − discount + additional charges
 *   vat_calculated = round(taxable × vat% / 100, 2)            (0 when VAT off)
 *   vat            = manual VAT if given, else vat_calculated    (0 when VAT off)
 *   calculated     = taxable + vat
 *   total_due      = manual total if given, else calculated
 */
export function computeMarineTotals({ items = [], vat_enabled = true, vat_percent = 15, vat_amount_override = null,
  discount_amount = 0, extra_charge_amount = 0, total_override = null } = {}) {
  const subtotalC = items.reduce((acc, it) => acc + lineAmountCents(it.quantity, it.unit_price), 0n)
  const discountC = toCents(blank(discount_amount) ? 0 : discount_amount) ?? 0n
  const extraC = toCents(blank(extra_charge_amount) ? 0 : extra_charge_amount) ?? 0n
  const taxableC = subtotalC - discountC + extraC
  const pctH = toScaled(blank(vat_percent) ? 0 : vat_percent, 2) ?? 0n
  const vatCalcC = vat_enabled ? divRound(taxableC * pctH, 10000n) : 0n
  const vatOverridden = !!vat_enabled && !blank(vat_amount_override)
  const vatC = vat_enabled ? (vatOverridden ? toCents(vat_amount_override) ?? 0n : vatCalcC) : 0n
  const calculatedC = taxableC + vatC
  const totalOverridden = !blank(total_override)
  const dueC = totalOverridden ? toCents(total_override) ?? 0n : calculatedC
  return {
    subtotal: centsToNumber(subtotalC),
    discount: centsToNumber(discountC),
    extraCharges: centsToNumber(extraC),
    taxable: centsToNumber(taxableC),
    vatCalculated: centsToNumber(vatCalcC),
    vat: centsToNumber(vatC),
    calculatedTotal: centsToNumber(calculatedC),
    totalDue: centsToNumber(dueC),
    adjustment: centsToNumber(dueC - calculatedC),
    vatOverridden,
    totalOverridden,
    discountTooLarge: taxableC < 0n,
  }
}

/** "1,234,567" or "1,234,567.50" -- decimals shown only when present. */
export function formatAmount(n) {
  const v = Number(n || 0)
  const hasCents = Math.round(Math.abs(v) * 100) % 100 !== 0
  return v.toLocaleString("en-US", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })
}
export const formatTZS = (n, currency = "TZS") => `${currency} ${formatAmount(n)}`

export function formatQty(q) {
  const v = Number(q || 0)
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 })
}

export function documentNumberPattern(docType, year, seq) {
  const t = DOC_TYPES[docType]
  return t ? `${t.prefix}-${year}-${String(seq).padStart(3, "0")}` : null
}

// ── Editor state ──────────────────────────────────────────────────────
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function emptyItem(seed = {}) {
  return { key: newKey(), description: "", unit: "service", quantity: "1", unit_price: "", catalog_item_id: null, ...seed }
}
export function emptyScope(seed = {}) {
  return { key: newKey(), title: "", description: "", template_id: null, ...seed }
}

export function bankFromSettings(s = DEFAULT_SETTINGS) {
  return {
    bank_name: s.bank_name || "",
    account_name: s.bank_account_name || "",
    account_number: s.bank_account_number || "",
    branch: s.bank_branch || "",
    currency: s.currency || "TZS",
  }
}

export function emptyDocumentForm(settings = DEFAULT_SETTINGS, docType = "QUOTATION", today = new Date()) {
  const pad = (n) => String(n).padStart(2, "0")
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const form = {
    doc_type: docType,
    document_date: iso,
    valid_until: "",
    due_date: "",
    subject: "",
    customer_reference: "",
    vat_enabled: true,
    vat_percent: String(settings.default_vat_percent ?? 15),
    vat_amount_override: "",
    discount_label: "",
    discount_amount: "",
    extra_charge_label: "",
    extra_charge_amount: "",
    total_override: "",
    total_override_reason: "",
    currency: settings.currency || "TZS",
    bank_details: bankFromSettings(settings),
    notes: settings.default_notes || "",
  }
  for (const f of CUSTOMER_FIELDS) form[f.key] = ""
  return form
}

/** DB row (+ items/scope) -> editor state. */
export function formFromDocument(doc, items = [], scope = []) {
  const str = (v) => (v === null || v === undefined ? "" : String(v))
  const form = {
    doc_type: doc.doc_type,
    document_date: str(doc.document_date),
    valid_until: str(doc.valid_until),
    due_date: str(doc.due_date),
    subject: str(doc.subject),
    customer_reference: str(doc.customer_reference),
    vat_enabled: doc.vat_enabled !== false,
    vat_percent: str(doc.vat_percent ?? 15),
    vat_amount_override: str(doc.vat_amount_override),
    discount_label: str(doc.discount_label),
    discount_amount: Number(doc.discount_amount) ? str(doc.discount_amount) : "",
    extra_charge_label: str(doc.extra_charge_label),
    extra_charge_amount: Number(doc.extra_charge_amount) ? str(doc.extra_charge_amount) : "",
    total_override: str(doc.total_override),
    total_override_reason: str(doc.total_override_reason),
    currency: doc.currency || "TZS",
    bank_details: { ...bankFromSettings(DEFAULT_SETTINGS), ...(doc.bank_details || {}) },
    notes: str(doc.notes),
  }
  for (const f of CUSTOMER_FIELDS) form[f.key] = str(doc[f.key])
  return {
    form,
    items: items.map(i => emptyItem({ description: i.description, unit: i.unit, quantity: str(i.quantity), unit_price: str(i.unit_price), catalog_item_id: i.catalog_item_id })),
    scope: scope.map(s => emptyScope({ title: str(s.title), description: str(s.description), template_id: s.template_id })),
  }
}

const nz = (v) => (blank(v) ? null : String(v).trim())
const numOrNull = (v) => (blank(v) ? null : String(v).replace(/,/g, "").trim())

/** Editor state -> save_marine_draft() arguments. Blank rows are dropped. */
export function buildDraftPayload(form, items, scope) {
  const doc = {
    doc_type: form.doc_type,
    document_date: nz(form.document_date),
    valid_until: form.doc_type === "QUOTATION" ? nz(form.valid_until) : null,
    due_date: form.doc_type === "QUOTATION" ? null : nz(form.due_date),
    subject: nz(form.subject),
    customer_reference: nz(form.customer_reference),
    vat_enabled: !!form.vat_enabled,
    vat_percent: numOrNull(form.vat_percent) ?? "0",
    vat_amount_override: form.vat_enabled ? numOrNull(form.vat_amount_override) : null,
    discount_label: nz(form.discount_label),
    discount_amount: numOrNull(form.discount_amount) ?? "0",
    extra_charge_label: nz(form.extra_charge_label),
    extra_charge_amount: numOrNull(form.extra_charge_amount) ?? "0",
    total_override: numOrNull(form.total_override),
    total_override_reason: blank(form.total_override) ? null : nz(form.total_override_reason),
    currency: form.currency || "TZS",
    bank_details: Object.fromEntries(Object.entries(form.bank_details || {}).map(([k, v]) => [k, String(v ?? "").trim()])),
    notes: nz(form.notes),
  }
  for (const f of CUSTOMER_FIELDS) doc[f.key] = nz(form[f.key])
  const outItems = items
    .filter(i => !blank(i.description) || !blank(i.unit_price))
    .map(i => ({
      description: String(i.description || "").trim(),
      unit: nz(i.unit) || "service",
      quantity: numOrNull(i.quantity) ?? "0",
      unit_price: numOrNull(i.unit_price) ?? "0",
      catalog_item_id: i.catalog_item_id || null,
    }))
  const outScope = scope
    .filter(s => !blank(s.title) || !blank(s.description))
    .map(s => ({ title: nz(s.title), description: String(s.description || "").trim(), template_id: s.template_id || null }))
  return { doc, items: outItems, scope: outScope }
}

const isNum = (v, { allowZero = true } = {}) => {
  const c = toScaled(v, 3)
  return c !== null && (allowZero ? c >= 0n : c > 0n)
}

/** Problems that would make save fail. Returns a list of messages. */
export function validateDraft(form, items) {
  const errs = []
  if (!DOC_TYPES[form.doc_type]) errs.push("Choose a document type.")
  if (!form.document_date) errs.push("Document date is required.")
  items.forEach((it, i) => {
    if (blank(it.description) && blank(it.unit_price)) return
    if (blank(it.description)) errs.push(`Line ${i + 1}: description is required.`)
    if (!isNum(it.quantity, { allowZero: false })) errs.push(`Line ${i + 1}: quantity must be greater than 0.`)
    if (!isNum(it.unit_price)) errs.push(`Line ${i + 1}: unit price must be 0 or more.`)
  })
  if (!isNum(form.vat_percent || 0) || Number(form.vat_percent) > 100) errs.push("VAT % must be between 0 and 100.")
  for (const [k, label] of [["discount_amount", "Discount"], ["extra_charge_amount", "Additional charges"], ["vat_amount_override", "Manual VAT"], ["total_override", "Manual total"]]) {
    if (!blank(form[k]) && !isNum(form[k])) errs.push(`${label} must be a number of 0 or more.`)
  }
  const t = computeMarineTotals({ ...form, items: items.filter(i => !blank(i.description)) })
  if (t.discountTooLarge) errs.push("The discount cannot be larger than the subtotal plus additional charges.")
  if (!blank(form.customer_email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customer_email.trim())) errs.push("Customer email address looks invalid.")
  return errs
}

/** Extra checks before issuing (the server repeats them). */
export function validateForIssue(form, items) {
  const errs = validateDraft(form, items)
  const real = items.filter(i => !blank(i.description))
  if (real.length === 0) errs.push("Add at least one service or material line.")
  const t = computeMarineTotals({ ...form, items: real })
  if (t.totalDue <= 0) errs.push("The total due must be greater than zero.")
  if (t.totalOverridden && blank(form.total_override_reason)) errs.push("Give a short reason for the manual total adjustment.")
  return errs
}

/** Customer rows for the PDF / viewer -- only fields that have a value. */
export function customerRows(doc) {
  return CUSTOMER_FIELDS.filter(f => !blank(doc[f.key])).map(f => [f.label, String(doc[f.key]).trim()])
}

export function moveInList(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list
  const next = list.slice()
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export function pdfFilename(doc) {
  const num = doc.document_number || `DRAFT-${DOC_TYPES[doc.doc_type]?.short || "DOC"}`
  const cust = String(doc.customer_name || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)
  return `${num}${cust ? "_" + cust : ""}.pdf`
}

/** Strips characters that would break a PostgREST or() filter. */
export function sanitizeSearch(s) {
  return String(s || "").replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80)
}

function friendly(error) {
  const msg = error?.message || String(error || "Request failed")
  if (/permission denied|row-level security|not authorized|Only an Owner/i.test(msg)) {
    return new Error(msg.includes("Only an") ? msg : "You don't have permission to do this. Marine Invoicing is limited to Owner/Admin accounts.")
  }
  if (/relation .*marine_.* does not exist|Could not find the function|schema cache/i.test(msg)) {
    return new Error("Marine Invoicing database tables are not installed yet (migration 20261119090000_smd_marine_invoicing.sql).")
  }
  return new Error(msg)
}
async function run(promise) {
  const { data, error } = await promise
  if (error) throw friendly(error)
  return data
}

// ── Settings ──────────────────────────────────────────────────────────
export async function fetchSettings() {
  const data = await run(supabase.from("marine_invoice_settings").select("*").eq("id", 1).maybeSingle())
  return data ? { ...DEFAULT_SETTINGS, ...data } : { ...DEFAULT_SETTINGS }
}
export async function updateSettings(patch) {
  const allowed = ["bank_name", "bank_account_name", "bank_account_number", "bank_branch", "currency", "default_vat_percent", "contacts", "footer_line", "default_notes"]
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
  const rows = await run(supabase.from("marine_invoice_settings").update(clean).eq("id", 1).select())
  if (!rows || rows.length === 0) throw new Error("Only the Owner can change the global invoice settings.")
  return rows[0]
}

// ── Documents ─────────────────────────────────────────────────────────
const LIST_COLUMNS = "id, doc_type, status, document_number, document_date, valid_until, due_date, subject, customer_name, total_due, currency, source_document_id, revision_of_id, superseded_by_id, created_at, issued_at, created_by_name, issued_by_name"

export async function listDocuments({ docType, status, from, to, search, limit = 200 } = {}) {
  let q = supabase.from("marine_documents").select(LIST_COLUMNS)
    .order("document_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
  if (docType) q = q.eq("doc_type", docType)
  if (status) q = q.eq("status", status)
  if (from) q = q.gte("document_date", from)
  if (to) q = q.lte("document_date", to)
  const term = sanitizeSearch(search)
  if (term) q = q.or(`document_number.ilike.*${term}*,customer_name.ilike.*${term}*,taxpayer_name.ilike.*${term}*,subject.ilike.*${term}*`)
  return (await run(q)) || []
}

export async function getDocumentBundle(id) {
  const [doc, items, scope, events] = await Promise.all([
    run(supabase.from("marine_documents").select("*").eq("id", id).single()),
    run(supabase.from("marine_document_items").select("*").eq("document_id", id).order("position")),
    run(supabase.from("marine_document_scope").select("*").eq("document_id", id).order("position")),
    run(supabase.from("marine_document_events").select("*").eq("document_id", id).order("created_at")),
  ])
  // Relationship graph: anything this document came from or led to.
  const relatedIds = [doc.source_document_id, doc.revision_of_id, doc.superseded_by_id].filter(Boolean)
  const [parents, children] = await Promise.all([
    relatedIds.length ? run(supabase.from("marine_documents").select(LIST_COLUMNS).in("id", relatedIds)) : [],
    run(supabase.from("marine_documents").select(LIST_COLUMNS).or(`source_document_id.eq.${id},revision_of_id.eq.${id}`).order("created_at")),
  ])
  return { doc, items: items || [], scope: scope || [], events: events || [], related: [...(parents || []), ...(children || [])] }
}

export async function saveDraft({ id, clientRequestId, form, items, scope }) {
  const p = buildDraftPayload(form, items, scope)
  return run(supabase.rpc("save_marine_draft", {
    p_document_id: id || null, p_client_request_id: id ? null : clientRequestId, p_doc: p.doc, p_items: p.items, p_scope: p.scope,
  }))
}
export const issueDocument = (id) => run(supabase.rpc("issue_marine_document", { p_document_id: id }))
export const convertDocument = (id, target) => run(supabase.rpc("convert_marine_document", { p_document_id: id, p_target_type: target }))
export const reviseDocument = (id) => run(supabase.rpc("revise_marine_document", { p_document_id: id }))
export const cancelDocument = (id, reason) => run(supabase.rpc("cancel_marine_document", { p_document_id: id, p_reason: reason }))

export async function deleteDraft(id) {
  const rows = await run(supabase.from("marine_documents").delete().eq("id", id).eq("status", "DRAFT").select("id"))
  if (!rows || rows.length === 0) throw new Error("Only unissued drafts can be deleted.")
}

/** Best-effort audit entry for downloads/reprints; never blocks the PDF. */
export async function logPdfEvent(documentId, kind, actorId) {
  try {
    await supabase.from("marine_document_events").insert({
      document_id: documentId, event: kind === "print" ? "PDF_PRINTED" : "PDF_DOWNLOADED", actor_id: actorId,
    })
  } catch { /* audit only */ }
}

// ── Libraries ─────────────────────────────────────────────────────────
export async function listCatalog({ includeInactive = false } = {}) {
  let q = supabase.from("marine_catalog_items").select("*").order("category").order("name")
  if (!includeInactive) q = q.eq("is_active", true)
  return (await run(q)) || []
}
export async function saveCatalogItem(item) {
  const row = {
    name: String(item.name || "").trim(), category: item.category || "Service", unit: item.unit || "service",
    default_unit_price: numOrNull(item.default_unit_price) ?? "0", notes: nz(item.notes), is_active: item.is_active !== false,
  }
  if (!row.name) throw new Error("Description is required.")
  if (!isNum(row.default_unit_price)) throw new Error("Default unit price must be 0 or more.")
  return item.id
    ? run(supabase.from("marine_catalog_items").update(row).eq("id", item.id).select().single())
    : run(supabase.from("marine_catalog_items").insert(row).select().single())
}

export async function listScopeTemplates({ includeInactive = false } = {}) {
  let q = supabase.from("marine_scope_templates").select("*").order("title")
  if (!includeInactive) q = q.eq("is_active", true)
  return (await run(q)) || []
}
export async function saveScopeTemplate(tpl) {
  const row = { title: String(tpl.title || "").trim(), description: String(tpl.description || "").trim(), is_active: tpl.is_active !== false }
  if (!row.title) throw new Error("Title is required.")
  return tpl.id
    ? run(supabase.from("marine_scope_templates").update(row).eq("id", tpl.id).select().single())
    : run(supabase.from("marine_scope_templates").insert(row).select().single())
}
