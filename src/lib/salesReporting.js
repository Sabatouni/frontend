import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import {
  PDF, hexToRgb, money, longDate, dateTimeStamp, loadLogo,
  drawDocumentHeader, drawFooters, sectionHeading, ensureSpace, tableStyles, kvTable, pdfToBlobUrl,
} from "./pdfBrand"

/**
 * Transaction-level sales reporting helpers.
 *
 * One place that decides how a sale's Description / Recorded By are read and
 * exported, so every report path (Analytics table, CSV, Excel, Tax report,
 * Sales Report PDF, Weekly Manager's Report) shows the same thing.
 *
 * Description = `sales.description`, falling back to the existing
 * `sales.note` (where historical sales already keep their description) --
 * see ./saleText.js. Nothing in the database is rewritten.
 */

import { saleDescription, saleExtraNote } from "./saleText"
export { saleDescription, saleExtraNote }

export const SALE_DESCRIPTION_MAX = 500

export function recordedByName(row, memberNames = {}, fallback = "") {
  return memberNames[row?.user_id] || fallback || ""
}

export const SALES_TX_HEADERS = ["Date", "Service", "Description", "Amount (TZS)", "Recorded By"]

/** Shapes sales into the minimum transaction-level columns
 * Date | Service | Description | Amount | Recorded By (+ note/payment kept). */
