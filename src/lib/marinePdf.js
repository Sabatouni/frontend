import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import {
  MARINE_BRAND, DOC_TYPES, DEFAULT_SETTINGS, computeMarineTotals, formatAmount, formatQty, pdfFilename,
} from "./marineInvoicing"

/**
 * Swahili Marine & Diving document PDF (quotation / proforma / invoice).
 *
 * Layout follows the original GEC Marine quotation
 * (docs/references/gec-marine-quotation-reference.pdf): navy top band,
 * official GEC logo left with the division wording beside it, gold rule,
 * document title, number/date row, BILL TO and PAYMENT DETAILS side by side,
 * scope of work, navy-headed services table with alternating light-blue
 * rows, right-aligned totals with a light-blue TOTAL DUE box, and a grey
 * footer with contacts.
 *
 * One template for all three types. A4, vector text (selectable), table
 * headings repeated on every page, totals kept together.
 *
 * Deliberately has NO stamp or signature area -- stamps and signatures are
 * applied by hand on the printed copy.
 *
 * Identity rules:
 *   * The header wording comes from MARINE_BRAND and is never editable. The
 *     logo is ONLY the official file at MARINE_BRAND.logoUrl -- nothing is
 *     ever drawn in its place; if it can't load the space stays empty and
 *     the UI warns (logoMissing).
 *   * An ISSUED/CONVERTED/CANCELLED document prints its own frozen banking
 *     details and the contact/footer snapshot captured when it was issued,
 *     so later settings changes never alter a reprint. Drafts use the
 *     current settings.
 */

const C = {
  NAVY: "#1B3A5C",
  TITLE: "#1F2D3D",
  GOLD: "#D4A72C",
  ROW: "#EEF4FA",
  TEXT: "#1F2D3D",
  SUB: "#5B6675",
  FAINT: "#8A94A3",
  LINE: "#CBD5E1",
  WHITE: "#FFFFFF",
  RED: "#A34E33",
}
const PAGE_W = 210
const PAGE_H = 297
const M = 15
const RIGHT = PAGE_W - M
const CONTENT_W = PAGE_W - M * 2
const COL2_X = 111            // PAYMENT DETAILS column (as in the reference)
const FOOTER_RULE_Y = PAGE_H - 31
const BOTTOM = FOOTER_RULE_Y - 5 // content must stay above the footer
const CONT_TOP = 25            // content start on continuation pages

const rgb = (hex) => { const h = hex.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) }
const fill = (doc, hex) => doc.setFillColor(...rgb(hex))
const draw = (doc, hex) => doc.setDrawColor(...rgb(hex))
const ink = (doc, hex) => doc.setTextColor(...rgb(hex))
const font = (doc, style = "normal", size = 9) => { doc.setFont("helvetica", style); doc.setFontSize(size) }

function longDate(s) {
  const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return ""
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  return `${d} ${months[m - 1]} ${y}`
}

// ── Official logo ─────────────────────────────────────────────────────
/**
 * Bounding box of the non-background pixels of an RGBA buffer. The official
 * logo is a JPEG on a white background (no alpha), so "background" means
 * near-white OR transparent. Pure, so it can be unit tested. Returns the
 * whole image when nothing is found, so cropping can never lose the logo.
 */
export function nonWhiteBounds(data, width, height, { threshold = 240, padRatio = 0.02 } = {}) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      const i = row + x * 4
      const visible = data[i + 3] > 8 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)
      if (visible) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: width, h: height }
  const pad = Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * padRatio)
  const x = Math.max(0, x0 - pad)
  const y = Math.max(0, y0 - pad)
  return { x, y, w: Math.min(width, x1 + pad + 1) - x, h: Math.min(height, y1 + pad + 1) - y }
}

