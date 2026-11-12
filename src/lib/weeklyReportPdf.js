import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { BRAND } from "./invoicePdf"
import { imageToJpeg } from "./pdfBrand"
import { formatOrdinalDate } from "./weeklyReports"

/**
 * Weekly Manager's Report PDF generation.
 *
 * A separate module from invoicePdf.js/debtCreditPdf.js, same precedent
 * those two already set for each other: only the read-only BRAND constant
 * is imported from invoicePdf.js, and the logo loader is a deliberate
 * small duplicate rather than a shared import, so nothing here can ever
 * affect either existing PDF. (The only shared piece is pdfBrand.js's pure
 * imageToJpeg helper, used to trim the logo's transparent margins; the
 * invoice / debt-credit / itinerary PDFs do not use it.)
 *
 * This is the one PDF in this app that can legitimately run to several
 * pages (a long memo, a big sales table, a busy action plan), so unlike
 * the others it repeats a running header and footer on every page --
 * built with jspdf-autotable's `didDrawPage` hook for pages autotable
 * inserts automatically, plus the same drawing calls made manually after
 * every `doc.addPage()` this file calls itself, so the treatment is
 * identical no matter what caused the new page.
 */

const GREEN = "#3F6B4F"
const GREEN_DARK = "#22392A"
const GREEN_BG = "#EAF3EC"
const RED = "#A34E33"
const RED_BG = "#F7E9E4"
const AMBER = "#8A6D1D"
const AMBER_BG = "#FCEEE3"
const GOLD_BG = "#FBF3D9"
const TEXT_DARK = "#26261F"
const TEXT_SUB = "#5C5B52"
const TEXT_FAINT = "#95917E"
const BORDER = "#E3DFD2"

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16
const HEADER_RESERVE = 30 // space reserved at the top of continuation pages
const FOOTER_RESERVE = 20 // space reserved at the bottom of every page

function money(n) {
  const v = Number(n || 0)
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

let cachedLogo = null
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
    // Transparent margins are trimmed in memory (the official logo file is
    // never modified), so the artwork fills the header slot instead of
    // printing at ~40% size inside a mostly empty box.
    const { dataUrl, ratio } = imageToJpeg(img, { maxDim: 720, trim: true, quality: 0.92 })
    cachedLogo = { dataUrl, ratio, format: "JPEG" }
  } catch (err) {
    console.warn("Weekly Report PDF: logo failed to load:", err.message)
    cachedLogo = null
  }
  return cachedLogo
}

function periodLabel(report) {
  const from = formatOrdinalDate(report.report_from, { withYear: report.report_from?.slice(0, 4) !== report.report_to?.slice(0, 4) })
  const to = formatOrdinalDate(report.report_to)
  return `${from} – ${to}`
}

// Full header -- page 1 only. Logo + business name + document title +
// the three header fields the brief calls out explicitly (Reporting
// Period / Prepared by / Date Submitted), closed off with a green rule.
function drawFullHeader(doc, logo, report) {
  let textX = MARGIN
  if (logo) {
    const h = 20
    const w = h * logo.ratio
    doc.addImage(logo.dataUrl, logo.format, MARGIN, 10, w, h)
    textX = MARGIN + w + 7
  }
  doc.setFont("times", "bold")
  doc.setFontSize(16)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text(BRAND.name, textX, 18)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10.5)
  doc.setTextColor(...hexToRgb(GREEN))
  doc.text("WEEKLY MANAGER'S REPORT", textX, 25)

  // Status badge, top right
  const badgeColor = report.status === "APPROVED" ? GREEN : report.status === "COMPLETED" ? TEXT_SUB : AMBER
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(badgeColor))
  doc.text(String(report.status || "DRAFT"), PAGE_W - MARGIN, 14, { align: "right" })

  doc.setDrawColor(...hexToRgb(GREEN))
  doc.setLineWidth(0.6)
  doc.line(MARGIN, 33, PAGE_W - MARGIN, 33)

  // Report title (the auto-generated "17th – 30th August 2026 STV Sales
  // Report" style headline) as the strongest single element on the page.
  doc.setFont("times", "bold")
  doc.setFontSize(17)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  const titleLines = doc.splitTextToSize(report.title || "STV Sales Report", PAGE_W - MARGIN * 2)
  doc.text(titleLines, MARGIN, 42)
  let y = 42 + titleLines.length * 6.5

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9.5)
  doc.setTextColor(...hexToRgb(TEXT_SUB))
  doc.text(`Reporting Period: ${periodLabel(report)}`, MARGIN, y + 2)
  doc.text(`Prepared by: ${report.prepared_by || "—"}`, MARGIN, y + 8)
  doc.text(`Date Submitted: ${report.date_submitted ? formatOrdinalDate(report.date_submitted) : "—"}`, MARGIN, y + 14)

  return y + 22
}

