import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import {
  PDF, hexToRgb, longDate, dateTimeStamp, loadLogo, loadImageAsJpeg,
  drawDocumentHeader, drawFooters, sectionHeading, ensureSpace, tableStyles, kvTable, paragraph, pdfToBlobUrl,
} from "./pdfBrand"
import { DOC_TYPES, SAFETY_STATUSES, CHECK_RESULTS, STATUS_LABELS, getEvidenceUrl, effectiveSummary } from "./opsDocuments"

/**
 * PDF rendering for every operational document type. Always rendered from
 * the SAVED database row (reference number, status, reviewer stamps), so a
 * reprint months later is identical to the original plus any later approval.
 */

const fmtQty = (v) => (v === "" || v == null ? "" : String(v))
const statusText = (s) => STATUS_LABELS[s] || s || ""
const reviewedLine = (d) =>
  d.reviewed_by_name ? `${d.reviewed_by_name} (${statusText(d.status === "FULFILLED" ? "APPROVED" : d.status)}, ${longDate(d.reviewed_at)})` : "Awaiting review"

function signatureTable(doc, y, rows) {
  y = ensureSpace(doc, y, 10 + rows.length * 10)
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    head: [["Role", "Name", "Signature", "Date"]],
    body: rows.map(r => [r.role, r.name || "", "", r.date || ""]),
    bodyStyles: { minCellHeight: 10, valign: "middle" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 38 }, 2: { cellWidth: 45 }, 3: { cellWidth: 32 } },
  })
  return doc.lastAutoTable.finalY + 6
}

function approvalRows(d, extra = []) {
  return [
    ...extra,
    {
      role: d.status === "REJECTED" ? "Rejected by (Manager)" : "Approved by (Manager)",
      name: d.reviewed_by_name || "",
      date: d.reviewed_at ? longDate(d.reviewed_at) : "",
    },
  ]
}

function reviewNote(doc, y, d) {
  if (d.review_note) y = paragraph(doc, y, "Manager's Review Note", d.review_note)
  return y
}

// ── A. Restock ────────────────────────────────────────────────────────
function renderRestock(doc, y, d) {
  const p = d.payload || {}
  y = kvTable(autoTable, doc, y, [
    ["Date", longDate(p.request_date || d.document_date)],
    ["Requested By", p.requested_by || d.created_by_name || ""],
    ["Approved By", d.status === "APPROVED" || d.status === "FULFILLED" ? reviewedLine(d) : d.status === "REJECTED" ? `Rejected – ${reviewedLine(d)}` : ""],
    ["Status", statusText(d.status) + (d.fulfilled_at ? ` – fulfilled by ${d.fulfilled_by_name || "—"} on ${longDate(d.fulfilled_at)}` : "")],
    ["Department", d.department],
  ])
  ;(p.sections || []).forEach((sec, idx) => {
    y = sectionHeading(doc, y, `${idx + 1}. ${sec.title}`)
    autoTable(doc, {
      ...tableStyles(),
      startY: y,
      head: [["Item", "Current Stock", "Required Quantity", "Notes"]],
      body: (sec.items || []).length
        ? sec.items.map(i => [
            i.name,
            i.current_stock == null ? "" : `${fmtQty(i.current_stock)}${i.stock_unit ? ` ${i.stock_unit}` : ""}`,
            `${fmtQty(i.required_qty)}${i.unit ? ` ${i.unit}` : ""}`,
            i.notes || "",
          ])
        : [[{ content: "No items.", colSpan: 4, styles: { halign: "center", textColor: hexToRgb(PDF.TEXT_FAINT) } }]],
      columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 28 }, 2: { cellWidth: 34 } },
    })
    y = doc.lastAutoTable.finalY + 8
  })
  if (p.notes) y = paragraph(doc, y, "Additional Notes", p.notes)
  y = reviewNote(doc, y, d)
  y = paragraph(doc, y, "Stock Note", "This request does not change inventory. Stock is only updated when items are received through the POS Add Stock / Adjust Stock workflow.")
  y = signatureTable(doc, y, approvalRows(d, [{ role: "Requested by", name: p.requested_by || d.created_by_name, date: longDate(p.request_date || d.document_date) }]))
  return y
}