export function buildSalesTransactionRows(sales, memberNames = {}, fallbackRecorder = "") {
  return (sales || [])
    .map(s => ({
      id: s.id,
      date: (s.date || "").slice(0, 10),
      service: s.service || "",
      description: saleDescription(s),
      amount: Number(s.amount) || 0,
      recordedBy: recordedByName(s, memberNames, fallbackRecorder),
      // Only an ADDITIONAL note (new sale with both fields); empty when the
      // note is already being shown as the description.
      note: saleExtraNote(s),
      paymentStatus: s.payment_status || "paid",
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function buildExpenseTransactionRows(expenses, memberNames = {}, fallbackRecorder = "") {
  return (expenses || [])
    .map(e => ({
      id: e.id,
      date: (e.date || "").slice(0, 10),
      category: e.category || "",
      item: String(e.item ?? "").trim(),
      amount: Number(e.cost) || 0,
      recordedBy: memberNames[e.user_id] || e.created_by || fallbackRecorder || "",
      note: String(e.note ?? "").trim(),
      paymentStatus: e.payment_status || "paid",
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Case-insensitive match over service, description, note and recorder. */
export function saleMatchesSearch(sale, needle, memberNames = {}) {
  const q = String(needle || "").trim().toLowerCase()
  if (!q) return true
  return [sale.service, sale.description, sale.note, memberNames[sale.user_id]]
    .some(v => String(v ?? "").toLowerCase().includes(q))
}

// ── CSV ───────────────────────────────────────────────────────────────
/** RFC 4180 escaping + spreadsheet formula-injection guard (a description
 * like "=HYPERLINK(...)" must never execute when the CSV is opened). */
export function csvCell(value) {
  let s = value == null ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows) {
  // BOM so Excel opens UTF-8 (Swahili text, en dashes) correctly.
  return "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n")
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a")
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Period presets (local calendar dates) ────────────────────────────
export function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "today" | "week" (Mon–Sun containing today) | "month" (1st – last day). */
export function presetRange(preset, now = new Date()) {
  if (preset === "today") {
    const d = localDateStr(now)
    return { from: d, to: d }
  }
  if (preset === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dow = (start.getDay() + 6) % 7 // Monday = 0
    start.setDate(start.getDate() - dow)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { from: localDateStr(start), to: localDateStr(end) }
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { from: localDateStr(start), to: localDateStr(end) }
  }
  return { from: "", to: "" }
}

export function periodLabel(from, to) {
  if (from && to) return from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`
  if (from) return `From ${longDate(from)}`
  if (to) return `Up to ${longDate(to)}`
  return "All recorded dates"
}

// ── Sales Report PDF ─────────────────────────────────────────────────
/**
 * Transaction-level Sales & Expenses report for any period (daily / weekly /
 * monthly via the presets, or a custom range). Summary + service breakdown
 * first, then the full sales transaction table with descriptions, then the
 * expense table with each expense's existing item description.
 */
export async function getSalesReportPdfBlobUrl({ title, from, to, serviceFilter, salesRows, expenseRows, generatedBy }) {
  const logo = await loadLogo()
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const reportTitle = title || "Sales Report"
  const totalSales = salesRows.reduce((a, r) => a + r.amount, 0)
  const totalExp = expenseRows.reduce((a, r) => a + r.amount, 0)

  let y = drawDocumentHeader(doc, logo, {
    title: reportTitle,
    subtitle: periodLabel(from, to),
    generatedAt: dateTimeStamp(),
  })

  y = kvTable(autoTable, doc, y, [
    ["Reporting Period", periodLabel(from, to)],
    ["Service Filter", serviceFilter && serviceFilter !== "All" ? serviceFilter : "All services"],
    ["Generated By", generatedBy || "—"],
    ["Total Sales", `TZS ${money(totalSales)}  (${salesRows.length} transaction${salesRows.length === 1 ? "" : "s"})`],
    ["Total Expenses", `TZS ${money(totalExp)}  (${expenseRows.length} transaction${expenseRows.length === 1 ? "" : "s"})`],
    ["Net", `TZS ${money(totalSales - totalExp)}`],
  ])

  // Service performance (aggregate -- no descriptions here on purpose)
  const bySvc = {}
  salesRows.forEach(r => {
    bySvc[r.service] = bySvc[r.service] || { count: 0, total: 0 }
    bySvc[r.service].count += 1
    bySvc[r.service].total += r.amount
  })
  const svcRows = Object.entries(bySvc).sort((a, b) => b[1].total - a[1].total)
  y = sectionHeading(doc, y, "Service Performance", PDF.GREEN_DARK)
  autoTable(doc, {
    ...tableStyles(PDF.GREEN, "#FFFFFF"),
    startY: y,
    head: [["Service", "Transactions", "Total (TZS)", "Share"]],
    body: svcRows.length
      ? svcRows.map(([svc, v]) => [svc || "—", String(v.count), money(v.total), totalSales ? `${((v.total / totalSales) * 100).toFixed(1)}%` : "—"])
      : [[{ content: "No sales in this period.", colSpan: 4, styles: { textColor: hexToRgb(PDF.TEXT_FAINT), halign: "center" } }]],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
  })
  y = doc.lastAutoTable.finalY + 9

  // Sales transactions -- Date | Service | Description | Amount | Recorded By
  y = sectionHeading(doc, y, "Sales Transactions", PDF.GREEN_DARK)
  autoTable(doc, {
    ...tableStyles(PDF.GREEN, "#FFFFFF"),
    startY: y,
    head: [["Date", "Service", "Description", "Amount (TZS)", "Recorded By"]],
    body: salesRows.length
      ? salesRows.map(r => [r.date, r.service, r.description || "—", money(r.amount), r.recordedBy || "—"])
      : [[{ content: "No sales in this period.", colSpan: 5, styles: { textColor: hexToRgb(PDF.TEXT_FAINT), halign: "center" } }]],
    foot: salesRows.length ? [["", "", "TOTAL", money(totalSales), ""]] : undefined,
    footStyles: { fillColor: hexToRgb(PDF.GREEN_BG), textColor: hexToRgb(PDF.TEXT), fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 247] },
    columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 27 }, 2: { cellWidth: "auto" }, 3: { cellWidth: 26, halign: "right" }, 4: { cellWidth: 30 } },
  })
  y = doc.lastAutoTable.finalY + 9

  // Expenses keep their existing item description
  y = ensureSpace(doc, y, 24)
  y = sectionHeading(doc, y, "Expense Transactions", PDF.RED)
  autoTable(doc, {
    ...tableStyles(PDF.RED, "#FFFFFF"),
    startY: y,
    head: [["Date", "Category", "Item / Description", "Cost (TZS)", "Recorded By"]],
    body: expenseRows.length
      ? expenseRows.map(r => [r.date, r.category, r.item || "—", money(r.amount), r.recordedBy || "—"])
      : [[{ content: "No expenses in this period.", colSpan: 5, styles: { textColor: hexToRgb(PDF.TEXT_FAINT), halign: "center" } }]],
    foot: expenseRows.length ? [["", "", "TOTAL", money(totalExp), ""]] : undefined,
    footStyles: { fillColor: hexToRgb(PDF.RED_BG), textColor: hexToRgb(PDF.TEXT), fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 27 }, 2: { cellWidth: "auto" }, 3: { cellWidth: 26, halign: "right" }, 4: { cellWidth: 30 } },
  })

  drawFooters(doc, { title: reportTitle })
  return pdfToBlobUrl(doc)
}