// Slim running header for every page after the first.
function drawRunningHeader(doc, logo, report) {
  if (logo) {
    const h = 9
    const w = h * logo.ratio
    doc.addImage(logo.dataUrl, logo.format, MARGIN, 8, w, h)
  }
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text(BRAND.name.length > 40 ? "SWAHILI TENT VILLAGE" : BRAND.name, MARGIN + 14, 13)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  const titleLine = doc.splitTextToSize(report.title || "", PAGE_W - MARGIN * 2 - 14)[0] || ""
  doc.text(titleLine, PAGE_W - MARGIN, 13, { align: "right" })
  doc.setDrawColor(...hexToRgb(GREEN))
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 20, PAGE_W - MARGIN, 20)
}

function drawFooter(doc, report) {
  const pageNumber = doc.internal.getCurrentPageInfo().pageNumber
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.setLineWidth(0.3)
  doc.line(MARGIN, PAGE_H - 15, PAGE_W - MARGIN, PAGE_H - 15)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(BRAND.name, MARGIN, PAGE_H - 9.5)
  doc.text(`Page ${pageNumber}`, PAGE_W - MARGIN, PAGE_H - 9.5, { align: "right" })
}

function newPage(doc, logo, report) {
  doc.addPage()
  drawRunningHeader(doc, logo, report)
  drawFooter(doc, report)
  return HEADER_RESERVE
}

/* jspdf-autotable's `didDrawPage` hook fires once for EVERY page a table
   occupies, including the page the table started on -- so a table that
   begins partway down page 1 still triggers this callback for page 1
   itself. Page 1 already has its own full header (drawFullHeader, with the
   status badge and big title) drawn once at the top of the document, so
   redrawing the slim running header on top of it there would overlap the
   two (this was an actual visual bug, caught by rendering a sample PDF to
   an image during this module's build and inspecting the header/badge
   area). Continuation pages (2+) never get a full header at all, so they
   still need the running header every time. Footer is safe to redraw
   unconditionally -- it's identical content each time. */
function didDrawPageDecoration(doc, logo, report) {
  if (doc.internal.getCurrentPageInfo().pageNumber > 1) drawRunningHeader(doc, logo, report)
  drawFooter(doc, report)
}

// Draws a section heading with a colored left rule + tinted label --
// used for every major numbered section (Executive Summary, Operations
// Update, etc.) so headings are visually distinct without being loud.
function sectionHeading(doc, y, label, color = TEXT_DARK) {
  doc.setDrawColor(...hexToRgb(color))
  doc.setLineWidth(1.4)
  doc.line(MARGIN, y - 4, MARGIN, y + 1.5)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11.5)
  doc.setTextColor(...hexToRgb(color))
  doc.text(label, MARGIN + 4, y)
  return y + 7
}

/** Draws wrapped text, breaking onto additional pages as needed so a long
 * memo/comment section "continues naturally" rather than getting cut off
 * or overlapping the footer. Returns the Y position after the text. */
function drawParagraph(doc, text, y, { logo, report, italic = false, placeholder = "" } = {}) {
  const content = (text || "").trim() || placeholder
  if (!content) return y
  doc.setFont("helvetica", italic && !text?.trim() ? "italic" : "normal")
  doc.setFontSize(9.5)
  doc.setTextColor(...hexToRgb(!text?.trim() ? TEXT_FAINT : TEXT_DARK))
  const lines = doc.splitTextToSize(content, PAGE_W - MARGIN * 2)
  const lineH = 5
  for (const line of lines) {
    if (y + lineH > PAGE_H - FOOTER_RESERVE) y = newPage(doc, logo, report)
    doc.text(line, MARGIN, y)
    y += lineH
  }
  return y + 3
}

