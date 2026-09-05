import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { BRAND } from "./invoicePdf"

/**
 * Swahili Tent Itinerary -- premium guest-facing experience proposal PDF.
 *
 * This is a DELIBERATELY SEPARATE renderer from lib/invoicePdf.js. It does
 * not import anything from that file except the read-only BRAND constant
 * (business name/contact/tagline), so the itinerary's own layout, palette,
 * and page logic can evolve freely without ever risking the invoice PDF's
 * output. Nothing in invoicePdf.js is modified, called for its side effects,
 * or depended on beyond that one constant.
 *
 * Same underlying technique as the invoice renderer -- jsPDF vector
 * primitives + jspdf-autotable, real (non-rasterized) selectable text -- but
 * a distinct visual language: warm cream page, olive/brown ink, a small gold
 * accent rule, serif display type for section titles, so a guest can tell at
 * a glance this is a different kind of document from an invoice.
 *
 * IMPORTANT -- guest/staff separation: every function below only ever reads
 * the fields it's explicitly given. The caller (the itinerary editor in
 * App.jsx) is responsible for building a "guest view" content object that
 * simply does not include any internal/staff-only field in the first place
 * -- this module never reads a field named `internal_notes` or similar, so
 * there is no code path here by which a staff note could reach the PDF even
 * if one were accidentally left on the object passed in.
 */

const CREAM = "#FBF7EE"
const CREAM_DARK = "#F1E9D8"
const OLIVE = "#5B6B45"
const OLIVE_DARK = "#333B24"
const BROWN = "#6B4A32"
const GOLD = "#B8923F"
const TEXT_DARK = "#2B2A22"
const TEXT_SUB = "#5A5748"
const TEXT_FAINT = "#8B8672"
const BORDER = "#E4DCC5"
// Pre-computed RGB (not hex) for the gold accent as used for TEXT drawn on
// the dark olive cover/closing pages, where a lighter tint reads better
// than the darker GOLD used for hairlines/bullets on the cream pages.
const GOLD_ON_DARK_RGB = [200, 176, 120]

// Small-caps type label shown next to a day item's time/title -- "activity"
// and "custom" get no label (they read fine as plain entries); the others
// make it obvious at a glance which items are excursions/transport/meals/
// special touches, matching the type model added to the editor.
const PDF_TYPE_LABELS = {
  excursion: "Excursion", transport: "Transport", meal: "Meal",
  special_touch: "Special Touch", accommodation_event: "Accommodation",
}

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const FOOTER_Y = PAGE_H - 16

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function money(n) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function formatDateLong(dateStr) {
  if (!dateStr) return ""
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

function nightsBetween(from, to) {
  if (!from || !to) return null
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const n = Math.round((b - a) / 86400000)
  return n > 0 ? n : null
}

// Generic "fetch a URL (logo asset or a signed Supabase Storage URL) and
// return a data: URL + aspect ratio" loader. Every call site wraps this in
// its own try/catch and falls back to an elegant placeholder block rather
// than ever failing the whole document -- a missing or unreachable photo
// must never break itinerary generation.
async function loadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`)
  const blob = await res.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5
  // Re-encode through canvas as JPEG, same reasoning as invoicePdf.js's
  // loadLogo(): avoids embedding an uncompressed alpha PNG bitmap, keeps
  // file size sane even with many photos.
  const targetW = 1200
  const targetH = Math.round(targetW / ratio)
  const canvas = document.createElement("canvas")
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#FFFFFF"
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(img, 0, 0, targetW, targetH)
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), ratio, format: "JPEG" }
}

// Only used for the full-bleed cover hero photo, where a letterboxed
// "contain" fit (see drawPhoto below) would look wrong -- crops the already-
// loaded image data to exactly `targetRatio` (center crop, never distorts)
// and returns a new { dataUrl, ratio: targetRatio, format }. Every other
// photo slot in the document uses the simpler, clip-free drawPhoto() below.
async function coverCropDataUrl(image, targetRatio) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = image.dataUrl
  })
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  let cropW = srcW, cropH = srcH
  if (srcW / srcH > targetRatio) {
    cropW = srcH * targetRatio
  } else {
    cropH = srcW / targetRatio
  }
  const cropX = (srcW - cropW) / 2
  const cropY = (srcH - cropH) / 2
  const canvas = document.createElement("canvas")
  canvas.width = 1400
  canvas.height = Math.round(1400 / targetRatio)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), ratio: targetRatio, format: "JPEG" }
}

// The logo is a real transparent PNG (verified: alpha channel 0-255,
// transparent corners) meant to sit on both light AND dark page
// backgrounds (the cover and closing pages use a dark green fill). The
// generic loadImage() above is deliberately wrong for it: it paints a
// solid white rect behind the image before flattening to JPEG (correct for
// real photos, which are always opaque and benefit from the smaller file
// size) -- reusing it for the logo is what produced the visible white box
// around the mark on dark pages. This loader keeps the alpha channel and
// stays PNG, at the cost of a slightly larger embed -- acceptable for one
// small logo used a couple of times per document.
async function loadTransparentImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`)
  const blob = await res.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")
  // No fillRect here -- transparent pixels stay transparent.
  ctx.drawImage(img, 0, 0)
  return { dataUrl: canvas.toDataURL("image/png"), ratio, format: "PNG" }
}

