import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

/**
 * Branded invoice PDF generation for Swahili Tent Village POS.
 *
 * Drawn with jsPDF's vector primitives (text/rect/line) plus
 * jspdf-autotable for the items grid -- NOT a rasterized screenshot of an
 * HTML template. That keeps the output crisp at any zoom, keeps file size
 * tiny, and keeps the text selectable/searchable/copyable in the PDF,
 * which a canvas-based render can't do.
 *
 * Two real, non-embedded PDF font families do the typographic work: "times"
 * (serif) for display moments -- the business name, the INVOICE headline,
 * the Asante sign-off -- and "helvetica" (sans) for everything functional --
 * labels, table body, footer. Both are core jsPDF fonts, so every character
 * stays selectable vector text; nothing here is rasterized.
 *
 * BRAND below holds the business details shown in the header/footer.
 */
export const BRAND = {
  name: "SWAHILI TENT VILLAGE",
  tagline: "More Than a Destination",
  addressLine: "CHWAKA, ZANZIBAR, TANZANIA",
  subtitle: "NATURE  •  PEOPLE  •  UNFORGETTABLE MOMENTS",
  phone: "+255 650 855 585",
  email: "info@swahilitentvillage.com",
  website: "www.swahilitentvillage.com",
  social: "@SwahiliTentVillage",
  thankYouLine: "Asante",
  thankYouSub: "FOR BEING PART OF OUR STORY",
}

// A restrained, natural palette -- deep forest green for brand moments,
// a muted sage for soft fills, warm cream/white for the page itself, and a
// warm charcoal (not pure black) for text -- meant to read as hospitality
// stationery rather than an accounting export. Saturated green is used only
// in small, deliberate doses (the table header, the invoice-number badge).
const GREEN = "#3F6B4F"
const GREEN_DARK = "#22392A"
const SAGE = "#DCE6D9"
const TEXT_DARK = "#26261F"
const TEXT_SUB = "#5C5B52"
const TEXT_FAINT = "#95917E"
const BORDER = "#E3DFD2"
const ROW_TINT = "#F7F5EE"

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16

function money(n) {
  const v = Number(n || 0)
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

let cachedLogo = null
// Fetches /logo.png (served from the app's public/ folder, same asset the
// POS UI itself uses) and returns { dataUrl, ratio } for embedding via
// doc.addImage -- computed once per session and reused.
//
// The source file is a 720x480 RGBA PNG with a transparent background.
// jsPDF embeds PNGs with an alpha channel as a raw, uncompressed bitmap
// plus a separate soft-mask (no re-compression happens for PNG the way
// it does for JPEG) -- at full size that alone made every generated PDF
// over 1MB despite the page otherwise being pure vector text. Since the
// logo is always drawn against the page's own background, it's flattened
// onto that exact color at a print-appropriate resolution and re-encoded
// as JPEG here -- visually seamless against the page, and a few KB instead
// of >1MB even at the larger, more prominent size the header now uses.
async function loadLogo() {
  if (cachedLogo) return cachedLogo
  try {
    const res = await fetch("/logo.png")
    if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
    const blob = await res.blob()
    const sourceUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = sourceUrl
    })
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1

    // Render at ~3x the size it's actually drawn on the page (now 24mm
    // tall) for crisp print quality, flattened onto the page's own white.
    const targetH = 320
    const targetW = Math.round(targetH * ratio)
    const canvas = document.createElement("canvas")
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(img, 0, 0, targetW, targetH)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92)

    cachedLogo = { dataUrl, ratio, format: "JPEG" }
  } catch (err) {
    console.error("[Invoice PDF] could not load logo:", err.message)
    cachedLogo = null
  }
  return cachedLogo
}

let cachedWatermarkLogo = null
// A second, independently-rendered copy of the same official /logo.png,
// meant only for the very faint watermark near the closing section -- not
// the same cached bitmap the header uses, since this one needs to be much
// larger and much fainter.
//
// The low opacity is baked directly into the pixels (drawn onto a white
// canvas at a low globalAlpha, then flattened to JPEG) rather than applied
// with the PDF's own transparency graphics state. A pre-faded bitmap reads
// the same in every PDF viewer and prints reliably, instead of depending on
// each viewer/printer's support for transparency groups. Flattening to JPEG
// also keeps the file small -- the same fix already used for the header
// logo, which otherwise embeds an alpha PNG as an uncompressed bitmap.
async function loadWatermarkLogo() {
  if (cachedWatermarkLogo) return cachedWatermarkLogo
  try {
    const res = await fetch("/logo.png")
    if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
    const blob = await res.blob()
    const sourceUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = sourceUrl
    })
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1

    const targetH = 480
    const targetW = Math.round(targetH * ratio)
    const canvas = document.createElement("canvas")
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#FFFFFF"
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.globalAlpha = 0.045
    ctx.drawImage(img, 0, 0, targetW, targetH)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9)

    cachedWatermarkLogo = { dataUrl, ratio, format: "JPEG" }
  } catch (err) {
    console.error("[Invoice PDF] could not load watermark logo:", err.message)
    cachedWatermarkLogo = null
  }
  return cachedWatermarkLogo
}