function ensureSpace(doc, y, needed, logo, report) {
  if (y + needed > PAGE_H - FOOTER_RESERVE) return newPage(doc, logo, report)
  return y
}

// A small tinted box behind one line of text, used for the Opening Cash
// Balance / Calculated Cash Position callouts inside the memo section.
function statLine(doc, y, label, value, color, bg) {
  doc.setFillColor(...hexToRgb(bg))
  doc.roundedRect(MARGIN, y - 5.5, PAGE_W - MARGIN * 2, 9, 1.2, 1.2, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)
  doc.setTextColor(...hexToRgb(color))
  doc.text(label, MARGIN + 4, y)
  doc.text(`TZS ${money(value)}`, PAGE_W - MARGIN - 4, y, { align: "right" })
  return y + 8
}

function financialLine(doc, y, label, value, color) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(...hexToRgb(color))
  doc.text(label, MARGIN + 4, y)
  doc.text(`TZS ${money(value)}`, PAGE_W - MARGIN - 4, y, { align: "right" })
  return y + 7.5
}

function statusPillColor(status) {
  const s = (status || "").toLowerCase()
  if (s.includes("complet") || s.includes("done") || s === "fixed") return GREEN
  if (s.includes("progress")) return "#8A6D1D"
  if (s.includes("issue") || s.includes("delay")) return RED
  return TEXT_SUB
}

