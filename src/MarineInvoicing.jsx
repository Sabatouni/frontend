import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FONT, RADIUS, SPACE, C, SHADOW, iS, seS, lS, fTi, tS, pT, panelS } from "./ui/theme"
import {
  MARINE_BRAND, DOC_TYPES, DOC_TYPE_ORDER, STATUSES, CONVERSION_TARGETS, UNITS, CATALOG_CATEGORIES, CUSTOMER_FIELDS,
  CONTACT_TYPES, DEFAULT_SETTINGS, canAccessMarine, computeMarineTotals, lineAmount, formatAmount, formatTZS, formatQty,
  emptyItem, emptyScope, emptyDocumentForm, formFromDocument, bankFromSettings, validateDraft, validateForIssue,
  moveInList, newKey, customerRows,
  fetchSettings, updateSettings, listDocuments, getDocumentBundle, saveDraft, issueDocument, convertDocument,
  reviseDocument, cancelDocument, deleteDraft, logPdfEvent, listCatalog, saveCatalogItem, listScopeTemplates, saveScopeTemplate,
} from "./lib/marineInvoicing"
import { getMarinePdfBlob } from "./lib/marinePdf"
import { downloadBlob } from "./lib/salesReporting"

/**
 * MARINE INVOICING -- Swahili Marine & Diving (Marine Services Division of
 * GEC Limited): quotations, proforma invoices, final invoices.
 *
 * Access: STRICTLY Owner-only (not Admin). Three UI layers -- the Sidebar
 * entry, App()'s route gate and the check below -- all use
 * canAccessMarine(role); the real boundary is the owner-only marine_* RLS
 * policies and the Owner check inside every Marine RPC (migration
 * 20261119120000_smd_marine_invoicing_owner_only.sql).
 */

const NAVY = "#0B2A4A"
const GOLD = "#C49A2C"
const ghostBtn = { background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"8px 14px", fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT, color:C.text, whiteSpace:"nowrap" }
const primaryBtn = { background:NAVY, color:"#fff", border:"none", borderRadius:RADIUS.sm, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT, whiteSpace:"nowrap" }
const goldBtn = { ...primaryBtn, background:GOLD, color:"#1C1404" }
const dangerBtn = { ...primaryBtn, background:C.warnStrong }
const smallBtn = { ...ghostBtn, padding:"5px 9px", fontSize:12 }
const cellInput = { padding:"8px 9px", border:`1px solid ${C.border}`, borderRadius:6, fontSize:13, fontFamily:FONT, background:C.surface, color:C.text, width:"100%" }
const thS = { textAlign:"left", padding:"0 8px 8px 0", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5, whiteSpace:"nowrap" }
const sectionCard = { ...panelS, marginBottom:SPACE.md }

const TABS = [
  { id:"overview", label:"Overview", icon:"⚓" },
  { id:"create",   label:"Create Document", icon:"✏️" },
  { id:"history",  label:"Document History", icon:"🗂️" },
  { id:"catalog",  label:"Services & Materials", icon:"🧰" },
  { id:"scope",    label:"Scope of Work Library", icon:"📋" },
  { id:"settings", label:"Invoice Settings", icon:"⚙️" },
]

// ── Small shared UI ───────────────────────────────────────────────────
function StatusPill({ status }) {
  const s = STATUSES[status] || STATUSES.DRAFT
  return <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:RADIUS.pill, fontSize:11, fontWeight:700, color:s.color, background:s.bg, border:`1px solid ${s.color}33`, whiteSpace:"nowrap" }}>{s.label}</span>
}
function TypePill({ type }) {
  const t = DOC_TYPES[type]
  return <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, color:NAVY, background:"#EAF2FB", whiteSpace:"nowrap" }}>{t?.short || type}</span>
}
function Badge({ manual }) {
  return (
    <span title={manual ? "Entered manually -- will not change when lines change" : "Calculated automatically"}
      style={{ marginLeft:6, padding:"1px 7px", borderRadius:RADIUS.pill, fontSize:10, fontWeight:700, letterSpacing:.4,
        color: manual ? "#7A5A12" : C.accentStrong, background: manual ? "#FBF0D9" : C.accentSoft, border:`1px solid ${manual ? "#E5C97A" : "#B9D8C8"}` }}>
      {manual ? "MANUAL" : "AUTO"}
    </span>
  )
}

function Modal({ title, onClose, children, width = 720, labelId = "marine-modal-title" }) {
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

function Field({ label, htmlFor, children, style, hint }) {
  return (
    <div style={{ minWidth:0, ...style }}>
      <label style={lS} htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:11.5, color:C.textFaint, marginTop:4 }}>{hint}</div>}
    </div>
  )
}