// Header: white page background, a generously sized logo, serif business
// name + tagline, and elegant right-aligned contact details, closed off by
// a single forest-green hairline -- brand presence without a heavy band.
function drawHeader(doc, logo) {
  const logoH = 22
  let textX = MARGIN

  if (logo) {
    const w = logoH * logo.ratio
    doc.addImage(logo.dataUrl, logo.format || "JPEG", MARGIN, 9, w, logoH)
    textX = MARGIN + w + 7
  }

  // Sized so the name never reaches into the right-aligned contact block,
  // even at the widest logo/ratio combination -- verified against
  // doc.getTextWidth() for both blocks, not eyeballed.
  doc.setFont("times", "bold")
  doc.setFontSize(15)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text(BRAND.name, textX, 19.5)

  doc.setFont("times", "italic")
  doc.setFontSize(10)
  doc.setTextColor(...hexToRgb(GREEN))
  doc.text(BRAND.tagline, textX, 27)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.3)
  doc.setTextColor(...hexToRgb(TEXT_SUB))
  doc.text(BRAND.addressLine, PAGE_W - MARGIN, 12.5, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.6)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(`Tel ${BRAND.phone}   ${BRAND.email}`, PAGE_W - MARGIN, 18, { align: "right" })
  doc.text(`${BRAND.website}   ${BRAND.social}`, PAGE_W - MARGIN, 23, { align: "right" })

  doc.setDrawColor(...hexToRgb(GREEN))
  doc.setLineWidth(0.6)
  doc.line(MARGIN, 38.5, PAGE_W - MARGIN, 38.5)
}

// Footer: a light hairline and small centered text -- no solid color band --
// so the page stays airy and print-friendly rather than reading as a form.
function drawFooter(doc) {
  doc.setDrawColor(...hexToRgb(GREEN))
  doc.setLineWidth(0.4)
  doc.line(MARGIN, PAGE_H - 17, PAGE_W - MARGIN, PAGE_H - 17)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text(BRAND.addressLine, PAGE_W / 2, PAGE_H - 11.5, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.3)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(
    `Tel: ${BRAND.phone}   ${BRAND.email}   ${BRAND.website}   ${BRAND.social}`,
    PAGE_W / 2,
    PAGE_H - 6.5,
    { align: "center" }
  )
}

// The very faint STV logo mark behind the closing section. `topY`/`bottomY`
// bound the clean space it's allowed to occupy (between the bottom of the
// notes/totals cards and the footer's hairline); it's centered in that band,
// sized to whichever of height or width is the tighter constraint so the
// logo's own aspect ratio is never distorted. If that space is too shallow
// to render a legible mark, it's skipped entirely -- clean whitespace beats
// a cramped or poorly-placed watermark.
function drawLogoWatermark(doc, watermarkLogo, topY, bottomY) {
  if (!watermarkLogo) return
  const available = bottomY - topY
  if (available < 22) return

  const maxW = PAGE_W - MARGIN * 2 - 30
  let h = Math.min(available, 50)
  let w = h * watermarkLogo.ratio
  if (w > maxW) {
    w = maxW
    h = w / watermarkLogo.ratio
  }

  const x = (PAGE_W - w) / 2
  const y = topY + (available - h) / 2
  doc.addImage(watermarkLogo.dataUrl, watermarkLogo.format || "JPEG", x, y, w, h)
}

// Invoice-number badge: a soft sage card with a bold serif number, made to
// be the visual anchor of the top-right corner. Numbering itself is untouched
// -- this only changes how the existing invoice.invoice_number is displayed.
function drawInvoiceBadge(doc, invoice) {
  const w = 60
  const h = 20
  const x = PAGE_W - MARGIN - w
  const y = 45

  doc.setFillColor(...hexToRgb(SAGE))
  doc.setDrawColor(...hexToRgb(GREEN))
  doc.setLineWidth(0.5)
  doc.roundedRect(x, y, w, h, 2, 2, "FD")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.2)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text("INVOICE NO.", x + w / 2, y + 7.2, { align: "center" })

  doc.setFont("times", "bold")
  doc.setFontSize(15.5)
  doc.text(String(invoice.invoice_number || "—"), x + w / 2, y + 15.8, { align: "center" })
}

