import { useEffect, useMemo, useRef, useState } from "react"
import { FONT, RADIUS, SPACE, C, SHADOW, iS, seS, lS, fTi, sB, tS, pT, panelS } from "./ui/theme"
import {
  DEPARTMENTS, CHECKLIST_DEPARTMENTS, DOC_TYPES, DEPARTMENT_DOC_TYPES, STATUS_LABELS,
  RESTOCK_TEMPLATE, KITCHEN_EQUIPMENT_TEMPLATE, DINING_EQUIPMENT_TEMPLATE, CHECKLIST_TEMPLATE, CONDITIONS,
  SAFETY_STATUSES, SAFETY_CHECK_ITEMS, CHECK_RESULTS, DEFAULT_GOKART_LOCATION,
  normalizeKartId, isValidKartId, unregisteredKarts,
  summarizeRestock, summarizeEquipment, summarizeChecklist, summarizeSafety, effectiveSummary,
  DOCUMENT_PAGE_SIZE, pageCount, getLatestDocument,
  newClientRequestId, createDocument, listDocuments, getDocument, getDocumentEvents, reviewDocument,
  fetchInventoryItemsForRestock, fetchKarts, fetchKartHistory, registerKart, verifyKartStatus,
  uploadEvidence, getEvidenceUrl,
} from "./lib/opsDocuments"
import { getOpsDocumentPdfBlobUrl, opsDocumentFilename } from "./lib/opsDocumentPdf"
import { localDateStr, downloadBlob } from "./lib/salesReporting"

/**
 * Operations Documents centre.
 *
 * Generates, stores and reprints the operational documents defined by the
 * four supplied Swahili Tent Village source PDFs, grouped under the POS
 * department they belong to. Every document is persisted in Supabase
 * (operational_documents) -- nothing here is kept only in the browser.
 *
 * Access: rendered for every signed-in POS member. What a member can see and
 * do is decided by RLS + triggers in the database; `isOwner` here only
 * decides which buttons to show.
 */

// ── Small shared UI ───────────────────────────────────────────────────
const ghostBtn = { background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"8px 14px", fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT, color:C.text }
const primaryBtn = { background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }
const dangerBtn = { ...primaryBtn, background:C.warnStrong }
const cellInput = { padding:"7px 8px", border:`1px solid ${C.border}`, borderRadius:6, fontSize:12.5, fontFamily:FONT, background:C.surface, color:C.text, width:"100%" }
const thS = { textAlign:"left", padding:"0 8px 8px 0", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5, whiteSpace:"nowrap" }

const STATUS_STYLE = {
  PENDING:   { color:"#8A6416", bg:"#FBF0D9" },
  APPROVED:  { color:C.accentStrong, bg:C.accentSoft },
  REJECTED:  { color:C.warnStrong, bg:C.warnSoft },
  FULFILLED: { color:"#2F5B7A", bg:"#E6F0F7" },
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.PENDING
  return <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:RADIUS.pill, fontSize:11, fontWeight:700, color:s.color, background:s.bg, border:`1px solid ${s.color}33`, whiteSpace:"nowrap" }}>{STATUS_LABELS[status] || status}</span>
}

function SafetyPill({ status, large }) {
  const s = SAFETY_STATUSES[status]
  if (!s) return null
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding: large ? "5px 12px" : "3px 10px", borderRadius:RADIUS.pill, fontSize: large ? 12.5 : 11, fontWeight:700, color:s.color, background:s.bg, border:`1px solid ${s.color}55`, whiteSpace:"nowrap" }}>
      <span aria-hidden="true">{s.emoji}</span>{s.label}
    </span>
  )
}

function Modal({ title, onClose, children, width = 720, labelId }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:12 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={labelId}
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(16px,4vw,26px)", width:`min(96vw, ${width}px)`, maxHeight:"92vh", overflowY:"auto", boxShadow:SHADOW.modal }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:14 }}>
          <h2 id={labelId} style={{ margin:0, fontFamily:FONT, fontWeight:700, fontSize:16.5, color:C.text }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.textSub, lineHeight:1, padding:2 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, htmlFor, children, style }) {
  return (
    <div style={{ minWidth:0, ...style }}>
      <label style={lS} htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

function StatGrid({ stats }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:10 }}>
      {stats.map(s => (
        <div key={s.label} style={{ background: s.bg || C.bg, border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 12px" }}>
          <div style={{ fontSize:10.5, fontWeight:600, color:C.textSub, textTransform:"uppercase", letterSpacing:.4 }}>{s.label}</div>
          <div style={{ fontSize:20, fontWeight:800, color: s.color || C.text, marginTop:2 }}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

/** Print a PDF blob URL via a hidden iframe; falls back to a new tab (iOS/Android). */
function printPdfUrl(url) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (isMobile) { window.open(url, "_blank", "noopener"); return }
  const iframe = document.createElement("iframe")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;"
  iframe.src = url
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print() }
    catch { window.open(url, "_blank", "noopener") }
    setTimeout(() => iframe.remove(), 60000)
  }
  document.body.appendChild(iframe)
}

const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—")
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : "—")
const nonNegOrEmpty = (v) => v === "" || (!isNaN(Number(v)) && Number(v) >= 0)
const cleanNum = (v) => (v === "" || v == null ? null : Number(v))

// ── PDF actions ──────────────────────────────────────────────────────
function usePdfActions(showToast) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  async function build(d) {
    setBusy(true)
    try { return await getOpsDocumentPdfBlobUrl(d) }
    catch (e) { showToast(e.message || "Could not generate the PDF.", "error"); return null }
    finally { setBusy(false) }
  }
  return {
    busy, preview,
    closePreview: () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) },
    view: async (d) => { const r = await build(d); if (r) setPreview({ url: r.url, blob: r.blob, doc: d }) },
    download: async (d) => { const r = await build(d); if (r) { downloadBlob(r.blob, opsDocumentFilename(d)); URL.revokeObjectURL(r.url) } },
    print: async (d) => { const r = await build(d); if (r) printPdfUrl(r.url) },
  }
}

function PdfPreviewModal({ preview, onClose }) {
  if (!preview) return null
  return (
    <Modal title={`${preview.doc.reference_number} — PDF preview`} onClose={onClose} width={900} labelId="ops-pdf-title">
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        <button type="button" style={primaryBtn} onClick={() => downloadBlob(preview.blob, opsDocumentFilename(preview.doc))}>↓ Download PDF</button>
        <button type="button" style={ghostBtn} onClick={() => printPdfUrl(preview.url)}>🖨 Print</button>
        <a href={preview.url} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, textDecoration:"none" }}>Open in new tab</a>
      </div>
      <iframe title="PDF preview" src={preview.url} style={{ width:"100%", height:"70vh", border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, background:"#fff" }} />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════
const TABS = [
  { id: DEPARTMENTS.inventory, icon: "📦" },
  { id: DEPARTMENTS.kitchen, icon: "🍽️" },
  { id: DEPARTMENTS.maintenance, icon: "🔧" },
  { id: "history", label: "Document History", icon: "🗂️" },
]

export default function OperationsDocumentsPage({ user, isOwner, displayName, showToast, initialTab }) {
  const [tab, setTab] = useState(initialTab || DEPARTMENTS.inventory)
  const [form, setForm] = useState(null) // { type, seed }
  const [viewId, setViewId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { if (initialTab) { setTab(initialTab); setForm(null) } }, [initialTab])

  const onSaved = (doc, duplicate) => {
    setForm(null)
    setRefreshKey(k => k + 1)
    showToast(duplicate ? `Already saved as ${doc.reference_number} (duplicate submission ignored).` : `Saved ${doc.reference_number}.`)
    setViewId(doc.id)
  }

  const tabBtn = (active) => ({
    padding:"9px 14px", borderRadius:RADIUS.sm, border:`1.5px solid ${active ? C.accentStrong : C.border}`,
    background: active ? C.accentStrong : C.surface, color: active ? "#fff" : C.textSub,
    fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT, whiteSpace:"nowrap",
  })

  return (
    <div>
      <h1 style={pT}>Operations Documents</h1>
      <p style={{ margin:"0 0 18px", color:C.textSub, fontSize:13 }}>
        Generate, approve and reprint official Swahili Tent Village operational documents. Every document is saved with its own reference number and history.
      </p>

      <div role="tablist" style={{ display:"flex", gap:8, marginBottom:SPACE.lg, overflowX:"auto", paddingBottom:4 }}>
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); setForm(null) }} style={tabBtn(tab === t.id)}>
            {t.icon} {t.label || t.id}
          </button>
        ))}
      </div>

      {form ? (
        <DocumentForm
          type={form.type} seed={form.seed} user={user} isOwner={isOwner} displayName={displayName}
          showToast={showToast} onCancel={() => setForm(null)} onSaved={onSaved}
        />
      ) : tab === "history" ? (
        <DocumentHistory key={`h-${refreshKey}`} showToast={showToast} onView={setViewId} showDepartment />
      ) : (
        <DepartmentPanel
          key={`${tab}-${refreshKey}`} department={tab} isOwner={isOwner} user={user} showToast={showToast}
          onNew={(type) => setForm({ type })} onView={setViewId}
        />
      )}

      {viewId && (
        <DocumentViewer
          id={viewId} isOwner={isOwner} showToast={showToast}
          onClose={() => setViewId(null)}
          onChanged={() => setRefreshKey(k => k + 1)}
          onReuse={(d) => { setViewId(null); setForm({ type: d.doc_type, seed: d }) }}
        />
      )}
    </div>
  )
}

function DepartmentPanel({ department, isOwner, user, showToast, onNew, onView }) {
  const types = DEPARTMENT_DOC_TYPES[department] || []
  return (
    <div>
      {department === DEPARTMENTS.maintenance && <FleetStatusPanel isOwner={isOwner} showToast={showToast} onViewDoc={onView} />}

      <div style={{ ...panelS, marginBottom:16 }}>
        <h2 style={fTi}>Generate a new document</h2>
        <div style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))" }}>
          {types.map(type => {
            const meta = DOC_TYPES[type]
            const locked = meta.adminOnly && !isOwner
            return (
              <button key={type} type="button" disabled={locked} onClick={() => onNew(type)}
                className="stv-card stv-card-hover stv-btn"
                title={locked ? "Only management (Owner/Admin) can create this document" : undefined}
                style={{ textAlign:"left", background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:"16px 18px", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.55 : 1, fontFamily:FONT, display:"flex", flexDirection:"column", gap:6 }}>
                <span style={{ fontSize:22 }} aria-hidden="true">{meta.icon}</span>
                <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{meta.label}</span>
                <span style={{ fontSize:11.5, color:C.textFaint }}>{locked ? "Management only" : "+ New document"}</span>
              </button>
            )
          })}
        </div>
      </div>

      <DocumentHistory docTypes={types} showToast={showToast} onView={onView} title={`${department} — saved documents`} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════════════════