function ErrorBox({ errors }) {
  if (!errors?.length) return null
  return (
    <div role="alert" style={{ background:C.warnSoft, border:`1px solid ${C.warn}`, color:C.warnStrong, borderRadius:RADIUS.sm, padding:"10px 14px", fontSize:13, marginBottom:SPACE.md }}>
      {errors.length === 1 ? errors[0] : <ul style={{ margin:0, paddingLeft:18 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  )
}

/** Locked preview of the permanent header -- shown so users can see it is not editable. */
function LogoMissingNotice() {
  return (
    <div role="status" style={{ background:"#FBF0D9", border:"1px solid #E5C97A", color:"#7A5A12", borderRadius:RADIUS.sm, padding:"8px 12px", fontSize:12.5, marginBottom:SPACE.md }}>
      ⚠ The official GEC Limited logo is not installed, so PDFs are generated without it. Add the file at <code>public{MARINE_BRAND.logoUrl}</code> and redeploy — every PDF (including reprints of issued documents) will then include it.
    </div>
  )
}

function BrandStrip({ compact }) {
  const [missing, setMissing] = useState(false)
  return (
    <>
    {missing && <LogoMissingNotice />}
    <div style={{ display:"flex", alignItems:"center", gap:14, background:NAVY, color:"#fff", borderRadius:RADIUS.md, padding: compact ? "10px 14px" : "14px 18px", borderBottom:`3px solid ${GOLD}`, marginBottom:SPACE.md }}>
      {!missing && <img src={MARINE_BRAND.logoUrl} alt="GEC Limited" onError={() => setMissing(true)} style={{ height: compact ? 34 : 44, background:"#fff", borderRadius:6, padding:3 }} />}
      <div style={{ minWidth:0 }}>
        <div style={{ fontFamily:"Georgia, 'Times New Roman', serif", fontWeight:700, fontSize: compact ? 15 : 18, letterSpacing:.3 }}>{MARINE_BRAND.division}</div>
        <div style={{ color:GOLD, fontSize:11, fontWeight:700, letterSpacing:2 }}>{MARINE_BRAND.divisionLine}</div>
        <div style={{ fontSize:11.5, opacity:.8, fontStyle:"italic" }}>{MARINE_BRAND.parentLine}</div>
      </div>
    </div>
    </>
  )
}

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

function PdfPreviewModal({ title, blob, filename, logoMissing, onClose, onDownload, onPrint }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <Modal title={title} onClose={onClose} width={880} labelId="marine-pdf-title">
      {logoMissing && <LogoMissingNotice />}
      <div style={{ height:"min(70vh, 900px)", border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, overflow:"hidden", background:C.bg }}>
        <iframe src={url} title={title} style={{ width:"100%", height:"100%", border:"none" }} />
      </div>
      <div style={{ display:"flex", gap:10, marginTop:14, flexWrap:"wrap", justifyContent:"flex-end" }}>
        <button type="button" style={ghostBtn} onClick={onClose}>Close</button>
        <button type="button" style={ghostBtn} onClick={() => { printPdfUrl(url); onPrint?.() }}>🖨️ Print</button>
        <button type="button" style={primaryBtn} onClick={() => { downloadBlob(blob, filename); onDownload?.() }}>⬇ Download PDF</button>
      </div>
    </Modal>
  )
}

/** Builds the PDF props for a stored document bundle. */
function pdfArgsFromBundle(bundle, settings) {
  const byId = Object.fromEntries((bundle.related || []).map(r => [r.id, r]))
  return {
    doc: bundle.doc, items: bundle.items, scope: bundle.scope, settings,
    sourceDoc: bundle.doc.source_document_id ? byId[bundle.doc.source_document_id] : null,
    revisionOf: bundle.doc.revision_of_id ? byId[bundle.doc.revision_of_id] : null,
  }
}

// ── Page ──────────────────────────────────────────────────────────────
export default function MarineInvoicingPage({ user, role, showToast: rawToast }) {
  // App() recreates showToast on every render (it re-renders on a 5s data
  // poll); a stable wrapper keeps the list effects below from refetching.
  const toastRef = useRef(rawToast)
  toastRef.current = rawToast
  const showToast = useCallback((...args) => toastRef.current?.(...args), [])
  const [tab, setTab] = useState("overview")
  const [settings, setSettings] = useState(null)
  const [settingsErr, setSettingsErr] = useState("")
  const [editor, setEditor] = useState(null) // { id?, type, nonce }
  const [viewId, setViewId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadSettings = useCallback(async () => {
    try { setSettings(await fetchSettings()); setSettingsErr("") }
    catch (e) { setSettings({ ...DEFAULT_SETTINGS }); setSettingsErr(e.message) }
  }, [])
  const allowed = canAccessMarine(role)
  useEffect(() => { if (allowed) loadSettings() }, [allowed, loadSettings])

  // Layer 3 of the access gate (see header comment). Strictly Owner.
  if (!allowed) return null

  const openEditor = (opts) => { setEditor({ nonce: newKey(), type: "QUOTATION", ...opts }); setTab("create"); setViewId(null) }
  const bump = () => setRefreshKey(k => k + 1)

  const tabBtn = (active) => ({
    padding:"9px 14px", borderRadius:RADIUS.sm, border:`1.5px solid ${active ? NAVY : C.border}`,
    background: active ? NAVY : C.surface, color: active ? "#fff" : C.textSub,
    fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT, whiteSpace:"nowrap",
  })

  return (
    <div>
      <h1 style={pT}>Marine Invoicing</h1>
      <p style={{ margin:"0 0 16px", color:C.textSub, fontSize:13 }}>
        Quotations, proforma invoices and final invoices issued by {MARINE_BRAND.division} — {MARINE_BRAND.divisionLine.toLowerCase()} of {MARINE_BRAND.parent}.
      </p>
      {settingsErr && <ErrorBox errors={[settingsErr]} />}

      <div role="tablist" style={{ display:"flex", gap:8, marginBottom:SPACE.lg, overflowX:"auto", paddingBottom:4 }}>
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            onClick={() => { setTab(t.id); if (t.id === "create" && !editor) openEditor({}) }} style={tabBtn(tab === t.id)}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {!settings ? <div style={{ color:C.textFaint, fontSize:13 }}>Loading…</div> : (
        <>
          {tab === "overview" && <Overview key={`o-${refreshKey}`} onNew={(type) => openEditor({ type })} onView={setViewId} showToast={showToast} />}
          {tab === "create" && editor && (
            <DocumentEditor key={editor.nonce} docId={editor.id} initialType={editor.type} settings={settings} user={user} showToast={showToast}
              onDone={(doc) => { bump(); setEditor(null); setTab("history"); if (doc) setViewId(doc.id) }}
              onCancel={() => { setEditor(null); setTab("history") }} />
          )}
          {tab === "history" && <DocumentHistory key={`h-${refreshKey}`} onView={setViewId} showToast={showToast} />}
          {tab === "catalog" && <CatalogLibrary showToast={showToast} />}
          {tab === "scope" && <ScopeLibrary showToast={showToast} />}
          {tab === "settings" && <SettingsPanel settings={settings} canEdit={canAccessMarine(role)} showToast={showToast} onSaved={loadSettings} />}
        </>
      )}

      {viewId && settings && (
        <DocumentViewer id={viewId} settings={settings} user={user} showToast={showToast}
          onClose={() => setViewId(null)} onOpen={setViewId} onChanged={bump}
          onEdit={(id) => openEditor({ id })} />
      )}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────
function Overview({ onNew, onView, showToast }) {
  const [docs, setDocs] = useState(null)
  const year = new Date().getFullYear()
  useEffect(() => {
    listDocuments({ from: `${year}-01-01`, limit: 1000 }).then(setDocs).catch(e => { setDocs([]); showToast(e.message, "error") })
  }, [year, showToast])

  const stats = useMemo(() => {
    const s = { drafts: 0, QUOTATION: 0, PROFORMA: 0, INVOICE: 0, invoiced: 0, quoted: 0 }
    for (const d of docs || []) {
      if (d.status === "DRAFT") { s.drafts++; continue }
      if (d.status === "CANCELLED") continue
      s[d.doc_type]++
      if (d.doc_type === "INVOICE") s.invoiced += Number(d.total_due || 0)
      if (d.doc_type === "QUOTATION") s.quoted += Number(d.total_due || 0)
    }
    return s
  }, [docs])

  const card = (label, value, sub, color) => (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md, padding:"14px 16px", boxShadow:SHADOW.card, borderTop:`3px solid ${color || NAVY}` }}>
      <div style={{ fontSize:11, fontWeight:600, color:C.textSub, textTransform:"uppercase", letterSpacing:.5 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:800, color:C.text, marginTop:4 }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:C.textFaint, marginTop:2 }}>{sub}</div>}
    </div>
  )

  return (
    <div>
      <BrandStrip />
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:SPACE.lg }}>
        {DOC_TYPE_ORDER.map(t => (
          <button key={t} type="button" style={t === "QUOTATION" ? goldBtn : primaryBtn} onClick={() => onNew(t)}>+ New {DOC_TYPES[t].label}</button>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))", gap:12, marginBottom:SPACE.lg }}>
        {card(`Quotations ${year}`, docs ? stats.QUOTATION : "…", docs ? formatTZS(stats.quoted) : "", GOLD)}
        {card(`Proforma ${year}`, docs ? stats.PROFORMA : "…")}
        {card(`Invoices ${year}`, docs ? stats.INVOICE : "…", docs ? formatTZS(stats.invoiced) : "", C.accentStrong)}
        {card("Open drafts", docs ? stats.drafts : "…", "Not yet numbered", "#7A5A12")}
      </div>
      <div style={sectionCard}>
        <h2 style={fTi}>Recent documents</h2>
        <DocumentTable docs={(docs || []).slice(0, 8)} loading={!docs} onView={onView} />
      </div>
    </div>
  )
}

function DocumentTable({ docs, loading, onView }) {
  if (loading) return <div style={{ color:C.textFaint, fontSize:13 }}>Loading…</div>
  if (!docs.length) return <div style={{ color:C.textFaint, fontSize:13, padding:"12px 0" }}>No documents found.</div>
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:640 }}>
        <thead><tr>{["Number","Type","Date","Customer","Total","Status",""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {docs.map(d => (
            <tr key={d.id} style={{ borderTop:`1px solid ${C.border}` }}>
              <td style={{ ...tS, fontWeight:700, whiteSpace:"nowrap" }}>{d.document_number || <span style={{ color:C.textFaint, fontWeight:500 }}>Draft</span>}</td>
              <td style={tS}><TypePill type={d.doc_type} /></td>
              <td style={{ ...tS, whiteSpace:"nowrap", color:C.textSub }}>{d.document_date}</td>
              <td style={{ ...tS, maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.customer_name || <span style={{ color:C.textFaint }}>—</span>}</td>
              <td style={{ ...tS, whiteSpace:"nowrap", fontWeight:600, textAlign:"right" }}>{formatTZS(d.total_due, d.currency)}</td>
              <td style={tS}><StatusPill status={d.status} /></td>
              <td style={{ ...tS, textAlign:"right" }}><button type="button" style={smallBtn} onClick={() => onView(d.id)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── History / document management ─────────────────────────────────────
function DocumentHistory({ onView, showToast }) {
  const [filters, setFilters] = useState({ search:"", docType:"", status:"", from:"", to:"" })
  const [docs, setDocs] = useState(null)
  const [debounced, setDebounced] = useState(filters)
  useEffect(() => { const t = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(t) }, [filters])
  useEffect(() => {
    let alive = true
    setDocs(null)
    listDocuments(debounced).then(d => { if (alive) setDocs(d) }).catch(e => { if (alive) { setDocs([]); showToast(e.message, "error") } })
    return () => { alive = false }
  }, [debounced, showToast])
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))

  return (
    <div style={sectionCard}>
      <h2 style={fTi}>Document history</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:10, marginBottom:SPACE.md }}>
        <Field label="Search" htmlFor="mh-search" style={{ gridColumn:"span 2" }}>
          <input id="mh-search" style={iS} placeholder="Document number or customer…" value={filters.search} onChange={set("search")} />
        </Field>
        <Field label="Type" htmlFor="mh-type">
          <select id="mh-type" style={{ ...seS, width:"100%" }} value={filters.docType} onChange={set("docType")}>
            <option value="">All types</option>
            {DOC_TYPE_ORDER.map(t => <option key={t} value={t}>{DOC_TYPES[t].label}</option>)}
          </select>
        </Field>
        <Field label="Status" htmlFor="mh-status">
          <select id="mh-status" style={{ ...seS, width:"100%" }} value={filters.status} onChange={set("status")}>
            <option value="">All statuses</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="mh-from"><input id="mh-from" type="date" style={iS} value={filters.from} onChange={set("from")} /></Field>
        <Field label="To" htmlFor="mh-to"><input id="mh-to" type="date" style={iS} value={filters.to} onChange={set("to")} /></Field>
      </div>
      {(filters.search || filters.docType || filters.status || filters.from || filters.to) && (
        <button type="button" style={{ ...smallBtn, marginBottom:10 }} onClick={() => setFilters({ search:"", docType:"", status:"", from:"", to:"" })}>Clear filters</button>
      )}
      <DocumentTable docs={docs || []} loading={!docs} onView={onView} />
    </div>
  )
}

function ConfirmModal({ title, children, confirmLabel, danger, busy, onConfirm, onClose, disabled }) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} width={480} labelId="marine-confirm-title">
      <div style={{ fontSize:13.5, color:C.textSub, lineHeight:1.55 }}>{children}</div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:18 }}>
        <button type="button" style={ghostBtn} onClick={onClose} disabled={busy}>Back</button>
        <button type="button" style={{ ...(danger ? dangerBtn : primaryBtn), opacity: busy || disabled ? .6 : 1 }} disabled={busy || disabled} onClick={onConfirm}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