// Customer/Invoice detail cards, redrawn as elegant inline "LABEL   value"
// rows (rather than the previous stacked, colored-header boxes) with a
// slim sage underline beneath a small caps section title -- fewer lines,
// more air, cleaner borders.
function detailBox(doc, x, y, w, title, rows) {
  const rowH = 7.3
  const headerH = 9
  const h = headerH + rows.length * rowH + 4

  doc.setDrawColor(...hexToRgb(BORDER))
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, 1.4, 1.4, "S")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.4)
  doc.setTextColor(...hexToRgb(GREEN))
  doc.text(title, x + 5, y + 6.3)
  doc.setDrawColor(...hexToRgb(SAGE))
  doc.setLineWidth(0.6)
  doc.line(x + 5, y + headerH, x + w - 5, y + headerH)

  const labelX = x + 5
  const valueX = x + 32
  let ry = y + headerH + 6.4
  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7.4)
    doc.setTextColor(...hexToRgb(TEXT_FAINT))
    doc.text(label.toUpperCase(), labelX, ry)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9.4)
    doc.setTextColor(...hexToRgb(TEXT_DARK))
    doc.text(String(value ?? "—"), valueX, ry)
    ry += rowH
  })

  return y + h
}

/**
 * Builds the jsPDF document for one invoice. `invoice` is a row from the
 * `invoices` table (grand_total/paid/amount_left already reflect the
 * saved, DB-computed values); `items` is the matching `invoice_items` rows,
 * already in the order they should print.
 */