/** Loads the official logo and crops its white margins in memory (the file itself is untouched). */
async function loadOfficialLogo(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const objectUrl = URL.createObjectURL(await res.blob())
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error("not a readable image"))
        el.src = objectUrl
      })
      const w0 = img.naturalWidth, h0 = img.naturalHeight
      const probe = document.createElement("canvas")
      probe.width = w0; probe.height = h0
      const pctx = probe.getContext("2d")
      pctx.drawImage(img, 0, 0)
      const box = nonWhiteBounds(pctx.getImageData(0, 0, w0, h0).data, w0, h0)
      const scale = Math.min(1, 900 / Math.max(box.w, box.h))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(box.w * scale); canvas.height = Math.round(box.h * scale)
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height)
      return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), ratio: canvas.width / canvas.height }
    } finally { URL.revokeObjectURL(objectUrl) }
  } catch (err) {
    console.warn("[Marine PDF] official logo unavailable:", err?.message)
    return null
  }
}

let logoPromise
function loadMarineLogo() {
  if (!logoPromise) {
    logoPromise = loadOfficialLogo(MARINE_BRAND.logoUrl)
    // Don't cache a failure: once the file is available the next PDF picks it up.
    logoPromise.then(l => { if (!l) logoPromise = undefined })
  }
  return logoPromise
}

// ── Page furniture ────────────────────────────────────────────────────
function drawMainHeader(doc, logo) {
  fill(doc, C.NAVY); doc.rect(0, 0, PAGE_W, 5.5, "F")

  // Official logo, left (≈43 × 33 mm in the reference).
  if (logo?.dataUrl) {
    const maxH = 33, maxW = 50
    let h = maxH, w = h * logo.ratio
    if (w > maxW) { w = maxW; h = w / logo.ratio }
    doc.addImage(logo.dataUrl, "JPEG", M + 3, 13 + (maxH - h) / 2, w, h)
  }

  const tx = 75
  font(doc, "bold", 19); ink(doc, C.NAVY)
  doc.text(MARINE_BRAND.division, tx, 23)
  font(doc, "bold", 9.5); ink(doc, C.NAVY)
  doc.text(MARINE_BRAND.divisionLine, tx, 30)
  font(doc, "normal", 10); ink(doc, C.SUB)
  doc.text(MARINE_BRAND.parentLine, tx, 35.5)

  draw(doc, C.GOLD); doc.setLineWidth(0.8); doc.line(M, 52.5, RIGHT, 52.5)
  return 52.5
}

function drawRunningHeader(doc, title, numberLabel, number) {
  fill(doc, C.NAVY); doc.rect(0, 0, PAGE_W, 5.5, "F")
  font(doc, "bold", 10); ink(doc, C.NAVY)
  doc.text(MARINE_BRAND.division, M, 13)
  font(doc, "normal", 7.5); ink(doc, C.SUB)
  doc.text(`${MARINE_BRAND.divisionLine}  |  ${MARINE_BRAND.parentLine}`, M, 17)
  font(doc, "bold", 9); ink(doc, C.NAVY)
  doc.text(`${title}  -  ${numberLabel} ${number}`, RIGHT, 13, { align: "right" })
  draw(doc, C.GOLD); doc.setLineWidth(0.6); doc.line(M, 19.5, RIGHT, 19.5)
}

function contactText(c) {
  const v = String(c?.value || "").trim()
  if (!v) return ""
  const label = String(c.label || "").trim()
  return label ? `${label}: ${v}` : v
}

function drawFooter(doc, { contacts, footerLine, page, pages }) {
  draw(doc, C.LINE); doc.setLineWidth(0.3); doc.line(M, FOOTER_RULE_Y, RIGHT, FOOTER_RULE_Y)
  const parts = (contacts || []).map(contactText).filter(Boolean)
  font(doc, "normal", 9.5); ink(doc, C.TEXT)
  const lines = doc.splitTextToSize(parts.join("     "), CONTENT_W)
  let y = FOOTER_RULE_Y + 5.5
  for (const l of lines.slice(0, 2)) { doc.text(l, M + 0.5, y); y += 4.4 }
  font(doc, "normal", 8.5); ink(doc, C.SUB)
  doc.text(footerLine || DEFAULT_SETTINGS.footer_line, PAGE_W / 2, PAGE_H - 14.5, { align: "center" })
  if (pages > 1) {
    font(doc, "normal", 7); ink(doc, C.FAINT)
    doc.text(`Page ${page} of ${pages}`, RIGHT, PAGE_H - 7, { align: "right" })
  }
}