/** Builds the full jsPDF document for one weekly report. */
export async function buildWeeklyReportPdf(report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const logo = await loadLogo()

  let y = drawFullHeader(doc, logo, report)
  drawFooter(doc, report)

  // 1. Executive Summary
  y = sectionHeading(doc, y, "1. Executive Summary")
  y = drawParagraph(doc, report.executive_summary, y, { logo, report, placeholder: "No summary provided." })

  // 2. Financial Performance
  y = ensureSpace(doc, y, 40, logo, report)
  y = sectionHeading(doc, y, "2. Financial Performance")
  doc.setFillColor(...hexToRgb("#F7F5EE"))
  doc.roundedRect(MARGIN, y - 5, PAGE_W - MARGIN * 2, 26, 1.5, 1.5, "F")
  y = financialLine(doc, y + 2, "Gross Sales for the Week", report.gross_sales, GREEN)
  y = financialLine(doc, y, "Operating Expenses", report.operating_expenses, RED)
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.line(MARGIN + 4, y - 3, PAGE_W - MARGIN - 4, y - 3)
  y = financialLine(doc, y + 2, "Net Profit", report.net_profit, report.net_profit >= 0 ? GREEN_DARK : RED)
  y += 6

  // Sales Breakdown -- green
  y = ensureSpace(doc, y, 20, logo, report)
  y = sectionHeading(doc, y, "Sales Breakdown", GREEN)
  // Date | Service | Description | Amount | Recorded By. Reports saved before
  // descriptions existed have no description/recorded_by keys -> blank cells.
  const salesRows = (report.sales_breakdown || []).map(r => [formatOrdinalDate(r.date), r.item || "", r.description || "", money(r.amount), r.recorded_by || ""])
  if (salesRows.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Date", "Service", "Description", "Amount (TZS)", "Recorded By"]],
      body: salesRows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 2.6, overflow: "linebreak" },
      headStyles: { fillColor: hexToRgb(GREEN), textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: hexToRgb(GREEN_BG) },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 26 }, 2: { cellWidth: "auto" }, 3: { halign: "right", cellWidth: 26 }, 4: { cellWidth: 28 } },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 8
  } else {
    y = drawParagraph(doc, "", y, { logo, report, placeholder: "No sales recorded for this period." })
  }

  // Expense Breakdown -- red
  y = ensureSpace(doc, y, 20, logo, report)
  y = sectionHeading(doc, y, "Expense Breakdown", RED)
  const expenseRows = (report.expense_breakdown || []).map(r => [formatOrdinalDate(r.date), r.note || "", money(r.amount)])
  if (expenseRows.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Date", "Note / Reason", "Amount (TZS)"]],
      body: expenseRows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 3 },
      headStyles: { fillColor: hexToRgb(RED), textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: hexToRgb(RED_BG) },
      columnStyles: { 2: { halign: "right" } },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 8
  } else {
    y = drawParagraph(doc, "", y, { logo, report, placeholder: "No expenses recorded for this period." })
  }

  // Memo / Cash Movements -- yellow/gold
  y = ensureSpace(doc, y, 24, logo, report)
  y = sectionHeading(doc, y, "Memo / Cash Movements", AMBER)
  y = statLine(doc, y, "Opening Cash Balance", report.opening_cash_balance, AMBER, GOLD_BG)

  const capitalRows = (report.capital_movements || []).map(r => [formatOrdinalDate(r.date), r.description || "", money(r.amount)])
  if (capitalRows.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...hexToRgb(AMBER))
    doc.text("Cash / Capital Added", MARGIN, y); y += 5
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Date", "Description", "Amount (TZS)"]],
      body: capitalRows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.7, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 2.6 },
      headStyles: { fillColor: hexToRgb(AMBER), textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: hexToRgb(GOLD_BG) },
      columnStyles: { 2: { halign: "right" } },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 5
  }

  const otherRows = (report.other_cash_movements || []).map(r => [formatOrdinalDate(r.date), r.description || "", money(r.amount)])
  if (otherRows.length) {
    y = ensureSpace(doc, y, 16, logo, report)
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...hexToRgb(AMBER))
    doc.text("Other Cash Movements", MARGIN, y); y += 5
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Date", "Description", "Amount (TZS)"]],
      body: otherRows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.7, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 2.6 },
      headStyles: { fillColor: hexToRgb(AMBER), textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: hexToRgb(GOLD_BG) },
      columnStyles: { 2: { halign: "right" } },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 5
  }

  y = ensureSpace(doc, y, 12, logo, report)
  y = statLine(doc, y, "Calculated Closing Cash Position", report.closing_cash_position, AMBER, GOLD_BG)
  y += 2
  y = drawParagraph(doc, report.memo_text, y, { logo, report, placeholder: "No memo notes." })

  // 3. Operations Update
  y = ensureSpace(doc, y, 20, logo, report)
  y = sectionHeading(doc, y, "3. Operations Update")
  const ops = report.operations_update || []
  if (ops.length === 0) {
    y = drawParagraph(doc, "", y, { logo, report, placeholder: "No operations updates recorded." })
  } else {
    for (const item of ops) {
      y = ensureSpace(doc, y, 7, logo, report)
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...hexToRgb(TEXT_DARK))
      const statusText = item.status ? ` — ${item.status}` : ""
      const lines = doc.splitTextToSize(`•  ${item.text || ""}`, PAGE_W - MARGIN * 2 - 30)
      doc.text(lines, MARGIN, y)
      if (item.status) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.3)
        doc.setTextColor(...hexToRgb(statusPillColor(item.status)))
        doc.text(item.status.toUpperCase(), PAGE_W - MARGIN, y, { align: "right" })
      }
      y += lines.length * 5 + 1.5
    }
    y += 2
  }

  // 4. Marketing & Social Media
  y = ensureSpace(doc, y, 16, logo, report)
  y = sectionHeading(doc, y, "4. Marketing & Social Media")
  y = drawParagraph(doc, report.marketing_social_media, y, { logo, report, placeholder: "No marketing updates recorded." })

  // 5. Compliance
  y = ensureSpace(doc, y, 16, logo, report)
  y = sectionHeading(doc, y, "5. Compliance")
  y = drawParagraph(doc, report.compliance, y, { logo, report, placeholder: "" })
  const complianceItems = report.compliance_items || []
  if (complianceItems.length) {
    const rows = complianceItems.map(c => [c.description || "", c.status || "", c.deadline ? formatOrdinalDate(c.deadline) : ""])
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Description", "Status", "Deadline"]],
      body: rows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.7, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 2.6 },
      headStyles: { fillColor: hexToRgb(TEXT_SUB), textColor: [255, 255, 255], fontStyle: "bold" },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 6
  }
  if (!report.compliance?.trim() && complianceItems.length === 0) {
    y = drawParagraph(doc, "", y, { logo, report, placeholder: "No compliance items recorded." })
  }

  // 6. Challenges -- warning-tinted
  y = ensureSpace(doc, y, 20, logo, report)
  y = sectionHeading(doc, y, "6. Challenges", RED)
  {
    const content = (report.challenges || "").trim() || "No challenges recorded."
    doc.setFont("helvetica", report.challenges?.trim() ? "normal" : "italic")
    doc.setFontSize(9.5)
    const lines = doc.splitTextToSize(content, PAGE_W - MARGIN * 2 - 8)
    const boxH = lines.length * 5 + 6
    y = ensureSpace(doc, y, boxH + 2, logo, report)
    doc.setFillColor(...hexToRgb(AMBER_BG))
    doc.roundedRect(MARGIN, y - 4, PAGE_W - MARGIN * 2, boxH, 1.5, 1.5, "F")
    doc.setTextColor(...hexToRgb(report.challenges?.trim() ? TEXT_DARK : TEXT_FAINT))
    doc.text(lines, MARGIN + 4, y + 1)
    y += boxH + 4
  }

  // 7. Action Plan (Next Week)
  y = ensureSpace(doc, y, 20, logo, report)
  y = sectionHeading(doc, y, "7. Action Plan (Next Week)")
  const actionRows = (report.action_plan || []).map(r => [r.activity || "", r.deadline ? formatOrdinalDate(r.deadline) : "", r.responsible || "", r.status || ""])
  if (actionRows.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: HEADER_RESERVE, bottom: FOOTER_RESERVE },
      head: [["Activity", "Deadline", "Responsible", "Status"]],
      body: actionRows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, textColor: hexToRgb(TEXT_DARK), lineColor: hexToRgb(BORDER), lineWidth: 0.2, cellPadding: 3 },
      headStyles: { fillColor: hexToRgb(GREEN_DARK), textColor: [255, 255, 255], fontStyle: "bold" },
      didDrawPage: () => didDrawPageDecoration(doc, logo, report),
    })
    y = doc.lastAutoTable.finalY + 8
  } else {
    y = drawParagraph(doc, "", y, { logo, report, placeholder: "No action items recorded." })
  }

  // 8. Manager's Comments
  y = ensureSpace(doc, y, 16, logo, report)
  y = sectionHeading(doc, y, "8. Manager's Comments")
  y = drawParagraph(doc, report.manager_comments, y, { logo, report, placeholder: "No additional comments." })

  // Approval -- kept together, never awkwardly split across a page break.
  y = ensureSpace(doc, y, 44, logo, report)
  y += 2
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 34, 1.5, 1.5, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10.5)
  doc.setTextColor(...hexToRgb(GREEN_DARK))
  doc.text("Approved By", MARGIN + 6, y + 9)
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.line(MARGIN + 6, y + 12, PAGE_W - MARGIN - 6, y + 12)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(TEXT_SUB))
  doc.text("Manager:", MARGIN + 6, y + 20)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...hexToRgb(TEXT_DARK))
  doc.text(report.manager_approved_by || "_______________________", MARGIN + 32, y + 20)

  doc.setFont("helvetica", "normal")
  doc.setTextColor(...hexToRgb(TEXT_SUB))
  doc.text("Managing Director:", MARGIN + 6, y + 29)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...hexToRgb(TEXT_DARK))
  doc.text(report.managing_director_approved_by || "_______________________", MARGIN + 46, y + 29)

  // Now that the total page count is known, backfill "Page X of N" on
  // every page (the running/full headers and footers already drew "Page
  // X" as each page was created, but the total wasn't known yet then).
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(...hexToRgb(TEXT_FAINT))
    // Overwrite the plain "Page X" footer text with a white rect first so
    // digits never double-print on top of each other.
    doc.setFillColor(255, 255, 255)
    doc.rect(PAGE_W - MARGIN - 30, PAGE_H - 12.5, 30, 5, "F")
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 9.5, { align: "right" })
  }

  return doc
}

export async function getWeeklyReportPdfBlobUrl(report) {
  const doc = await buildWeeklyReportPdf(report)
  return { url: doc.output("bloburl"), doc }
}

export async function downloadWeeklyReportPdf(report) {
  const doc = await buildWeeklyReportPdf(report)
  doc.save(`${(report.title || "weekly-report").replace(/[^a-z0-9]+/gi, "-")}.pdf`)
}