export async function buildInvoicePdf(invoice, items) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const logo = await loadLogo()
  const watermarkLogo = await loadWatermarkLogo()

  drawHeader(doc, logo)
  drawFooter(doc)

  // Title -- the display serif moment, meant to be the strongest single
  // element on the page.
  doc.setFont("times", "bold")
  doc.setFontSize(30)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text("INVOICE", MARGIN, 59)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(BRAND.subtitle, MARGIN, 65)

  drawInvoiceBadge(doc, invoice)

  // Two-column detail cards
  const boxY = 76
  const boxW = (PAGE_W - MARGIN * 2 - 6) / 2
  const customerRows = [["Name", invoice.customer_name]]
  if (invoice.customer_company) customerRows.push(["Company", invoice.customer_company])
  if (invoice.customer_contact_person) customerRows.push(["Contact Person", invoice.customer_contact_person])
  if (invoice.customer_phone) customerRows.push(["Phone", invoice.customer_phone])
  if (invoice.customer_email) customerRows.push(["Email", invoice.customer_email])

  // Invoice Number is dropped here -- it already has its own prominent
  // badge above, so repeating it in the card would be redundant.
  //
  // "Prepared By" is deliberately always "Manager" here, regardless of
  // which logged-in user (Admin/Owner/Worker/etc.) actually created the
  // invoice -- this customer-facing document should never surface internal
  // account names or roles. The underlying user/permission data behind
  // `invoice` is untouched; this only changes what the PDF displays.
  const invoiceRows = [["Date", formatDateDMY(invoice.invoice_date)]]
  if (invoice.valid_until) invoiceRows.push(["Valid Until", formatDateDMY(invoice.valid_until)])
  invoiceRows.push(["Prepared By", "Manager"])
  if (invoice.reference) invoiceRows.push(["Reference", invoice.reference])

  const leftBottom = detailBox(doc, MARGIN, boxY, boxW, "Customer Details", customerRows)
  const rightBottom = detailBox(doc, MARGIN + boxW + 6, boxY, boxW, "Invoice Details", invoiceRows)
  const afterBoxesY = Math.max(leftBottom, rightBottom) + 8

  // Items table -- currency lives in the column header, so cells themselves
  // stay uncluttered with plain formatted numbers.
  const rows = (items || []).map((it, idx) => [
    String(idx + 1),
    it.description || "",
    String(Number(it.quantity || 0)),
    money(it.unit_price),
    money(it.total != null ? it.total : Number(it.quantity || 0) * Number(it.unit_price || 0)),
  ])

  autoTable(doc, {
    startY: afterBoxesY,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", "DESCRIPTION", "QUANTITY", "UNIT PRICE (TZS)", "TOTAL (TZS)"]],
    body: rows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      textColor: hexToRgb(TEXT_DARK),
      lineColor: hexToRgb(BORDER),
      lineWidth: 0.2,
      cellPadding: 4,
    },
    headStyles: { fillColor: hexToRgb(GREEN), textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { halign: "left" },
      2: { halign: "center", cellWidth: 30 },
      3: { halign: "right", cellWidth: 34 },
      4: { halign: "right", cellWidth: 34 },
    },
    alternateRowStyles: { fillColor: hexToRgb(ROW_TINT) },
  })

  let y = doc.lastAutoTable.finalY + 8

  // Notes + totals need ~48mm, and the Asante sign-off needs roughly
  // another 30mm below that before the footer's hairline. (The watermark
  // itself is optional and adaptive -- it simply omits itself if the
  // leftover space is too shallow, so it doesn't need its own reservation
  // here.) If we're too close to the bottom of the page, continue on a
  // fresh page rather than crowding or overlapping anything.
  const bottomSectionH = 48
  if (y + bottomSectionH + 30 > PAGE_H - 17) {
    doc.addPage()
    drawHeader(doc, logo)
    drawFooter(doc)
    y = 44
  }

  // Notes card (lower-left) -- more air, a small caps label, a light rule.
  const notesW = boxW
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.roundedRect(MARGIN, y, notesW, bottomSectionH, 1.5, 1.5, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.4)
  doc.setTextColor(...hexToRgb(GREEN))
  doc.text("Notes", MARGIN + 5, y + 7.5)
  doc.setDrawColor(...hexToRgb(SAGE))
  doc.setLineWidth(0.6)
  doc.line(MARGIN + 5, y + 9.8, MARGIN + notesW - 5, y + 9.8)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(TEXT_DARK))
  const noteLines = doc.splitTextToSize(invoice.notes || "—", notesW - 10)
  doc.text(noteLines.slice(0, 5), MARGIN + 5, y + 17)

  // Totals card (lower-right)
  const totalsX = MARGIN + boxW + 6
  const totalsW = boxW
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.roundedRect(totalsX, y, totalsW, bottomSectionH, 1.5, 1.5, "S")

  const paid = Number(invoice.paid || 0)
  const grand = Number(invoice.grand_total || 0)
  const amountLeft = invoice.amount_left != null ? Number(invoice.amount_left) : grand - paid

  const totalLine = (label, value, ly, opts = {}) => {
    doc.setFont(opts.serif ? "times" : "helvetica", opts.bold ? "bold" : "normal")
    doc.setFontSize(opts.big ? 12.5 : 9.5)
    doc.setTextColor(...hexToRgb(opts.color || TEXT_SUB))
    doc.text(label, totalsX + 6, ly)
    doc.setFont(opts.serif ? "times" : "helvetica", "bold")
    doc.setTextColor(...hexToRgb(opts.valueColor || TEXT_DARK))
    doc.text(`TZS ${money(value)}`, totalsX + totalsW - 6, ly, { align: "right" })
  }

  totalLine("Grand Total", grand, y + 13)
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.line(totalsX + 6, y + 17, totalsX + totalsW - 6, y + 17)
  totalLine("Paid", paid, y + 25)

  // The outstanding balance is emphasized purely through size, weight and a
  // soft sage backdrop -- it deliberately stays in the brand's forest green
  // regardless of amount, rather than switching to a warning color, so the
  // invoice never reads as a payment-overdue notice.
  doc.setFillColor(...hexToRgb(SAGE))
  doc.roundedRect(totalsX + 3, y + 31, totalsW - 6, 14, 1.5, 1.5, "F")
  totalLine("Amount left to be Paid", amountLeft, y + 40, {
    bold: true,
    big: true,
    serif: true,
    color: GREEN_DARK,
    valueColor: GREEN_DARK,
  })

  // The faint logo watermark is drawn first, in the clean band between the
  // notes/totals cards and the footer's hairline, so the Asante sign-off
  // that follows sits on top of it rather than the other way around.
  const footerLineY = PAGE_H - 17
  drawLogoWatermark(doc, watermarkLogo, y + bottomSectionH + 4, footerLineY - 6)

  // Thank-you signature block
  const thanksY = y + bottomSectionH + 18
  doc.setFont("times", "bolditalic")
  doc.setFontSize(22)
  doc.setTextColor(...hexToRgb(GREEN))
  doc.text(BRAND.thankYouLine, PAGE_W / 2, thanksY, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(BRAND.thankYouSub, PAGE_W / 2, thanksY + 6.5, { align: "center" })

  return doc
}

function formatDateDMY(dateStr) {
  if (!dateStr) return "—"
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export async function getInvoicePdfBlobUrl(invoice, items) {
  const doc = await buildInvoicePdf(invoice, items)
  return { url: doc.output("bloburl"), doc }
}

export async function downloadInvoicePdf(invoice, items) {
  const doc = await buildInvoicePdf(invoice, items)
  doc.save(`${invoice.invoice_number || "invoice"}.pdf`)
}