function drawWatermark(doc, text, color) {
  try {
    doc.saveGraphicsState()
    doc.setGState(new doc.GState({ opacity: 0.09 }))
    font(doc, "bold", 78); ink(doc, color)
    doc.text(text, PAGE_W / 2, PAGE_H / 2 + 20, { align: "center", angle: 35 })
    doc.restoreGraphicsState()
  } catch { /* watermark is cosmetic */ }
}

function ensureSpace(doc, y, needed, limit = BOTTOM) {
  if (y + needed > limit) { doc.addPage(); return CONT_TOP }
  return y
}

function heading(doc, x, y, text, ruleTo) {
  font(doc, "bold", 11); ink(doc, C.NAVY)
  doc.text(text, x, y)
  if (ruleTo) { draw(doc, C.LINE); doc.setLineWidth(0.3); doc.line(x, y + 2.6, ruleTo, y + 2.6) }
}

// Short labels as printed in the reference's BILL TO block.
const BILL_LABELS = {
  customer_name: "Customer", taxpayer_name: "Taxpayer", z_number: "Z Number", ztn_number: "ZTN Number",
  ztn_location: "ZTN Location", tin_number: "TIN Number", vrn_number: "VRN Number", street_address: "Street Address",
  tax_office: "Tax Office", customer_phone: "Phone Number", customer_email: "Email",
}

/**
 * Builds the jsPDF document.
 * @param {object} p
 * @param {object} p.doc      marine_documents row (or an unsaved form shaped like one)
 * @param {Array}  p.items    line items {description, unit, quantity, unit_price}
 * @param {Array}  p.scope    scope entries {title, description}
 * @param {object} p.settings current global settings (used for drafts only)
 * @param {object} [p.sourceDoc] document this one was converted from
 * @param {object} [p.revisionOf] document this one revises
 * @param {object|null} [p.logo] pre-loaded logo (tests); omit to load the official file
 */
