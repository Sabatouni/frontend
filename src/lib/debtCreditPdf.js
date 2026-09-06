import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { BRAND } from "./invoicePdf"

/**
 * Account Statement + Payment Receipt PDFs for the Debt & Credit module.
 *
 * Deliberately a SEPARATE module from invoicePdf.js. Per this module's own
 * "absolutely protected" rule for the existing invoice generator, nothing
 * here imports from or writes back into that file except the read-only
 * BRAND constant (business name/address/phone/email/website -- the exact
 * same real details the invoice already uses, never invented). The small
 * logo loader below is a deliberate duplicate of invoicePdf.js's own
 * private loadLogo() -- copying ~30 lines here is a safer choice than
 * modifying the invoice file to export something out of it.
 */

const GREEN = "#3F6B4F"
const GREEN_DARK = "#22392A"
const SAGE = "#DCE6D9"
const TEXT_DARK = "#26261F"
const TEXT_SUB = "#5C5B52"
const TEXT_FAINT = "#95917E"
const BORDER = "#E3DFD2"
const ROW_TINT = "#F7F5EE"
const WARN = "#A34E33"

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16

function money(n) {
  const v = Number(n || 0)
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function fmtDate(d) {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return String(d).slice(0, 10)
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

let cachedLogo = null
// Same approach as invoicePdf.js's own loadLogo(): fetch the app's real
// /logo.png, flatten it onto white at print resolution, JPEG-encode it so
// the PDF stays small. A statement/receipt is a plain white-page business
// document (same as the invoice), so there's no need for the itinerary
// module's separate transparent-background logo loader here.
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
    console.warn("Debt & Credit PDF: logo failed to load:", err.message)
    cachedLogo = null
  }
  return cachedLogo
}

async function drawLogoIfAvailable(doc, x, y, h) {
  const logo = await loadLogo()
  if (!logo) return
  const w = h * logo.ratio
  doc.addImage(logo.dataUrl, logo.format, x, y, w, h)
}

function drawHeader(doc, titleText, docNumber, docDate) {
  const y = MARGIN
  doc.setFont("times", "bold")
  doc.setTextColor(GREEN_DARK)
  doc.setFontSize(19)
  doc.text(BRAND.name, MARGIN, y + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(TEXT_FAINT)
  doc.text(BRAND.addressLine, MARGIN, y + 12)
  doc.text(`${BRAND.phone}  •  ${BRAND.email}`, MARGIN, y + 16.5)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(15)
  doc.setTextColor(GREEN)
  doc.text(titleText, PAGE_W - MARGIN, y + 6, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(TEXT_SUB)
  doc.text(`No. ${docNumber || "—"}`, PAGE_W - MARGIN, y + 12, { align: "right" })
  doc.text(fmtDate(docDate), PAGE_W - MARGIN, y + 16.5, { align: "right" })

  doc.setDrawColor(BORDER)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y + 21, PAGE_W - MARGIN, y + 21)
  return y + 28
}

function drawFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(BORDER)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, PAGE_H - 16, PAGE_W - MARGIN, PAGE_H - 16)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(TEXT_FAINT)
    doc.text(`${BRAND.name}  •  ${BRAND.website}`, MARGIN, PAGE_H - 11)
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 11, { align: "right" })
  }
}

/* ── ACCOUNT STATEMENT ──────────────────────────────────────────────── */

function directionWording(direction) {
  // Plain, direction-unambiguous wording for the printed statement --
  // "owed TO" vs "owed BY" Swahili Tent Village, so the reader never has to
  // work out which way the money runs. Kept slightly more formal than the
  // in-app UI's short "Owed to Us" / "We Owe" tab labels, per the brief.
  return direction === "RECEIVABLE"
    ? { totalLabel: "Amount Owed to Swahili Tent Village", paidLabel: "Total Paid" }
    : { totalLabel: "Amount Owed by Swahili Tent Village", paidLabel: "Total Paid" }
}