// ── B. Equipment lists ───────────────────────────────────────────────
function renderEquipment(doc, y, d) {
  const p = d.payload || {}
  const s = effectiveSummary(d)
  y = kvTable(autoTable, doc, y, [
    ["Date", longDate(d.document_date)], ["Prepared By", p.prepared_by || d.created_by_name || ""],
    ["Department", d.department], ["Status", statusText(d.status)],
  ], { columns: 4 })

  y = sectionHeading(doc, y, d.doc_type === "kitchen_equipment" ? "1. Kitchen Cooking Equipment" : "2. Restaurant Dining Equipment (For Guests)")
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    head: [["Item", "Suggested Qty", "Actual Qty", "Missing", "Damaged", "Notes"]],
    body: (p.items || []).map(i => [i.name, fmtQty(i.suggested_qty), fmtQty(i.actual_qty), fmtQty(i.missing_qty), fmtQty(i.damaged_qty), i.notes || ""]),
    foot: [["TOTAL", String(s.total_suggested ?? ""), String(s.total_actual ?? ""), String(s.total_missing ?? ""), String(s.total_damaged ?? ""), ""]],
    footStyles: { fillColor: hexToRgb(PDF.HEAD_BG), textColor: hexToRgb(PDF.TEXT), fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 64 }, 1: { halign: "right", cellWidth: 20 }, 2: { halign: "right", cellWidth: 18 }, 3: { halign: "right", cellWidth: 17 }, 4: { halign: "right", cellWidth: 18 } },
  })
  y = doc.lastAutoTable.finalY + 7
  y = paragraph(doc, y, "Summary",
    `${s.item_count || 0} items listed · ${s.items_counted || 0} counted · ${s.shortfall_items || 0} below suggested quantity · ${s.total_missing || 0} missing · ${s.total_damaged || 0} damaged. Suggested quantities are planning targets only and are not recorded as stock.`)
  if (p.notes) y = paragraph(doc, y, "Notes", p.notes)
  y = reviewNote(doc, y, d)
  y = signatureTable(doc, y, approvalRows(d, [{ role: "Prepared by", name: p.prepared_by || d.created_by_name, date: longDate(d.document_date) }]))
  return y
}

// ── C. Inventory checklist ──────────────────────────────────────────
function renderChecklist(doc, y, d) {
  const p = d.payload || {}
  const s = effectiveSummary(d)
  y = kvTable(autoTable, doc, y, [
    ["Location", p.location || "Swahili Tent Village"], ["Date", longDate(p.inspection_date || d.document_date)],
    ["Checked By", p.checked_by || d.created_by_name || ""], ["Department", d.department],
  ], { columns: 4 })

  ;(p.sections || []).forEach((sec, idx) => {
    y = sectionHeading(doc, y, `${idx + 1}. ${sec.title}`)
    autoTable(doc, {
      ...tableStyles(),
      startY: y,
      head: [["Item", "Quantity", "Condition (Good/Fair/Damaged)", "Notes"]],
      body: (sec.items || []).map(i => [i.name, fmtQty(i.quantity), i.condition || "", i.notes || ""]),
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 22, halign: "right" }, 2: { cellWidth: 48 } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          if (data.cell.raw === "Damaged") data.cell.styles.textColor = hexToRgb(PDF.RED)
          if (data.cell.raw === "Good") data.cell.styles.textColor = hexToRgb(PDF.GREEN)
        }
      },
    })
    y = doc.lastAutoTable.finalY + 7
  })

  y = ensureSpace(doc, y, 62) // keep heading + summary table together
  y = sectionHeading(doc, y, "Inventory Summary")
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    head: [["Inventory Summary", ""]],
    body: [
      ["Total Items Inspected", `${s.total_inspected ?? 0} of ${s.total_items ?? 0}`],
      ["Items in Good Condition", String(s.good ?? 0)],
      ["Items in Fair Condition", String(s.fair ?? 0)],
      ["Items Needing Repair", String(s.needing_repair ?? 0)],
      ["Items Missing", String(s.missing ?? 0)],
    ],
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
  })
  y = doc.lastAutoTable.finalY + 7
  if (p.notes) y = paragraph(doc, y, "Notes", p.notes)
  y = reviewNote(doc, y, d)
  y = signatureTable(doc, y, [
    { role: "Checked by", name: p.checked_by || d.created_by_name, date: longDate(p.inspection_date || d.document_date) },
    { role: "Manager Signature", name: d.reviewed_by_name || "", date: d.reviewed_at ? longDate(d.reviewed_at) : "" },
  ])
  return y
}