let cachedLogo = null
async function loadLogo() {
  if (cachedLogo !== null) return cachedLogo
  try {
    cachedLogo = await loadTransparentImage("/logo.png")
  } catch (err) {
    console.error("[Itinerary PDF] could not load logo:", err.message)
    cachedLogo = false
  }
  return cachedLogo || null
}

// Draws a photo into the given box, preserving aspect ratio via a center
// crop (never stretched/distorted). Falls back to a soft placeholder panel
// with a small icon-less label if `image` is null -- used for every photo
// slot in the document so a missing photo never breaks page layout.
function drawPhoto(doc, image, x, y, w, h, placeholderLabel) {
  if (!image) {
    doc.setFillColor(...hexToRgb(CREAM_DARK))
    doc.roundedRect(x, y, w, h, 2, 2, "F")
    doc.setDrawColor(...hexToRgb(BORDER))
    doc.roundedRect(x, y, w, h, 2, 2, "S")
    if (placeholderLabel) {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(...hexToRgb(TEXT_FAINT))
      doc.text(placeholderLabel, x + w / 2, y + h / 2, { align: "center", maxWidth: w - 10 })
    }
    return
  }
  // "Contain" fit, centered -- scaled down (never up, never distorted) to
  // fit entirely within the box, on a soft mat matching the page background.
  // Deliberately not a crop-to-fill: jsPDF's clip-path support varies across
  // versions/renderers, and a photo that's occasionally letterboxed by a few
  // millimeters is a far safer failure mode than a clip call that silently
  // fails in some PDF viewer and lets the image bleed past its frame.
  doc.setFillColor(...hexToRgb(CREAM_DARK))
  doc.roundedRect(x, y, w, h, 2, 2, "F")
  const boxRatio = w / h
  let sw = w, sh = h
  if (image.ratio > boxRatio) {
    sw = w
    sh = w / image.ratio
  } else {
    sh = h
    sw = h * image.ratio
  }
  const ox = x + (w - sw) / 2
  const oy = y + (h - sh) / 2
  doc.addImage(image.dataUrl, image.format || "JPEG", ox, oy, sw, sh)
  doc.setDrawColor(...hexToRgb(BORDER))
  doc.roundedRect(x, y, w, h, 2, 2, "S")
}

function drawFooter(doc, pageLabel) {
  doc.setDrawColor(...hexToRgb(GOLD))
  doc.setLineWidth(0.4)
  doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.2)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text(`${BRAND.name}  ·  ${BRAND.addressLine}  ·  ${BRAND.phone}  ·  ${BRAND.email}`, MARGIN, FOOTER_Y + 5.5)
  if (pageLabel) doc.text(pageLabel, PAGE_W - MARGIN, FOOTER_Y + 5.5, { align: "right" })
}

// Every interior page shares this cream background + faint header rule +
// footer. `title` is the small caps section label in the top-left.
function newPage(doc, title, pageLabel) {
  doc.addPage()
  doc.setFillColor(...hexToRgb(CREAM))
  doc.rect(0, 0, PAGE_W, PAGE_H, "F")
  if (title) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...hexToRgb(GOLD))
    doc.text(title.toUpperCase(), MARGIN, 16)
    doc.setDrawColor(...hexToRgb(BORDER))
    doc.setLineWidth(0.3)
    doc.line(MARGIN, 19, PAGE_W - MARGIN, 19)
  }
  drawFooter(doc, pageLabel)
  return title ? 30 : 20
}

// Ensures at least `needed` mm remain before the footer; if not, starts a
// fresh page (same section title/pagination continues) and returns the new
// y. This is what keeps a day/activity heading from ever being stranded
// alone at the bottom of a page.
function ensureSpace(doc, y, needed, title, pageLabel) {
  if (y + needed > FOOTER_Y - 4) {
    return newPage(doc, title, pageLabel)
  }
  return y
}

function sectionHeading(doc, text, y) {
  doc.setFont("times", "bold")
  doc.setFontSize(19)
  doc.setTextColor(...hexToRgb(OLIVE_DARK))
  doc.text(text, MARGIN, y)
  doc.setDrawColor(...hexToRgb(GOLD))
  doc.setLineWidth(0.7)
  doc.line(MARGIN, y + 3, MARGIN + 22, y + 3)
  return y + 12
}

function paragraph(doc, text, x, y, w, opts = {}) {
  if (!text) return y
  doc.setFont("helvetica", opts.italic ? "italic" : "normal")
  doc.setFontSize(opts.size || 10.5)
  doc.setTextColor(...hexToRgb(opts.color || TEXT_SUB))
  const lines = doc.splitTextToSize(text, w)
  doc.text(lines, x, y, { lineHeightFactor: 1.45 })
  return y + lines.length * (opts.size || 10.5) * 0.4535 + 2
}