// `records` here are debt_credit_record_balances rows (already carrying
// paid_total/remaining/status computed by the database), `payments` are
// debt_credit_payments rows across all of them -- both ALL historical
// records for this person, paid ones included, never just the outstanding
// ones (the statement's whole point is a complete account history).
async function buildAccountStatementDoc(person, records, payments, statementNumber) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  let y = drawHeader(doc, "ACCOUNT STATEMENT", statementNumber, new Date())
  await drawLogoIfAvailable(doc, PAGE_W - MARGIN - 22, MARGIN - 2, 14)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(TEXT_DARK)
  doc.text(person.name || "", MARGIN, y)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9.5)
  doc.setTextColor(TEXT_SUB)
  doc.text(person.phone || "", MARGIN, y + 5.5)
  y += 14

  // One summary block per direction actually present in this person's
  // history -- most accounts only ever have one, but nothing stops a
  // person from being both a customer and a supplier over time.
  const directions = [...new Set(records.map(r => r.direction))]
  for (const dir of directions) {
    const dirRecords = records.filter(r => r.direction === dir)
    const totalCredit = dirRecords.reduce((a, r) => a + Number(r.original_amount || 0), 0)
    const totalPaid = dirRecords.reduce((a, r) => a + Number(r.paid_total || 0), 0)
    const outstanding = totalCredit - totalPaid
    const w = directionWording(dir)

    if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }

    doc.setFillColor(SAGE)
    doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 20, 2, 2, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(GREEN_DARK)
    doc.text(dir === "RECEIVABLE" ? "MONEY OWED TO US" : "MONEY WE OWE", MARGIN + 6, y + 7)

    const cols = [
      [w.totalLabel, totalCredit],
      [w.paidLabel, totalPaid],
      ["Outstanding Balance", outstanding],
    ]
    let cx = MARGIN + 6
    const colWidth = (PAGE_W - MARGIN * 2 - 12) / 3
    cols.forEach(([label, val]) => {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.setTextColor(TEXT_SUB)
      doc.text(label, cx, y + 13)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(10.5)
      doc.setTextColor(label === "Outstanding Balance" && outstanding > 0 ? WARN : GREEN_DARK)
      doc.text(`TZS ${money(val)}`, cx, y + 18)
      cx += colWidth
    })
    y += 26
  }

  const rows = records
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(r => [
      fmtDate(r.created_at),
      r.description || r.category,
      r.category,
      money(r.original_amount),
      money(r.paid_total),
      money(r.remaining),
      r.status === "paid" ? "PAID" : r.status === "overpaid" ? "OVERPAID" : r.status === "partially_paid" ? "PARTIAL" : "OUTSTANDING",
    ])

  autoTable(doc, {
    startY: y,
    head: [["Date", "Description", "Category", "Amount", "Paid", "Remaining", "Status"]],
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    styles: { font: "helvetica", fontSize: 8.5, textColor: TEXT_DARK, cellPadding: 3 },
    headStyles: { fillColor: GREEN, textColor: "#FFFFFF", fontStyle: "bold" },
    alternateRowStyles: { fillColor: ROW_TINT },
    columnStyles: {
      3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "center", fontStyle: "bold" },
    },
  })
  y = doc.lastAutoTable.finalY + 10

  if (payments.length) {
    if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(GREEN_DARK)
    doc.text("Payment History", MARGIN, y)
    y += 4
    const payRows = payments
      .slice()
      .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date))
      .map(p => [fmtDate(p.payment_date), money(p.amount), p.recorded_by_name || "—", p.note || ""])
    autoTable(doc, {
      startY: y,
      head: [["Date", "Payment", "Recorded By", "Note"]],
      body: payRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: "helvetica", fontSize: 8.5, textColor: TEXT_DARK, cellPadding: 3 },
      headStyles: { fillColor: GREEN_DARK, textColor: "#FFFFFF", fontStyle: "bold" },
      alternateRowStyles: { fillColor: ROW_TINT },
      columnStyles: { 1: { halign: "right" } },
    })
  }

  drawFooter(doc)
  return doc
}

export async function getDebtStatementPdfBlobUrl(person, records, payments, statementNumber) {
  const doc = await buildAccountStatementDoc(person, records, payments, statementNumber)
  return URL.createObjectURL(doc.output("blob"))
}

export async function downloadDebtStatementPdf(person, records, payments, statementNumber) {
  const doc = await buildAccountStatementDoc(person, records, payments, statementNumber)
  doc.save(`${statementNumber || "statement"}-${(person.name || "account").replace(/[^a-z0-9]+/gi, "-")}.pdf`)
}

/* ── PAYMENT RECEIPT ────────────────────────────────────────────────── */

async function buildPaymentReceiptDoc(person, record, payment) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  let y = drawHeader(doc, "PAYMENT RECEIPT", payment.receipt_number, payment.payment_date)
  await drawLogoIfAvailable(doc, PAGE_W - MARGIN - 22, MARGIN - 2, 14)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(TEXT_DARK)
  doc.text(person.name || "", MARGIN, y)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9.5)
  doc.setTextColor(TEXT_SUB)
  doc.text(person.phone || "", MARGIN, y + 5.5)
  y += 16

  // "Previous balance" is reconstructed as (current remaining + this
  // payment's amount) -- correct for the common case of one payment against
  // an otherwise-untouched record, and still accurate as "balance right
  // before this specific payment was applied" even when several payments
  // exist, since `record.remaining` here is read at the moment this
  // receipt is generated (immediately after the payment, from the caller).
  const remaining = Number(record.remaining || 0)
  const previousBalance = remaining + Number(payment.amount || 0)
  const rows = [
    ["Reference", record.description || record.category],
    ["Previous Balance", `TZS ${money(previousBalance)}`],
    ["Payment Received", `TZS ${money(payment.amount)}`],
    ["Remaining Balance", `TZS ${money(remaining)}`],
    ["Recorded By", payment.recorded_by_name || "—"],
  ]

  rows.forEach(([label, val], i) => {
    const ry = y + i * 10
    doc.setFillColor(i % 2 === 0 ? "#FFFFFF" : ROW_TINT)
    doc.rect(MARGIN, ry - 6, PAGE_W - MARGIN * 2, 10, "F")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9.5)
    doc.setTextColor(TEXT_SUB)
    doc.text(label, MARGIN + 4, ry)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10.5)
    doc.setTextColor(label === "Remaining Balance" && remaining > 0 ? WARN : TEXT_DARK)
    doc.text(String(val), PAGE_W - MARGIN - 4, ry, { align: "right" })
  })
  y += rows.length * 10 + 14

  doc.setFont("times", "italic")
  doc.setFontSize(11)
  doc.setTextColor(GREEN)
  doc.text(BRAND.thankYouLine || "Asante", MARGIN, y)

  drawFooter(doc)
  return doc
}

export async function getDebtPaymentReceiptPdfBlobUrl(person, record, payment) {
  const doc = await buildPaymentReceiptDoc(person, record, payment)
  return URL.createObjectURL(doc.output("blob"))
}

export async function downloadDebtPaymentReceiptPdf(person, record, payment) {
  const doc = await buildPaymentReceiptDoc(person, record, payment)
  doc.save(`${payment.receipt_number || "receipt"}.pdf`)
}