// ── D1. Damage report ────────────────────────────────────────────────
async function renderDamage(doc, y, d) {
  const p = d.payload || {}
  const st = SAFETY_STATUSES[d.safety_status] || {}
  y = kvTable(autoTable, doc, y, [
    ["Maintenance Tracking No", d.reference_number],
    ["Equipment", p.equipment || "Go-Kart"],
    ["Unit ID", (d.kart_ids || [])[0] || ""],
    ["Location", p.location || ""],
    ["Date", longDate(d.document_date)],
    ["Reported by", p.reported_by || d.created_by_name || ""],
  ])

  y = paragraph(doc, y, "Description of Damage", p.description)

  // Safety status, highlighted
  y = ensureSpace(doc, y, 18)
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...hexToRgb(PDF.TEXT))
  doc.text("Safety Status", PDF.MARGIN, y); y += 2.5
  doc.setFillColor(...hexToRgb(st.bg || "#EEEEEE"))
  doc.setDrawColor(...hexToRgb(st.color || PDF.BORDER))
  doc.roundedRect(PDF.MARGIN, y, PDF.PAGE_W - PDF.MARGIN * 2, 8, 1.2, 1.2, "FD")
  doc.setTextColor(...hexToRgb(st.color || PDF.TEXT))
  doc.text((st.label || d.safety_status || "").toUpperCase(), PDF.MARGIN + 3, y + 5.4)
  y += 12
  if (p.safety_status_note) y = paragraph(doc, y, "Safety Status Details", p.safety_status_note)

  const bullets = (label, list) => paragraph(doc, y, label, (list || []).filter(Boolean).map(x => `• ${x}`).join("\n"))
  y = bullets("Immediate Action Taken", p.immediate_actions)
  y = bullets("Recommended Action", p.recommended_actions)

  const photos = p.photos || []
  if (photos.length) {
    y = sectionHeading(doc, y, "Photographic Evidence")
    for (const ph of photos) {
      let img = null
      try { img = await loadImageAsJpeg(await getEvidenceUrl(ph.path, 120), 1400) } catch { img = null }
      const maxW = PDF.PAGE_W - PDF.MARGIN * 2
      const h = img ? Math.min(95, maxW / img.ratio) : 12
      const w = img ? h * img.ratio : maxW
      y = ensureSpace(doc, y, h + 12)
      if (ph.caption) {
        doc.setFont("helvetica", "bolditalic"); doc.setFontSize(9.5); doc.setTextColor(...hexToRgb(PDF.TEXT))
        doc.text(ph.caption, PDF.MARGIN, y); y += 3
      }
      if (img) doc.addImage(img.dataUrl, "JPEG", PDF.MARGIN, y, w, h)
      else { doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...hexToRgb(PDF.TEXT_FAINT)); doc.text("(image unavailable)", PDF.MARGIN, y + 6) }
      y += h + 6
    }
  }

  y = reviewNote(doc, y, d)
  y = sectionHeading(doc, y, "Approval & Verification")
  y = signatureTable(doc, y, [
    { role: "Supervisor", name: p.supervisor_name || "", date: p.supervisor_date ? longDate(p.supervisor_date) : "" },
    { role: "Manager", name: d.reviewed_by_name || "", date: d.reviewed_at ? longDate(d.reviewed_at) : "" },
  ])
  if (d.safety_status === "OUT_OF_SERVICE" || d.safety_status === "RESTRICTED") {
    y = paragraph(doc, y, "Return to Service",
      "This kart may only be returned to service after repairs are completed and the status change is verified by an authorised manager in the POS maintenance interface.")
  }
  return y
}