// Renders the ordered list of real, admin-entered destination names as a
// simple generated flow diagram -- boxes connected by arrows, e.g.
//   Swahili Tent Village  ->  Mnemba Island  ->  Stone Town  ->  Airport
// This is a GENERATED visualization, not a live/geographic map: it never
// makes an external request, never invents a coordinate, and simply lays
// out the names the admin typed in, in the order the admin set them. Safe
// to call with an empty or disabled list -- it just returns `y` unchanged,
// so a missing/disabled route never blocks the rest of the PDF. Uses
// ensureSpace() before each box so a stop is never stranded alone at the
// bottom of a page (same page-break discipline as the rest of this file).
function drawRouteMap(doc, stops, y, title, pageLabel) {
  const clean = (stops || []).map((s) => (s || "").trim()).filter(Boolean)
  if (!clean.length) return y

  const boxW = 100
  const boxH = 11
  const gapH = 9
  const x = MARGIN

  y = ensureSpace(doc, y, 14, title, pageLabel)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...hexToRgb(TEXT_FAINT))
  doc.text("YOUR ROUTE", MARGIN, y)
  y += 9

  clean.forEach((stop, i) => {
    const isLast = i === clean.length - 1
    y = ensureSpace(doc, y, boxH + (isLast ? 0 : gapH), title, pageLabel)
    doc.setFillColor(...hexToRgb(CREAM_DARK))
    doc.setDrawColor(...hexToRgb(GOLD))
    doc.setLineWidth(0.4)
    doc.roundedRect(x, y, boxW, boxH, 2, 2, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...hexToRgb(OLIVE_DARK))
    const lines = doc.splitTextToSize(stop, boxW - 8)
    doc.text(lines[0], x + boxW / 2, y + boxH / 2 + 1.3, { align: "center" })
    y += boxH
    if (!isLast) {
      doc.setDrawColor(...hexToRgb(GOLD))
      doc.setLineWidth(0.6)
      doc.line(x + boxW / 2, y + 1, x + boxW / 2, y + gapH - 2.5)
      doc.setFillColor(...hexToRgb(GOLD))
      doc.triangle(x + boxW / 2 - 1.6, y + gapH - 3, x + boxW / 2 + 1.6, y + gapH - 3, x + boxW / 2, y + gapH - 0.3, "F")
      y += gapH
    }
  })
  return y + 5
}

/**
 * Builds the jsPDF document for one itinerary.
 *
 * `itinerary` -- a plain object shaped like a `stv_itineraries` row (title,
 * subtitle, guest_name, guest_type, occasion, check_in/out, adults/children).
 *
 * `guestContent` -- the fully-resolved, GUEST-SAFE content tree already
 * built by the caller: { welcomeText, atAGlance:{keyExperiences[]}, stay:
 * {tentName, description, amenities[], heroImageUrl}, days:[{label, date,
 * activities:[{time, title, description, imageUrl}]}], experiences:[{title,
 * description, imageUrl, duration, included, whatToBring, notes}],
 * stvExperience:{items:[{title, description, imageUrl}]}, included:[string],
 * notToBring... whatToBring:[string], pricing:{label, referencePrice,
 * currentPrice, currency, note}, terms:string, closing:string,
 * routeStops:[string], routeEnabled:boolean }. Every field is optional; absent sections are
 * simply skipped. No field here is ever staff-only -- that filtering
 * happens before this function is called.
 *
 * `resolveImage(url)` -- optional async fn(url) => {dataUrl,ratio,format}
 * (or null). Defaults to fetching the URL directly (works for any public or
 * signed URL). Failures are caught per-image; a missing photo degrades to a
 * placeholder, never an error.
 */
