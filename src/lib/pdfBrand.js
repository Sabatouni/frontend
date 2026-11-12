import { BRAND } from "./invoicePdf"

/**
 * Shared branding helpers for the NEW PDF generators added with the
 * Operational Documents / Sales Reporting upgrade (opsDocumentPdf.js and
 * salesReportPdf.js). The pre-existing invoice / debt-credit / weekly-report
 * / itinerary PDFs are deliberately left on their own loaders and untouched.
 *
 * Visual language matches the supplied STV source documents: official logo
 * centred on page 1, bold title, grey-headed bordered tables -- with the
 * POS's forest-green brand colour for rules and table headers.
 */

export const PDF = {
  PAGE_W: 210,
  PAGE_H: 297,
  MARGIN: 15,
  GREEN: "#3F6B4F",
  GREEN_DARK: "#22392A",
  GREEN_BG: "#EAF3EC",
  RED: "#A34E33",
  RED_BG: "#F7E9E4",
  AMBER: "#8A6D1D",
  AMBER_BG: "#FBF3D9",
  TEXT: "#26261F",
  TEXT_SUB: "#5C5B52",
  TEXT_FAINT: "#8C887A",
  BORDER: "#D6D2C4",
  HEAD_BG: "#E4E2DA",
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function money(n) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })
}

/** "12 November 2026" -- calendar date, never shifted by timezone. */
export function longDate(dateStr) {
  const s = String(dateStr || "").slice(0, 10)
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) return ""
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  return `${d} ${months[m - 1]} ${y}`
}

export function dateTimeStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Bounding box of the visible (non-transparent) pixels of an RGBA buffer,
 * plus a small padding. Pure, so it can be unit tested. Returns the full
 * image when nothing is visible (or when the image is fully opaque, the box
 * is simply the whole image), so trimming can never make a logo disappear.
 */
export function visibleBounds(data, width, height, { alphaThreshold = 8, padRatio = 0.03 } = {}) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > alphaThreshold) {
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

/**
 * Draws a loaded image onto a white canvas as JPEG (jsPDF-friendly).
 * With trim=true the transparent margins are cropped first -- in memory only;
 * the source image file is never modified. Shared by the new PDF generators
 * and the Weekly Manager's Report.
 */
export function imageToJpeg(img, { maxDim = 1400, trim = false, quality = 0.88 } = {}) {
  const w0 = img.naturalWidth || img.width || 1
  const h0 = img.naturalHeight || img.height || 1
  let box = { x: 0, y: 0, w: w0, h: h0 }
  if (trim) {
    try {
      const probe = document.createElement("canvas")
      probe.width = w0
      probe.height = h0
      const pctx = probe.getContext("2d")
      pctx.drawImage(img, 0, 0)
      box = visibleBounds(pctx.getImageData(0, 0, w0, h0).data, w0, h0)
    } catch {
      box = { x: 0, y: 0, w: w0, h: h0 } // e.g. a tainted canvas -- fall back to the untrimmed image
    }
  }
  const scale = Math.min(1, maxDim / Math.max(box.w, box.h))
  const w = Math.max(1, Math.round(box.w * scale))
  const h = Math.max(1, Math.round(box.h * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#FFFFFF"
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), ratio: w / h }
}

/** Fetches any same-origin / signed image URL into a JPEG data URL (white
 * background, downscaled) that jsPDF can embed. Returns null on failure so a
 * missing image never blocks a document from generating. */
export async function loadImageAsJpeg(url, maxDim = 1400, { trim = false } = {}) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = objectUrl
      })
      return imageToJpeg(img, { maxDim, trim })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch (err) {
    console.warn("PDF image failed to load:", url, err?.message)
    return null
  }
}

let cachedLogo
/** Official logo (/logo.png) with its transparent margins trimmed. */
export async function loadLogo() {
  if (cachedLogo !== undefined) return cachedLogo
  cachedLogo = await loadImageAsJpeg("/logo.png", 900, { trim: true })
  return cachedLogo
}

/**
 * Page-1 header: centred official logo, business name, document title and a
 * reference/date strip. Returns the y position to continue from.
 */
export function drawDocumentHeader(doc, logo, { title, subtitle, reference, generatedAt, status }) {
  const { PAGE_W, MARGIN } = PDF
  let y = 10
  if (logo) {
    // Trimmed logo: the artwork itself is now 24 mm tall (previously the
    // artwork was only ~45% of a 30 mm box because of transparent margins).
    const h = 24
    const w = h * logo.ratio
    doc.addImage(logo.dataUrl, "JPEG", (PAGE_W - w) / 2, y, w, h)
    y += h + 6
  }
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(PDF.GREEN))
  doc.text(BRAND.name, PAGE_W / 2, y, { align: "center" })
  y += 7

  doc.setFontSize(15.5)
  doc.setTextColor(...hexToRgb(PDF.TEXT))
  const titleLines = doc.splitTextToSize(title || "", PAGE_W - MARGIN * 2)
  doc.text(titleLines, PAGE_W / 2, y, { align: "center" })
  y += titleLines.length * 6.4

  if (subtitle) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(9.5)
    doc.setTextColor(...hexToRgb(PDF.TEXT_SUB))
    doc.text(subtitle, PAGE_W / 2, y, { align: "center" })
    y += 5.5
  }

  // Reference strip
  y += 2
  doc.setDrawColor(...hexToRgb(PDF.GREEN))
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(...hexToRgb(PDF.TEXT))
  if (reference) doc.text(`Ref: ${reference}`, MARGIN, y)
  if (status) {
    const color = status === "APPROVED" || status === "FULFILLED" ? PDF.GREEN : status === "REJECTED" ? PDF.RED : PDF.AMBER
    doc.setTextColor(...hexToRgb(color))
    doc.text(status, PAGE_W / 2, y, { align: "center" })
  }
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...hexToRgb(PDF.TEXT_SUB))
  doc.text(`Generated: ${generatedAt || dateTimeStamp()}`, PAGE_W - MARGIN, y, { align: "right" })
  y += 3
  doc.setDrawColor(...hexToRgb(PDF.BORDER))
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  return y + 7
}

