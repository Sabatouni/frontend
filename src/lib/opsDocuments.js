import { supabase } from "../api/supabaseClient"

/**
 * Operational Document Generation -- templates + data access.
 *
 * Templates below are transcribed from the four supplied source PDFs:
 *   swahili_tent_village_restock_with_inventory(1).pdf
 *   swahili_tent_village_kitchen_items_with_logo.pdf
 *   swahili_tent_village_inventory_checklist.pdf
 *   swahili_tent_village_gokart_report_and_logbook.pdf
 *
 * Persistence is the `operational_documents` table (see migration
 * 20261112090100). Documents are immutable once saved; reference numbers,
 * author, status and reviewer stamps are assigned by the database.
 */

// ── Types / departments ───────────────────────────────────────────────
export const DEPARTMENTS = {
  inventory: "Inventory & Stock",
  kitchen: "Kitchen & Restaurant",
  maintenance: "Maintenance & Activities",
}

export const CHECKLIST_DEPARTMENTS = [
  "Operations", "Reception & Office", "Accommodation", "Restaurant / Kitchen",
  "Swimming Pool", "Adventure & Games", "Maintenance", "Marketing",
]

export const DOC_TYPES = {
  restock_request: {
    label: "Stock Restock Request", short: "Restock Request", icon: "📦",
    department: DEPARTMENTS.inventory, title: "Stock Restock Request & Inventory Form",
    adminOnly: false, statuses: ["PENDING", "APPROVED", "REJECTED", "FULFILLED"],
  },
  inventory_checklist: {
    label: "General Inventory Checklist", short: "Inventory Checklist", icon: "📋",
    department: null, title: "Inventory Checklist",
    adminOnly: false, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
  kitchen_equipment: {
    label: "Kitchen Cooking Equipment", short: "Kitchen Equipment", icon: "🍳",
    department: DEPARTMENTS.kitchen, title: "Kitchen Cooking Equipment List",
    adminOnly: true, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
  dining_equipment: {
    label: "Restaurant Dining Equipment (For Guests)", short: "Dining Equipment", icon: "🍽️",
    department: DEPARTMENTS.kitchen, title: "Restaurant Dining Equipment List (For Guests)",
    adminOnly: true, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
  gokart_damage_report: {
    label: "Go-Kart Equipment Damage Report", short: "Damage Report", icon: "⚠️",
    department: DEPARTMENTS.maintenance, title: "Go-Kart Equipment Damage Report",
    adminOnly: false, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
  gokart_maintenance_log: {
    label: "Go-Kart Maintenance Logbook", short: "Maintenance Log", icon: "🔧",
    department: DEPARTMENTS.maintenance, title: "Go-Kart Maintenance Logbook",
    adminOnly: false, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
  gokart_safety_inspection: {
    label: "Daily Safety Inspection Checklist", short: "Safety Inspection", icon: "✅",
    department: DEPARTMENTS.maintenance, title: "Go-Kart Daily Safety Inspection Checklist",
    adminOnly: false, statuses: ["PENDING", "APPROVED", "REJECTED"],
  },
}

export const DEPARTMENT_DOC_TYPES = {
  [DEPARTMENTS.inventory]: ["restock_request", "inventory_checklist"],
  [DEPARTMENTS.kitchen]: ["kitchen_equipment", "dining_equipment"],
  [DEPARTMENTS.maintenance]: ["gokart_damage_report", "gokart_maintenance_log", "gokart_safety_inspection"],
}

export const STATUS_LABELS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", FULFILLED: "Fulfilled" }

// ── A. Restock request template ──────────────────────────────────────
export const RESTOCK_TEMPLATE = [
  {
    title: "Shisha Stock Control",
    items: [
      { name: "Shisha Flavor – Mint", required_qty: 1, unit: "Pack" },
      { name: "Shisha Flavor – Double Apple", required_qty: 1, unit: "Pack" },
      { name: "Shisha Flavor – Blueberry", required_qty: 1, unit: "Pack" },
      { name: "Shisha Charcoal", required_qty: 2, unit: "Boxes" },
    ],
  },
  {
    title: "Soft Drinks & Beverage Stock Control",
    items: [
      { name: "Coca Cola", required_qty: 1, unit: "Crate" },
      { name: "Fanta", required_qty: 1, unit: "Crate" },
      { name: "Sprite", required_qty: 1, unit: "Crate" },
      { name: "Energy Drink", required_qty: 1, unit: "Crate" },
      { name: "Bottled Water", required_qty: 2, unit: "Crates" },
    ],
  },
]

// ── B. Kitchen & restaurant equipment templates ──────────────────────
export const KITCHEN_EQUIPMENT_TEMPLATE = [
  ["Large Cooking Pots (Stainless Steel)", 6],
  ["Medium Cooking Pots (Stainless Steel)", 8],
  ["Frying Pans", 6],
  ["Deep Frying Pan / Wok", 3],
  ["Cutting Boards (Food Grade)", 10],
  ["Chef Knives", 6],
  ["Utility Knives", 6],
  ["Peelers", 5],
  ["Wooden Cooking Spoons", 10],
  ["Metal Cooking Spoons", 10],
  ["Serving Ladles", 6],
  ["Mixing Bowls (Stainless Steel)", 10],
  ["Food Storage Containers", 20],
  ["Colanders / Strainers", 5],
  ["Kitchen Tongs", 6],
  ["Measuring Cups & Spoons Set", 4],
]

export const DINING_EQUIPMENT_TEMPLATE = [
  ["Dinner Plates (Ceramic / Restaurant Grade)", 80],
  ["Side Plates", 60],
  ["Soup Bowls", 60],
  ["Serving Bowls", 20],
  ["Serving Platters", 15],
  ["Drinking Glasses", 80],
  ["Mugs / Tea Cups", 60],
  ["Saucers", 60],
  ["Forks (Stainless Steel)", 100],
  ["Table Knives (Stainless Steel)", 100],
  ["Spoons (Stainless Steel)", 100],
  ["Tea Spoons", 100],
  ["Serving Spoons", 20],
  ["Water Jugs / Pitchers", 15],
  ["Table Trays", 15],
]

// ── C. General inventory checklist (8 sections) ──────────────────────
export const CHECKLIST_TEMPLATE = [
  { title: "Reception & Office Items", items: ["Reception Desk", "Office Chairs", "Laptop", "Printer", "Guest Register Book", "Pens & Stationery", "Receipt Books", "Booking Files", "Cash Box"] },
  { title: "Tent Accommodation Items", items: ["Guest Tents", "Mattresses", "Bedsheets", "Blankets", "Pillows", "Pillow Covers", "Bedside Tables", "Mosquito Nets", "Tent Lights/Lamps"] },
  { title: "Restaurant / Kitchen Inventory", items: ["Cooking Pots", "Frying Pans", "Plates", "Cups & Glasses", "Spoons", "Forks", "Knives", "Gas Cooker", "Gas Cylinders", "Refrigerator", "Food Storage Containers"] },
  { title: "Swimming Pool Equipment", items: ["Pool Chairs", "Pool Tables", "Pool Umbrellas", "Pool Cleaning Net", "Pool Chemicals", "Changing Room Lockers", "Shower Equipment"] },
  { title: "Adventure & Game Equipment", items: ["Go-Karts", "Go-Kart Helmets", "Paintball Guns", "Paintball Masks", "Paintball Balls", "Camp Game Equipment", "Footballs", "Board Games"] },
  { title: "Campfire & Outdoor Area", items: ["Campfire Chairs", "Firewood", "Fire Pit", "Outdoor Lights", "BBQ Grill", "Sound System"] },
  { title: "Cleaning & Maintenance Supplies", items: ["Brooms", "Mops", "Buckets", "Cleaning Detergents", "Disinfectants", "Trash Bins", "Trash Bags", "Maintenance Tools"] },
  { title: "Marketing & Promotion Materials", items: ["Signboards", "Promotional Banners", "Flyers", "Photo Equipment", "Social Media Devices"] },
]

export const CONDITIONS = ["Good", "Fair", "Damaged"]

// ── D. Go-kart ───────────────────────────────────────────────────────
export const SAFETY_STATUSES = {
  OPERATIONAL: { label: "Operational", color: "#3F7259", bg: "#EDF4F0", emoji: "🟢" },
  RESTRICTED: { label: "Restricted", color: "#8A6416", bg: "#FBF0D9", emoji: "🟡" },
  OUT_OF_SERVICE: { label: "Out of Service", color: "#A34E33", bg: "#FBEEE9", emoji: "🔴" },
}

export const SAFETY_CHECK_ITEMS = ["Fuel Tank Condition", "Brakes", "Steering", "Tires", "Engine", "Throttle", "Seat and Seatbelt"]
export const CHECK_RESULTS = { PASS: "Pass ✓", FAIL: "Fail ✗", NA: "N/A" }

export const DEFAULT_GOKART_LOCATION = "Swahili Tent Village Activity Area"

/** "gk 01" -> "GK-01". Returns "" when nothing usable remains. */
export function normalizeKartId(raw) {
  return String(raw || "").toUpperCase().trim().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 20)
}
export function isValidKartId(id) {
  return /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(id || "")
}

// ── Summary calculators (pure; also stored in `summary`) ─────────────
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v))

export function summarizeRestock(sections) {
  const items = sections.flatMap(s => s.items)
  return {
    item_count: items.length,
    total_required: items.reduce((a, i) => a + (num(i.required_qty) || 0), 0),
  }
}

export function summarizeEquipment(items) {
  const totals = items.reduce((acc, i) => {
    const suggested = num(i.suggested_qty) || 0
    const actual = num(i.actual_qty)
    acc.total_suggested += suggested
    acc.total_actual += actual || 0
    acc.total_missing += num(i.missing_qty) || 0
    acc.total_damaged += num(i.damaged_qty) || 0
    if (actual !== null) {
      acc.items_counted += 1
      if (actual < suggested) acc.shortfall_items += 1
    }
    return acc
  }, { total_suggested: 0, total_actual: 0, total_missing: 0, total_damaged: 0, items_counted: 0, shortfall_items: 0 })
  return { item_count: items.length, ...totals }
}

/**
 * Inventory checklist summary.
 *   inspected       = rows where a quantity or a condition was recorded
 *   good            = condition "Good"
 *   fair            = condition "Fair"
 *   needing_repair  = condition "Damaged"
 *   missing         = quantity recorded as 0
 */
export function summarizeChecklist(sections) {
  const items = sections.flatMap(s => s.items)
  const inspected = items.filter(i => num(i.quantity) !== null || i.condition)
  return {
    total_items: items.length,
    total_inspected: inspected.length,
    good: items.filter(i => i.condition === "Good").length,
    fair: items.filter(i => i.condition === "Fair").length,
    needing_repair: items.filter(i => i.condition === "Damaged").length,
    missing: items.filter(i => num(i.quantity) === 0).length,
  }
}

export function summarizeSafety(checks) {
  return {
    total_checks: checks.length,
    passed: checks.filter(c => c.status === "PASS").length,
    failed: checks.filter(c => c.status === "FAIL").length,
    not_checked: checks.filter(c => !c.status).length,
  }
}

/**
 * The summary shown on screen and in PDFs is ALWAYS recalculated from the
 * saved items (payload). The `summary` column written at creation time comes
 * from the browser, so it is never trusted for display -- a modified client
 * cannot make a checklist read "0 damaged" while its items say otherwise.
 */
export function effectiveSummary(doc) {
  const p = doc?.payload || {}
  switch (doc?.doc_type) {
    case "restock_request": return summarizeRestock(Array.isArray(p.sections) ? p.sections.map(s => ({ items: Array.isArray(s?.items) ? s.items : [] })) : [])
    case "kitchen_equipment":
    case "dining_equipment": return summarizeEquipment(Array.isArray(p.items) ? p.items : [])
    case "inventory_checklist": return summarizeChecklist(Array.isArray(p.sections) ? p.sections.map(s => ({ items: Array.isArray(s?.items) ? s.items : [] })) : [])
    case "gokart_safety_inspection": return summarizeSafety(Array.isArray(p.checks) ? p.checks : [])
    case "gokart_maintenance_log": return { entry_count: Array.isArray(p.entries) ? p.entries.length : 0 }
    case "gokart_damage_report": return { photo_count: Array.isArray(p.photos) ? p.photos.length : 0 }
    default: return {}
  }
}

export const DOCUMENT_PAGE_SIZE = 25

/** Inclusive PostgREST .range() bounds for a 0-based page. */
export function pageRange(page, pageSize = DOCUMENT_PAGE_SIZE) {
  const p = Math.max(0, Math.floor(Number(page) || 0))
  const size = Math.max(1, Math.floor(Number(pageSize) || DOCUMENT_PAGE_SIZE))
  return { from: p * size, to: p * size + size - 1 }
}

export function pageCount(total, pageSize = DOCUMENT_PAGE_SIZE) {
  return Math.max(1, Math.ceil((Number(total) || 0) / pageSize))
}

// ── Data access ──────────────────────────────────────────────────────
export function newClientRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  // RFC4122 v4 fallback for very old browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Saves a document. Idempotent per client_request_id: if the same form
 * submission arrives twice (double tap / retry), the second insert hits the
 * unique constraint and the already-saved row is returned instead of a
 * duplicate being created.
 */
export async function createDocument(doc) {
  const row = {
    doc_type: doc.doc_type,
    title: doc.title,
    department: doc.department,
    document_date: doc.document_date,
    payload: doc.payload,
    summary: doc.summary || {},
    kart_ids: doc.kart_ids || [],
    safety_status: doc.safety_status || null,
    client_request_id: doc.client_request_id,
    created_by_name: doc.created_by_name || null,
  }
  const { data, error } = await supabase.from("operational_documents").insert([row]).select().single()
  if (!error) return { document: data, duplicate: false }
  if (error.code === "23505" && /client_request_id/.test(error.message || "")) {
    const { data: existing, error: e2 } = await supabase
      .from("operational_documents").select("*").eq("client_request_id", doc.client_request_id).single()
    if (e2) throw e2
    return { document: existing, duplicate: true }
  }
  throw error
}

/** One page of documents, newest first, plus the total matching count. */
export async function listDocuments({ docTypes, department, status, from, to, search, page = 0, pageSize = DOCUMENT_PAGE_SIZE } = {}) {
  const range = pageRange(page, pageSize)
  let q = supabase.from("operational_documents").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(range.from, range.to)
  if (docTypes?.length) q = q.in("doc_type", docTypes)
  if (department && department !== "All") q = q.eq("department", department)
  if (status && status !== "All") q = q.eq("status", status)
  if (from) q = q.gte("document_date", from)
  if (to) q = q.lte("document_date", to)
  const needle = String(search || "").trim()
  if (needle) {
    // Escape LIKE wildcards and PostgREST filter delimiters in user input.
    const safe = needle.replace(/[%_\\]/g, m => `\\${m}`).replace(/[,()]/g, " ")
    q = q.or(`reference_number.ilike.%${safe}%,title.ilike.%${safe}%`)
  }
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data || [], total: count ?? (data || []).length }
}

/** Most recent saved document of one type (or null). */
export async function getLatestDocument(docType) {
  const { data, error } = await supabase.from("operational_documents").select("*")
    .eq("doc_type", docType).order("created_at", { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0] || null
}

export async function getDocument(id) {
  const { data, error } = await supabase.from("operational_documents").select("*").eq("id", id).single()
  if (error) throw error
  return data
}

export async function getDocumentEvents(id) {
  const { data, error } = await supabase
    .from("operational_document_events").select("*").eq("document_id", id).order("created_at", { ascending: true })
  if (error) throw error
  return data || []
}

/** Owner/Admin only (RLS + trigger enforce it). */
export async function reviewDocument(id, status, note) {
  const patch = { status }
  if (status !== "FULFILLED") patch.review_note = (note || "").trim() || null
  const { data, error } = await supabase.from("operational_documents").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data
}

export async function fetchInventoryItemsForRestock() {
  const { data, error } = await supabase
    .from("inventory_items").select("id, name, unit, quantity, min_quantity, category").eq("is_active", true).order("name")
  if (error) throw error
  return data || []
}

// Go-kart fleet
export async function fetchKarts() {
  const { data, error } = await supabase.from("gokart_units").select("*").order("kart_id")
  if (error) throw error
  return data || []
}

export async function fetchKartHistory(kartId) {
  const [hist, docs] = await Promise.all([
    supabase.from("gokart_status_history").select("*").eq("kart_id", kartId).order("created_at", { ascending: false }),
    supabase.from("operational_documents").select("*").contains("kart_ids", [kartId]).order("created_at", { ascending: false }),
  ])
  if (hist.error) throw hist.error
  if (docs.error) throw docs.error
  return { statusHistory: hist.data || [], documents: docs.data || [] }
}

/** Owner/Admin only (RLS). The database stamps the registration fields and
 * writes the REGISTERED entry to gokart_status_history itself. */
export async function registerKart(kartId, label) {
  const id = normalizeKartId(kartId)
  if (!isValidKartId(id)) throw new Error("Kart ID may only contain letters, numbers and dashes (e.g. GK-01).")
  const { data, error } = await supabase.from("gokart_units")
    .insert([{ kart_id: id, label: (label || "").trim() || null, current_status: "OPERATIONAL" }]).select().single()
  if (error) {
    if (error.code === "23505") throw new Error(`Kart ${id} is already registered.`)
    throw error
  }
  return data
}

/** Workers may only file go-kart documents against registered karts. */
export function unregisteredKarts(kartIds, karts) {
  const known = new Set((karts || []).map(k => k.kart_id))
  return (kartIds || []).filter(id => !known.has(id))
}

export async function verifyKartStatus(kartId, newStatus, note, documentId = null) {
  const { data, error } = await supabase.rpc("verify_gokart_status", {
    p_kart_id: kartId, p_new_status: newStatus, p_note: note, p_document_id: documentId,
  })
  if (error) throw error
  return data
}

// Photographic evidence (private bucket, signed URLs only)
export const EVIDENCE_BUCKET = "stv-ops-documents"
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024

async function downscaleToJpeg(file, maxDim = 1600) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("This image format can't be read by the browser. Please use JPG or PNG."))
      el.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function uploadEvidence(file, userId) {
  if (!file?.type?.startsWith("image/")) throw new Error("Only image files can be attached as evidence.")
  const blob = await downscaleToJpeg(file)
  if (!blob) throw new Error("Could not process the image.")
  if (blob.size > MAX_EVIDENCE_BYTES) throw new Error("Image is too large even after compression (max 5 MB).")
  const path = `evidence/${userId}/${newClientRequestId()}.jpg`
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false })
  if (error) throw error
  return path
}

export async function getEvidenceUrl(path, seconds = 600) {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}