// ── D2. Maintenance logbook ─────────────────────────────────────────
function renderLog(doc, y, d) {
  const p = d.payload || {}
  y = paragraph(doc, y, "",
    "This logbook is used to track inspection, maintenance, and repairs for all go-karts used in guest activities at Swahili Tent Village. Each entry should be completed by the maintenance staff or supervisor.")
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    head: [["Date", "Kart ID", "Inspection / Issue Found", "Maintenance Action Taken", "Technician", "Signature"]],
    body: (p.entries || []).map(e => [e.date ? longDate(e.date) : "", e.kart_id, e.issue, e.action, e.technician, e.signature || ""]),
    bodyStyles: { minCellHeight: 9 },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 17 }, 4: { cellWidth: 24 }, 5: { cellWidth: 22 } },
  })
  y = doc.lastAutoTable.finalY + 7
  if (p.notes) y = paragraph(doc, y, "Notes", p.notes)
  y = reviewNote(doc, y, d)
  y = signatureTable(doc, y, approvalRows(d, [{ role: "Recorded by", name: d.created_by_name, date: longDate(d.document_date) }]))
  return y
}

// ── D3. Daily safety inspection ─────────────────────────────────────
function renderSafety(doc, y, d) {
  const p = d.payload || {}
  const s = effectiveSummary(d)
  const st = SAFETY_STATUSES[d.safety_status] || {}
  y = kvTable(autoTable, doc, y, [
    ["Kart ID", (d.kart_ids || [])[0] || ""], ["Date", longDate(d.document_date)],
    ["Inspected By", p.inspector || d.created_by_name || ""], ["Result", `${st.label || ""} (${s.passed ?? 0}/${s.total_checks ?? 0} passed)`],
  ], { columns: 4 })
  y = sectionHeading(doc, y, "Daily Safety Inspection Checklist")
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    head: [["Item", "Check (Pass/Fail)", "Notes"]],
    body: (p.checks || []).map(c => [c.item, CHECK_RESULTS[c.status]?.replace(/[✓✗]/g, "").trim() || "", c.notes || ""]),
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 28 } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        if (data.cell.raw === "Fail") { data.cell.styles.textColor = hexToRgb(PDF.RED); data.cell.styles.fontStyle = "bold" }
        if (data.cell.raw === "Pass") data.cell.styles.textColor = hexToRgb(PDF.GREEN)
      }
    },
  })
  y = doc.lastAutoTable.finalY + 7
  if (p.overall_notes) y = paragraph(doc, y, "Notes", p.overall_notes)
  y = reviewNote(doc, y, d)
  y = signatureTable(doc, y, approvalRows(d, [{ role: "Inspector", name: p.inspector || d.created_by_name, date: longDate(d.document_date) }]))
  return y
}

export async function getOpsDocumentPdfBlobUrl(d) {
  const meta = DOC_TYPES[d.doc_type] || {}
  const logo = await loadLogo()
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" })
  const title = `Swahili Tent Village – ${meta.title || d.title}`
  let y = drawDocumentHeader(doc, logo, {
    title,
    subtitle: d.doc_type === "kitchen_equipment" || d.doc_type === "dining_equipment"
      ? "Items Required for Kitchen Operations and Client Dining Use" : d.department,
    reference: d.reference_number,
    status: d.status,
    generatedAt: dateTimeStamp(),
  })

  switch (d.doc_type) {
    case "restock_request": y = renderRestock(doc, y, d); break
    case "kitchen_equipment":
    case "dining_equipment": y = renderEquipment(doc, y, d); break
    case "inventory_checklist": y = renderChecklist(doc, y, d); break
    case "gokart_damage_report": y = await renderDamage(doc, y, d); break
    case "gokart_maintenance_log": y = renderLog(doc, y, d); break
    case "gokart_safety_inspection": y = renderSafety(doc, y, d); break
    default: y = paragraph(doc, y, "Content", JSON.stringify(d.payload, null, 2))
  }

  // Record footer line
  y = ensureSpace(doc, y, 10)
  doc.setFont("helvetica", "italic"); doc.setFontSize(7.8); doc.setTextColor(...hexToRgb(PDF.TEXT_FAINT))
  doc.text(`Recorded in the STV POS by ${d.created_by_name || "—"} on ${dateTimeStamp(new Date(d.created_at))}. Reference ${d.reference_number}.`, PDF.MARGIN, y)

  drawFooters(doc, { title: meta.short || d.title, reference: d.reference_number })
  return pdfToBlobUrl(doc)
}

export function opsDocumentFilename(d) {
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9-]+/g, "_")
  return `${safe(d.reference_number)}_${safe(DOC_TYPES[d.doc_type]?.short || d.doc_type)}.pdf`
}