/** Compact running header for continuation pages. */
export function drawRunningHeader(doc, { title, reference }) {
  const { PAGE_W, MARGIN } = PDF
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(PDF.GREEN))
  doc.text(BRAND.name, MARGIN, 10)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...hexToRgb(PDF.TEXT_SUB))
  doc.text(`${title || ""}${reference ? `  ·  ${reference}` : ""}`, PAGE_W - MARGIN, 10, { align: "right" })
  doc.setDrawColor(...hexToRgb(PDF.BORDER))
  doc.setLineWidth(0.2)
  doc.line(MARGIN, 12.5, PAGE_W - MARGIN, 12.5)
}

/** Footer with page numbers on every page -- call once after all content. */
export function drawFooters(doc, { reference, title }) {
  const { PAGE_W, PAGE_H, MARGIN } = PDF
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    if (i > 1) drawRunningHeader(doc, { title, reference })
    doc.setDrawColor(...hexToRgb(PDF.BORDER))
    doc.setLineWidth(0.2)
    doc.line(MARGIN, PAGE_H - 13, PAGE_W - MARGIN, PAGE_H - 13)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(...hexToRgb(PDF.TEXT_FAINT))
    doc.text(`Prepared for: Swahili Tent Village Operations  ·  ${BRAND.addressLine}`, MARGIN, PAGE_H - 8.5)
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, PAGE_H - 8.5, { align: "right" })
  }
}

/** Section heading, with an automatic page break when near the bottom. */
export function sectionHeading(doc, y, text, color = PDF.TEXT) {
  y = ensureSpace(doc, y, 18)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11.5)
  doc.setTextColor(...hexToRgb(color))
  doc.text(text, PDF.MARGIN, y)
  return y + 4
}

export function ensureSpace(doc, y, needed) {
  if (y + needed > PDF.PAGE_H - 18) {
    doc.addPage()
    return 20
  }
  return y
}

/** Standard autotable look shared by every new document. */
export function tableStyles(headColor = PDF.HEAD_BG, headText = PDF.TEXT) {
  return {
    theme: "grid",
    margin: { left: PDF.MARGIN, right: PDF.MARGIN, top: 18, bottom: 18 },
    styles: { font: "helvetica", fontSize: 8.6, textColor: hexToRgb(PDF.TEXT), lineColor: hexToRgb(PDF.BORDER), lineWidth: 0.2, cellPadding: 2.2, overflow: "linebreak" },
    headStyles: { fillColor: hexToRgb(headColor), textColor: hexToRgb(headText), fontStyle: "bold" },
  }
}

/** Two-column key/value info box (Date / Requested By / ... in the specs). */
export function kvTable(autoTable, doc, y, rows, { columns = 2 } = {}) {
  const body = []
  if (columns === 4) {
    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i] || ["", ""]
      const b = rows[i + 1] || ["", ""]
      body.push([a[0], a[1], b[0], b[1]])
    }
  } else {
    rows.forEach(r => body.push([r[0], r[1]]))
  }
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    body,
    columnStyles: columns === 4
      ? { 0: { fontStyle: "bold", fillColor: hexToRgb("#F4F3EF"), cellWidth: 32 }, 2: { fontStyle: "bold", fillColor: hexToRgb("#F4F3EF"), cellWidth: 32 } }
      : { 0: { fontStyle: "bold", fillColor: hexToRgb("#F4F3EF"), cellWidth: 60 } },
  })
  return doc.lastAutoTable.finalY + 7
}

export function paragraph(doc, y, label, text) {
  y = ensureSpace(doc, y, 14)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)
  doc.setTextColor(...hexToRgb(PDF.TEXT))
  doc.text(label, PDF.MARGIN, y)
  y += 4.6
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9.2)
  doc.setTextColor(...hexToRgb(text ? PDF.TEXT : PDF.TEXT_FAINT))
  const lines = doc.splitTextToSize(text || "—", PDF.PAGE_W - PDF.MARGIN * 2)
  for (const line of lines) {
    y = ensureSpace(doc, y, 6)
    doc.text(line, PDF.MARGIN, y)
    y += 4.4
  }
  return y + 3
}

export function pdfToBlobUrl(doc) {
  const blob = doc.output("blob")
  return { blob, url: URL.createObjectURL(blob) }
}