export async function buildItineraryPdf(itinerary, guestContent, resolveImage = loadImage) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const logo = await loadLogo()
  const gc = guestContent || {}

  async function safeImage(url) {
    if (!url) return null
    try {
      return await resolveImage(url)
    } catch (err) {
      console.error("[Itinerary PDF] image failed, using placeholder:", err.message)
      return null
    }
  }

  const nights = nightsBetween(itinerary.check_in, itinerary.check_out)
  const guestCount = [
    itinerary.adults ? `${itinerary.adults} adult${itinerary.adults === 1 ? "" : "s"}` : null,
    itinerary.children ? `${itinerary.children} child${itinerary.children === 1 ? "" : "ren"}` : null,
  ].filter(Boolean).join(", ")

  // ── COVER ──────────────────────────────────────────────────
  doc.setFillColor(...hexToRgb(OLIVE_DARK))
  doc.rect(0, 0, PAGE_W, PAGE_H, "F")
  const rawHeroImg = await safeImage(gc.stay?.heroImageUrl || gc.days?.[0]?.activities?.[0]?.imageUrl)
  let heroImg = null
  if (rawHeroImg) {
    try {
      heroImg = await coverCropDataUrl(rawHeroImg, PAGE_W / 160)
      doc.addImage(heroImg.dataUrl, heroImg.format, 0, 0, PAGE_W, 160)
      doc.setFillColor(...hexToRgb(OLIVE_DARK))
      doc.rect(0, 150, PAGE_W, PAGE_H - 150, "F")
    } catch (err) {
      console.error("[Itinerary PDF] cover crop failed, using plain cover:", err.message)
      heroImg = null
    }
  }
  if (logo) {
    const w = 22 * logo.ratio
    doc.addImage(logo.dataUrl, logo.format, (PAGE_W - w) / 2, heroImg ? 168 : 40, w, 22)
  }
  doc.setFont("times", "bold")
  doc.setFontSize(15)
  doc.setTextColor(255, 255, 255)
  doc.text(BRAND.name, PAGE_W / 2, (heroImg ? 168 : 40) + 32, { align: "center" })
  doc.setFont("times", "italic")
  doc.setFontSize(10)
  doc.setTextColor(...GOLD_ON_DARK_RGB)
  doc.text(BRAND.tagline, PAGE_W / 2, (heroImg ? 168 : 40) + 38, { align: "center" })

  doc.setFont("times", "bold")
  doc.setFontSize(28)
  doc.setTextColor(255, 255, 255)
  const titleLines = doc.splitTextToSize(itinerary.title || "Swahili Tent Itinerary", PAGE_W - MARGIN * 2 - 20)
  doc.text(titleLines, PAGE_W / 2, (heroImg ? 168 : 40) + 60, { align: "center" })
  if (itinerary.subtitle) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    doc.setTextColor(220, 214, 195)
    const subtitleY = (heroImg ? 168 : 40) + 60 + titleLines.length * 11
    const subtitleLines = doc.splitTextToSize(itinerary.subtitle, PAGE_W - MARGIN * 2 - 20)
    doc.text(subtitleLines, PAGE_W / 2, subtitleY, { align: "center" })
  }

  const coverBoxY = PAGE_H - 62
  doc.setDrawColor(...hexToRgb(GOLD))
  doc.setLineWidth(0.5)
  doc.line(PAGE_W / 2 - 20, coverBoxY, PAGE_W / 2 + 20, coverBoxY)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(200, 194, 175)
  doc.text("PREPARED EXCLUSIVELY FOR", PAGE_W / 2, coverBoxY + 9, { align: "center" })
  doc.setFont("times", "bold")
  doc.setFontSize(17)
  doc.setTextColor(255, 255, 255)
  doc.text(itinerary.guest_name || "Our Guest", PAGE_W / 2, coverBoxY + 19, { align: "center" })
  // Trip-type/occasion line (e.g. "Honeymoon") -- occasion is the admin's own
  // free-text field ("50th Birthday", "Anniversary"); guest_type is the
  // structured fallback when no occasion was entered, capitalized for display.
  const occasionLabel = itinerary.occasion || (itinerary.guest_type && itinerary.guest_type !== "custom"
    ? itinerary.guest_type[0].toUpperCase() + itinerary.guest_type.slice(1) : "")
  let dateLineY = coverBoxY + 27
  if (occasionLabel) {
    doc.setFont("times", "italic")
    doc.setFontSize(10.5)
    doc.setTextColor(...GOLD_ON_DARK_RGB)
    doc.text(occasionLabel, PAGE_W / 2, coverBoxY + 25, { align: "center" })
    dateLineY = coverBoxY + 33
  }
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9.5)
  doc.setTextColor(210, 204, 187)
  const dateRange = [formatDateLong(itinerary.check_in), formatDateLong(itinerary.check_out)].filter(Boolean).join("  –  ")
  const coverLine2 = [dateRange, nights ? `${nights} night${nights === 1 ? "" : "s"}` : null, guestCount || null].filter(Boolean).join("   ·   ")
  if (coverLine2) doc.text(coverLine2, PAGE_W / 2, dateLineY, { align: "center" })

  // ── WELCOME ────────────────────────────────────────────────
  let y = newPage(doc, "Welcome", "2")
  y = sectionHeading(doc, `Dear ${itinerary.guest_name || "Guest"},`, y + 6)
  y = paragraph(doc, gc.welcomeText, MARGIN, y + 4, PAGE_W - MARGIN * 2, { size: 11.5 })

  // ── AT A GLANCE ────────────────────────────────────────────
  y = newPage(doc, "Your Experience at a Glance", "3")
  y = sectionHeading(doc, "At a Glance", y)
  const glanceRows = [
    ["Dates", dateRange || "—"],
    ["Duration", nights ? `${nights} night${nights === 1 ? "" : "s"}` : "—"],
    ["Guests", guestCount || "—"],
    ["Accommodation", gc.stay?.tentName || "—"],
    ["Trip Type", itinerary.guest_type ? itinerary.guest_type[0].toUpperCase() + itinerary.guest_type.slice(1) : "—"],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: glanceRows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10.5, textColor: hexToRgb(TEXT_DARK), cellPadding: { top: 3, bottom: 3, left: 0, right: 4 } },
    columnStyles: { 0: { fontStyle: "bold", textColor: hexToRgb(TEXT_FAINT), cellWidth: 42 } },
  })
  y = doc.lastAutoTable.finalY + 8
  const keyExperiences = gc.atAGlance?.keyExperiences || []
  if (keyExperiences.length) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(...hexToRgb(TEXT_FAINT))
    doc.text("KEY EXPERIENCES", MARGIN, y)
    y += 6
    keyExperiences.forEach((exp) => {
      doc.setFillColor(...hexToRgb(GOLD))
      doc.circle(MARGIN + 1.2, y - 1.2, 1, "F")
      doc.setFont("helvetica", "normal")
      doc.setFontSize(10.5)
      doc.setTextColor(...hexToRgb(TEXT_DARK))
      doc.text(exp, MARGIN + 6, y)
      y += 7
    })
  }
  if (gc.routeEnabled !== false && gc.routeStops?.length) {
    y += 4
    y = drawRouteMap(doc, gc.routeStops, y, "Your Experience at a Glance", "3")
  }

  // ── YOUR STAY ──────────────────────────────────────────────
  if (gc.stay?.tentName) {
    y = newPage(doc, "Your Stay", "4")
    y = sectionHeading(doc, gc.stay.tentName, y)
    const stayImg = await safeImage(gc.stay.heroImageUrl)
    const imgW = 78
    drawPhoto(doc, stayImg, MARGIN, y, imgW, 58, gc.stay.tentName)
    const textX = MARGIN + imgW + 8
    const textW = PAGE_W - MARGIN - textX
    let ty = paragraph(doc, gc.stay.description, textX, y + 5, textW, { size: 10 })
    if (gc.stay.amenities?.length) {
      ty += 3
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(...hexToRgb(TEXT_FAINT))
      doc.text("AMENITIES", textX, ty)
      ty += 5.5
      doc.setFont("helvetica", "normal")
      doc.setFontSize(9.5)
      doc.setTextColor(...hexToRgb(TEXT_DARK))
      const amenText = doc.splitTextToSize(gc.stay.amenities.join("   ·   "), textW)
      doc.text(amenText, textX, ty)
    }
  }

  // ── DAY-BY-DAY ITINERARY ───────────────────────────────────
  const days = gc.days || []
  if (days.length) {
    y = newPage(doc, "Your Itinerary", "5")
    y = sectionHeading(doc, "Your Itinerary", y)
    for (let di = 0; di < days.length; di++) {
      const day = days[di]
      y = ensureSpace(doc, y, 26, "Your Itinerary", "5")
      doc.setFillColor(...hexToRgb(OLIVE))
      doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 10, 1.5, 1.5, "F")
      doc.setFont("times", "bold")
      doc.setFontSize(11)
      doc.setTextColor(255, 255, 255)
      const dayLabel = `DAY ${di + 1}${day.label ? " — " + day.label.toUpperCase() : ""}`
      doc.text(dayLabel, MARGIN + 5, y + 6.8)
      if (day.date) {
        doc.setFont("helvetica", "normal")
        doc.setFontSize(8.5)
        doc.text(formatDateLong(day.date), PAGE_W - MARGIN - 5, y + 6.8, { align: "right" })
      }
      y += 15
      if (day.description) {
        y = ensureSpace(doc, y, 12, "Your Itinerary", "5")
        y = paragraph(doc, day.description, MARGIN, y, PAGE_W - MARGIN * 2, { size: 9.5, italic: true, color: TEXT_SUB })
        y += 2
      }
      const activities = day.activities || []
      for (const act of activities) {
        const actType = act.type || "activity"
        // Type badge + Included badge, e.g. "EXCURSION   ·   INCLUDED" --
        // gives the guest an at-a-glance sense of what kind of item this is
        // and whether it's already covered, without cluttering the title
        // line itself.
        const badgeParts = []
        if (PDF_TYPE_LABELS[actType]) badgeParts.push(PDF_TYPE_LABELS[actType].toUpperCase())
        if (act.included) badgeParts.push("INCLUDED")
        const badgeText = badgeParts.join("   ·   ")
        // Type-specific detail line(s) -- only the fields relevant to this
        // item's type are ever shown, mirroring the editor's own progressive
        // disclosure (ActivityEditor in App.jsx).
        const detailParts = []
        if (act.locationText && (actType === "excursion" || actType === "transport")) {
          detailParts.push(`${actType === "transport" ? "Pickup" : "Meeting point"}: ${act.locationText}`)
        }
        if (act.transportInfo && actType === "transport") detailParts.push(act.transportInfo)
        if (act.mealNote && (actType === "meal" || actType === "excursion")) detailParts.push(`Meals: ${act.mealNote}`)
        if (act.dietaryNote && actType === "meal") detailParts.push(`Dietary note: ${act.dietaryNote}`)
        const detailWrapped = detailParts.length ? doc.splitTextToSize(detailParts.join("   ·   "), PAGE_W - MARGIN * 2 - 28) : []
        const descLines = act.description ? doc.splitTextToSize(act.description, PAGE_W - MARGIN * 2 - 28) : []
        // Each activity's own photo (attached via the editor's MediaSlot) --
        // resolved up front so its height is known before ensureSpace() runs,
        // same page-break discipline as everything else in this file. A
        // missing/failed photo (safeImage returns null) simply omits the
        // thumbnail rather than leaving a gap or breaking the block.
        const actImg = act.imageUrl ? await safeImage(act.imageUrl) : null
        const thumbW = 34, thumbH = 23
        const badgeH = badgeText ? 5 : 0
        const blockH = badgeH + 8 + descLines.length * 4.6 + detailWrapped.length * 4.2 + (actImg ? thumbH + 4 : 0) + 4
        y = ensureSpace(doc, y, blockH, "Your Itinerary", "5")
        if (badgeText) {
          doc.setFont("helvetica", "bold")
          doc.setFontSize(7.5)
          doc.setTextColor(...hexToRgb(OLIVE))
          doc.text(badgeText, MARGIN + 20, y + 2.5)
          y += badgeH
        }
        doc.setFont("helvetica", "bold")
        doc.setFontSize(9.5)
        doc.setTextColor(...hexToRgb(GOLD))
        const timeLabel = [act.time, act.duration ? `(${act.duration})` : null].filter(Boolean).join(" ") || "•"
        doc.text(timeLabel, MARGIN, y + 3.5, { maxWidth: 22 })
        doc.setFont("helvetica", "bold")
        doc.setFontSize(10.5)
        doc.setTextColor(...hexToRgb(TEXT_DARK))
        doc.text(act.title || "", MARGIN + 20, y + 3.5, { maxWidth: PAGE_W - MARGIN * 2 - 20 })
        let ay = y + 8
        if (descLines.length) {
          doc.setFont("helvetica", "normal")
          doc.setFontSize(9.5)
          doc.setTextColor(...hexToRgb(TEXT_SUB))
          doc.text(descLines, MARGIN + 20, ay)
          ay += descLines.length * 4.6
        }
        if (detailWrapped.length) {
          doc.setFont("helvetica", "italic")
          doc.setFontSize(8.8)
          doc.setTextColor(...hexToRgb(TEXT_FAINT))
          doc.text(detailWrapped, MARGIN + 20, ay)
          ay += detailWrapped.length * 4.2
        }
        if (actImg) {
          drawPhoto(doc, actImg, MARGIN + 20, ay, thumbW, thumbH, "")
          ay += thumbH + 4
        }
        y = ay + 4
      }
      // Day-level photo gallery -- a small strip of thumbnails, distinct
      // from each activity's own single photo. Missing/failed photos are
      // simply skipped (see safeImage), never a hard failure.
      const dayPhotoUrls = (day.photoUrls || []).slice(0, 4)
      if (dayPhotoUrls.length) {
        const thumbW = 40, thumbH = 30, gap = 4
        y = ensureSpace(doc, y, thumbH + 4, "Your Itinerary", "5")
        for (let pi = 0; pi < dayPhotoUrls.length; pi++) {
          const img = await safeImage(dayPhotoUrls[pi])
          drawPhoto(doc, img, MARGIN + pi * (thumbW + gap), y, thumbW, thumbH, "")
        }
        y += thumbH + 4
      }
      y += 4
    }
  }

  // ── SPECIAL TOUCHES SUMMARY ──────────────────────────────────
  // Collects every day-item of type "special_touch" into one dedicated
  // spread, in addition to appearing inline on its own day above -- gives
  // the personal/concierge touches (honeymoon surprise, birthday decoration,
  // etc.) the standalone moment the brief asked for, without inventing any
  // content not already entered against a specific day.
  const specialTouches = []
  days.forEach((day, di) => {
    ;(day.activities || []).forEach((act) => {
      if ((act.type || "activity") === "special_touch") specialTouches.push({ ...act, dayNumber: di + 1, dayLabel: day.label })
    })
  })
  if (specialTouches.length) {
    y = newPage(doc, "Special Touches", "")
    y = sectionHeading(doc, "Special Touches for You", y)
    y = paragraph(doc, "A few personal details we've arranged especially for this visit.", MARGIN, y, PAGE_W - MARGIN * 2, { size: 9.5, italic: true, color: TEXT_FAINT })
    y += 3
    for (const touch of specialTouches) {
      const descLines = touch.description ? doc.splitTextToSize(touch.description, PAGE_W - MARGIN * 2 - 4) : []
      const blockH = 12 + descLines.length * 4.6 + 6
      y = ensureSpace(doc, y, blockH, "Special Touches", "")
      doc.setFont("times", "bold")
      doc.setFontSize(11.5)
      doc.setTextColor(...hexToRgb(OLIVE_DARK))
      doc.text(touch.title || "", MARGIN, y + 4)
      const dayRef = `Day ${touch.dayNumber}${touch.dayLabel ? " — " + touch.dayLabel : ""}`
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8.5)
      doc.setTextColor(...hexToRgb(TEXT_FAINT))
      doc.text(touch.complimentary === false ? `${dayRef}   ·   Paid add-on` : `${dayRef}   ·   Complimentary`, PAGE_W - MARGIN, y + 4, { align: "right" })
      y += 8
      if (descLines.length) {
        doc.setFont("helvetica", "normal")
        doc.setFontSize(9.5)
        doc.setTextColor(...hexToRgb(TEXT_SUB))
        doc.text(descLines, MARGIN, y)
        y += descLines.length * 4.6
      }
      y += 6
      doc.setDrawColor(...hexToRgb(BORDER))
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3)
    }
  }

  // ── EXPERIENCE PAGES (major excursions/activities) ─────────
  const experiences = gc.experiences || []
  for (const exp of experiences) {
    y = newPage(doc, exp.title || "Your Experience", "")
    const expImg = await safeImage(exp.imageUrl)
    drawPhoto(doc, expImg, MARGIN, y, PAGE_W - MARGIN * 2, 70, exp.title)
    y += 78
    y = sectionHeading(doc, exp.title || "", y)
    y = paragraph(doc, exp.description, MARGIN, y, PAGE_W - MARGIN * 2, { size: 10.5 })
    if (exp.duration) { y += 2; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...hexToRgb(TEXT_FAINT)); doc.text(`DURATION: ${exp.duration}`, MARGIN, y); y += 7 }
    if (exp.included) { y = paragraph(doc, `What's included: ${exp.included}`, MARGIN, y, PAGE_W - MARGIN * 2, { size: 9.5, color: TEXT_SUB }) }
    if (exp.whatToBring) { y = paragraph(doc, `What to bring: ${exp.whatToBring}`, MARGIN, y, PAGE_W - MARGIN * 2, { size: 9.5, color: TEXT_SUB }) }
    if (exp.notes) { y = paragraph(doc, exp.notes, MARGIN, y, PAGE_W - MARGIN * 2, { size: 9, italic: true, color: TEXT_FAINT }) }
  }

  // ── LIFE AT SWAHILI TENT VILLAGE (internal field name `stvExperience`
  //    is unchanged -- only the guest-facing heading text below changes) ──
  const stvItems = gc.stvExperience?.items || []
  if (stvItems.length) {
    y = newPage(doc, "Life at Swahili Tent Village", "")
    y = sectionHeading(doc, "Life at Swahili Tent Village", y)
    const colW = (PAGE_W - MARGIN * 2 - 10) / 2
    let col = 0
    let rowTopY = y
    let maxRowH = 0
    for (const item of stvItems) {
      const x = MARGIN + col * (colW + 10)
      y = ensureSpace(doc, rowTopY, 48, "Life at Swahili Tent Village", "")
      if (y !== rowTopY) { rowTopY = y; col = 0 }
      const itemImg = await safeImage(item.imageUrl)
      drawPhoto(doc, itemImg, x, rowTopY, colW, 30, item.title)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(10)
      doc.setTextColor(...hexToRgb(TEXT_DARK))
      doc.text(item.title || "", x, rowTopY + 36)
      const descY = paragraph(doc, item.description, x, rowTopY + 41, colW, { size: 8.8 })
      maxRowH = Math.max(maxRowH, descY - rowTopY)
      col++
      if (col > 1) { col = 0; rowTopY += maxRowH + 6; maxRowH = 0 }
    }
    y = rowTopY + (col > 0 ? maxRowH + 6 : 0)
  }

  // ── WHAT'S INCLUDED / WHAT TO BRING ────────────────────────
  if (gc.included?.length || gc.whatToBring?.length) {
    y = newPage(doc, "Good to Know", "")
    if (gc.included?.length) {
      y = sectionHeading(doc, "What's Included", y)
      gc.included.forEach((line) => {
        y = ensureSpace(doc, y, 8, "Good to Know", "")
        doc.setFillColor(...hexToRgb(GOLD))
        doc.circle(MARGIN + 1.2, y - 1.2, 1, "F")
        doc.setFont("helvetica", "normal")
        doc.setFontSize(10)
        doc.setTextColor(...hexToRgb(TEXT_DARK))
        doc.text(line, MARGIN + 6, y, { maxWidth: PAGE_W - MARGIN * 2 - 6 })
        y += 7
      })
      y += 6
    }
    if (gc.whatToBring?.length) {
      y = ensureSpace(doc, y, 20, "Good to Know", "")
      y = sectionHeading(doc, "What to Bring", y)
      gc.whatToBring.forEach((line) => {
        y = ensureSpace(doc, y, 8, "Good to Know", "")
        doc.setFillColor(...hexToRgb(OLIVE))
        doc.circle(MARGIN + 1.2, y - 1.2, 1, "F")
        doc.setFont("helvetica", "normal")
        doc.setFontSize(10)
        doc.setTextColor(...hexToRgb(TEXT_DARK))
        doc.text(line, MARGIN + 6, y, { maxWidth: PAGE_W - MARGIN * 2 - 6 })
        y += 7
      })
    }
  }

  // ── GUEST REQUESTS (opt-in) ──────────────────────────────────
  // Only rendered when the admin has explicitly turned this on for this
  // itinerary (guestRequestsVisible) -- staffNotes, the always-internal
  // counterpart, never reaches this function at all (stripped upstream by
  // stripInternalFields() before guestContent is built).
  if (gc.guestRequestsVisible && gc.guestRequests) {
    y = newPage(doc, "Your Requests", "")
    y = sectionHeading(doc, "Your Requests", y)
    y = paragraph(doc, gc.guestRequests, MARGIN, y, PAGE_W - MARGIN * 2, { size: 10.5 })
  }

  // ── PACKAGE INVESTMENT (never invoice-style Subtotal/Tax/Balance) ──
  const pricing = gc.pricing
  if (pricing && (pricing.currentPrice != null || pricing.note)) {
    y = newPage(doc, pricing.label || "Package Investment", "")
    y = sectionHeading(doc, pricing.label || "Package Investment", y)
    const cardW = PAGE_W - MARGIN * 2
    const cardH = 46
    doc.setFillColor(...hexToRgb(CREAM_DARK))
    doc.roundedRect(MARGIN, y, cardW, cardH, 2, 2, "F")
    doc.setDrawColor(...hexToRgb(GOLD))
    doc.roundedRect(MARGIN, y, cardW, cardH, 2, 2, "S")
    if (pricing.referencePrice != null && pricing.currentPrice != null && Number(pricing.referencePrice) > Number(pricing.currentPrice)) {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(11)
      doc.setTextColor(...hexToRgb(TEXT_FAINT))
      const refText = `${pricing.currency || "TZS"} ${money(pricing.referencePrice)}`
      const refW = doc.getTextWidth(refText)
      doc.text(refText, MARGIN + 12, y + 20)
      doc.setDrawColor(...hexToRgb(TEXT_FAINT))
      doc.setLineWidth(0.4)
      doc.line(MARGIN + 12, y + 17.5, MARGIN + 12 + refW, y + 17.5)
    }
    if (pricing.currentPrice != null) {
      doc.setFont("times", "bold")
      doc.setFontSize(22)
      doc.setTextColor(...hexToRgb(OLIVE_DARK))
      doc.text(`${pricing.currency || "TZS"} ${money(pricing.currentPrice)}`, MARGIN + 12, y + 33)
    }
    if (pricing.note) {
      y = paragraph(doc, pricing.note, MARGIN, y + cardH + 8, cardW, { size: 9, italic: true, color: TEXT_FAINT })
    } else {
      y = y + cardH + 8
    }
  }

  // ── TERMS ───────────────────────────────────────────────────
  if (gc.terms) {
    y = newPage(doc, "Important Information", "")
    y = sectionHeading(doc, "Important Information", y)
    y = paragraph(doc, gc.terms, MARGIN, y, PAGE_W - MARGIN * 2, { size: 9.5, color: TEXT_SUB })
  }

  // ── FINAL / CLOSING ──────────────────────────────────────────
  doc.addPage()
  doc.setFillColor(...hexToRgb(OLIVE_DARK))
  doc.rect(0, 0, PAGE_W, PAGE_H, "F")
  if (logo) {
    const w = 20 * logo.ratio
    doc.addImage(logo.dataUrl, logo.format, (PAGE_W - w) / 2, 90, w, 20)
  }
  doc.setFont("times", "bolditalic")
  doc.setFontSize(24)
  doc.setTextColor(...GOLD_ON_DARK_RGB)
  doc.text(gc.closing?.headline || "Karibu Zanzibar", PAGE_W / 2, 125, { align: "center" })
  if (gc.closing?.message) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10.5)
    doc.setTextColor(230, 226, 212)
    const lines = doc.splitTextToSize(gc.closing.message, PAGE_W - MARGIN * 2 - 20)
    doc.text(lines, PAGE_W / 2, 138, { align: "center" })
  }
  doc.setFont("times", "bold")
  doc.setFontSize(13)
  doc.setTextColor(255, 255, 255)
  doc.text(BRAND.name, PAGE_W / 2, PAGE_H - 60, { align: "center" })
  doc.setFont("helvetica", "italic")
  doc.setFontSize(9)
  doc.setTextColor(...GOLD_ON_DARK_RGB)
  doc.text(`"${BRAND.tagline}"`, PAGE_W / 2, PAGE_H - 53, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(210, 204, 187)
  doc.text(BRAND.addressLine, PAGE_W / 2, PAGE_H - 40, { align: "center" })
  doc.text(`${BRAND.phone}   ${BRAND.email}`, PAGE_W / 2, PAGE_H - 34, { align: "center" })
  doc.text(BRAND.website, PAGE_W / 2, PAGE_H - 28, { align: "center" })

  return doc
}

function safeFileNamePart(s) {
  return String(s || "itinerary").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "itinerary"
}

export async function getItineraryPdfBlobUrl(itinerary, guestContent, resolveImage) {
  const doc = await buildItineraryPdf(itinerary, guestContent, resolveImage)
  return { url: doc.output("bloburl"), doc }
}

export async function downloadItineraryPdf(itinerary, guestContent, resolveImage) {
  const doc = await buildItineraryPdf(itinerary, guestContent, resolveImage)
  doc.save(`${safeFileNamePart(itinerary.guest_name)}-itinerary.pdf`)
}

export async function getItineraryPdfBlob(itinerary, guestContent, resolveImage) {
  const doc = await buildItineraryPdf(itinerary, guestContent, resolveImage)
  return doc.output("blob")
}