export async function buildMarinePdf({ doc: d, items = [], scope = [], settings = DEFAULT_SETTINGS, sourceDoc, revisionOf, logo: logoOverride }) {
  const logo = logoOverride !== undefined ? logoOverride : await loadMarineLogo()
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const type = DOC_TYPES[d.doc_type] || DOC_TYPES.QUOTATION
  const numberLabel = d.doc_type === "QUOTATION" ? "QUOTATION NO." : "INVOICE NO."
  const isDraft = !d.status || d.status === "DRAFT"
  const number = d.document_number || "DRAFT"
  const currency = d.currency || settings.currency || "TZS"
  const snap = !isDraft && d.contact_snapshot ? d.contact_snapshot : null
  const contacts = snap?.contacts || settings.contacts || DEFAULT_SETTINGS.contacts
  const footerLine = snap?.footer_line || settings.footer_line
  const bank = d.bank_details && Object.values(d.bank_details).some(v => String(v || "").trim())
    ? d.bank_details
    : { bank_name: settings.bank_name, account_name: settings.bank_account_name, account_number: settings.bank_account_number, branch: settings.bank_branch, currency: settings.currency }

  pdf.setProperties({ title: `${type.title} ${number}`, subject: MARINE_BRAND.division, author: MARINE_BRAND.division, creator: `${MARINE_BRAND.division} | ${MARINE_BRAND.parent}` })

  drawMainHeader(pdf, logo)

  // ── Title + number / date rows ─────────────────────────────────────
  font(pdf, "bold", 22); ink(pdf, C.TITLE)
  pdf.text(type.title, M, 66)

  const pairs = [[numberLabel, number], ["ISSUE DATE", longDate(d.document_date)]]
  if (d.doc_type === "QUOTATION" && d.valid_until) pairs.push(["VALID UNTIL", longDate(d.valid_until)])
  if (d.doc_type !== "QUOTATION" && d.due_date) pairs.push(["DUE DATE", longDate(d.due_date)])
  if (sourceDoc?.document_number) pairs.push([`REF. ${DOC_TYPES[sourceDoc.doc_type]?.short || ""}`.trim(), sourceDoc.document_number])
  if (revisionOf?.document_number) pairs.push(["REVISES", revisionOf.document_number])
  if (d.customer_reference) pairs.push(["YOUR REF.", d.customer_reference])
  let y = 76.5
  for (let i = 0; i < pairs.length; i += 2) {
    pairs.slice(i, i + 2).forEach(([k, v], j) => {
      const lx = j === 0 ? M : 133, vx = j === 0 ? M + 33 : 162
      font(pdf, "bold", 8.5); ink(pdf, C.TITLE); pdf.text(k, lx, y)
      font(pdf, "normal", 9.5); ink(pdf, C.TEXT)
      pdf.text(pdf.splitTextToSize(String(v), (j === 0 ? 133 - vx - 4 : RIGHT - vx))[0], vx, y)
    })
    y += 6
  }
  if (d.subject) {
    font(pdf, "normal", 9); ink(pdf, C.SUB)
    const sl = pdf.splitTextToSize(`Subject: ${d.subject}`, CONTENT_W).slice(0, 2)
    pdf.text(sl, M, y); y += sl.length * 4.4 + 1.2
  }
  y += 1
  draw(pdf, C.LINE); pdf.setLineWidth(0.3); pdf.line(M, y, RIGHT, y)
  y += 7.5

  // ── BILL TO | PAYMENT DETAILS ──────────────────────────────────────
  const billRows = Object.keys(BILL_LABELS).filter(k => String(d[k] || "").trim()).map(k => [BILL_LABELS[k], String(d[k]).trim()])
  const bankRows = [["Bank", bank.bank_name], ["Account Name", bank.account_name], ["Account Number", bank.account_number], ["Branch", bank.branch], ["Currency", bank.currency || currency]]
    .filter(([, v]) => String(v || "").trim())
  const top = y
  let leftY = top, rightY = top
  if (billRows.length) {
    heading(pdf, M, top, "BILL TO", COL2_X - 6)
    leftY = top + 8
    for (const [k, v] of billRows) {
      font(pdf, "bold", 7.8); ink(pdf, C.NAVY); pdf.text(`${k}:`, M, leftY)
      font(pdf, "normal", 7.8); ink(pdf, C.TEXT)
      const vl = pdf.splitTextToSize(v, COL2_X - 6 - (M + 31))
      pdf.text(vl, M + 31, leftY)
      leftY += Math.max(1, vl.length) * 3.6 + 1
    }
  }
  if (bankRows.length) {
    const bx = billRows.length ? COL2_X : M
    const bw = RIGHT - bx
    heading(pdf, bx, top, "PAYMENT DETAILS", RIGHT)
    rightY = top + 8
    for (const [k, v] of bankRows) {
      font(pdf, "normal", 8); ink(pdf, C.TEXT)
      const one = `${k}: ${v}`
      if (pdf.getTextWidth(one) <= bw) { pdf.text(one, bx, rightY); rightY += 6 }
      else {
        // Long values (e.g. the account name) go on their own line, as in the reference.
        pdf.text(`${k}:`, bx, rightY); rightY += 6
        const vl = pdf.splitTextToSize(String(v), bw)
        pdf.text(vl, bx, rightY); rightY += vl.length * 4 + 2
      }
    }
  }
  y = Math.max(leftY, rightY) + 3

  // ── Scope of work ──────────────────────────────────────────────────
  const scopeRows = scope.filter(s => String(s.title || "").trim() || String(s.description || "").trim())
  if (scopeRows.length) {
    y = ensureSpace(pdf, y, 16)
    heading(pdf, M, y, "SCOPE OF WORK")
    y += 6
    scopeRows.forEach((s, i) => {
      const title = String(s.title || "").trim()
      const desc = String(s.description || "").trim()
      const prefix = `${i + 1}. `
      const text = title ? `${title}${desc ? ": " : ""}${desc}` : desc
      font(pdf, "normal", 8.2); ink(pdf, C.TEXT)
      const indent = pdf.getTextWidth(prefix)
      const lines = text.split(/\r?\n/).flatMap(p => pdf.splitTextToSize(p || " ", CONTENT_W - 1 - indent))
      y = ensureSpace(pdf, y, Math.min(2, lines.length) * 4.2 + 1)
      pdf.text(prefix, M + 1, y)
      lines.forEach((l, li) => {
        if (li > 0) y = ensureSpace(pdf, y, 4.6)
        pdf.text(l, M + 1 + indent, y)
        y += 4.2
      })
      y += 0.4
    })
    y += 2.5
  }

  // ── Services & materials ───────────────────────────────────────────
  const unitSuffix = (u) => !u || ["service", "pieces"].includes(u) ? "" : ` ${u === "metres" ? "m" : u}`
  const body = items.map(it => [
    it.description || "",
    `${formatQty(it.quantity)}${unitSuffix(it.unit)}`,
    formatAmount(it.unit_price),
    formatAmount(it.amount ?? computeMarineTotals({ items: [it] }).subtotal),
  ])
  autoTable(pdf, {
    startY: ensureSpace(pdf, y, 25),
    head: [["DESCRIPTION OF SERVICES / MATERIALS", "QTY", "UNIT PRICE", "AMOUNT"]],
    body: body.length ? body : [["No line items", "", "", ""]],
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    margin: { left: M, right: M, top: CONT_TOP, bottom: PAGE_H - BOTTOM },
    styles: { font: "helvetica", fontSize: 8.5, textColor: rgb(C.TEXT), cellPadding: { top: 2.7, bottom: 2.7, left: 3.4, right: 3.4 }, valign: "middle", lineWidth: 0 },
    headStyles: { fillColor: rgb(C.NAVY), textColor: rgb(C.WHITE), fontStyle: "bold", fontSize: 8, cellPadding: { top: 1.9, bottom: 1.9, left: 3.4, right: 3.4 } },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 26, halign: "center" },
      2: { cellWidth: 32, halign: "center" },
      3: { cellWidth: 32, halign: "right" },
    },
    didParseCell: (h) => {
      if (h.section === "head") h.cell.styles.halign = h.column.index === 0 ? "left" : h.column.index === 3 ? "right" : "center"
      // First body row tinted, then alternating -- as in the reference.
      if (h.section === "body" && h.row.index % 2 === 0) h.cell.styles.fillColor = rgb(C.ROW)
    },
  })
  y = pdf.lastAutoTable.finalY
  draw(pdf, C.LINE); pdf.setLineWidth(0.3); pdf.line(M, y + 0.6, RIGHT, y + 0.6)
  y += 6

  // ── Totals (kept together) ─────────────────────────────────────────
  const t = computeMarineTotals({ ...d, items })
  const stored = !isDraft && d.total_due !== undefined && d.total_due !== null
  const fig = stored ? {
    subtotal: Number(d.subtotal), discount: Number(d.discount_amount), extraCharges: Number(d.extra_charge_amount),
    taxable: Number(d.taxable_amount), vat: Number(d.vat_amount),
    calculatedTotal: Number(d.calculated_total), totalDue: Number(d.total_due),
    adjustment: Number(d.total_due) - Number(d.calculated_total),
    vatOverridden: d.vat_enabled && d.vat_amount_override !== null && d.vat_amount_override !== undefined,
  } : t

  const rows = [["Subtotal", formatAmount(fig.subtotal)]]
  if (fig.discount > 0) rows.push([d.discount_label || "Discount", `- ${formatAmount(fig.discount)}`])
  if (fig.extraCharges > 0) rows.push([d.extra_charge_label || "Additional charges", formatAmount(fig.extraCharges)])
  if (fig.discount > 0 || fig.extraCharges > 0) rows.push(["Amount before VAT", formatAmount(fig.taxable)])
  if (d.vat_enabled) rows.push([fig.vatOverridden ? "VAT" : `VAT (${Number(d.vat_percent)}%)`, formatAmount(fig.vat)])
  else rows.push(["VAT", "Not applicable"])
  if (Math.abs(fig.adjustment) >= 0.005) {
    rows.push([d.total_override_reason ? `Adjustment (${d.total_override_reason})` : "Adjustment", `${fig.adjustment < 0 ? "- " : "+ "}${formatAmount(Math.abs(fig.adjustment))}`])
  }

  // Measurements from the reference: box from x≈141 mm, rows 6.3 mm apart.
  // The totals block may run down to just above the footer rule (in the
  // reference the footer rule doubles as the line under the totals).
  // Reference proportions (box from x≈141 mm) are the minimum; the column
  // widens leftwards so long labels / large amounts are never cut off.
  const valueX = RIGHT - 4, rowH = 6.3, GAP = 6
  font(pdf, "normal", 8.8)
  const maxLabelW = Math.min(90, Math.max(...rows.map(([k]) => pdf.getTextWidth(k))))
  font(pdf, "bold", 8.8)
  const maxValueW = Math.max(...rows.map(([, v]) => pdf.getTextWidth(v)))
  font(pdf, "bold", 10.5); const dueLabelW = pdf.getTextWidth("TOTAL DUE")
  font(pdf, "bold", 11); const dueValueW = pdf.getTextWidth(formatAmount(fig.totalDue))
  const labelX = Math.min(145.5, valueX - maxValueW - GAP - maxLabelW, valueX - dueValueW - GAP - dueLabelW + 1)
  const boxX = Math.min(141, labelX - 4.5)
  const totalsH = rows.length * rowH + 8
  y = ensureSpace(pdf, y, totalsH, FOOTER_RULE_Y - 3)
  rows.forEach(([k, v], i) => {
    const ry = y + i * rowH
    font(pdf, "normal", 8.8); ink(pdf, C.TEXT)
    pdf.text(pdf.splitTextToSize(k, maxLabelW + 0.5)[0], labelX, ry)
    font(pdf, "bold", 8.8)
    pdf.text(v, valueX, ry, { align: "right" })
  })
  const by = y + rows.length * rowH - 1.5
  fill(pdf, C.ROW); pdf.rect(boxX, by, RIGHT - boxX, 9.5, "F")
  font(pdf, "bold", 10.5); ink(pdf, C.NAVY)
  pdf.text("TOTAL DUE", labelX - 1, by + 6.3)
  font(pdf, "bold", 11); ink(pdf, C.TITLE)
  pdf.text(formatAmount(fig.totalDue), valueX, by + 6.3, { align: "right" })
  font(pdf, "normal", 7.8); ink(pdf, C.TEXT)
  pdf.text(currency === "TZS" ? "All amounts in Tanzanian Shillings (TZS)." : `All amounts in ${currency}.`, M, by + 8)
  y = by + 9.5 + 5.5
  // Separator only when it isn't sitting right on top of the footer rule.
  if (y < FOOTER_RULE_Y - 6) { draw(pdf, C.LINE); pdf.setLineWidth(0.3); pdf.line(M, y, RIGHT, y) }
  y += 8

  // ── Notes / terms ──────────────────────────────────────────────────
  if (String(d.notes || "").trim()) {
    y = ensureSpace(pdf, y, 14)
    heading(pdf, M, y, "NOTES & TERMS")
    y += 6
    font(pdf, "normal", 8.2); ink(pdf, C.TEXT)
    const nl = String(d.notes).split(/\r?\n/).flatMap(p => pdf.splitTextToSize(p || " ", CONTENT_W))
    for (const l of nl) { y = ensureSpace(pdf, y, 5); pdf.text(l, M, y); y += 4.2 }
  }

  if (d.status === "CANCELLED" && d.cancel_reason) {
    y = ensureSpace(pdf, y + 3, 10)
    font(pdf, "bold", 9); ink(pdf, C.RED)
    pdf.text(pdf.splitTextToSize(`CANCELLED: ${d.cancel_reason}`, CONTENT_W), M, y)
  }

  // ── Final pass: running headers, footers, watermarks ───────────────
  const pages = pdf.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    if (p > 1) drawRunningHeader(pdf, type.title, numberLabel, number)
    drawFooter(pdf, { contacts, footerLine, page: p, pages })
    if (isDraft) drawWatermark(pdf, "DRAFT", C.NAVY)
    if (d.status === "CANCELLED") drawWatermark(pdf, "CANCELLED", C.RED)
  }
  pdf.__logoMissing = !logo?.dataUrl
  return pdf
}

export async function getMarinePdfBlob(args) {
  const pdf = await buildMarinePdf(args)
  return { blob: pdf.output("blob"), filename: pdfFilename(args.doc), pages: pdf.getNumberOfPages(), logoMissing: pdf.__logoMissing }
}