function DocumentHistory({ docTypes, department, showDepartment, showToast, onView, title = "Document history" }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [f, setF] = useState({ search:"", type:"All", status:"All", department:"All", from:"", to:"" })
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const pdf = usePdfActions(showToast)

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(f.search), 300); return () => clearTimeout(t) }, [f.search])

  const typeOptions = docTypes || Object.keys(DOC_TYPES)
  const filterKey = [f.type, f.status, f.department, f.from, f.to, debouncedSearch, department, docTypes?.join(",")].join("|")

  // Any filter change goes back to the first page.
  useEffect(() => { setPage(0) }, [filterKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listDocuments({
      docTypes: f.type !== "All" ? [f.type] : docTypes,
      department: department || f.department,
      status: f.status, from: f.from, to: f.to, search: debouncedSearch,
      page, pageSize: DOCUMENT_PAGE_SIZE,
    })
      .then(r => { if (!cancelled) { setRows(r.rows); setTotal(r.total); setError("") } })
      .catch(e => { if (!cancelled) setError(e.message || "Could not load documents.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filterKey, page])

  const pages = pageCount(total, DOCUMENT_PAGE_SIZE)

  const allDepartments = useMemo(() => Array.from(new Set([...Object.values(DEPARTMENTS), ...CHECKLIST_DEPARTMENTS])), [])

  return (
    <div style={panelS}>
      <h2 style={{ ...fTi, marginBottom:12 }}>{title}</h2>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
        <input aria-label="Search by reference number or title" placeholder="Search reference no. (e.g. STV-RR-2026-0001)" value={f.search}
          onChange={e => setF(s => ({ ...s, search:e.target.value }))} style={{ ...seS, flex:"1 1 220px", minWidth:0 }} />
        {typeOptions.length > 1 && (
          <select aria-label="Filter by document type" value={f.type} onChange={e => setF(s => ({ ...s, type:e.target.value }))} style={seS}>
            <option value="All">All types</option>
            {typeOptions.map(t => <option key={t} value={t}>{DOC_TYPES[t].short}</option>)}
          </select>
        )}
        {showDepartment && (
          <select aria-label="Filter by department" value={f.department} onChange={e => setF(s => ({ ...s, department:e.target.value }))} style={seS}>
            <option value="All">All departments</option>
            {allDepartments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select aria-label="Filter by status" value={f.status} onChange={e => setF(s => ({ ...s, status:e.target.value }))} style={seS}>
          <option value="All">All statuses</option>
          {Object.keys(STATUS_LABELS).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <input aria-label="From date" type="date" value={f.from} onChange={e => setF(s => ({ ...s, from:e.target.value }))} style={seS} />
        <input aria-label="To date" type="date" value={f.to} onChange={e => setF(s => ({ ...s, to:e.target.value }))} style={seS} />
        <button type="button" onClick={() => setF({ search:"", type:"All", status:"All", department:"All", from:"", to:"" })} style={{ ...seS, background:C.bg, border:"none", cursor:"pointer" }}>Reset</button>
      </div>

      {error && <p role="alert" style={{ color:C.warnStrong, fontSize:12.5, marginBottom:10 }}>{error}</p>}

      <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table className="stv-table" style={{ width:"100%", minWidth:760, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {["Reference", "Document", "Department", "Date", "Status", "Created by", ""].map(h => <th key={h} scope="col" style={thS}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ ...tS, color:C.textFaint, textAlign:"center" }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} style={{ ...tS, color:C.textFaint, textAlign:"center" }}>No documents found.</td></tr>}
            {!loading && rows.map(d => (
              <tr key={d.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                <td style={{ ...tS, fontWeight:700, whiteSpace:"nowrap" }}>{d.reference_number}</td>
                <td style={tS}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <span>{DOC_TYPES[d.doc_type]?.icon} {DOC_TYPES[d.doc_type]?.short}</span>
                    {d.kart_ids?.length > 0 && <span style={{ fontSize:11, color:C.textSub }}>· {d.kart_ids.join(", ")}</span>}
                    {d.safety_status && d.safety_status !== "OPERATIONAL" && <SafetyPill status={d.safety_status} />}
                  </div>
                </td>
                <td style={{ ...tS, color:C.textSub }}>{d.department}</td>
                <td style={{ ...tS, whiteSpace:"nowrap" }}>{fmtDate(d.document_date)}</td>
                <td style={tS}><StatusPill status={d.status} /></td>
                <td style={{ ...tS, color:C.textSub }}>{d.created_by_name || "—"}</td>
                <td style={tS}>
                  <div style={{ display:"flex", gap:6, flexWrap:"nowrap" }}>
                    <button type="button" onClick={() => onView(d.id)} style={{ ...ghostBtn, padding:"5px 10px", fontSize:11.5 }}>View</button>
                    <button type="button" disabled={pdf.busy} onClick={() => pdf.download(d)} aria-label={`Download PDF ${d.reference_number}`} title="Download PDF" style={{ ...ghostBtn, padding:"5px 9px", fontSize:11.5 }}>↓ PDF</button>
                    <button type="button" disabled={pdf.busy} onClick={() => pdf.print(d)} aria-label={`Print ${d.reference_number}`} title="Print" style={{ ...ghostBtn, padding:"5px 9px", fontSize:11.5 }}>🖨</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Document history pages" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginTop:12, fontSize:12.5, color:C.textSub }}>
        <span>
          {total === 0 ? "0 documents" : `Showing ${page * DOCUMENT_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * DOCUMENT_PAGE_SIZE)} of ${total}`}
        </span>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button type="button" disabled={loading || page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={{ ...ghostBtn, padding:"5px 11px", opacity: page === 0 ? 0.5 : 1 }}>← Previous</button>
          <span aria-live="polite">Page {Math.min(page + 1, pages)} of {pages}</span>
          <button type="button" disabled={loading || page + 1 >= pages} onClick={() => setPage(p => p + 1)} style={{ ...ghostBtn, padding:"5px 11px", opacity: page + 1 >= pages ? 0.5 : 1 }}>Next →</button>
        </div>
      </nav>
      <PdfPreviewModal preview={pdf.preview} onClose={pdf.closePreview} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// VIEWER (reopen / approve / reprint)
// ══════════════════════════════════════════════════════════════════════
function DocumentViewer({ id, isOwner, showToast, onClose, onChanged, onReuse }) {
  const [doc, setDoc] = useState(null)
  const [events, setEvents] = useState([])
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [acting, setActing] = useState(false)
  const pdf = usePdfActions(showToast)

  async function load() {
    try {
      const [d, ev] = await Promise.all([getDocument(id), getDocumentEvents(id)])
      setDoc(d); setEvents(ev); setError("")
    } catch (e) { setError(e.message || "Could not load the document.") }
  }
  useEffect(() => { load() }, [id])

  async function act(status) {
    const verb = { APPROVED:"approve", REJECTED:"reject", FULFILLED:"mark as fulfilled" }[status]
    if (status === "REJECTED" && !note.trim()) { showToast("Please add a note explaining the rejection.", "error"); return }
    if (!confirm(`Are you sure you want to ${verb} ${doc.reference_number}? This is recorded permanently.`)) return
    setActing(true)
    try {
      await reviewDocument(doc.id, status, note)
      setNote("")
      await load()
      onChanged?.()
      showToast(`${doc.reference_number} ${STATUS_LABELS[status].toLowerCase()}.`)
    } catch (e) { showToast(e.message || "Action failed.", "error") }
    finally { setActing(false) }
  }

  const meta = doc ? DOC_TYPES[doc.doc_type] : null
  const canReuse = doc && ["restock_request", "kitchen_equipment", "dining_equipment", "inventory_checklist"].includes(doc.doc_type) && (!meta.adminOnly || isOwner)

  return (
    <Modal title={doc ? `${meta?.icon} ${doc.reference_number}` : "Document"} onClose={onClose} width={900} labelId="ops-viewer-title">
      {error && <p role="alert" style={{ color:C.warnStrong, fontSize:13 }}>{error}</p>}
      {!doc && !error && <p style={{ color:C.textFaint, fontSize:13 }}>Loading…</p>}
      {doc && (
        <>
          <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:8, marginBottom:12 }}>
            <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{meta?.label}</span>
            <StatusPill status={doc.status} />
            {doc.safety_status && <SafetyPill status={doc.safety_status} />}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))", gap:10, fontSize:12.5, color:C.textSub, marginBottom:14 }}>
            <div><b style={{ color:C.text }}>Department:</b> {doc.department}</div>
            <div><b style={{ color:C.text }}>Document date:</b> {fmtDate(doc.document_date)}</div>
            <div><b style={{ color:C.text }}>Created by:</b> {doc.created_by_name || "—"}</div>
            <div><b style={{ color:C.text }}>Generated:</b> {fmtDateTime(doc.created_at)}</div>
            {doc.reviewed_by_name && <div><b style={{ color:C.text }}>{doc.status === "REJECTED" ? "Rejected" : "Approved"} by:</b> {doc.reviewed_by_name} ({fmtDate(doc.reviewed_at)})</div>}
            {doc.fulfilled_by_name && <div><b style={{ color:C.text }}>Fulfilled by:</b> {doc.fulfilled_by_name} ({fmtDate(doc.fulfilled_at)})</div>}
          </div>

          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
            <button type="button" disabled={pdf.busy} onClick={() => pdf.view(doc)} style={primaryBtn}>{pdf.busy ? "Generating…" : "📄 View PDF"}</button>
            <button type="button" disabled={pdf.busy} onClick={() => pdf.download(doc)} style={ghostBtn}>↓ Download PDF</button>
            <button type="button" disabled={pdf.busy} onClick={() => pdf.print(doc)} style={ghostBtn}>🖨 Print</button>
            {canReuse && <button type="button" onClick={() => onReuse(doc)} style={ghostBtn}>↻ Start a new document from this one</button>}
          </div>

          <DocumentContent doc={doc} />

          {doc.review_note && (
            <div style={{ marginTop:14, padding:"10px 12px", background:C.bg, borderRadius:RADIUS.sm, fontSize:12.5 }}>
              <b>Review note:</b> {doc.review_note}
            </div>
          )}

          {isOwner && (doc.status === "PENDING" || (doc.status === "APPROVED" && doc.doc_type === "restock_request")) && (
            <div style={{ marginTop:16, padding:14, border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, background:"#FCFCFA" }}>
              <div style={{ ...lS, marginBottom:8 }}>Management action</div>
              {doc.status === "PENDING" && (
                <>
                  <textarea aria-label="Review note" placeholder="Review note (required to reject, optional to approve)" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={2} style={{ ...iS, marginBottom:10, resize:"vertical" }} />
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <button type="button" disabled={acting} onClick={() => act("APPROVED")} style={primaryBtn}>✓ Approve</button>
                    <button type="button" disabled={acting} onClick={() => act("REJECTED")} style={dangerBtn}>✗ Reject</button>
                  </div>
                </>
              )}
              {doc.status === "APPROVED" && doc.doc_type === "restock_request" && (
                <>
                  <p style={{ fontSize:12, color:C.textSub, margin:"0 0 10px" }}>
                    Marking fulfilled does <b>not</b> change inventory. Record received items with <b>Inventory → Add Stock</b> so stock levels and movement history stay accurate.
                  </p>
                  <button type="button" disabled={acting} onClick={() => act("FULFILLED")} style={primaryBtn}>Mark as Fulfilled</button>
                </>
              )}
            </div>
          )}

          <div style={{ marginTop:18 }}>
            <div style={{ ...lS, marginBottom:6 }}>History</div>
            <ol style={{ listStyle:"none", padding:0, margin:0, fontSize:12.5, color:C.textSub }}>
              {events.map(ev => (
                <li key={ev.id} style={{ padding:"6px 0", borderBottom:`1px solid ${C.bg}` }}>
                  <b style={{ color:C.text }}>{ev.event === "CREATED" ? "Created" : `${STATUS_LABELS[ev.from_status] || ev.from_status} → ${STATUS_LABELS[ev.to_status] || ev.to_status}`}</b>
                  {" "}by {ev.actor_name || "—"} · {fmtDateTime(ev.created_at)}
                  {ev.note && <div style={{ marginTop:2, color:C.textFaint }}>“{ev.note}”</div>}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      <PdfPreviewModal preview={pdf.preview} onClose={pdf.closePreview} />
    </Modal>
  )
}

function SimpleTable({ head, rows, minWidth = 520 }) {
  return (
    <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
      <table className="stv-table" style={{ width:"100%", minWidth, borderCollapse:"collapse", fontSize:12.5 }}>
        <thead><tr style={{ borderBottom:`1.5px solid ${C.border}` }}>{head.map(h => <th key={h} scope="col" style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom:`1px solid ${C.bg}` }}>
              {r.map((c, j) => <td key={j} style={{ ...tS, padding:"7px 8px 7px 0", fontSize:12.5 }}>{c === "" || c == null ? "—" : c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EvidencePhotos({ photos }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let cancelled = false
    Promise.all((photos || []).map(async p => [p.path, await getEvidenceUrl(p.path).catch(() => null)]))
      .then(list => { if (!cancelled) setUrls(Object.fromEntries(list)) })
    return () => { cancelled = true }
  }, [photos])
  if (!photos?.length) return null
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10, marginTop:10 }}>
      {photos.map(p => (
        <figure key={p.path} style={{ margin:0 }}>
          {urls[p.path] ? <img src={urls[p.path]} alt={p.caption || "Damage evidence"} style={{ width:"100%", height:130, objectFit:"cover", borderRadius:RADIUS.sm, border:`1px solid ${C.border}` }} />
            : <div style={{ height:130, background:C.bg, borderRadius:RADIUS.sm }} />}
          {p.caption && <figcaption style={{ fontSize:11.5, color:C.textSub, marginTop:4 }}>{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function DocumentContent({ doc }) {
  const p = doc.payload || {}
  const s = effectiveSummary(doc)
  const box = { border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, padding:12, marginBottom:12 }
  switch (doc.doc_type) {
    case "restock_request":
      return (
        <div>
          <div style={{ fontSize:12.5, color:C.textSub, marginBottom:10 }}>Requested by <b>{p.requested_by}</b> for {fmtDate(p.request_date)}</div>
          {(p.sections || []).map(sec => (
            <div key={sec.title} style={box}>
              <div style={{ fontWeight:700, marginBottom:6 }}>{sec.title}</div>
              <SimpleTable head={["Item", "Current stock", "Required", "Notes"]} rows={(sec.items || []).map(i => [i.name, i.current_stock == null ? "" : `${i.current_stock} ${i.stock_unit || ""}`, `${i.required_qty} ${i.unit || ""}`, i.notes])} />
            </div>
          ))}
          {p.notes && <p style={{ fontSize:12.5 }}><b>Notes:</b> {p.notes}</p>}
        </div>
      )
    case "kitchen_equipment":
    case "dining_equipment":
      return (
        <div>
          <StatGrid stats={[
            { label:"Items", value:s.item_count ?? 0 }, { label:"Suggested total", value:s.total_suggested ?? 0 },
            { label:"Actual total", value:s.total_actual ?? 0 }, { label:"Below suggested", value:s.shortfall_items ?? 0, color:C.warnStrong },
            { label:"Missing", value:s.total_missing ?? 0, color:C.warnStrong }, { label:"Damaged", value:s.total_damaged ?? 0, color:C.warnStrong },
          ]} />
          <div style={{ height:12 }} />
          <SimpleTable head={["Item", "Suggested", "Actual", "Missing", "Damaged", "Notes"]} rows={(p.items || []).map(i => [i.name, i.suggested_qty, i.actual_qty, i.missing_qty, i.damaged_qty, i.notes])} />
          {p.notes && <p style={{ fontSize:12.5, marginTop:10 }}><b>Notes:</b> {p.notes}</p>}
        </div>
      )
    case "inventory_checklist":
      return (
        <div>
          <div style={{ fontSize:12.5, color:C.textSub, marginBottom:10 }}>{p.location} · checked by <b>{p.checked_by}</b> on {fmtDate(p.inspection_date)}</div>
          <StatGrid stats={[
            { label:"Inspected", value:`${s.total_inspected ?? 0}/${s.total_items ?? 0}` }, { label:"Good", value:s.good ?? 0, color:C.accentStrong },
            { label:"Fair", value:s.fair ?? 0 }, { label:"Needing repair", value:s.needing_repair ?? 0, color:C.warnStrong }, { label:"Missing", value:s.missing ?? 0, color:C.warnStrong },
          ]} />
          <div style={{ height:12 }} />
          {(p.sections || []).map((sec, i) => (
            <details key={sec.title} style={box} open={i === 0}>
              <summary style={{ fontWeight:700, cursor:"pointer" }}>{i + 1}. {sec.title}</summary>
              <div style={{ marginTop:8 }}><SimpleTable head={["Item", "Qty", "Condition", "Notes"]} rows={(sec.items || []).map(it => [it.name, it.quantity, it.condition, it.notes])} /></div>
            </details>
          ))}
        </div>
      )
    case "gokart_damage_report":
      return (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))", gap:8, fontSize:12.5, marginBottom:10 }}>
            <div><b>Equipment:</b> {p.equipment}</div><div><b>Unit ID:</b> {doc.kart_ids?.[0]}</div>
            <div><b>Location:</b> {p.location}</div><div><b>Reported by:</b> {p.reported_by}</div>
          </div>
          <div style={box}><b>Description of damage</b><p style={{ fontSize:12.5, marginTop:4, whiteSpace:"pre-wrap" }}>{p.description}</p></div>
          {p.safety_status_note && <div style={box}><b>Safety status details</b><p style={{ fontSize:12.5, marginTop:4 }}>{p.safety_status_note}</p></div>}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:12 }}>
            <div style={box}><b>Immediate action taken</b><ul style={{ margin:"6px 0 0 18px", fontSize:12.5 }}>{(p.immediate_actions || []).map((a, i) => <li key={i}>{a}</li>)}</ul></div>
            <div style={box}><b>Recommended action</b><ul style={{ margin:"6px 0 0 18px", fontSize:12.5 }}>{(p.recommended_actions || []).map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          </div>
          <div style={{ fontSize:12.5 }}><b>Supervisor:</b> {p.supervisor_name || "—"} {p.supervisor_date ? `(${p.supervisor_date})` : ""}</div>
          <EvidencePhotos photos={p.photos} />
        </div>
      )
    case "gokart_maintenance_log":
      return <SimpleTable minWidth={680} head={["Date", "Kart ID", "Issue found", "Action taken", "Technician", "Signature"]} rows={(p.entries || []).map(e => [e.date, e.kart_id, e.issue, e.action, e.technician, e.signature])} />
    case "gokart_safety_inspection":
      return (
        <div>
          <div style={{ fontSize:12.5, color:C.textSub, marginBottom:10 }}>Kart <b>{doc.kart_ids?.[0]}</b> · inspected by <b>{p.inspector}</b> · {s.passed ?? 0}/{s.total_checks ?? 0} passed{s.failed ? `, ${s.failed} failed` : ""}</div>
          <SimpleTable head={["Item", "Check", "Notes"]} rows={(p.checks || []).map(c => [c.item, CHECK_RESULTS[c.status] || "", c.notes])} />
          {p.overall_notes && <p style={{ fontSize:12.5, marginTop:10 }}><b>Notes:</b> {p.overall_notes}</p>}
        </div>
      )
    default:
      return null
  }
}

// ══════════════════════════════════════════════════════════════════════
// FORMS
// ══════════════════════════════════════════════════════════════════════
function DocumentForm(props) {
  const meta = DOC_TYPES[props.type]
  const common = { ...props, meta }
  return (
    <div>
      <button type="button" onClick={props.onCancel} style={{ background:"none", border:"none", color:C.textSub, fontSize:12.5, fontWeight:600, cursor:"pointer", padding:0, marginBottom:14, fontFamily:FONT }}>
        ← Back to documents
      </button>
      <div style={{ ...panelS }}>
        <h2 style={{ ...fTi, marginBottom:4 }}>{meta.icon} New {meta.label}</h2>
        <p style={{ fontSize:12, color:C.textFaint, margin:"0 0 18px" }}>A unique reference number is assigned when you save. Saved documents cannot be edited — generate a new one to record changes.</p>
        {props.type === "restock_request" && <RestockForm {...common} />}
        {(props.type === "kitchen_equipment" || props.type === "dining_equipment") && <EquipmentForm {...common} />}
        {props.type === "inventory_checklist" && <ChecklistForm {...common} />}
        {props.type === "gokart_damage_report" && <DamageReportForm {...common} />}
        {props.type === "gokart_maintenance_log" && <MaintenanceLogForm {...common} />}
        {props.type === "gokart_safety_inspection" && <SafetyInspectionForm {...common} />}
      </div>
    </div>
  )
}

/** Shared submit plumbing: one client_request_id per form session + a ref
 * lock, so double taps / retries can never create duplicates. */
function useSubmit({ type, meta, displayName, showToast, onSaved }) {
  const requestId = useRef(newClientRequestId())
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  async function submit(fields) {
    if (lock.current) return
    lock.current = true
    setSaving(true)
    try {
      const { document, duplicate } = await createDocument({
        doc_type: type,
        title: meta.title,
        department: fields.department || meta.department,
        document_date: fields.document_date,
        payload: fields.payload,
        summary: fields.summary,
        kart_ids: fields.kart_ids,
        safety_status: fields.safety_status,
        client_request_id: requestId.current,
        created_by_name: displayName,
      })
      requestId.current = newClientRequestId()
      onSaved(document, duplicate)
    } catch (e) {
      showToast(e.message || "Could not save the document.", "error")
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  return { submit, saving }
}

function FormActions({ saving, onCancel, onSubmit, label = "Save & Generate Document" }) {
  return (
    <div style={{ display:"flex", gap:10, marginTop:20, flexWrap:"wrap", justifyContent:"flex-end" }}>
      <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      <button type="button" onClick={onSubmit} disabled={saving} className="stv-btn stv-btn-primary" style={{ ...sB, width:"auto", padding:"11px 20px", opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving…" : label}
      </button>
    </div>
  )
}

function ErrorText({ msg }) {
  return msg ? <p role="alert" style={{ color:C.warnStrong, fontSize:12.5, margin:"12px 0 0" }}>{msg}</p> : null
}

let rowSeq = 0
const rk = () => `r${++rowSeq}`

// ── A. Restock ────────────────────────────────────────────────────────
function RestockForm({ type, meta, seed, displayName, showToast, onSaved, onCancel }) {
  const [date, setDate] = useState(localDateStr())
  const [requestedBy, setRequestedBy] = useState(displayName || "")
  const [notes, setNotes] = useState("")
  const [inventory, setInventory] = useState([])
  const [invError, setInvError] = useState("")
  const [sections, setSections] = useState(() => {
    const src = seed?.payload?.sections || RESTOCK_TEMPLATE
    return src.map(s => ({ title: s.title, key: rk(), items: s.items.map(i => ({ key: rk(), name: i.name, unit: i.unit || "", required_qty: i.required_qty ?? "", notes: seed ? (i.notes || "") : "", inventory_item_id: i.inventory_item_id || null })) }))
  })
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })

  useEffect(() => {
    fetchInventoryItemsForRestock().then(setInventory).catch(e => setInvError(e.message))
  }, [])

  // Current stock is always read live from inventory (by id, else by exact name).
  const invById = useMemo(() => Object.fromEntries(inventory.map(i => [i.id, i])), [inventory])
  const invByName = useMemo(() => Object.fromEntries(inventory.map(i => [i.name.trim().toLowerCase(), i])), [inventory])
  const matchInv = (it) => (it.inventory_item_id && invById[it.inventory_item_id]) || invByName[it.name.trim().toLowerCase()] || null

  const setItem = (si, ii, patch) => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: s.items.map((it, b) => b !== ii ? it : { ...it, ...patch }) }))
  const removeItem = (si, ii) => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: s.items.filter((_, b) => b !== ii) }))
  const addItem = (si, inv) => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: [...s.items, inv
    ? { key: rk(), name: inv.name, unit: inv.unit || "", required_qty: "", notes: "", inventory_item_id: inv.id }
    : { key: rk(), name: "", unit: "", required_qty: "", notes: "", inventory_item_id: null }] }))
  const addSection = () => setSections(ss => [...ss, { title: "Other Stock", key: rk(), items: [] }])

  function save() {
    setErr("")
    if (!date) return setErr("Please choose the request date.")
    if (!requestedBy.trim()) return setErr("Please enter who is requesting the stock.")
    const cleaned = sections.map(s => ({
      title: s.title.trim() || "Stock",
      items: s.items.filter(i => i.name.trim() || i.required_qty !== "").map(i => {
        const inv = matchInv(i)
        return {
          name: i.name.trim(), unit: i.unit.trim(), required_qty: cleanNum(i.required_qty), notes: i.notes.trim(),
          inventory_item_id: inv?.id || null, current_stock: inv ? Number(inv.quantity) : null, stock_unit: inv?.unit || null,
        }
      }),
    })).filter(s => s.items.length)
    const all = cleaned.flatMap(s => s.items)
    if (all.some(i => !i.name)) return setErr("Every item needs a name.")
    if (all.some(i => i.required_qty == null || isNaN(i.required_qty) || i.required_qty <= 0)) return setErr("Every item needs a required quantity greater than 0 (remove items you don't need).")
    if (!all.length) return setErr("Add at least one item to request.")
    submit({
      document_date: date,
      payload: { request_date: date, requested_by: requestedBy.trim(), sections: cleaned, notes: notes.trim() },
      summary: summarizeRestock(cleaned),
    })
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:16 }}>
        <Field label="Request date" htmlFor="rr-date"><input id="rr-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={iS} /></Field>
        <Field label="Requested by" htmlFor="rr-by"><input id="rr-by" value={requestedBy} maxLength={120} onChange={e => setRequestedBy(e.target.value)} style={iS} /></Field>
        <Field label="Approved by"><div style={{ ...iS, background:C.bg, color:C.textFaint }}>Filled when management approves</div></Field>
      </div>
      {invError && <p style={{ fontSize:12, color:C.warnStrong }}>Current stock unavailable: {invError}</p>}
      {sections.map((sec, si) => (
        <div key={sec.key} style={{ border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, padding:12, marginBottom:12 }}>
          <input aria-label="Section title" value={sec.title} maxLength={80} onChange={e => setSections(ss => ss.map((s, a) => a === si ? { ...s, title:e.target.value } : s))} style={{ ...cellInput, fontWeight:700, fontSize:13.5, marginBottom:10, maxWidth:360 }} />
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", minWidth:640, borderCollapse:"collapse" }}>
              <thead><tr>{["Item", "Current stock", "Required qty", "Unit", "Notes", ""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>
                {sec.items.map((it, ii) => {
                  const inv = matchInv(it)
                  return (
                    <tr key={it.key}>
                      <td style={{ padding:"4px 8px 4px 0" }}><input aria-label="Item name" value={it.name} maxLength={120} onChange={e => setItem(si, ii, { name:e.target.value, inventory_item_id:null })} style={cellInput} /></td>
                      <td style={{ padding:"4px 8px 4px 0", fontSize:12.5, whiteSpace:"nowrap", color: inv ? C.text : C.textFaint }}>{inv ? `${Number(inv.quantity).toLocaleString()} ${inv.unit}` : "Not in inventory"}</td>
                      <td style={{ padding:"4px 8px 4px 0", width:110 }}><input aria-label="Required quantity" type="number" min="0" step="any" value={it.required_qty} onChange={e => setItem(si, ii, { required_qty:e.target.value })} style={{ ...cellInput, textAlign:"right" }} /></td>
                      <td style={{ padding:"4px 8px 4px 0", width:100 }}><input aria-label="Unit" value={it.unit} maxLength={30} onChange={e => setItem(si, ii, { unit:e.target.value })} style={cellInput} /></td>
                      <td style={{ padding:"4px 8px 4px 0" }}><input aria-label="Notes" value={it.notes} maxLength={300} onChange={e => setItem(si, ii, { notes:e.target.value })} style={cellInput} /></td>
                      <td><button type="button" aria-label="Remove item" onClick={() => removeItem(si, ii)} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:15 }}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
            {inventory.length > 0 && (
              <select aria-label="Add item from inventory" value="" onChange={e => { const inv = invById[e.target.value]; if (inv) addItem(si, inv) }} style={seS}>
                <option value="">+ Add item from inventory…</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({Number(i.quantity).toLocaleString()} {i.unit})</option>)}
              </select>
            )}
            <button type="button" onClick={() => addItem(si, null)} style={{ ...ghostBtn, padding:"7px 12px" }}>+ Custom item</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={addSection} style={ghostBtn}>+ Add section</button>
      <Field label="Additional notes" htmlFor="rr-notes" style={{ marginTop:14 }}><textarea id="rr-notes" rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...iS, resize:"vertical" }} /></Field>
      <p style={{ fontSize:11.5, color:C.textFaint, marginTop:10 }}>Creating a request never changes stock. Received items are added through Inventory → Add Stock.</p>
      <ErrorText msg={err} />
      <FormActions saving={saving} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ── B. Equipment lists ───────────────────────────────────────────────
function EquipmentForm({ type, meta, seed, isOwner, displayName, showToast, onSaved, onCancel }) {
  const template = type === "kitchen_equipment" ? KITCHEN_EQUIPMENT_TEMPLATE : DINING_EQUIPMENT_TEMPLATE
  const fromTemplate = () => template.map(([name, qty]) => ({ key: rk(), name, suggested_qty: qty, actual_qty: "", missing_qty: "", damaged_qty: "", notes: "" }))
  const fromDoc = (d) => (d.payload?.items || []).map(i => ({ key: rk(), name: i.name, suggested_qty: i.suggested_qty ?? "", actual_qty: "", missing_qty: "", damaged_qty: "", notes: "" }))
  const [items, setItems] = useState(() => (seed ? fromDoc(seed) : fromTemplate()))
  const [latest, setLatest] = useState(null)
  // Loading guard: the item table stays read-only until the latest saved list
  // has been fetched, so the fetch can never overwrite quantities the user has
  // already started typing. A "starting point" seed needs no fetch.
  const [loadingLatest, setLoadingLatest] = useState(!seed)
  const [latestError, setLatestError] = useState("")
  const [date, setDate] = useState(localDateStr())
  const [preparedBy, setPreparedBy] = useState(displayName || "")
  const [notes, setNotes] = useState("")
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })

  useEffect(() => {
    if (seed) return
    let cancelled = false
    setLoadingLatest(true)
    getLatestDocument(type)
      .then(d => { if (!cancelled && d) { setLatest(d); setItems(fromDoc(d)) } })
      .catch(e => { if (!cancelled) setLatestError(e.message || "Could not load the latest saved list.") })
      .finally(() => { if (!cancelled) setLoadingLatest(false) })
    return () => { cancelled = true }
  }, [type, seed])

  if (!isOwner) {
    return <p style={{ fontSize:13, color:C.textSub }}>Only management (Owner/Admin) can create or update equipment lists.</p>
  }

  const set = (i, patch) => setItems(list => list.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const summary = summarizeEquipment(items)

  function save() {
    setErr("")
    if (loadingLatest) return setErr("Please wait — the latest saved list is still loading.")
    const cleaned = items.filter(i => i.name.trim()).map(i => ({
      name: i.name.trim(), suggested_qty: cleanNum(i.suggested_qty), actual_qty: cleanNum(i.actual_qty),
      missing_qty: cleanNum(i.missing_qty), damaged_qty: cleanNum(i.damaged_qty), notes: i.notes.trim(),
    }))
    if (!cleaned.length) return setErr("The list needs at least one item.")
    const bad = items.some(i => !["suggested_qty", "actual_qty", "missing_qty", "damaged_qty"].every(k => nonNegOrEmpty(i[k])))
    if (bad) return setErr("Quantities must be 0 or more.")
    if (cleaned.some(i => i.suggested_qty == null)) return setErr("Every item needs a suggested quantity.")
    submit({ document_date: date, payload: { prepared_by: preparedBy.trim(), items: cleaned, notes: notes.trim(), based_on: seed?.reference_number || latest?.reference_number || "Original template" }, summary: summarizeEquipment(cleaned) })
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:12 }}>
        <Field label="Date" htmlFor="eq-date"><input id="eq-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={iS} /></Field>
        <Field label="Prepared by" htmlFor="eq-by"><input id="eq-by" value={preparedBy} maxLength={120} onChange={e => setPreparedBy(e.target.value)} style={iS} /></Field>
      </div>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:12, fontSize:12, color:C.textSub }}>
        <span>Starting from: <b>{loadingLatest ? "loading latest saved list…" : (seed?.reference_number || latest?.reference_number || "original equipment list")}</b></span>
        <button type="button" disabled={loadingLatest} onClick={() => setItems(fromTemplate())} style={{ ...ghostBtn, padding:"5px 10px", fontSize:11.5 }}>Reset to original suggested quantities</button>
      </div>
      {latestError && <p role="alert" style={{ fontSize:12, color:C.warnStrong, margin:"0 0 8px" }}>{latestError} Showing the original suggested quantities.</p>}
      <p style={{ fontSize:11.5, color:C.textFaint, margin:"0 0 10px" }}>Suggested quantities are planning targets only — they are never recorded as stock.</p>
      <fieldset disabled={loadingLatest} aria-busy={loadingLatest} style={{ border:"none", padding:0, margin:0, minWidth:0, opacity: loadingLatest ? 0.55 : 1 }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", minWidth:760, borderCollapse:"collapse" }}>
          <thead><tr>{["Item", "Suggested", "Actual", "Missing", "Damaged", "Notes", ""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {items.map((it, i) => {
              const short = it.actual_qty !== "" && Number(it.actual_qty) < Number(it.suggested_qty || 0)
              return (
                <tr key={it.key} style={{ background: short ? "#FFF8F4" : undefined }}>
                  <td style={{ padding:"4px 8px 4px 0" }}><input aria-label="Item" value={it.name} maxLength={120} onChange={e => set(i, { name:e.target.value })} style={cellInput} /></td>
                  {["suggested_qty", "actual_qty", "missing_qty", "damaged_qty"].map(k => (
                    <td key={k} style={{ padding:"4px 8px 4px 0", width:90 }}><input aria-label={k} type="number" min="0" step="1" value={it[k]} onChange={e => set(i, { [k]:e.target.value })} style={{ ...cellInput, textAlign:"right" }} /></td>
                  ))}
                  <td style={{ padding:"4px 8px 4px 0" }}><input aria-label="Notes" value={it.notes} maxLength={300} onChange={e => set(i, { notes:e.target.value })} style={cellInput} /></td>
                  <td><button type="button" aria-label="Remove item" onClick={() => setItems(l => l.filter((_, j) => j !== i))} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:15 }}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setItems(l => [...l, { key: rk(), name:"", suggested_qty:"", actual_qty:"", missing_qty:"", damaged_qty:"", notes:"" }])} style={{ ...ghostBtn, marginTop:8 }}>+ Add item</button>
      </fieldset>
      <div style={{ marginTop:16 }}>
        <StatGrid stats={[
          { label:"Items", value:summary.item_count }, { label:"Suggested total", value:summary.total_suggested },
          { label:"Actual total", value:summary.total_actual }, { label:"Below suggested", value:summary.shortfall_items, color:C.warnStrong },
          { label:"Missing", value:summary.total_missing, color:C.warnStrong }, { label:"Damaged", value:summary.total_damaged, color:C.warnStrong },
        ]} />
      </div>
      <Field label="Notes" htmlFor="eq-notes" style={{ marginTop:14 }}><textarea id="eq-notes" rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...iS, resize:"vertical" }} /></Field>
      <ErrorText msg={err} />
      <FormActions saving={saving || loadingLatest} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ── C. Inventory checklist ──────────────────────────────────────────
function ChecklistForm({ type, meta, seed, displayName, showToast, onSaved, onCancel }) {
  const [location, setLocation] = useState(seed?.payload?.location || "Swahili Tent Village")
  const [date, setDate] = useState(localDateStr())
  const [checkedBy, setCheckedBy] = useState(displayName || "")
  const [department, setDepartment] = useState(seed?.department || CHECKLIST_DEPARTMENTS[0])
  const [notes, setNotes] = useState("")
  const [sections, setSections] = useState(() => {
    const src = seed?.payload?.sections
      ? seed.payload.sections.map(s => ({ title: s.title, items: s.items.map(i => i.name) }))
      : CHECKLIST_TEMPLATE
    return src.map(s => ({ key: rk(), title: s.title, items: s.items.map(name => ({ key: rk(), name, quantity:"", condition:"", notes:"" })) }))
  })
  const [open, setOpen] = useState(0)
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })

  const setItem = (si, ii, patch) => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: s.items.map((it, b) => b !== ii ? it : { ...it, ...patch }) }))
  const summary = summarizeChecklist(sections)

  function save() {
    setErr("")
    if (!date) return setErr("Please choose the inspection date.")
    if (!checkedBy.trim()) return setErr("Please enter who checked the inventory.")
    if (sections.some(s => s.items.some(i => !nonNegOrEmpty(i.quantity)))) return setErr("Quantities must be 0 or more.")
    const cleaned = sections.map(s => ({
      title: s.title,
      items: s.items.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), quantity: cleanNum(i.quantity), condition: i.condition || "", notes: i.notes.trim() })),
    }))
    const sum = summarizeChecklist(cleaned)
    if (sum.total_inspected === 0) return setErr("Record a quantity or condition for at least one item.")
    submit({
      department,
      document_date: date,
      payload: { location: location.trim() || "Swahili Tent Village", inspection_date: date, checked_by: checkedBy.trim(), sections: cleaned, notes: notes.trim() },
      summary: sum,
    })
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:16 }}>
        <Field label="Location" htmlFor="ic-loc"><input id="ic-loc" value={location} maxLength={120} onChange={e => setLocation(e.target.value)} style={iS} /></Field>
        <Field label="Inspection date" htmlFor="ic-date"><input id="ic-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={iS} /></Field>
        <Field label="Checked by" htmlFor="ic-by"><input id="ic-by" value={checkedBy} maxLength={120} onChange={e => setCheckedBy(e.target.value)} style={iS} /></Field>
        <Field label="Department" htmlFor="ic-dept">
          <select id="ic-dept" value={department} onChange={e => setDepartment(e.target.value)} style={iS}>
            {CHECKLIST_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ position:"sticky", top:0, zIndex:2, background:C.surface, paddingBottom:10 }}>
        <StatGrid stats={[
          { label:"Inspected", value:`${summary.total_inspected}/${summary.total_items}` }, { label:"Good", value:summary.good, color:C.accentStrong },
          { label:"Fair", value:summary.fair }, { label:"Needing repair", value:summary.needing_repair, color:C.warnStrong }, { label:"Missing (qty 0)", value:summary.missing, color:C.warnStrong },
        ]} />
      </div>

      {sections.map((sec, si) => {
        const done = sec.items.filter(i => i.quantity !== "" || i.condition).length
        return (
          <div key={sec.key} style={{ border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, marginTop:10 }}>
            <button type="button" onClick={() => setOpen(open === si ? -1 : si)} aria-expanded={open === si}
              style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:"none", border:"none", cursor:"pointer", fontFamily:FONT, fontSize:13.5, fontWeight:700, color:C.text, textAlign:"left" }}>
              <span>{si + 1}. {sec.title}</span>
              <span style={{ fontSize:11.5, color:C.textFaint, fontWeight:600 }}>{done}/{sec.items.length} {open === si ? "▲" : "▼"}</span>
            </button>
            {open === si && (
              <div style={{ padding:"0 14px 12px", overflowX:"auto" }}>
                <table style={{ width:"100%", minWidth:600, borderCollapse:"collapse" }}>
                  <thead><tr>{["Item", "Quantity", "Condition", "Notes", ""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                  <tbody>
                    {sec.items.map((it, ii) => (
                      <tr key={it.key}>
                        <td style={{ padding:"4px 8px 4px 0" }}><input aria-label="Item" value={it.name} maxLength={120} onChange={e => setItem(si, ii, { name:e.target.value })} style={cellInput} /></td>
                        <td style={{ padding:"4px 8px 4px 0", width:90 }}><input aria-label={`${it.name} quantity`} type="number" min="0" step="any" value={it.quantity} onChange={e => setItem(si, ii, { quantity:e.target.value })} style={{ ...cellInput, textAlign:"right" }} /></td>
                        <td style={{ padding:"4px 8px 4px 0", width:200 }}>
                          <div role="radiogroup" aria-label={`${it.name} condition`} style={{ display:"flex", gap:4 }}>
                            {CONDITIONS.map(c => {
                              const on = it.condition === c
                              const col = c === "Good" ? C.accentStrong : c === "Damaged" ? C.warnStrong : "#8A6416"
                              return <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setItem(si, ii, { condition: on ? "" : c })}
                                style={{ flex:1, padding:"6px 4px", borderRadius:6, border:`1.5px solid ${on ? col : C.border}`, background: on ? col : C.surface, color: on ? "#fff" : C.textSub, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>{c}</button>
                            })}
                          </div>
                        </td>
                        <td style={{ padding:"4px 8px 4px 0" }}><input aria-label={`${it.name} notes`} value={it.notes} maxLength={300} onChange={e => setItem(si, ii, { notes:e.target.value })} style={cellInput} /></td>
                        <td><button type="button" aria-label="Remove item" onClick={() => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: s.items.filter((_, b) => b !== ii) }))} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:15 }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={() => setSections(ss => ss.map((s, a) => a !== si ? s : { ...s, items: [...s.items, { key: rk(), name:"", quantity:"", condition:"", notes:"" }] }))} style={{ ...ghostBtn, marginTop:8, padding:"6px 12px" }}>+ Add item</button>
              </div>
            )}
          </div>
        )
      })}
      <Field label="Notes" htmlFor="ic-notes" style={{ marginTop:14 }}><textarea id="ic-notes" rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...iS, resize:"vertical" }} /></Field>
      <p style={{ fontSize:11.5, color:C.textFaint, marginTop:10 }}>Manager signature and date are recorded when management approves this checklist.</p>
      <ErrorText msg={err} />
      <FormActions saving={saving} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ── Go-kart helpers ──────────────────────────────────────────────────
/** Registered karts only -- reports can never create fleet records (also
 * enforced by the database). */
function KartSelect({ value, onChange, fleet, id, compact }) {
  const { karts, loading, error } = fleet
  const kart = karts.find(k => k.kart_id === value)
  if (!loading && !error && karts.length === 0) {
    return <div style={{ ...(compact ? cellInput : iS), background:C.bg, color:C.textFaint, fontSize:12 }}>No karts registered — ask management to register karts first</div>
  }
  return (
    <div>
      <select id={id} aria-label={compact ? "Kart ID" : undefined} value={value} disabled={loading} onChange={e => onChange(e.target.value)} style={compact ? cellInput : iS}>
        <option value="">{loading ? "Loading karts…" : "Select kart…"}</option>
        {karts.map(k => (
          <option key={k.kart_id} value={k.kart_id}>
            {k.kart_id}{k.label ? ` – ${k.label}` : ""}{k.current_status !== "OPERATIONAL" ? ` (${SAFETY_STATUSES[k.current_status]?.label})` : ""}
          </option>
        ))}
      </select>
      {error && <div style={{ fontSize:11.5, color:C.warnStrong, marginTop:4 }}>Could not load karts: {error}</div>}
      {!compact && kart && kart.current_status !== "OPERATIONAL" && (
        <div style={{ marginTop:6 }}><SafetyPill status={kart.current_status} /> <span style={{ fontSize:11.5, color:C.textSub }}>{kart.status_reason}</span></div>
      )}
    </div>
  )
}

function ListEditor({ items, onChange, placeholder, label }) {
  return (
    <div>
      {items.map((v, i) => (
        <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
          <input aria-label={`${label} ${i + 1}`} value={v} maxLength={300} placeholder={placeholder} onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} style={cellInput} />
          <button type="button" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:15 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} style={{ ...ghostBtn, padding:"6px 12px" }}>+ Add</button>
    </div>
  )
}

function useKarts() {
  const [state, setState] = useState({ karts: [], loading: true, error: "" })
  useEffect(() => {
    let cancelled = false
    fetchKarts()
      .then(karts => { if (!cancelled) setState({ karts, loading: false, error: "" }) })
      .catch(e => { if (!cancelled) setState({ karts: [], loading: false, error: e.message || "error" }) })
    return () => { cancelled = true }
  }, [])
  return state
}

/** Shared pre-submit check: kart IDs must be valid AND registered. */
function kartValidationError(kartIds, fleet) {
  if (!kartIds.length || kartIds.some(id => !isValidKartId(id))) return "Select a registered kart."
  if (fleet.loading) return "Karts are still loading — please wait."
  const unknown = unregisteredKarts(kartIds, fleet.karts)
  if (unknown.length) return `Kart ${unknown.join(", ")} is not registered. Ask management to register it first.`
  return ""
}

// ── D1. Damage report ────────────────────────────────────────────────
function DamageReportForm({ type, meta, user, displayName, showToast, onSaved, onCancel }) {
  const fleet = useKarts()
  const [kart, setKart] = useState("")
  const [equipment, setEquipment] = useState("Go-Kart")
  const [location, setLocation] = useState(DEFAULT_GOKART_LOCATION)
  const [date, setDate] = useState(localDateStr())
  const [reportedBy, setReportedBy] = useState(displayName || "")
  const [description, setDescription] = useState("")
  const [safety, setSafety] = useState("")
  const [safetyNote, setSafetyNote] = useState("")
  const [immediate, setImmediate] = useState([""])
  const [recommended, setRecommended] = useState([""])
  const [photos, setPhotos] = useState([]) // { path, caption, preview }
  const [uploading, setUploading] = useState(false)
  const [supervisor, setSupervisor] = useState("")
  const [supervisorDate, setSupervisorDate] = useState("")
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })

  async function onFiles(files) {
    if (!files?.length) return
    if (photos.length + files.length > 6) { showToast("Up to 6 photos per report.", "error"); return }
    setUploading(true)
    try {
      for (const f of files) {
        const path = await uploadEvidence(f, user.id)
        setPhotos(p => [...p, { path, caption: "", preview: URL.createObjectURL(f) }])
      }
    } catch (e) { showToast(e.message || "Upload failed.", "error") }
    finally { setUploading(false) }
  }

  function save() {
    setErr("")
    const kartId = normalizeKartId(kart)
    const kartErr = kartValidationError([kartId], fleet)
    if (kartErr) return setErr(kartErr)
    if (!date) return setErr("Please choose the date.")
    if (!reportedBy.trim()) return setErr("Please enter who reported the damage.")
    if (description.trim().length < 10) return setErr("Describe the damage (at least 10 characters).")
    if (!safety) return setErr("Select the kart's safety status.")
    if (uploading) return setErr("Please wait for photos to finish uploading.")
    const im = immediate.map(s => s.trim()).filter(Boolean)
    const rec = recommended.map(s => s.trim()).filter(Boolean)
    if (!im.length) return setErr("Record at least one immediate action taken.")
    submit({
      document_date: date,
      kart_ids: [kartId],
      safety_status: safety,
      payload: {
        equipment: equipment.trim() || "Go-Kart", unit_id: kartId, location: location.trim(), reported_by: reportedBy.trim(),
        description: description.trim(), safety_status_note: safetyNote.trim(), immediate_actions: im, recommended_actions: rec,
        photos: photos.map(p => ({ path: p.path, caption: p.caption.trim() })),
        supervisor_name: supervisor.trim(), supervisor_date: supervisorDate || null,
      },
      summary: { photo_count: photos.length },
    })
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:14 }}>
        <Field label="Maintenance tracking no."><div style={{ ...iS, background:C.bg, color:C.textFaint }}>Assigned on save (STV-GK-…)</div></Field>
        <Field label="Equipment" htmlFor="dr-eq"><input id="dr-eq" value={equipment} maxLength={80} onChange={e => setEquipment(e.target.value)} style={iS} /></Field>
        <Field label="Kart / unit ID" htmlFor="dr-kart"><KartSelect id="dr-kart" value={kart} onChange={setKart} fleet={fleet} /></Field>
        <Field label="Location" htmlFor="dr-loc"><input id="dr-loc" value={location} maxLength={120} onChange={e => setLocation(e.target.value)} style={iS} /></Field>
        <Field label="Date" htmlFor="dr-date"><input id="dr-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={iS} /></Field>
        <Field label="Reported by" htmlFor="dr-by"><input id="dr-by" value={reportedBy} maxLength={120} onChange={e => setReportedBy(e.target.value)} style={iS} /></Field>
      </div>
      <Field label="Description of damage" htmlFor="dr-desc"><textarea id="dr-desc" rows={4} maxLength={3000} value={description} onChange={e => setDescription(e.target.value)} style={{ ...iS, resize:"vertical" }} placeholder="What was found, where, and the likely cause." /></Field>

      <div style={{ marginTop:14 }}>
        <span style={lS} id="dr-safety-label">Safety status</span>
        <div role="radiogroup" aria-labelledby="dr-safety-label" style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {Object.entries(SAFETY_STATUSES).map(([k, s]) => (
            <button key={k} type="button" role="radio" aria-checked={safety === k} onClick={() => setSafety(k)}
              style={{ padding:"9px 14px", borderRadius:RADIUS.sm, border:`2px solid ${safety === k ? s.color : C.border}`, background: safety === k ? s.bg : C.surface, color: safety === k ? s.color : C.textSub, fontWeight:700, fontSize:12.5, cursor:"pointer", fontFamily:FONT }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        {safety === "OUT_OF_SERVICE" && <p style={{ fontSize:12, color:C.warnStrong, marginTop:8, fontWeight:600 }}>This kart will be flagged Out of Service as soon as the report is saved. Only management can return it to service, after repairs are verified.</p>}
        {safety === "RESTRICTED" && <p style={{ fontSize:12, color:"#8A6416", marginTop:8 }}>The kart will be flagged Restricted until management verifies it.</p>}
        <input aria-label="Safety status details" placeholder="Safety status details (e.g. removed from operation because the leaking fuel tank is a risk)" value={safetyNote} maxLength={500} onChange={e => setSafetyNote(e.target.value)} style={{ ...iS, marginTop:10 }} />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:14, marginTop:14 }}>
        <Field label="Immediate action taken"><ListEditor label="Immediate action" items={immediate} onChange={setImmediate} placeholder="e.g. Vehicle removed from activity use" /></Field>
        <Field label="Recommended action"><ListEditor label="Recommended action" items={recommended} onChange={setRecommended} placeholder="e.g. Replace damaged fuel tank" /></Field>
      </div>

      <div style={{ marginTop:14 }}>
        <span style={lS}>Photographic evidence (up to 6)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple disabled={uploading} onChange={e => { onFiles(Array.from(e.target.files || [])); e.target.value = "" }} aria-label="Add photos" />
        {uploading && <span style={{ fontSize:12, color:C.textFaint, marginLeft:8 }}>Uploading…</span>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10, marginTop:10 }}>
          {photos.map((p, i) => (
            <div key={p.path}>
              <img src={p.preview} alt="" style={{ width:"100%", height:110, objectFit:"cover", borderRadius:RADIUS.sm, border:`1px solid ${C.border}` }} />
              <input aria-label={`Caption for photo ${i + 1}`} placeholder="Caption" value={p.caption} maxLength={120} onChange={e => setPhotos(list => list.map((x, j) => (j === i ? { ...x, caption:e.target.value } : x)))} style={{ ...cellInput, marginTop:4 }} />
              <button type="button" onClick={() => setPhotos(list => list.filter((_, j) => j !== i))} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:11.5, padding:"2px 0" }}>Remove from report</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginTop:14 }}>
        <Field label="Supervisor name" htmlFor="dr-sup"><input id="dr-sup" value={supervisor} maxLength={120} onChange={e => setSupervisor(e.target.value)} style={iS} /></Field>
        <Field label="Supervisor date" htmlFor="dr-supd"><input id="dr-supd" type="date" value={supervisorDate} onChange={e => setSupervisorDate(e.target.value)} style={iS} /></Field>
        <Field label="Manager approval"><div style={{ ...iS, background:C.bg, color:C.textFaint }}>Recorded when management approves</div></Field>
      </div>
      <ErrorText msg={err} />
      <FormActions saving={saving || uploading} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ── D2. Maintenance logbook ─────────────────────────────────────────
function MaintenanceLogForm({ type, meta, displayName, showToast, onSaved, onCancel }) {
  const fleet = useKarts()
  const blank = () => ({ key: rk(), date: localDateStr(), kart_id:"", issue:"", action:"", technician: displayName || "", signature:"" })
  const [entries, setEntries] = useState([blank()])
  const [notes, setNotes] = useState("")
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })
  const set = (i, patch) => setEntries(list => list.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  function save() {
    setErr("")
    const cleaned = entries
      .map(e => ({ date: e.date, kart_id: normalizeKartId(e.kart_id), issue: e.issue.trim(), action: e.action.trim(), technician: e.technician.trim(), signature: e.signature.trim() }))
      .filter(e => e.kart_id || e.issue || e.action)
    if (!cleaned.length) return setErr("Add at least one logbook entry.")
    for (const e of cleaned) {
      const kartErr = kartValidationError([e.kart_id], fleet)
      if (kartErr) return setErr(kartErr)
      if (!e.date || !e.issue || !e.action || !e.technician) return setErr("Each entry needs a date, kart ID, issue found, action taken and technician.")
    }
    const dates = cleaned.map(e => e.date).sort()
    submit({
      document_date: dates[dates.length - 1],
      kart_ids: Array.from(new Set(cleaned.map(e => e.kart_id))),
      payload: { entries: cleaned, notes: notes.trim() },
      summary: { entry_count: cleaned.length },
    })
  }

  return (
    <div>
      <p style={{ fontSize:12.5, color:C.textSub, margin:"0 0 12px" }}>Track inspection, maintenance and repairs for go-karts used in guest activities. Each entry should be completed by the maintenance staff or supervisor.</p>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", minWidth:900, borderCollapse:"collapse" }}>
          <thead><tr>{["Date", "Kart ID", "Inspection / issue found", "Maintenance action taken", "Technician", "Signature (typed name)", ""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.key}>
                <td style={{ padding:"4px 8px 4px 0", width:140 }}><input aria-label="Date" type="date" value={e.date} onChange={ev => set(i, { date:ev.target.value })} style={cellInput} /></td>
                <td style={{ padding:"4px 8px 4px 0", width:150 }}>
                  <KartSelect compact value={e.kart_id} onChange={v => set(i, { kart_id: v })} fleet={fleet} />
                </td>
                <td style={{ padding:"4px 8px 4px 0" }}><textarea aria-label="Issue found" rows={2} value={e.issue} maxLength={1000} onChange={ev => set(i, { issue:ev.target.value })} style={{ ...cellInput, resize:"vertical" }} /></td>
                <td style={{ padding:"4px 8px 4px 0" }}><textarea aria-label="Action taken" rows={2} value={e.action} maxLength={1000} onChange={ev => set(i, { action:ev.target.value })} style={{ ...cellInput, resize:"vertical" }} /></td>
                <td style={{ padding:"4px 8px 4px 0", width:130 }}><input aria-label="Technician" value={e.technician} maxLength={120} onChange={ev => set(i, { technician:ev.target.value })} style={cellInput} /></td>
                <td style={{ padding:"4px 8px 4px 0", width:130 }}><input aria-label="Signature" value={e.signature} maxLength={120} onChange={ev => set(i, { signature:ev.target.value })} style={{ ...cellInput, fontStyle:"italic" }} /></td>
                <td><button type="button" aria-label="Remove entry" onClick={() => setEntries(l => l.filter((_, j) => j !== i))} style={{ background:"none", border:"none", color:C.warnStrong, cursor:"pointer", fontSize:15 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setEntries(l => [...l, blank()])} style={{ ...ghostBtn, marginTop:8 }}>+ Add entry</button>
      <p style={{ fontSize:11.5, color:C.textFaint, marginTop:10 }}>Logging a repair does not return a kart to service. Management verifies the kart in Fleet Status after repairs.</p>
      <Field label="Notes" htmlFor="ml-notes" style={{ marginTop:10 }}><textarea id="ml-notes" rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...iS, resize:"vertical" }} /></Field>
      <ErrorText msg={err} />
      <FormActions saving={saving} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ── D3. Daily safety inspection ─────────────────────────────────────
function SafetyInspectionForm({ type, meta, displayName, showToast, onSaved, onCancel }) {
  const fleet = useKarts()
  const [kart, setKart] = useState("")
  const [date, setDate] = useState(localDateStr())
  const [inspector, setInspector] = useState(displayName || "")
  const [checks, setChecks] = useState(SAFETY_CHECK_ITEMS.map(item => ({ item, status:"", notes:"" })))
  const [result, setResult] = useState("")
  const [overall, setOverall] = useState("")
  const [err, setErr] = useState("")
  const { submit, saving } = useSubmit({ type, meta, displayName, showToast, onSaved })
  const anyFail = checks.some(c => c.status === "FAIL")
  const derived = anyFail ? "RESTRICTED" : "OPERATIONAL"
  const effective = result || derived
  const set = (i, patch) => setChecks(list => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  function save() {
    setErr("")
    const kartId = normalizeKartId(kart)
    const kartErr = kartValidationError([kartId], fleet)
    if (kartErr) return setErr(kartErr)
    if (!inspector.trim()) return setErr("Please enter the inspector's name.")
    if (checks.some(c => !c.status)) return setErr("Every item must be checked (Pass, Fail or N/A).")
    if (checks.some(c => c.status === "FAIL" && !c.notes.trim())) return setErr("Add a note for every failed item.")
    if (anyFail && effective === "OPERATIONAL") return setErr("A kart with a failed check cannot be recorded as Operational.")
    submit({
      document_date: date,
      kart_ids: [kartId],
      safety_status: effective,
      payload: { kart_id: kartId, inspection_date: date, inspector: inspector.trim(), checks: checks.map(c => ({ ...c, notes: c.notes.trim() })), overall_notes: overall.trim() },
      summary: summarizeSafety(checks),
    })
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:14 }}>
        <Field label="Kart ID" htmlFor="si-kart"><KartSelect id="si-kart" value={kart} onChange={setKart} fleet={fleet} /></Field>
        <Field label="Date" htmlFor="si-date"><input id="si-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={iS} /></Field>
        <Field label="Inspected by" htmlFor="si-by"><input id="si-by" value={inspector} maxLength={120} onChange={e => setInspector(e.target.value)} style={iS} /></Field>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", minWidth:560, borderCollapse:"collapse" }}>
          <thead><tr>{["Item", "Check", "Notes"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={c.item} style={{ borderBottom:`1px solid ${C.bg}` }}>
                <td style={{ ...tS, fontWeight:600, padding:"8px 8px 8px 0" }}>{c.item}</td>
                <td style={{ padding:"4px 8px 4px 0", width:220 }}>
                  <div role="radiogroup" aria-label={`${c.item} check`} style={{ display:"flex", gap:4 }}>
                    {Object.entries(CHECK_RESULTS).map(([k, label]) => {
                      const on = c.status === k
                      const col = k === "PASS" ? C.accentStrong : k === "FAIL" ? C.warnStrong : C.textSub
                      return <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set(i, { status:k })}
                        style={{ flex:1, padding:"7px 4px", borderRadius:6, border:`1.5px solid ${on ? col : C.border}`, background: on ? col : C.surface, color: on ? "#fff" : C.textSub, fontSize:11.5, fontWeight:700, cursor:"pointer", fontFamily:FONT }}>{label}</button>
                    })}
                  </div>
                </td>
                <td style={{ padding:"4px 0" }}><input aria-label={`${c.item} notes`} value={c.notes} maxLength={300} onChange={e => set(i, { notes:e.target.value })} style={{ ...cellInput, borderColor: c.status === "FAIL" && !c.notes.trim() ? C.warn : C.border }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:14 }}>
        <span style={lS}>Resulting kart status</span>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {Object.entries(SAFETY_STATUSES).map(([k, s]) => {
            const disabled = anyFail && k === "OPERATIONAL"
            const on = effective === k
            return <button key={k} type="button" disabled={disabled} aria-pressed={on} onClick={() => setResult(k)}
              style={{ padding:"8px 13px", borderRadius:RADIUS.sm, border:`2px solid ${on ? s.color : C.border}`, background: on ? s.bg : C.surface, color: on ? s.color : C.textSub, fontWeight:700, fontSize:12, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, fontFamily:FONT }}>{s.emoji} {s.label}</button>
          })}
        </div>
        <p style={{ fontSize:11.5, color:C.textFaint, marginTop:6 }}>A failed check flags the kart at least Restricted. An inspection can never return a flagged kart to service — that needs management verification.</p>
      </div>
      <Field label="Notes" htmlFor="si-notes" style={{ marginTop:12 }}><textarea id="si-notes" rows={2} maxLength={1000} value={overall} onChange={e => setOverall(e.target.value)} style={{ ...iS, resize:"vertical" }} /></Field>
      <ErrorText msg={err} />
      <FormActions saving={saving} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// GO-KART FLEET STATUS
// ══════════════════════════════════════════════════════════════════════
function FleetStatusPanel({ isOwner, showToast, onViewDoc }) {
  const [karts, setKarts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState(null)
  const [showRegister, setShowRegister] = useState(false)

  async function load() {
    try { setKarts(await fetchKarts()); setError("") }
    catch (e) { setError(e.message || "Could not load the go-kart fleet.") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const oos = karts.filter(k => k.current_status === "OUT_OF_SERVICE")
  const restricted = karts.filter(k => k.current_status === "RESTRICTED")

  return (
    <div style={{ ...panelS, marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:12 }}>
        <h2 style={{ ...fTi, marginBottom:0 }}>🏎️ Go-Kart Fleet Status</h2>
        {isOwner && <button type="button" onClick={() => setShowRegister(true)} style={ghostBtn}>+ Register kart</button>}
      </div>

      {oos.length > 0 && (
        <div role="alert" style={{ background:C.warnSoft, border:`2px solid ${C.warnStrong}`, color:C.warnStrong, borderRadius:RADIUS.sm, padding:"10px 14px", fontSize:13, fontWeight:700, marginBottom:12 }}>
          🔴 {oos.length} kart{oos.length > 1 ? "s" : ""} OUT OF SERVICE — {oos.map(k => k.kart_id).join(", ")}. Do not use for guest activities until management verifies repairs.
        </div>
      )}
      {restricted.length > 0 && (
        <div style={{ background:"#FBF0D9", border:"1px solid #E7D48A", color:"#7A5E10", borderRadius:RADIUS.sm, padding:"8px 14px", fontSize:12.5, fontWeight:600, marginBottom:12 }}>
          🟡 Restricted: {restricted.map(k => k.kart_id).join(", ")}
        </div>
      )}

      {error && <p role="alert" style={{ color:C.warnStrong, fontSize:12.5 }}>{error}</p>}
      {loading ? <p style={{ fontSize:12.5, color:C.textFaint }}>Loading…</p> : karts.length === 0 ? (
        <p style={{ fontSize:12.5, color:C.textFaint }}>No karts registered yet. {isOwner ? "Register each kart before damage reports, logbook entries or inspections can be filed for it." : "Management must register karts before damage reports, logbook entries or inspections can be filed."}</p>
      ) : (
        <div style={{ display:"grid", gap:10, gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))" }}>
          {karts.map(k => {
            const s = SAFETY_STATUSES[k.current_status]
            return (
              <button key={k.kart_id} type="button" onClick={() => setSelected(k)} className="stv-card stv-card-hover stv-btn"
                style={{ textAlign:"left", background: k.current_status === "OPERATIONAL" ? C.surface : s.bg, border:`${k.current_status === "OUT_OF_SERVICE" ? 2 : 1}px solid ${k.current_status === "OPERATIONAL" ? C.border : s.color}`, borderRadius:RADIUS.md, padding:"12px 14px", cursor:"pointer", fontFamily:FONT }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:6 }}>
                  <span style={{ fontWeight:800, fontSize:15, color:C.text }}>{k.kart_id}</span>
                  <SafetyPill status={k.current_status} />
                </div>
                {k.label && <div style={{ fontSize:11.5, color:C.textSub, marginTop:2 }}>{k.label}</div>}
                {k.status_reason && <div style={{ fontSize:11.5, color:C.textSub, marginTop:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{k.status_reason}</div>}
                <div style={{ fontSize:10.5, color:C.textFaint, marginTop:4 }}>Since {fmtDate(k.status_changed_at)}{k.status_changed_by_name ? ` · ${k.status_changed_by_name}` : ""}</div>
              </button>
            )
          })}
        </div>
      )}

      {selected && <KartDetailModal kart={selected} isOwner={isOwner} showToast={showToast} onViewDoc={onViewDoc} onClose={() => setSelected(null)} onChanged={async () => { await load(); }} />}
      {showRegister && <RegisterKartModal showToast={showToast} onClose={() => setShowRegister(false)} onSaved={() => { setShowRegister(false); load() }} />}
    </div>
  )
}

function RegisterKartModal({ showToast, onClose, onSaved }) {
  const [id, setId] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await registerKart(id, label); showToast("Kart registered."); onSaved() }
    catch (e) { showToast(e.message, "error") }
    finally { setBusy(false) }
  }
  return (
    <Modal title="Register a go-kart" onClose={onClose} width={420} labelId="reg-kart-title">
      <Field label="Kart ID" htmlFor="rk-id"><input id="rk-id" value={id} maxLength={20} placeholder="GK-01" onChange={e => setId(e.target.value)} onBlur={() => setId(normalizeKartId(id))} style={{ ...iS, marginBottom:12 }} /></Field>
      <Field label="Label (optional)" htmlFor="rk-label"><input id="rk-label" value={label} maxLength={80} placeholder="e.g. Green single-seater" onChange={e => setLabel(e.target.value)} style={{ ...iS, marginBottom:16 }} /></Field>
      <button type="button" disabled={busy} onClick={save} style={{ ...sB }}>{busy ? "Saving…" : "Register as Operational"}</button>
    </Modal>
  )
}

function KartDetailModal({ kart, isOwner, showToast, onViewDoc, onClose, onChanged }) {
  const [current, setCurrent] = useState(kart)
  const [data, setData] = useState(null)
  const [newStatus, setNewStatus] = useState("")
  const [note, setNote] = useState("")
  const [linkDoc, setLinkDoc] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    try { setData(await fetchKartHistory(kart.kart_id)) }
    catch (e) { showToast(e.message, "error") }
  }
  useEffect(() => { load() }, [kart.kart_id])

  async function verify() {
    if (!newStatus) { showToast("Choose the verified status.", "error"); return }
    if (note.trim().length < 10) { showToast("Write a verification note (at least 10 characters) describing the repair / checks done.", "error"); return }
    if (!confirm(`Verify ${kart.kart_id} as ${SAFETY_STATUSES[newStatus].label}? This is recorded permanently under your name.`)) return
    setBusy(true)
    try {
      const row = await verifyKartStatus(kart.kart_id, newStatus, note.trim(), linkDoc || null)
      setCurrent(row); setNewStatus(""); setNote(""); setLinkDoc("")
      await load(); await onChanged()
      showToast(`${kart.kart_id} verified as ${SAFETY_STATUSES[row.current_status].label}.`)
    } catch (e) { showToast(e.message, "error") }
    finally { setBusy(false) }
  }

  // Same rule the database enforces in verify_gokart_status(): only
  // non-rejected maintenance log entries for THIS kart can be linked.
  const logDocs = (data?.documents || []).filter(d => d.doc_type === "gokart_maintenance_log" && d.status !== "REJECTED" && (d.kart_ids || []).includes(kart.kart_id))

  return (
    <Modal title={`Kart ${kart.kart_id}`} onClose={onClose} width={820} labelId="kart-detail-title">
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:12 }}>
        <SafetyPill status={current.current_status} large />
        <span style={{ fontSize:12.5, color:C.textSub }}>{current.status_reason}</span>
      </div>

      {current.current_status === "OUT_OF_SERVICE" && (
        <div role="alert" style={{ background:C.warnSoft, border:`2px solid ${C.warnStrong}`, color:C.warnStrong, borderRadius:RADIUS.sm, padding:"10px 14px", fontSize:12.5, fontWeight:700, marginBottom:12 }}>
          This kart must not be used for guest activities. It stays Out of Service until management verifies the repair below.
        </div>
      )}

      {isOwner ? (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, padding:12, marginBottom:16, background:"#FCFCFA" }}>
          <div style={{ ...lS, marginBottom:8 }}>Verified status change (management)</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
            {Object.entries(SAFETY_STATUSES).filter(([k]) => k !== current.current_status).map(([k, s]) => (
              <button key={k} type="button" aria-pressed={newStatus === k} onClick={() => setNewStatus(k)}
                style={{ padding:"7px 12px", borderRadius:RADIUS.sm, border:`2px solid ${newStatus === k ? s.color : C.border}`, background: newStatus === k ? s.bg : C.surface, color: newStatus === k ? s.color : C.textSub, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:FONT }}>{s.emoji} {s.label}</button>
            ))}
          </div>
          <textarea aria-label="Verification note" rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Verification note — what was repaired and which safety checks were completed (required)" style={{ ...iS, resize:"vertical", marginBottom:8 }} />
          {logDocs.length > 0 && (
            <select aria-label="Link maintenance log" value={linkDoc} onChange={e => setLinkDoc(e.target.value)} style={{ ...seS, marginBottom:8, maxWidth:"100%" }}>
              <option value="">Link a maintenance log entry (optional)</option>
              {logDocs.map(d => <option key={d.id} value={d.id}>{d.reference_number} · {fmtDate(d.document_date)}</option>)}
            </select>
          )}
          <div><button type="button" disabled={busy} onClick={verify} style={primaryBtn}>{busy ? "Saving…" : "Verify status change"}</button></div>
        </div>
      ) : current.current_status !== "OPERATIONAL" && (
        <p style={{ fontSize:12.5, color:C.textSub, marginBottom:14 }}>Only management can return this kart to service after verifying repairs.</p>
      )}

      <div style={{ ...lS, marginBottom:6 }}>Status history</div>
      {!data ? <p style={{ fontSize:12.5, color:C.textFaint }}>Loading…</p> : (
        <SimpleTable minWidth={560} head={["When", "Change", "Type", "By", "Reason"]}
          rows={data.statusHistory.map(h => [fmtDateTime(h.created_at), `${SAFETY_STATUSES[h.from_status]?.label || "—"} → ${SAFETY_STATUSES[h.to_status]?.label}`, h.change_type.replace(/_/g, " ").toLowerCase(), h.actor_name, h.reason])} />
      )}

      <div style={{ ...lS, margin:"16px 0 6px" }}>Maintenance documents</div>
      {data && (data.documents.length === 0 ? <p style={{ fontSize:12.5, color:C.textFaint }}>No documents for this kart yet.</p> : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {data.documents.map(d => (
            <button key={d.id} type="button" onClick={() => { onClose(); onViewDoc(d.id) }}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", textAlign:"left", padding:"8px 10px", border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, background:C.surface, cursor:"pointer", fontFamily:FONT, fontSize:12.5 }}>
              <span><b>{d.reference_number}</b> · {DOC_TYPES[d.doc_type]?.short} · {fmtDate(d.document_date)}</span>
              <span style={{ display:"flex", gap:6 }}>{d.safety_status && <SafetyPill status={d.safety_status} />}<StatusPill status={d.status} /></span>
            </button>
          ))}
        </div>
      ))}
    </Modal>
  )
}