function DocumentViewer({ id, settings, user, showToast, onClose, onOpen, onChanged, onEdit }) {
  const [bundle, setBundle] = useState(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [pdf, setPdf] = useState(null)
  const [confirm, setConfirm] = useState(null) // { kind, target? }
  const [reason, setReason] = useState("")

  const load = useCallback(() => {
    setBundle(null); setErr("")
    getDocumentBundle(id).then(setBundle).catch(e => setErr(e.message))
  }, [id])
  useEffect(load, [load])

  const act = async (fn, okMsg) => {
    setBusy(true)
    try { const res = await fn(); showToast(okMsg(res)); onChanged(); setConfirm(null); return res }
    catch (e) { showToast(e.message, "error") }
    finally { setBusy(false) }
  }

  const openPdf = async () => {
    setBusy(true)
    try { setPdf(await getMarinePdfBlob(pdfArgsFromBundle(bundle, settings))) }
    catch (e) { showToast(`Could not generate PDF: ${e.message}`, "error") }
    finally { setBusy(false) }
  }

  if (err) return <Modal title="Document" onClose={onClose}><ErrorBox errors={[err]} /></Modal>
  if (!bundle) return <Modal title="Document" onClose={onClose}><div style={{ color:C.textFaint }}>Loading…</div></Modal>

  const { doc, items, scope, events, related } = bundle
  const type = DOC_TYPES[doc.doc_type]
  const t = computeMarineTotals({ ...doc, items })
  const isDraft = doc.status === "DRAFT"
  const isIssued = doc.status === "ISSUED"
  const cust = customerRows(doc)
  const bank = doc.bank_details || {}

  return (
    <Modal title={`${type.label} ${doc.document_number || "(draft)"}`} onClose={onClose} width={900} labelId="marine-view-title">
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:14 }}>
        <StatusPill status={doc.status} /><TypePill type={doc.doc_type} />
        <span style={{ fontSize:12.5, color:C.textSub }}>Dated {doc.document_date}{doc.issued_at ? ` · issued ${new Date(doc.issued_at).toLocaleString()} by ${doc.issued_by_name || "—"}` : ""}</span>
      </div>
      {doc.status === "CANCELLED" && <ErrorBox errors={[`Cancelled${doc.cancelled_by_name ? " by " + doc.cancelled_by_name : ""}: ${doc.cancel_reason || "no reason recorded"}`]} />}

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:SPACE.md }}>
        <button type="button" style={primaryBtn} disabled={busy} onClick={openPdf}>{isDraft ? "Preview PDF" : "View / Reprint PDF"}</button>
        {isDraft && <button type="button" style={ghostBtn} onClick={() => onEdit(doc.id)}>✏️ Edit draft</button>}
        {isDraft && <button type="button" style={goldBtn} disabled={busy} onClick={() => setConfirm({ kind:"issue" })}>Issue {type.label}</button>}
        {isDraft && <button type="button" style={{ ...ghostBtn, color:C.warnStrong }} onClick={() => setConfirm({ kind:"delete" })}>Delete draft</button>}
        {isIssued && CONVERSION_TARGETS[doc.doc_type].map(target => (
          <button key={target} type="button" style={goldBtn} disabled={busy} onClick={() => setConfirm({ kind:"convert", target })}>Convert to {DOC_TYPES[target].label}</button>
        ))}
        {isIssued && <button type="button" style={ghostBtn} disabled={busy} onClick={() => setConfirm({ kind:"revise" })}>Revise</button>}
        {isIssued && <button type="button" style={{ ...ghostBtn, color:C.warnStrong }} onClick={() => { setReason(""); setConfirm({ kind:"cancel" }) }}>Cancel document</button>}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:14, marginBottom:SPACE.md }}>
        <div style={{ background:C.bg, borderRadius:RADIUS.sm, padding:12 }}>
          <div style={lS}>Customer</div>
          {cust.length ? cust.map(([k, v]) => <div key={k} style={{ fontSize:13, marginBottom:3 }}><span style={{ color:C.textFaint }}>{k}:</span> {v}</div>) : <div style={{ fontSize:13, color:C.textFaint }}>No customer details</div>}
        </div>
        <div style={{ background:C.bg, borderRadius:RADIUS.sm, padding:12 }}>
          <div style={lS}>Payment details {isDraft ? "(draft)" : "(snapshot at issue)"}</div>
          {[["Bank", bank.bank_name], ["Account name", bank.account_name], ["Account number", bank.account_number], ["Branch", bank.branch], ["Currency", bank.currency]]
            .filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ fontSize:13, marginBottom:3 }}><span style={{ color:C.textFaint }}>{k}:</span> {v}</div>)}
          {!Object.values(bank).some(Boolean) && <div style={{ fontSize:13, color:C.textFaint }}>Defaults will be captured when issued</div>}
        </div>
      </div>

      {doc.subject && <p style={{ fontSize:13.5, margin:"0 0 12px" }}><strong>Subject:</strong> {doc.subject}</p>}

      {scope.length > 0 && (
        <div style={{ marginBottom:SPACE.md }}>
          <div style={lS}>Scope of work</div>
          <ol style={{ margin:0, paddingLeft:20, fontSize:13.5 }}>
            {scope.map(s => <li key={s.id} style={{ marginBottom:4, whiteSpace:"pre-wrap" }}>{s.title && <strong>{s.title}{s.description ? ": " : ""}</strong>}{s.description}</li>)}
          </ol>
        </div>
      )}

      <div style={{ overflowX:"auto", marginBottom:SPACE.md }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:520 }}>
          <thead><tr>{["#","Description","Qty","Unit price","Amount"].map((h, i) => <th key={h} style={{ ...thS, textAlign: i >= 2 ? "right" : "left" }}>{h}</th>)}</tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} style={{ background: i % 2 ? "#EAF2FB" : "transparent" }}>
                <td style={{ ...tS, paddingLeft:6 }}>{i + 1}</td>
                <td style={{ ...tS, whiteSpace:"pre-wrap" }}>{it.description}</td>
                <td style={{ ...tS, textAlign:"right", whiteSpace:"nowrap" }}>{formatQty(it.quantity)} {it.unit}</td>
                <td style={{ ...tS, textAlign:"right" }}>{formatAmount(it.unit_price)}</td>
                <td style={{ ...tS, textAlign:"right", fontWeight:600 }}>{formatAmount(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TotalsBreakdown form={doc} totals={isDraft ? t : {
        ...t, subtotal:Number(doc.subtotal), taxable:Number(doc.taxable_amount), vatCalculated:Number(doc.vat_calculated), vat:Number(doc.vat_amount),
        calculatedTotal:Number(doc.calculated_total), totalDue:Number(doc.total_due), adjustment:Number(doc.total_due) - Number(doc.calculated_total),
      }} />

      {related.length > 0 && (
        <div style={{ marginTop:SPACE.md }}>
          <div style={lS}>Related documents</div>
          {related.map(r => {
            const rel = r.id === doc.source_document_id ? "Converted from" : r.id === doc.revision_of_id ? "Revision of"
              : r.id === doc.superseded_by_id ? "Superseded by" : r.source_document_id === doc.id ? "Converted to" : "Revised as"
            return (
              <div key={r.id} style={{ display:"flex", gap:8, alignItems:"center", fontSize:13, padding:"6px 0", borderTop:`1px solid ${C.border}`, flexWrap:"wrap" }}>
                <span style={{ color:C.textFaint, minWidth:110 }}>{rel}</span>
                <TypePill type={r.doc_type} />
                <button type="button" onClick={() => onOpen(r.id)} style={{ background:"none", border:"none", color:NAVY, fontWeight:700, cursor:"pointer", padding:0, fontFamily:FONT, textDecoration:"underline" }}>{r.document_number || "Draft"}</button>
                <StatusPill status={r.status} />
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop:SPACE.md }}>
        <div style={lS}>History</div>
        {events.map(e => (
          <div key={e.id} style={{ fontSize:12.5, color:C.textSub, padding:"4px 0" }}>
            <span style={{ color:C.textFaint }}>{new Date(e.created_at).toLocaleString()}</span> · <strong style={{ color:C.text }}>{e.event.replace("_", " ").toLowerCase()}</strong>
            {e.note ? ` — ${e.note}` : ""}{e.actor_name ? ` · ${e.actor_name}` : ""}
          </div>
        ))}
      </div>

      {pdf && (
        <PdfPreviewModal title={`${type.label} ${doc.document_number || "draft"}`} blob={pdf.blob} filename={pdf.filename} logoMissing={pdf.logoMissing} onClose={() => setPdf(null)}
          onDownload={() => !isDraft && logPdfEvent(doc.id, "download", user?.id)}
          onPrint={() => !isDraft && logPdfEvent(doc.id, "print", user?.id)} />
      )}

      {confirm?.kind === "issue" && (
        <ConfirmModal title={`Issue ${type.label}?`} confirmLabel="Issue and assign number" busy={busy} onClose={() => setConfirm(null)}
          onConfirm={() => act(() => issueDocument(doc.id), r => { load(); return `Issued ${r.document_number}` })}>
          A permanent {type.prefix}-{new Date().getFullYear()}-### number will be assigned and the document, its banking details and footer contacts will be frozen. Corrections after this require a revision or cancellation.
        </ConfirmModal>
      )}
      {confirm?.kind === "delete" && (
        <ConfirmModal title="Delete this draft?" danger confirmLabel="Delete draft" busy={busy} onClose={() => setConfirm(null)}
          onConfirm={() => act(() => deleteDraft(doc.id), () => { onClose(); return "Draft deleted" })}>
          The draft has no number yet, so deleting it leaves no gap in the numbering. This cannot be undone.
        </ConfirmModal>
      )}
      {confirm?.kind === "convert" && (
        <ConfirmModal title={`Convert to ${DOC_TYPES[confirm.target].label}?`} confirmLabel="Create converted draft" busy={busy} onClose={() => setConfirm(null)}
          onConfirm={() => act(() => convertDocument(doc.id, confirm.target), (newId) => { onEdit(newId); return "Converted draft created — review and issue it" })}>
          A new {DOC_TYPES[confirm.target].label} draft is created with the same customer, scope of work, lines, prices, VAT and banking details. {doc.document_number} stays unchanged; it is marked <strong>Converted</strong> once the new document is issued.
        </ConfirmModal>
      )}
      {confirm?.kind === "revise" && (
        <ConfirmModal title="Create a revision?" confirmLabel="Create revision draft" busy={busy} onClose={() => setConfirm(null)}
          onConfirm={() => act(() => reviseDocument(doc.id), (newId) => { onEdit(newId); return "Revision draft created" })}>
          A copy of {doc.document_number} opens as a draft for correction. When the revision is issued it receives a new number and {doc.document_number} is cancelled as superseded — the original record is kept.
        </ConfirmModal>
      )}
      {confirm?.kind === "cancel" && (
        <ConfirmModal title={`Cancel ${doc.document_number}?`} danger confirmLabel="Cancel document" busy={busy} disabled={reason.trim().length < 5}
          onClose={() => setConfirm(null)} onConfirm={() => act(() => cancelDocument(doc.id, reason.trim()), r => { load(); return `${r.document_number} cancelled` })}>
          <p style={{ marginTop:0 }}>The document is kept on record and marked cancelled. Its number is never reused.</p>
          <label style={lS} htmlFor="marine-cancel-reason">Reason (required)</label>
          <textarea id="marine-cancel-reason" style={{ ...iS, minHeight:70 }} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
        </ConfirmModal>
      )}
    </Modal>
  )
}

// ── Totals breakdown (editor + viewer) ────────────────────────────────
function TotalsBreakdown({ form, totals: t }) {
  const cur = form.currency || "TZS"
  const row = (label, value, opts = {}) => (
    <div style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"6px 0", borderBottom:`1px solid ${C.border}`, fontSize:13.5, color: opts.muted ? C.textFaint : C.text }}>
      <span>{label}{opts.badge !== undefined && <Badge manual={opts.badge} />}</span>
      <span style={{ fontWeight:600, whiteSpace:"nowrap" }}>{value}</span>
    </div>
  )
  return (
    <div style={{ maxWidth:440, marginLeft:"auto" }}>
      {row("Subtotal", formatAmount(t.subtotal), { badge:false })}
      {t.discount > 0 && row(`Less: ${form.discount_label || "Discount"}`, `− ${formatAmount(t.discount)}`)}
      {t.extraCharges > 0 && row(`Add: ${form.extra_charge_label || "Additional charges"}`, formatAmount(t.extraCharges))}
      {(t.discount > 0 || t.extraCharges > 0) && row("Amount before VAT", formatAmount(t.taxable), { badge:false })}
      {form.vat_enabled
        ? <>
            {row(`VAT (${Number(form.vat_percent || 0)}%)`, formatAmount(t.vat), { badge:t.vatOverridden })}
            {t.vatOverridden && row(`Calculated VAT would be`, formatAmount(t.vatCalculated), { muted:true })}
          </>
        : row("VAT", "Disabled", { muted:true })}
      {t.totalOverridden && row("Calculated total", formatAmount(t.calculatedTotal), { muted:true })}
      {t.totalOverridden && Math.abs(t.adjustment) >= 0.005 && row(`Adjustment${form.total_override_reason ? ` (${form.total_override_reason})` : ""}`, `${t.adjustment < 0 ? "− " : "+ "}${formatAmount(Math.abs(t.adjustment))}`, { badge:true })}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginTop:8, padding:"12px 14px", background:NAVY, borderLeft:`5px solid ${GOLD}`, borderRadius:6, color:"#fff" }}>
        <span style={{ color:GOLD, fontWeight:800, letterSpacing:1, fontSize:13 }}>TOTAL DUE{t.totalOverridden && <Badge manual />}</span>
        <span style={{ fontWeight:800, fontSize:17, whiteSpace:"nowrap" }}>{cur} {formatAmount(t.totalDue)}</span>
      </div>
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────
function DocumentEditor({ docId, initialType, settings, user, showToast, onDone, onCancel }) {
  const [id, setId] = useState(docId || null)
  const [meta, setMeta] = useState(null) // { source/revision ids + numbers }
  const [form, setForm] = useState(() => emptyDocumentForm(settings, initialType))
  const [items, setItems] = useState(() => [emptyItem()])
  const [scope, setScope] = useState(() => [emptyScope()])
  const [loading, setLoading] = useState(!!docId)
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [picker, setPicker] = useState(null) // "catalog" | "scope"
  const [pdf, setPdf] = useState(null)
  const [confirmIssue, setConfirmIssue] = useState(false)
  const requestId = useRef(newKey())

  useEffect(() => {
    if (!docId) return
    getDocumentBundle(docId).then(b => {
      if (b.doc.status !== "DRAFT") { setErrors([`${b.doc.document_number} is ${b.doc.status.toLowerCase()} and can't be edited. Use Revise instead.`]); setLoading(false); return }
      const f = formFromDocument(b.doc, b.items, b.scope)
      setForm(f.form)
      setItems(f.items.length ? f.items : [emptyItem()])
      setScope(f.scope.length ? f.scope : [emptyScope()])
      const byId = Object.fromEntries(b.related.map(r => [r.id, r]))
      setMeta({ source: byId[b.doc.source_document_id], revisionOf: byId[b.doc.revision_of_id], locked: !!(b.doc.source_document_id || b.doc.revision_of_id) })
      setLoading(false)
    }).catch(e => { setErrors([e.message]); setLoading(false) })
  }, [docId])

  const upd = (patch) => { setForm(f => ({ ...f, ...patch })); setDirty(true) }
  const set = (k) => (e) => upd({ [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })
  const updItem = (key, patch) => { setItems(list => list.map(i => i.key === key ? { ...i, ...patch } : i)); setDirty(true) }
  const updScope = (key, patch) => { setScope(list => list.map(s => s.key === key ? { ...s, ...patch } : s)); setDirty(true) }

  const realItems = items.filter(i => String(i.description || "").trim())
  const totals = useMemo(() => computeMarineTotals({ ...form, items: realItems }), [form, realItems])
  const type = DOC_TYPES[form.doc_type]

  const persist = async () => {
    const errs = validateDraft(form, items)
    setErrors(errs)
    if (errs.length) return null
    const doc = await saveDraft({ id, clientRequestId: requestId.current, form, items, scope })
    setId(doc.id); setDirty(false)
    return doc
  }

  const onSave = async () => {
    setBusy(true)
    try { const d = await persist(); if (d) showToast("Draft saved") }
    catch (e) { setErrors([e.message]) }
    finally { setBusy(false) }
  }

  const onIssue = async () => {
    const errs = validateForIssue(form, items)
    if (errs.length) { setErrors(errs); setConfirmIssue(false); return }
    setBusy(true)
    try {
      const d = await persist()
      if (!d) { setConfirmIssue(false); return }
      const issued = await issueDocument(d.id)
      showToast(`Issued ${issued.document_number}`)
      onDone(issued)
    } catch (e) { setErrors([e.message]); setConfirmIssue(false) }
    finally { setBusy(false) }
  }

  const onPreview = async () => {
    setBusy(true)
    try {
      const doc = { ...form, status:"DRAFT", vat_amount_override: form.vat_amount_override || null, total_override: form.total_override || null,
        discount_amount: form.discount_amount || 0, extra_charge_amount: form.extra_charge_amount || 0 }
      setPdf(await getMarinePdfBlob({ doc, items: realItems.map(i => ({ ...i, amount: lineAmount(i.quantity, i.unit_price) })), scope, settings, sourceDoc: meta?.source, revisionOf: meta?.revisionOf }))
    } catch (e) { showToast(`Could not generate PDF: ${e.message}`, "error") }
    finally { setBusy(false) }
  }

  if (loading) return <div style={{ color:C.textFaint }}>Loading draft…</div>

  const isQuote = form.doc_type === "QUOTATION"

  return (
    <div>
      <BrandStrip compact />
      <ErrorBox errors={errors} />
      {meta?.source && <div style={{ ...sectionCard, padding:"10px 16px", fontSize:13 }}>Converting from <strong>{meta.source.document_number}</strong> ({DOC_TYPES[meta.source.doc_type].label}). The original stays unchanged.</div>}
      {meta?.revisionOf && <div style={{ ...sectionCard, padding:"10px 16px", fontSize:13 }}>Revision of <strong>{meta.revisionOf.document_number}</strong>. Issuing this revision cancels the original as superseded.</div>}

      {/* Document */}
      <div style={sectionCard}>
        <h2 style={fTi}>Document</h2>
        <div role="radiogroup" aria-label="Document type" style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:SPACE.md }}>
          {DOC_TYPE_ORDER.map(t => {
            const on = form.doc_type === t
            return (
              <button key={t} type="button" role="radio" aria-checked={on} disabled={meta?.locked && !on}
                onClick={() => upd({ doc_type: t })}
                style={{ ...ghostBtn, borderColor: on ? NAVY : C.border, background: on ? NAVY : C.surface, color: on ? "#fff" : C.text, opacity: meta?.locked && !on ? .45 : 1 }}>
                {DOC_TYPES[t].label}
              </button>
            )
          })}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:12 }}>
          <Field label="Number" hint="Assigned automatically when issued"><input style={{ ...iS, background:C.bg, color:C.textFaint }} value={`${type.prefix}-${new Date().getFullYear()}-###`} readOnly aria-readonly="true" /></Field>
          <Field label="Date" htmlFor="md-date"><input id="md-date" type="date" style={iS} value={form.document_date} onChange={set("document_date")} /></Field>
          {isQuote
            ? <Field label="Valid until" htmlFor="md-valid"><input id="md-valid" type="date" style={iS} value={form.valid_until} onChange={set("valid_until")} /></Field>
            : <Field label="Due date" htmlFor="md-due"><input id="md-due" type="date" style={iS} value={form.due_date} onChange={set("due_date")} /></Field>}
          <Field label="Customer reference / PO" htmlFor="md-ref"><input id="md-ref" style={iS} maxLength={120} value={form.customer_reference} onChange={set("customer_reference")} /></Field>
          <Field label="Subject / project" htmlFor="md-subject" style={{ gridColumn:"1 / -1" }}><input id="md-subject" style={iS} maxLength={300} value={form.subject} onChange={set("subject")} placeholder="e.g. Mooring buoy replacement and servicing" /></Field>
        </div>
      </div>

      {/* Customer */}
      <div style={sectionCard}>
        <h2 style={fTi}>Customer details <span style={{ fontWeight:500, fontSize:12.5, color:C.textFaint }}>— all optional; empty fields are left off the PDF</span></h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:12 }}>
          {CUSTOMER_FIELDS.map(f => (
            <Field key={f.key} label={f.label} htmlFor={`md-${f.key}`} style={f.key === "customer_name" || f.key === "street_address" ? { gridColumn:"span 2" } : undefined}>
              <input id={`md-${f.key}`} style={iS} value={form[f.key]} onChange={set(f.key)} type={f.key === "customer_email" ? "email" : "text"} />
            </Field>
          ))}
        </div>
      </div>

      {/* Scope of work */}
      <div style={sectionCard}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <h2 style={{ ...fTi, margin:0 }}>Scope of work</h2>
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" style={ghostBtn} onClick={() => setPicker("scope")}>+ From library</button>
            <button type="button" style={ghostBtn} onClick={() => { setScope(s => [...s, emptyScope()]); setDirty(true) }}>+ Custom entry</button>
          </div>
        </div>
        {scope.length === 0 && <div style={{ color:C.textFaint, fontSize:13 }}>No scope entries — the section is left off the PDF.</div>}
        {scope.map((s, i) => (
          <div key={s.key} style={{ display:"grid", gridTemplateColumns:"28px 1fr auto", gap:10, alignItems:"start", padding:"10px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
            <div style={{ fontWeight:800, color:GOLD, paddingTop:8 }}>{i + 1}.</div>
            <div style={{ display:"grid", gap:6 }}>
              <input aria-label={`Scope ${i + 1} title`} style={cellInput} placeholder="Title (e.g. RUBANI BUOY)" maxLength={200} value={s.title} onChange={e => updScope(s.key, { title: e.target.value })} />
              <textarea aria-label={`Scope ${i + 1} description`} style={{ ...cellInput, minHeight:58, resize:"vertical" }} placeholder="Description of work…" maxLength={4000} value={s.description} onChange={e => updScope(s.key, { description: e.target.value })} />
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <button type="button" style={smallBtn} aria-label="Move up" disabled={i === 0} onClick={() => { setScope(l => moveInList(l, i, i - 1)); setDirty(true) }}>↑</button>
              <button type="button" style={smallBtn} aria-label="Move down" disabled={i === scope.length - 1} onClick={() => { setScope(l => moveInList(l, i, i + 1)); setDirty(true) }}>↓</button>
              <button type="button" style={{ ...smallBtn, color:C.warnStrong }} aria-label="Remove entry" onClick={() => { setScope(l => l.filter(x => x.key !== s.key)); setDirty(true) }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Services & materials */}
      <div style={sectionCard}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <h2 style={{ ...fTi, margin:0 }}>Services & materials</h2>
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" style={ghostBtn} onClick={() => setPicker("catalog")}>+ From library</button>
            <button type="button" style={ghostBtn} onClick={() => { setItems(l => [...l, emptyItem()]); setDirty(true) }}>+ Custom line</button>
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:720 }}>
            <thead><tr>
              <th style={thS}>#</th><th style={thS}>Description</th><th style={thS}>Unit</th>
              <th style={{ ...thS, textAlign:"right" }}>Quantity</th><th style={{ ...thS, textAlign:"right" }}>Unit price</th>
              <th style={{ ...thS, textAlign:"right" }}>Amount</th><th style={thS} />
            </tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.key} style={{ background: i % 2 ? "#EAF2FB" : "transparent", verticalAlign:"top" }}>
                  <td style={{ padding:"8px 6px", color:C.textFaint, fontSize:12.5 }}>{i + 1}</td>
                  <td style={{ padding:"6px 6px 6px 0", minWidth:240 }}>
                    <textarea aria-label={`Line ${i + 1} description`} rows={1} style={{ ...cellInput, resize:"vertical", minHeight:36 }} value={it.description} maxLength={2000} onChange={e => updItem(it.key, { description: e.target.value })} />
                  </td>
                  <td style={{ padding:"6px 6px 6px 0", width:110 }}>
                    <input aria-label={`Line ${i + 1} unit`} list="marine-units" style={cellInput} value={it.unit} maxLength={30} onChange={e => updItem(it.key, { unit: e.target.value })} />
                  </td>
                  <td style={{ padding:"6px 6px 6px 0", width:100 }}>
                    <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" style={{ ...cellInput, textAlign:"right" }} value={it.quantity} onChange={e => updItem(it.key, { quantity: e.target.value })} />
                  </td>
                  <td style={{ padding:"6px 6px 6px 0", width:140 }}>
                    <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" style={{ ...cellInput, textAlign:"right" }} value={it.unit_price} placeholder="0" onChange={e => updItem(it.key, { unit_price: e.target.value })} />
                  </td>
                  <td style={{ padding:"14px 8px 6px 0", width:130, textAlign:"right", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>{formatAmount(lineAmount(it.quantity, it.unit_price))}</td>
                  <td style={{ padding:"6px 0", whiteSpace:"nowrap" }}>
                    <button type="button" style={smallBtn} aria-label="Move up" disabled={i === 0} onClick={() => { setItems(l => moveInList(l, i, i - 1)); setDirty(true) }}>↑</button>{" "}
                    <button type="button" style={smallBtn} aria-label="Move down" disabled={i === items.length - 1} onClick={() => { setItems(l => moveInList(l, i, i + 1)); setDirty(true) }}>↓</button>{" "}
                    <button type="button" style={{ ...smallBtn, color:C.warnStrong }} aria-label="Remove line" onClick={() => { setItems(l => l.filter(x => x.key !== it.key)); setDirty(true) }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="marine-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
        </div>
      </div>

      {/* Financials */}
      <div style={sectionCard}>
        <h2 style={fTi}>VAT & totals <span style={{ fontWeight:500, fontSize:12.5, color:C.textFaint }}>— all amounts in {form.currency}</span></h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:SPACE.xl }}>
          <div style={{ display:"grid", gap:12, alignContent:"start" }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13.5, fontWeight:600, cursor:"pointer" }}>
              <input type="checkbox" checked={form.vat_enabled} onChange={set("vat_enabled")} style={{ width:18, height:18 }} /> Charge VAT on this document
            </label>
            {form.vat_enabled && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <Field label="VAT %" htmlFor="md-vatp"><input id="md-vatp" inputMode="decimal" style={iS} value={form.vat_percent} onChange={set("vat_percent")} /></Field>
                <Field label="Manual VAT amount" htmlFor="md-vato" hint={form.vat_amount_override ? `Calculated: ${formatAmount(totals.vatCalculated)}` : "Leave blank to calculate"}>
                  <div style={{ display:"flex", gap:6 }}>
                    <input id="md-vato" inputMode="decimal" style={iS} value={form.vat_amount_override} placeholder={formatAmount(totals.vatCalculated)} onChange={set("vat_amount_override")} />
                    {form.vat_amount_override && <button type="button" style={smallBtn} title="Return to automatic VAT" onClick={() => upd({ vat_amount_override:"" })}>Auto</button>}
                  </div>
                </Field>
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr", gap:10 }}>
              <Field label="Discount label" htmlFor="md-dl"><input id="md-dl" style={iS} maxLength={120} placeholder="Discount" value={form.discount_label} onChange={set("discount_label")} /></Field>
              <Field label="Discount amount" htmlFor="md-da"><input id="md-da" inputMode="decimal" style={iS} placeholder="0" value={form.discount_amount} onChange={set("discount_amount")} /></Field>
              <Field label="Additional charge label" htmlFor="md-cl"><input id="md-cl" style={iS} maxLength={120} placeholder="e.g. Mobilisation" value={form.extra_charge_label} onChange={set("extra_charge_label")} /></Field>
              <Field label="Additional charge amount" htmlFor="md-ca"><input id="md-ca" inputMode="decimal" style={iS} placeholder="0" value={form.extra_charge_amount} onChange={set("extra_charge_amount")} /></Field>
            </div>
            <div style={{ background:"#FBF5E4", border:`1px solid #E5C97A`, borderRadius:RADIUS.sm, padding:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1.3fr", gap:10 }}>
                <Field label="Manual total due" htmlFor="md-to" hint="Overrides the calculated total">
                  <input id="md-to" inputMode="decimal" style={iS} value={form.total_override} placeholder={formatAmount(totals.calculatedTotal)} onChange={set("total_override")} />
                </Field>
                <Field label="Reason for adjustment" htmlFor="md-tr">
                  <input id="md-tr" style={iS} maxLength={300} value={form.total_override_reason} disabled={!form.total_override} placeholder="e.g. Rounded as agreed" onChange={set("total_override_reason")} />
                </Field>
              </div>
              {form.total_override && <button type="button" style={{ ...smallBtn, marginTop:8 }} onClick={() => upd({ total_override:"", total_override_reason:"" })}>Return to calculated total</button>}
            </div>
          </div>
          <TotalsBreakdown form={form} totals={totals} />
        </div>
      </div>

      {/* Banking */}
      <div style={sectionCard}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <h2 style={{ ...fTi, margin:0 }}>Payment & banking details</h2>
          <button type="button" style={ghostBtn} onClick={() => upd({ bank_details: bankFromSettings(settings) })}>Reset to defaults</button>
        </div>
        <p style={{ margin:"0 0 12px", fontSize:12.5, color:C.textFaint }}>Changes here apply to this document only — the global defaults in Invoice Settings are not modified. Details are frozen when the document is issued.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:12 }}>
          {[["bank_name","Bank"],["account_name","Account name"],["account_number","Account number"],["branch","Branch"],["currency","Currency"]].map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`md-bank-${k}`}>
              <input id={`md-bank-${k}`} style={iS} value={form.bank_details?.[k] || ""} maxLength={160}
                onChange={e => upd({ bank_details: { ...form.bank_details, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </div>

      <div style={sectionCard}>
        <h2 style={fTi}>Notes & terms</h2>
        <textarea aria-label="Notes and terms" style={{ ...iS, minHeight:80, resize:"vertical" }} maxLength={4000} value={form.notes} onChange={set("notes")} placeholder="Payment terms, validity, exclusions…" />
      </div>

      <div style={{ position:"sticky", bottom:0, background:C.bg, padding:"12px 0", display:"flex", gap:10, flexWrap:"wrap", justifyContent:"flex-end", borderTop:`1px solid ${C.border}`, zIndex:5 }}>
        <span style={{ marginRight:"auto", alignSelf:"center", fontSize:13, color:C.textSub }}>
          Total due <strong style={{ color:C.text }}>{formatTZS(totals.totalDue, form.currency)}</strong>{dirty ? " · unsaved changes" : id ? " · saved" : ""}
        </span>
        <button type="button" style={ghostBtn} disabled={busy} onClick={onCancel}>Close</button>
        <button type="button" style={ghostBtn} disabled={busy} onClick={onPreview}>Preview PDF</button>
        <button type="button" style={primaryBtn} disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save draft"}</button>
        <button type="button" style={goldBtn} disabled={busy} onClick={() => {
          const errs = validateForIssue(form, items); setErrors(errs); if (!errs.length) setConfirmIssue(true)
        }}>Issue {type.label}</button>
      </div>

      {picker === "catalog" && (
        <CatalogPicker onClose={() => setPicker(null)} onPick={(c) => {
          const line = emptyItem({ description: c.name, unit: c.unit, quantity:"1", unit_price: String(c.default_unit_price), catalog_item_id: c.id })
          setItems(l => {
            const blankIdx = l.findIndex(x => !String(x.description).trim() && !String(x.unit_price).trim())
            return blankIdx >= 0 ? l.map((x, i) => i === blankIdx ? line : x) : [...l, line]
          })
          setDirty(true)
        }} />
      )}
      {picker === "scope" && (
        <ScopePicker onClose={() => setPicker(null)} onPick={(tpl) => {
          const entry = emptyScope({ title: tpl.title, description: tpl.description, template_id: tpl.id })
          setScope(l => {
            const blankIdx = l.findIndex(x => !String(x.title).trim() && !String(x.description).trim())
            return blankIdx >= 0 ? l.map((x, i) => i === blankIdx ? entry : x) : [...l, entry]
          })
          setDirty(true)
        }} />
      )}
      {pdf && <PdfPreviewModal title={`Preview — ${type.label} (draft)`} blob={pdf.blob} filename={pdf.filename} logoMissing={pdf.logoMissing} onClose={() => setPdf(null)} />}
      {confirmIssue && (
        <ConfirmModal title={`Issue this ${type.label}?`} confirmLabel={`Issue — ${formatTZS(totals.totalDue, form.currency)}`} busy={busy} onClose={() => setConfirmIssue(false)} onConfirm={onIssue}>
          The draft is saved, then a permanent {type.prefix}-{new Date().getFullYear()}-### number is assigned. Content, banking details and footer contacts are frozen; later corrections need a revision or cancellation.
          {totals.totalOverridden && <p style={{ marginBottom:0 }}><strong>Note:</strong> the total due has been set manually ({formatAmount(totals.totalDue)} vs calculated {formatAmount(totals.calculatedTotal)}).</p>}
          {totals.vatOverridden && <p style={{ marginBottom:0 }}><strong>Note:</strong> VAT has been set manually ({formatAmount(totals.vat)} vs calculated {formatAmount(totals.vatCalculated)}).</p>}
        </ConfirmModal>
      )}
    </div>
  )
}

function CatalogPicker({ onClose, onPick }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState("")
  const [err, setErr] = useState("")
  useEffect(() => { listCatalog().then(setRows).catch(e => { setRows([]); setErr(e.message) }) }, [])
  const shown = (rows || []).filter(r => !q || `${r.name} ${r.category}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal title="Add from Services & Materials library" onClose={onClose} width={640} labelId="marine-cat-pick">
      <ErrorBox errors={err ? [err] : []} />
      <input style={{ ...iS, marginBottom:10 }} placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {!rows ? <div style={{ color:C.textFaint }}>Loading…</div> : shown.length === 0 ? <div style={{ color:C.textFaint, fontSize:13 }}>No library items. Add them under “Services & Materials”.</div> :
        shown.map(r => (
          <button key={r.id} type="button" onClick={() => { onPick(r); onClose() }}
            style={{ display:"flex", width:"100%", justifyContent:"space-between", gap:12, textAlign:"left", padding:"10px 12px", border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, background:C.surface, marginBottom:6, cursor:"pointer", fontFamily:FONT }}>
            <span><strong style={{ fontSize:13.5, color:C.text }}>{r.name}</strong><br /><span style={{ fontSize:12, color:C.textFaint }}>{r.category} · per {r.unit}</span></span>
            <span style={{ fontWeight:700, fontSize:13, whiteSpace:"nowrap", color:C.text }}>{formatTZS(r.default_unit_price)}</span>
          </button>
        ))}
    </Modal>
  )
}

function ScopePicker({ onClose, onPick }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState("")
  const [err, setErr] = useState("")
  useEffect(() => { listScopeTemplates().then(setRows).catch(e => { setRows([]); setErr(e.message) }) }, [])
  const shown = (rows || []).filter(r => !q || `${r.title} ${r.description}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal title="Add from Scope of Work library" onClose={onClose} width={640} labelId="marine-scope-pick">
      <ErrorBox errors={err ? [err] : []} />
      <input style={{ ...iS, marginBottom:10 }} placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {!rows ? <div style={{ color:C.textFaint }}>Loading…</div> : shown.length === 0 ? <div style={{ color:C.textFaint, fontSize:13 }}>No templates yet. Add them under “Scope of Work Library”.</div> :
        shown.map(r => (
          <button key={r.id} type="button" onClick={() => { onPick(r); onClose() }}
            style={{ display:"block", width:"100%", textAlign:"left", padding:"10px 12px", border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, background:C.surface, marginBottom:6, cursor:"pointer", fontFamily:FONT }}>
            <strong style={{ fontSize:13.5, color:C.text }}>{r.title}</strong>
            <div style={{ fontSize:12.5, color:C.textSub, whiteSpace:"pre-wrap" }}>{r.description}</div>
          </button>
        ))}
    </Modal>
  )
}

// ── Libraries ─────────────────────────────────────────────────────────
function CatalogLibrary({ showToast }) {
  const [rows, setRows] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState("")
  const load = useCallback(() => { listCatalog({ includeInactive: true }).then(setRows).catch(e => { setRows([]); setErr(e.message) }) }, [])
  useEffect(load, [load])
  const shown = (rows || []).filter(r => showArchived || r.is_active)

  const toggle = async (r) => {
    try { await saveCatalogItem({ ...r, is_active: !r.is_active }); showToast(r.is_active ? "Archived" : "Restored"); load() }
    catch (e) { showToast(e.message, "error") }
  }

  return (
    <div style={sectionCard}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        <h2 style={{ ...fTi, margin:0 }}>Services & materials library</h2>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <label style={{ fontSize:12.5, color:C.textSub, display:"flex", gap:6, alignItems:"center" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived</label>
          <button type="button" style={primaryBtn} onClick={() => setEdit({ name:"", category:"Service", unit:"service", default_unit_price:"", notes:"", is_active:true })}>+ Add item</button>
        </div>
      </div>
      <p style={{ margin:"0 0 12px", fontSize:12.5, color:C.textFaint }}>Reusable lines for documents. Changing a price here never alters documents that already use it.</p>
      <ErrorBox errors={err ? [err] : []} />
      {!rows ? <div style={{ color:C.textFaint }}>Loading…</div> : shown.length === 0 ? <div style={{ color:C.textFaint, fontSize:13 }}>No items yet.</div> : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
            <thead><tr>{["Description","Category","Unit","Default price",""].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} style={{ borderTop:`1px solid ${C.border}`, opacity: r.is_active ? 1 : .55 }}>
                  <td style={{ ...tS, whiteSpace:"pre-wrap" }}>{r.name}</td>
                  <td style={tS}>{r.category}</td>
                  <td style={tS}>{r.unit}</td>
                  <td style={{ ...tS, fontWeight:600 }}>{formatTZS(r.default_unit_price)}</td>
                  <td style={{ ...tS, textAlign:"right", whiteSpace:"nowrap" }}>
                    <button type="button" style={smallBtn} onClick={() => setEdit({ ...r, default_unit_price: String(r.default_unit_price) })}>Edit</button>{" "}
                    <button type="button" style={smallBtn} onClick={() => toggle(r)}>{r.is_active ? "Archive" : "Restore"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? "Edit library item" : "New library item"} onClose={() => setEdit(null)} width={560} labelId="marine-cat-edit">
          <LibraryForm initial={edit} fields={[
            { k:"name", label:"Description", type:"textarea", max:500 },
            { k:"category", label:"Category", type:"select", options:CATALOG_CATEGORIES },
            { k:"unit", label:"Unit", list:"marine-units-lib", max:30 },
            { k:"default_unit_price", label:"Default unit price (TZS)", inputMode:"decimal" },
            { k:"notes", label:"Internal notes", type:"textarea", max:1000 },
          ]} onCancel={() => setEdit(null)} onSave={async (v) => { await saveCatalogItem(v); showToast("Saved"); setEdit(null); load() }} />
          <datalist id="marine-units-lib">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
        </Modal>
      )}
    </div>
  )
}

function ScopeLibrary({ showToast }) {
  const [rows, setRows] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState("")
  const load = useCallback(() => { listScopeTemplates({ includeInactive: true }).then(setRows).catch(e => { setRows([]); setErr(e.message) }) }, [])
  useEffect(load, [load])
  const shown = (rows || []).filter(r => showArchived || r.is_active)
  const toggle = async (r) => {
    try { await saveScopeTemplate({ ...r, is_active: !r.is_active }); showToast(r.is_active ? "Archived" : "Restored"); load() }
    catch (e) { showToast(e.message, "error") }
  }
  return (
    <div style={sectionCard}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        <h2 style={{ ...fTi, margin:0 }}>Scope of work library</h2>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <label style={{ fontSize:12.5, color:C.textSub, display:"flex", gap:6, alignItems:"center" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived</label>
          <button type="button" style={primaryBtn} onClick={() => setEdit({ title:"", description:"", is_active:true })}>+ Add template</button>
        </div>
      </div>
      <ErrorBox errors={err ? [err] : []} />
      {!rows ? <div style={{ color:C.textFaint }}>Loading…</div> : shown.length === 0 ? <div style={{ color:C.textFaint, fontSize:13 }}>No templates yet.</div> :
        shown.map(r => (
          <div key={r.id} style={{ display:"flex", gap:12, justifyContent:"space-between", padding:"10px 0", borderTop:`1px solid ${C.border}`, opacity: r.is_active ? 1 : .55 }}>
            <div style={{ minWidth:0 }}>
              <strong style={{ fontSize:13.5 }}>{r.title}</strong>
              <div style={{ fontSize:13, color:C.textSub, whiteSpace:"pre-wrap" }}>{r.description}</div>
            </div>
            <div style={{ whiteSpace:"nowrap" }}>
              <button type="button" style={smallBtn} onClick={() => setEdit(r)}>Edit</button>{" "}
              <button type="button" style={smallBtn} onClick={() => toggle(r)}>{r.is_active ? "Archive" : "Restore"}</button>
            </div>
          </div>
        ))}
      {edit && (
        <Modal title={edit.id ? "Edit template" : "New scope template"} onClose={() => setEdit(null)} width={560} labelId="marine-scope-edit">
          <LibraryForm initial={edit} fields={[
            { k:"title", label:"Title", max:200 },
            { k:"description", label:"Description", type:"textarea", max:4000 },
          ]} onCancel={() => setEdit(null)} onSave={async (v) => { await saveScopeTemplate(v); showToast("Saved"); setEdit(null); load() }} />
        </Modal>
      )}
    </div>
  )
}

function LibraryForm({ initial, fields, onSave, onCancel }) {
  const [v, setV] = useState(initial)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("")
    try { await onSave(v) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
      <ErrorBox errors={err ? [err] : []} />
      {fields.map(f => (
        <Field key={f.k} label={f.label} htmlFor={`lib-${f.k}`}>
          {f.type === "textarea"
            ? <textarea id={`lib-${f.k}`} style={{ ...iS, minHeight:70, resize:"vertical" }} maxLength={f.max} value={v[f.k] || ""} onChange={e => setV({ ...v, [f.k]: e.target.value })} />
            : f.type === "select"
              ? <select id={`lib-${f.k}`} style={{ ...seS, width:"100%" }} value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })}>{f.options.map(o => <option key={o}>{o}</option>)}</select>
              : <input id={`lib-${f.k}`} style={iS} maxLength={f.max} list={f.list} inputMode={f.inputMode} value={v[f.k] ?? ""} onChange={e => setV({ ...v, [f.k]: e.target.value })} />}
        </Field>
      ))}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <button type="button" style={ghostBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={primaryBtn} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  )
}

// ── Settings ──────────────────────────────────────────────────────────
function SettingsPanel({ settings, canEdit, showToast, onSaved }) {
  const [v, setV] = useState(() => ({ ...settings, default_vat_percent: String(settings.default_vat_percent), contacts: (settings.contacts || []).map(c => ({ ...c, key: newKey() })) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState([])
  const set = (k) => (e) => setV(s => ({ ...s, [k]: e.target.value }))
  const setContact = (key, patch) => setV(s => ({ ...s, contacts: s.contacts.map(c => c.key === key ? { ...c, ...patch } : c) }))

  const save = async () => {
    const errs = []
    const pct = Number(v.default_vat_percent)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errs.push("Default VAT % must be between 0 and 100.")
    const contacts = v.contacts.filter(c => String(c.value || "").trim()).map(({ type, label, value }) => ({ type, label: String(label || "").trim(), value: String(value).trim() }))
    if (!String(v.bank_account_number || "").trim()) errs.push("Account number is required.")
    setErr(errs)
    if (errs.length) return
    setBusy(true)
    try {
      await updateSettings({ ...v, default_vat_percent: pct, contacts })
      showToast("Settings saved — they apply to documents issued from now on")
      onSaved()
    } catch (e) { setErr([e.message]) }
    finally { setBusy(false) }
  }

  const dis = !canEdit
  return (
    <div>
      <div style={sectionCard}>
        <h2 style={fTi}>Permanent document header</h2>
        <BrandStrip />
        <p style={{ margin:0, fontSize:12.5, color:C.textFaint }}>
          🔒 This header is fixed on every quotation and invoice and cannot be edited. The logo is loaded from <code>public{MARINE_BRAND.logoUrl}</code>.
        </p>
      </div>
      {!canEdit && <div style={{ ...sectionCard, padding:"10px 16px", fontSize:13, background:"#FBF0D9", borderColor:"#E5C97A" }}>Only the Owner can change these settings. You can view them.</div>}
      <ErrorBox errors={err} />
      <div style={sectionCard}>
        <h2 style={fTi}>Default banking details</h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:12 }}>
          {[["bank_name","Bank"],["bank_account_name","Account name"],["bank_account_number","Account number"],["bank_branch","Branch"],["currency","Currency"]].map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`ms-${k}`}><input id={`ms-${k}`} style={iS} disabled={dis} value={v[k] || ""} onChange={set(k)} maxLength={160} /></Field>
          ))}
          <Field label="Default VAT %" htmlFor="ms-vat"><input id="ms-vat" style={iS} disabled={dis} inputMode="decimal" value={v.default_vat_percent} onChange={set("default_vat_percent")} /></Field>
        </div>
      </div>
      <div style={sectionCard}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <h2 style={{ ...fTi, margin:0 }}>Footer & contacts</h2>
          {canEdit && <button type="button" style={ghostBtn} disabled={v.contacts.length >= 12} onClick={() => setV(s => ({ ...s, contacts: [...s.contacts, { key:newKey(), type:"phone", label:"", value:"" }] }))}>+ Add contact</button>}
        </div>
        {v.contacts.map((c, i) => (
          <div key={c.key} style={{ display:"grid", gridTemplateColumns:"130px 1fr 1.4fr auto", gap:8, marginBottom:8, alignItems:"center" }}>
            <select aria-label={`Contact ${i + 1} type`} style={seS} disabled={dis} value={c.type} onChange={e => setContact(c.key, { type: e.target.value })}>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input aria-label={`Contact ${i + 1} label`} style={cellInput} disabled={dis} placeholder="Label (e.g. Email)" maxLength={60} value={c.label} onChange={e => setContact(c.key, { label: e.target.value })} />
            <input aria-label={`Contact ${i + 1} value`} style={cellInput} disabled={dis} placeholder="Value" maxLength={160} value={c.value} onChange={e => setContact(c.key, { value: e.target.value })} />
            <div style={{ whiteSpace:"nowrap" }}>
              {canEdit && <>
                <button type="button" style={smallBtn} aria-label="Move up" disabled={i === 0} onClick={() => setV(s => ({ ...s, contacts: moveInList(s.contacts, i, i - 1) }))}>↑</button>{" "}
                <button type="button" style={{ ...smallBtn, color:C.warnStrong }} aria-label="Remove contact" onClick={() => setV(s => ({ ...s, contacts: s.contacts.filter(x => x.key !== c.key) }))}>✕</button>
              </>}
            </div>
          </div>
        ))}
        <Field label="Footer line" htmlFor="ms-footer" style={{ marginTop:10 }}><input id="ms-footer" style={iS} disabled={dis} maxLength={200} value={v.footer_line} onChange={set("footer_line")} /></Field>
        <Field label="Default notes & terms for new documents" htmlFor="ms-notes" style={{ marginTop:12 }}>
          <textarea id="ms-notes" style={{ ...iS, minHeight:70 }} disabled={dis} maxLength={2000} value={v.default_notes || ""} onChange={set("default_notes")} />
        </Field>
        <p style={{ fontSize:12.5, color:C.textFaint, margin:"12px 0 0" }}>Changes apply to documents issued after saving. Documents already issued keep the banking, contact and footer details captured when they were issued.</p>
      </div>
      {canEdit && (
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button type="button" style={primaryBtn} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      )}
      {settings.updated_by_name && <p style={{ fontSize:12, color:C.textFaint, textAlign:"right" }}>Last changed by {settings.updated_by_name} on {new Date(settings.updated_at).toLocaleString()}</p>}
    </div>
  )
}

// Exposed only so tests/unit.test.mjs can render these without a browser.
export const __testing = { DocumentEditor, SettingsPanel, TotalsBreakdown, DocumentTable, BrandStrip, Overview, DocumentHistory, CatalogLibrary, ScopeLibrary }
