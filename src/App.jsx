import { useEffect, useRef, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis,
} from "recharts"
import * as XLSX from "xlsx"
// Used ONLY for the Tax / Accounting Report export below. The existing CSV
// and generic Excel exports above keep using plain "xlsx" untouched --
// that library silently drops cell styling (fonts/fills/borders) on write,
// which is fine for a raw data dump but not for an accountant-facing report.
// xlsx-js-style is an API-compatible fork that writes styling correctly.
import XLSXStyle from "xlsx-js-style"
import { ADMIN_API } from "./api"
import { supabase } from "./api/supabaseClient"
import { useAuth } from "./context/AuthContext"
import { useLanguage } from "./i18n"
import { downloadInvoicePdf, getInvoicePdfBlobUrl } from "./lib/invoicePdf"

/* ── CONFIG ─────────────────────────────────────────────── */
const LOGO        = "/logo.png"
const TZS         = (n) => `TZS ${Number(n || 0).toLocaleString()}`
const todayStr    = () => new Date().toISOString().split("T")[0]
const thisMonth   = () => new Date().toISOString().slice(0, 7)
const nowTimeStr  = () => new Date().toTimeString().slice(0, 5) // "HH:MM", local clock

const PALETTE = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#9C89B8","#F0A500","#00B4D8","#E63946","#2DC653","#FF6B6B"]
const EMOJI_LIST  = ["🍽️","🏎️","🎯","🎟️","🏊","🎪","🎭","⚽","🎸","🧗","🏄","🎡","🛶","🎠","🏋️","🎳","🤸","🧩","🎨","🎮","🧘","🎲","🚀","💆","🎉"]
const EXPENSE_CATS = ["Restaurant","Go Kart","Paintball","Park Entry","Utilities","Staff","Maintenance","Other"]

/* ── DESIGN TOKENS ──────────────────────────────────────────
   A small, consistent scale so spacing/radius/shadow/color
   stop being ad hoc per element. Brand accents (sage + terracotta)
   are kept, just used with more restraint — neutral surfaces,
   color reserved for meaning (brand action, money in/out, status). */
const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif"
const RADIUS = { sm: 8, md: 12, lg: 16, pill: 999 }
const SPACE  = { xs:8, sm:12, md:16, lg:20, xl:24, xxl:32 }
const C = {
  bg:        "#F7F7F6",
  surface:   "#FFFFFF",
  border:    "#EBE8E3",
  borderStrong: "#DCD8D1",
  text:      "#1F2233",
  textSub:   "#4B5163",   // ~7.9:1 on white — WCAG AAA
  textFaint: "#6B7080",   // ~4.9:1 on white — WCAG AA (was #9A9FAE at 2.6:1, failed)
  accent:      "#6FA88E",   // sage — badges/icons/borders (not for white-on-fill text)
  accentHover: "#5F9680",
  accentSoft:  "#EDF4F0",
  accentStrong:      "#3F7259", // ~5.6:1 with white text — use for solid buttons/CTAs
  accentStrongHover: "#345F49",
  warn:        "#E07A5F",   // terracotta — money-out / destructive / errors (badges, icons)
  warnHover:   "#C96A50",
  warnSoft:    "#FBEEE9",
  warnStrong:      "#A34E33",  // ~5.7:1 with white text, ~5:1 as text on warnSoft
  warnStrongHover: "#8A4129",
  sidebar:     "#20222E",
  sidebarBorder: "rgba(255,255,255,0.08)",
  sidebarText:   "#9CA0B4",
}
const SHADOW = {
  card:  "0 1px 2px rgba(20,20,30,0.04), 0 1px 3px rgba(20,20,30,0.05)",
  hover: "0 6px 20px rgba(20,20,30,0.08)",
  modal: "0 24px 48px rgba(20,20,30,0.16)",
}

/* Admin backend helper — uses VITE_API_URL via src/api/index.js.
   Takes the access token as a parameter (read from AuthContext by the
   caller) instead of calling supabase.auth.getSession() itself -- that
   avoids adding another independent call into the Supabase auth client,
   which is what caused lock contention on session restore (see
   context/AuthContext.jsx for the full incident notes). */
async function adminFetch(path, accessToken, opts = {}) {
  const url = `${ADMIN_API}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(opts.headers || {}),
    },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || "Admin request failed")
  return json
}

/* ── ROOT APP ────────────────────────────────────────────── */
export default function App() {
  const { user, isOwner, logout, ready, hasAccess, permissionsPending, permissionsError, refresh } = useAuth()
  const { t, lang } = useLanguage()

  const [sales,    setSales]    = useState([])
  const [expenses, setExpenses] = useState([])
  const [services, setServices] = useState([])
  const [page,     setPage]     = useState("dashboard")
  const [sidebarOpen, setSidebarOpen]   = useState(true)
  const [toast,    setToast]    = useState(null)
  const [showAddService, setShowAddService] = useState(false)

  // Start with the sidebar closed on phones/small tablets so it behaves
  // as an off-canvas drawer instead of covering the screen on first load.
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false)
    }
  }, [])

  const showToast = (msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  async function fetchAll() {
    // Previously called supabase.auth.getSession() here just to log the
    // session/user id -- that's another independent call into the Supabase
    // auth client (this one re-fires every 5s via the polling interval
    // below), and unnecessary since `user` is already available from
    // AuthContext. Removing it cuts down on avoidable auth-lock traffic;
    // see context/AuthContext.jsx for why that traffic matters here.
    console.log("USER ID:", user?.id)

    const [
      { data: s, error: sErr },
      { data: e, error: eErr },
      { data: srv, error: srvErr },
    ] = await Promise.all([
      supabase.from("sales").select("*").order("date", { ascending: false }),
      supabase.from("expenses").select("*").order("date", { ascending: false }),
      supabase.from("services").select("*"),
    ])

    if (sErr)   console.error("Sales fetch error:", sErr.message)
    if (eErr)   console.error("Expenses fetch error:", eErr.message)
    if (srvErr) console.error("Services fetch error:", srvErr.message)

    console.log("Fetched sales:", s)
    console.log("Fetched expenses:", e)

    setSales(s || [])
    setExpenses(e || [])
    setServices(srv || [])
  }

  useEffect(() => {
    if (!user) return
    fetchAll()
    const i = setInterval(fetchAll, 5000)
    return () => clearInterval(i)
  }, [user])

  const addService = async (newSvc) => {
    const { error } = await supabase.from("services").insert([{
      id:    newSvc.id,
      name:  newSvc.name,
      color: newSvc.color,
      emoji: newSvc.emoji,
    }])
    if (error) { showToast(error.message, "error"); return }
    fetchAll()
    showToast(t("serviceAddedToast", { name: newSvc.name }))
  }

  // `ready` covers only session restore now (fast, local) -- it no longer
  // waits for the permissions network round trip, which is what used to
  // cause a "Checking access..." flash for every already-authenticated
  // user on every refresh. `permissionsPending` is the new, narrower case:
  // it's only true when there's neither a real permission result yet NOR a
  // cached hint for this user to render from optimistically (i.e. a
  // genuinely first-time/unknown-on-this-device session) -- a returning
  // Owner/Admin/Worker with a matching hint skips straight to the real UI
  // below using that hint, while the real check verifies silently in the
  // background and can still redirect to AccessDeniedPage the moment it
  // comes back if it disagrees. See src/context/AuthContext.jsx for the
  // full reasoning (hint caching, namespacing, fail-closed timeouts).
  //
  // Every one of these four checks is bounded and terminal -- `ready` and
  // `permissionsPending` are both backed by their own failsafe timeout in
  // AuthContext, so this component can never sit on FullScreenLoader
  // forever. `permissionsError` (a check that genuinely failed/timed out,
  // as opposed to succeeding with "no grant") gets its own screen rather
  // than being folded into AccessDeniedPage -- "we couldn't verify you"
  // and "we verified you and you're not allowed in" are different facts,
  // and only the second one is really "Access Denied". Note this can never
  // be used to grant access: loadPermissions() in AuthContext only sets
  // hasAccess-affecting state from a REAL result; a failed/timed-out check
  // either fails closed (first check for this user) or leaves the last
  // known-good result untouched (a later background re-check, e.g. a
  // token refresh) -- it never invents a "yes".
  if (!ready) return <FullScreenLoader />
  if (!user) return <LoginPage />
  if (permissionsPending) return <FullScreenLoader />
  if (permissionsError && !hasAccess) {
    return <PermissionErrorPage onRetry={refresh} onLogout={logout} />
  }
  if (!hasAccess) return <AccessDeniedPage onLogout={logout} email={user.email} />

  const displayName = user.user_metadata?.name || user.email?.split("@")[0] || "User"

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:FONT, background:C.bg, overflow:"hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <Sidebar
        page={page}
        setPage={setPage}
        isOwner={isOwner}
        displayName={displayName}
        onLogout={() => { logout(); setPage("dashboard") }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main style={{ flex:1, overflow:"auto", minWidth:0 }}>
        {/* Top bar */}
        <div style={{ padding:"16px clamp(14px,4vw,28px) 0", display:"flex", alignItems:"center", gap:14, marginBottom:6 }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="stv-btn stv-btn-ghost"
            aria-label={t("toggleSidebar")}
            aria-expanded={sidebarOpen}
            style={{ background:"none", border:"none", borderRadius:RADIUS.sm, cursor:"pointer", fontSize:19, padding:6, color:C.textSub, lineHeight:1 }}
          >
            ☰
          </button>
          <span style={{ fontSize:13, color:C.textFaint, fontWeight:500 }}>
            {new Date().toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}
          </span>
        </div>

        <div style={{ padding:"18px clamp(14px,4vw,28px) 32px" }}>
          {page === "dashboard" && isOwner  && <OwnerDashboard sales={sales} expenses={expenses} services={services} />}
          {page === "dashboard" && !isOwner && <WorkerHome sales={sales} displayName={displayName} setPage={setPage} />}
          {page === "sales"     && (
            <SalesPage
              sales={sales} services={services} fetchAll={fetchAll}
              user={user} showToast={showToast} isOwner={isOwner}
              onOpenAddService={() => setShowAddService(true)}
            />
          )}
          {page === "expenses"  && (
            <ExpensesPage
              expenses={expenses} fetchAll={fetchAll}
              user={user} showToast={showToast} isOwner={isOwner}
            />
          )}
          {page === "inventory" && (
            <InventoryPage user={user} isOwner={isOwner} showToast={showToast} />
          )}
          {page === "invoices" && (
            <InvoicesPage user={user} isOwner={isOwner} displayName={displayName} showToast={showToast} />
          )}
          {page === "reports" && isOwner && (
            <ReportsPage sales={sales} expenses={expenses} services={services} showToast={showToast} />
          )}
          {page === "users" && isOwner && <UsersPage showToast={showToast} />}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          style={{
            position:"fixed", bottom:"clamp(16px,4vw,28px)", right:"clamp(16px,4vw,28px)",
            left:"auto", maxWidth:"min(90vw, 380px)", zIndex:9999,
            display:"flex", alignItems:"center", gap:9,
            background: toast.type === "success" ? C.accentStrong : C.warnStrong,
            color:"#fff", padding:"13px 20px", borderRadius:RADIUS.md,
            fontWeight:600, fontSize:14, boxShadow:SHADOW.modal,
          }}>
          <span aria-hidden="true" style={{ fontSize:15, lineHeight:1 }}>{toast.type === "error" ? "⚠" : "✓"}</span>
          {toast.msg}
        </div>
      )}

      {/* Add Service Modal */}
      {showAddService && (
        <AddServiceModal
          onAdd={addService}
          onClose={() => setShowAddService(false)}
          existing={services}
        />
      )}

      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        html, body { background:${C.bg}; overflow-x:hidden; }
        body { font-family:${FONT}; -webkit-font-smoothing:antialiased; }
        img { max-width:100%; height:auto; }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:${C.borderStrong}; border-radius:3px; }

        /* Shared interaction states — impossible to express via inline style */
        .stv-btn { transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .1s ease, opacity .15s ease; }
        .stv-btn:active { transform: translateY(1px); }
        .stv-btn-primary:hover:not(:disabled)   { background:${C.accentStrongHover} !important; }
        .stv-btn-danger-solid:hover:not(:disabled) { background:${C.warnStrongHover} !important; }
        .stv-btn-secondary:hover:not(:disabled) { background:${C.bg} !important; border-color:${C.borderStrong} !important; }
        .stv-btn-ghost:hover:not(:disabled)     { background:${C.bg} !important; color:${C.text} !important; }
        .stv-btn-danger:hover:not(:disabled)    { background:${C.warnStrong} !important; color:#fff !important; }
        .stv-btn-accent:hover:not(:disabled)    { background:${C.accentStrong} !important; color:#fff !important; }

        .stv-card { transition: box-shadow .15s ease, border-color .15s ease; }
        .stv-card-hover:hover { box-shadow:${SHADOW.hover}; border-color:${C.borderStrong}; }

        .stv-nav-item:hover { background:rgba(255,255,255,0.06) !important; color:#fff !important; }
        .stv-table tbody tr { transition: background-color .12s ease; }
        .stv-table tbody tr:hover { background:#FAFAF9; }

        input, select, textarea { transition: border-color .15s ease, box-shadow .15s ease; }
        input:focus, select:focus, textarea:focus {
          border-color:${C.accent} !important;
          box-shadow:0 0 0 3px ${C.accentSoft};
        }
        button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
          outline: 2px solid ${C.accentStrong};
          outline-offset: 2px;
        }
        input:focus-visible, select:focus-visible {
          outline: none;
        }

        /* Mobile drawer overlay (hidden on tablet/desktop) */
        .stv-sidebar-overlay {
          position:fixed; inset:0; background:rgba(20,20,30,0.45);
          z-index:900; opacity:0; pointer-events:none; transition:opacity .2s ease;
          display:none;
        }
        .stv-sidebar-overlay.is-open { opacity:1; pointer-events:auto; }

        @media (max-width: 767px) {
          .stv-sidebar-overlay { display:block; }
          .stv-sidebar {
            position:fixed !important; top:0; left:0; z-index:950;
            height:100vh !important; width:min(78vw,260px) !important; min-width:0 !important;
            transform:translateX(-100%);
            box-shadow:0 0 40px rgba(0,0,0,.25);
            transition:transform .25s ease;
          }
          .stv-sidebar.is-open { transform:translateX(0); }
        }
      `}</style>
    </div>
  )
}

/* ── LOADING / ACCESS DENIED ────────────────────────────── */
// Only shown when genuinely necessary: (a) briefly, while the local session
// restore itself is in flight (near-instant in practice -- see AuthContext's
// AUTH_INIT_TIMEOUT_MS), or (b) for a first-time/unknown-on-this-device
// session with no cached access hint to render from optimistically. A
// returning authenticated user with a cached hint never sees this -- they
// go straight to the POS shell while permissions verify in the background.
function FullScreenLoader() {
  const { t } = useLanguage()
  return (
    <div style={{
      minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, background:C.bg, fontFamily:FONT,
    }}>
      <img src={LOGO} alt="" aria-hidden="true" style={{ width:72, height:"auto", opacity:0.92, mixBlendMode:"multiply" }} />
      <div
        aria-hidden="true"
        style={{
          width:22, height:22, borderRadius:RADIUS.pill,
          border:`2.5px solid ${C.border}`, borderTopColor:C.accentStrong,
          animation:"stv-spin 0.7s linear infinite",
        }}
      />
      <span role="status" aria-live="polite" style={{ fontSize:12.5, color:C.textFaint, fontWeight:500 }}>
        {t("loadingBrand")}
      </span>
      <style>{`@keyframes stv-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  )
}

function AccessDeniedPage({ onLogout, email }) {
  const { t } = useLanguage()
  return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:C.bg, fontFamily:FONT, padding:20,
    }}>
      <div style={{ background:C.surface, borderRadius:RADIUS.lg, padding:"40px 36px", width:"min(92vw, 420px)", textAlign:"center", boxShadow:SHADOW.modal }}>
        <div style={{ fontSize:34, marginBottom:14 }}>🔒</div>
        <h1 style={{ margin:"0 0 10px", fontFamily:FONT, fontWeight:700, fontSize:19, color:C.text }}>{t("noAccessTitle")}</h1>
        <p style={{ margin:"0 0 6px", color:C.textSub, fontSize:13.5, lineHeight:1.5 }}>
          {t("noAccessBody", { email })}
        </p>
        <p style={{ margin:"0 0 24px", color:C.textFaint, fontSize:12.5, lineHeight:1.5 }}>
          {t("noAccessHint")}
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="stv-btn stv-btn-primary"
          style={{ width:"100%", padding:"12px", background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT }}
        >
          {t("signOut")}
        </button>
      </div>
    </div>
  )
}

// Shown when a permission check genuinely failed or timed out (Supabase
// unreachable, slow network, RPC error) -- as opposed to succeeding and
// finding no grant, which is AccessDeniedPage above. Deliberately never
// implies the person lacks access (we don't know either way yet), and
// deliberately never auto-retries into granting access -- retrying re-runs
// the same real permission check, which still fails closed on its own if
// it fails again.
function PermissionErrorPage({ onRetry, onLogout }) {
  const { t } = useLanguage()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:C.bg, fontFamily:FONT, padding:20,
    }}>
      <div style={{ background:C.surface, borderRadius:RADIUS.lg, padding:"40px 36px", width:"min(92vw, 420px)", textAlign:"center", boxShadow:SHADOW.modal }}>
        <div style={{ fontSize:34, marginBottom:14 }} aria-hidden="true">⚠️</div>
        <h1 style={{ margin:"0 0 10px", fontFamily:FONT, fontWeight:700, fontSize:19, color:C.text }}>{t("permissionErrorTitle")}</h1>
        <p style={{ margin:"0 0 24px", color:C.textSub, fontSize:13.5, lineHeight:1.5 }}>
          {t("permissionErrorBody")}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="stv-btn stv-btn-primary"
          style={{ width:"100%", padding:"12px", marginBottom:10, background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT, opacity: retrying ? 0.7 : 1 }}
        >
          {retrying ? t("retryingBtn") : t("tryAgainBtn")}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="stv-btn stv-btn-secondary"
          style={{ width:"100%", padding:"12px", background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT }}
        >
          {t("signOut")}
        </button>
      </div>
    </div>
  )
}

/* ── LOGIN ───────────────────────────────────────────────── */
function LoginPage() {
  const { login } = useAuth()
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState("")
  const [busy,     setBusy]     = useState(false)

  const handle = async () => {
    setError("")
    setBusy(true)
    try {
      await login(email, password)
    } catch (e) {
      setError(e.message || "Invalid credentials.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:"linear-gradient(145deg, #1a1c2b 0%, #2f3347 50%, #3a2e1e 100%)",
      fontFamily:FONT, padding:20,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ background:C.surface, borderRadius:RADIUS.lg, padding:"clamp(28px,6vw,44px) clamp(20px,6vw,40px)", width:"min(92vw, 400px)", maxHeight:"92vh", overflowY:"auto", boxShadow:SHADOW.modal }}>
        <div style={{ textAlign:"center", marginBottom:SPACE.xl }}>
          <img src={LOGO} alt="Swahili Tent Village" style={{ width:180, height:"auto", marginBottom:4, mixBlendMode:"multiply" }} />
          <p style={{ margin:"6px 0 0", color:C.textFaint, fontSize:12, letterSpacing:1.5, fontWeight:600 }}>POINT OF SALE</p>
        </div>

        <label style={lS} htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handle()}
          style={iS}
        />

        <label style={{ ...lS, marginTop:SPACE.sm+2 }} htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handle()}
          style={{ ...iS, marginTop:0 }}
        />

        {error && <p role="alert" style={{ color:C.warnStrong, fontSize:13, marginTop:8 }}>{error}</p>}

        <button
          type="button"
          onClick={handle}
          disabled={busy}
          className="stv-btn stv-btn-primary"
          style={{
            width:"100%", marginTop:SPACE.lg+2, padding:"14px",
            background:C.accentStrong, color:"#fff", border:"none",
            borderRadius:RADIUS.sm, fontSize:14.5, fontWeight:600,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
            fontFamily:FONT, boxShadow:"0 1px 2px rgba(20,20,30,0.08)",
          }}
        >
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </div>
    </div>
  )
}

/* ── SIDEBAR ─────────────────────────────────────────────── */
function Sidebar({ page, setPage, isOwner, displayName, onLogout, open, onClose }) {
  const { t, lang, setLang } = useLanguage()
  const ownerNav = [
    { id:"dashboard",  label:t("navDashboard"),  icon:"📊" },
    { id:"sales",      label:t("navSales"),      icon:"💰" },
    { id:"expenses",   label:t("navExpenses"),   icon:"🧾" },
    { id:"inventory",  label:t("navInventory"),  icon:"📦" },
    { id:"invoices",   label:t("navInvoices"),   icon:"📑" },
    { id:"reports",    label:t("navReports"),    icon:"📈" },
    { id:"users",      label:t("navUsers"),      icon:"👥" },
  ]
  const workerNav = [
    { id:"dashboard",  label:t("navHome"),       icon:"🏠" },
    { id:"sales",      label:t("navRecordSale"), icon:"💰" },
    { id:"expenses",   label:t("navExpenses"),   icon:"🧾" },
    { id:"inventory",  label:t("navInventory"),  icon:"📦" },
    { id:"invoices",   label:t("navInvoices"),   icon:"📑" },
  ]
  const nav = isOwner ? ownerNav : workerNav

  return (
    <>
      <div
        className={`stv-sidebar-overlay${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
      className={`stv-sidebar${open ? " is-open" : ""}`}
      style={{
      width: open ? 232 : 66,
      minWidth: open ? 232 : 66,
      background:C.sidebar,
      color:"#fff",
      display:"flex",
      flexDirection:"column",
      transition:"width .25s, min-width .25s",
      overflow:"hidden",
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: open ? "24px 16px 16px" : "18px 10px 16px",
        display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column", gap:6,
        borderBottom:`1px solid ${C.sidebarBorder}`,
      }}>
        <img
          src={LOGO}
          alt="logo"
          style={{ width: open ? 104 : 40, height:"auto", transition:"width .25s", objectFit:"contain", mixBlendMode:"screen" }}
        />
        {open && (
          <div style={{ fontSize:10, color:C.sidebarText, textAlign:"center", marginTop:2, letterSpacing:0.6, fontWeight:500 }}>
            {isOwner ? t("ownerDashboardLabel") : t("workerPanelLabel")}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"12px 10px" }} aria-label={t("mainNavigation")}>
        {nav.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            className="stv-btn stv-nav-item"
            aria-label={item.label}
            aria-current={page === item.id ? "page" : undefined}
            title={item.label}
            style={{
              display:"flex", alignItems:"center", gap:11,
              width:"100%",
              padding: open ? "10px 14px" : "10px 7px",
              marginBottom:2, borderRadius:RADIUS.sm,
              border:"none", cursor:"pointer",
              background: page === item.id ? "rgba(255,255,255,0.1)" : "transparent",
              color: page === item.id ? "#fff" : C.sidebarText,
              fontSize:13.5,
              fontWeight: page === item.id ? 600 : 500,
              textAlign:"left",
              fontFamily:FONT,
              justifyContent: open ? "flex-start" : "center",
            }}
          >
            <span style={{ fontSize:16, flexShrink:0, opacity: page === item.id ? 1 : 0.85 }}>{item.icon}</span>
            {open && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User + Logout */}
      <div style={{ padding:"16px 10px", borderTop:`1px solid ${C.sidebarBorder}` }}>
        {open && (
          <div style={{ display:"flex", alignItems:"center", gap:SPACE.sm, marginBottom:12 }}>
            <div style={{
              width:30, height:30, borderRadius:RADIUS.sm,
              background:C.warn,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:12.5, fontWeight:700, flexShrink:0, color:"#fff",
            }}>
              {displayName[0]?.toUpperCase()}
            </div>
            <div style={{ overflow:"hidden" }}>
              <div style={{ fontSize:12.5, fontWeight:600, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {displayName}
              </div>
              <div style={{ fontSize:10.5, color:C.sidebarText, textTransform:"capitalize" }}>
                {isOwner ? t("roleOwner") : t("roleWorker")}
              </div>
            </div>
          </div>
        )}

        {/* Language selector -- compact EN|SW toggle. A manual choice here
            always overrides the role-based default and persists per
            authenticated user (see src/i18n.jsx), so it survives a refresh
            but never leaks onto a different person's session on a shared
            device. */}
        <div
          role="group"
          aria-label={t("language")}
          style={{
            display:"flex", gap:4, marginBottom:10,
            justifyContent: open ? "flex-start" : "center",
          }}
        >
          {["en", "sw"].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              aria-pressed={lang === code}
              aria-label={code === "en" ? "English" : "Kiswahili"}
              title={code === "en" ? "English" : "Kiswahili"}
              className="stv-btn"
              style={{
                padding: open ? "6px 12px" : "6px 8px",
                borderRadius:RADIUS.sm,
                border:`1px solid ${lang === code ? "rgba(255,255,255,0.3)" : C.sidebarBorder}`,
                background: lang === code ? "rgba(255,255,255,0.14)" : "transparent",
                color: lang === code ? "#fff" : C.sidebarText,
                cursor:"pointer", fontSize:11, fontWeight:700,
                fontFamily:FONT, letterSpacing:0.5,
              }}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="stv-btn stv-nav-item"
          aria-label={t("signOut")}
          title={t("signOut")}
          style={{
            width:"100%", padding:"9px 14px", borderRadius:RADIUS.sm,
            border:`1px solid ${C.sidebarBorder}`, background:"transparent",
            color:C.sidebarText, cursor:"pointer", fontSize:12.5, fontWeight:500,
            fontFamily:FONT,
            display:"flex", alignItems:"center", gap:8,
            justifyContent: open ? "flex-start" : "center",
          }}
        >
          <span style={{ fontSize:14 }}>🚪</span>
          {open && t("signOut")}
        </button>
      </div>
      </aside>
    </>
  )
}

/* ── STAT CARD ───────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="stv-card stv-card-hover" style={{
      background:C.surface, borderRadius:RADIUS.md, padding:"18px 20px",
      border:`1px solid ${C.border}`, boxShadow:SHADOW.card,
      flex:1, minWidth:0,
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <span style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>{label}</span>
        <span style={{
          width:32, height:32, borderRadius:RADIUS.sm, flexShrink:0,
          background:color + "18", display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:15,
        }}>{icon}</span>
      </div>
      <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:"-0.01em" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:11.5, color:C.textFaint, marginTop:6 }}>{sub}</div>}
    </div>
  )
}

/* ── SERVICE BADGE ───────────────────────────────────────── */
function ServiceBadge({ name, services }) {
  const svc   = services?.find(s => s.name === name)
  const color = svc?.color || "#aaa"
  const emoji = svc?.emoji || ""
  return (
    <span style={{
      background: color + "18", color,
      border:`1px solid ${color}33`,
      padding:"4px 10px", borderRadius:RADIUS.pill,
      fontSize:11.5, fontWeight:600, whiteSpace:"nowrap",
    }}>
      {emoji && <span style={{ marginRight:4 }}>{emoji}</span>}
      {name || "—"}
    </span>
  )
}

/* ── ADD SERVICE MODAL ───────────────────────────────────── */
function AddServiceModal({ onAdd, onClose, existing }) {
  const { t } = useLanguage()
  const [name,  setName]  = useState("")
  const [emoji, setEmoji] = useState("🎪")
  const [color, setColor] = useState(PALETTE[existing.length % PALETTE.length])
  const [err,   setErr]   = useState("")
  const [busy,  setBusy]  = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr(t("serviceNameRequired")); return }
    if (existing.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setErr(t("serviceNameExists")); return
    }
    setBusy(true)
    await onAdd({
      id:    trimmed.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now(),
      name:  trimmed,
      color,
      emoji,
    })
    setBusy(false)
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-service-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 400px)", maxHeight:"90vh", overflowY:"auto", boxShadow:SHADOW.modal }}
      >
        <h2 id="add-service-title" style={{ margin:"0 0 22px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text, letterSpacing:"-0.01em" }}>
          {t("addServiceTitle")}
        </h2>

        <label style={lS} htmlFor="svc-name">{t("serviceNameLabel")}</label>
        <input
          id="svc-name"
          autoFocus
          placeholder={t("serviceNamePlaceholder")}
          value={name}
          onChange={e => { setName(e.target.value); setErr("") }}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={{ ...iS, marginBottom: err ? 4 : SPACE.md+2 }}
        />
        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"4px 0 14px" }}>{err}</p>}

        <label style={lS} id="svc-icon-label">{t("iconLabel")}</label>
        <div role="group" aria-labelledby="svc-icon-label" style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:SPACE.md+2 }}>
          {EMOJI_LIST.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className="stv-btn"
              aria-label={t("iconAriaLabel", { emoji: e })}
              aria-pressed={emoji === e}
              style={{
                width:36, height:36, borderRadius:RADIUS.sm,
                border:`1.5px solid ${emoji === e ? C.text : C.border}`,
                background: emoji === e ? C.text : C.surface,
                fontSize:16, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <label style={lS} id="svc-color-label">{t("colorLabel")}</label>
        <div role="group" aria-labelledby="svc-color-label" style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:SPACE.lg+4 }}>
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="stv-btn"
              aria-label={t("colorSwatchAriaLabel", { color: c })}
              aria-pressed={color === c}
              style={{
                width:28, height:28, borderRadius:RADIUS.sm,
                border:`2px solid ${color === c ? C.text : "transparent"}`,
                boxShadow: color === c ? "none" : `0 0 0 1px ${C.border}`,
                background:c, cursor:"pointer", outline:"none",
              }}
            />
          ))}
        </div>

        {/* Preview */}
        <div style={{ marginBottom:SPACE.lg, padding:"12px 16px", background:C.bg, borderRadius:RADIUS.sm, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>{emoji}</span>
          <span style={{
            background: color + "18", color,
            border:`1px solid ${color}33`,
            padding:"4px 12px", borderRadius:RADIUS.pill,
            fontSize:13, fontWeight:600,
          }}>
            {name || t("preview")}
          </span>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button
            type="button"
            onClick={onClose}
            className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? t("saving") : `${emoji} ${t("addServiceBtn")}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── RECEIPT ─────────────────────────────────────────────────
   Extends the existing Sales workflow rather than creating a second
   sales/service system: every value shown here comes from the same `sale`
   record and `service` data SalesPage already has (service name, amount,
   date, note) plus the currently authenticated user's display name for
   "Served by". Customer name/contact and payment method are the only new
   inputs, and they are intentionally NEVER written to Supabase -- see the
   Phase 0 audit notes in the final report for why a schema change wasn't
   used: the `sales` table has no customer/payment fields today, and there
   was no reliable way from this session to confirm which Supabase project
   backs this exact deployment (VITE_SUPABASE_URL isn't in the repo's
   .env -- it's Vercel-only), so altering a shared production database
   blind was avoided. Customer/payment info therefore lives only in this
   modal's state (plus the light in-memory `receiptDrafts` cache in
   SalesPage) for as long as the receipt is open. */

// Human-readable reference derived from the existing sale record -- never
// the raw UUID. Deterministic (same sale -> same reference every time it's
// reprinted), and doesn't require a new counter/table.
function receiptRefFromSale(sale) {
  const idPart = String(sale?.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()
  const d = (sale?.date || "").slice(0, 10).replace(/-/g, "").slice(2) // YYMMDD
  return `STV-${d || "000000"}-${idPart || "000000"}`
}

function ReceiptModal({ sale, servedByName, capturedAt, draft, onDraftChange, onClose }) {
  const { t, lang } = useLanguage()
  const [customerName,    setCustomerName]    = useState(draft?.customerName || "")
  const [customerContact, setCustomerContact] = useState(draft?.customerContact || "")
  const [paymentMethod,   setPaymentMethod]   = useState(draft?.paymentMethod || "")

  const updateDraft = (next) => onDraftChange?.({ customerName, customerContact, paymentMethod, ...next })

  const dateDisplay = formatDMY(sale?.date)
  // Real clock time is only known for a sale just recorded in this session
  // (capturedAt, set at the moment of saving) -- the sale's own stored
  // `date` field always carries a fixed noon placeholder time (see
  // SalesPage.submit), not the actual time of the transaction, so a
  // reprinted older receipt correctly omits the Time row rather than
  // showing a fabricated 12:00.
  const timeDisplay = capturedAt
    ? capturedAt.toLocaleTimeString(lang === "sw" ? "sw-TZ" : "en-US", { hour:"2-digit", minute:"2-digit" })
    : null
  const note = (sale?.note || "").trim()
  const trimmedName = customerName.trim()
  const trimmedContact = customerContact.trim()
  const paymentLabel = { cash:t("paymentCash"), mobile:t("paymentMobileMoney"), card:t("paymentCard") }[paymentMethod] || null

  const printLine = { display:"flex", justifyContent:"space-between", gap:12, fontSize:12.5, padding:"3px 0" }
  const divider = <div aria-hidden="true" style={{ borderTop:`1px dashed ${C.borderStrong}`, margin:"12px 0" }} />

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(20px,5vw,28px)", width:"min(94vw, 420px)", maxHeight:"92vh", overflowY:"auto", boxShadow:SHADOW.modal }}
      >
        <h2 id="receipt-title" style={{ margin:"0 0 16px", fontFamily:FONT, fontWeight:700, fontSize:16, color:C.text }}>
          {t("printReceipt")}
        </h2>

        {/* Optional customer + payment capture -- never mandatory, never
            blocks anything, and never touches the database. */}
        <div style={{ marginBottom:16, padding:"12px 14px", background:C.bg, borderRadius:RADIUS.sm }}>
          <div style={{ fontSize:11, fontWeight:600, color:C.textSub, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>
            {t("receiptAddCustomerOptional")}
          </div>
          <label style={lS} htmlFor="receipt-customer-name">{t("receiptName")}</label>
          <input
            id="receipt-customer-name"
            placeholder={t("customerNamePlaceholder")}
            value={customerName}
            onChange={e => { setCustomerName(e.target.value); updateDraft({ customerName: e.target.value }) }}
            style={{ ...iS, marginBottom:10 }}
          />
          <label style={lS} htmlFor="receipt-customer-contact">{t("receiptContact")}</label>
          <input
            id="receipt-customer-contact"
            type="tel"
            placeholder={t("customerContactPlaceholder")}
            value={customerContact}
            onChange={e => { setCustomerContact(e.target.value); updateDraft({ customerContact: e.target.value }) }}
            style={{ ...iS, marginBottom:10 }}
          />
          <label style={lS} htmlFor="receipt-payment-method">{t("selectPaymentMethodOptional")}</label>
          <select
            id="receipt-payment-method"
            value={paymentMethod}
            onChange={e => { setPaymentMethod(e.target.value); updateDraft({ paymentMethod: e.target.value }) }}
            style={iS}
          >
            <option value="">{t("paymentNone")}</option>
            <option value="cash">{t("paymentCash")}</option>
            <option value="mobile">{t("paymentMobileMoney")}</option>
            <option value="card">{t("paymentCard")}</option>
          </select>
        </div>

        {/* The actual printable receipt -- only this element (via
            .stv-receipt-print) is visible when printing. */}
        <div className="stv-receipt-print" style={{ border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, padding:18, background:"#fff" }}>
          <div style={{ textAlign:"center", marginBottom:10 }}>
            <div style={{ fontWeight:800, fontSize:15, color:C.text, letterSpacing:0.5 }}>SWAHILI TENT VILLAGE</div>
            <div style={{ fontSize:11, color:C.textFaint, fontWeight:600, letterSpacing:1, marginTop:4 }}>{t("receiptHeading")}</div>
          </div>
          {divider}
          <div style={printLine}><span style={{ color:C.textSub }}>{t("receiptNo")}</span><span style={{ fontWeight:600 }}>{receiptRefFromSale(sale)}</span></div>
          <div style={printLine}><span style={{ color:C.textSub }}>{t("dateLabel")}</span><span style={{ fontWeight:600 }}>{dateDisplay}</span></div>
          {timeDisplay && (
            <div style={printLine}><span style={{ color:C.textSub }}>{t("receiptTime")}</span><span style={{ fontWeight:600 }}>{timeDisplay}</span></div>
          )}

          {(trimmedName || trimmedContact) && (
            <>
              {divider}
              <div style={{ fontSize:10.5, fontWeight:700, color:C.textFaint, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{t("receiptCustomer")}</div>
              {trimmedName && <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{trimmedName}</div>}
              {trimmedContact && <div style={{ fontSize:12.5, color:C.textSub }}>{trimmedContact}</div>}
            </>
          )}

          {divider}
          <div style={{ fontSize:10.5, fontWeight:700, color:C.textFaint, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{t("receiptServiceProvided")}</div>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{sale?.service || "—"}</div>
          {note && <div style={{ fontSize:12, color:C.textSub, marginTop:4 }}>{note}</div>}

          {divider}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
            <span style={{ fontSize:12.5, fontWeight:700, color:C.text, textTransform:"uppercase", letterSpacing:0.5 }}>{t("total")}</span>
            <span style={{ fontSize:19, fontWeight:800, color:C.accentStrong }}>{TZS(sale?.amount)}</span>
          </div>
          {paymentLabel && (
            <div style={{ ...printLine, marginTop:6 }}><span style={{ color:C.textSub }}>{t("receiptPaymentMethod")}</span><span style={{ fontWeight:600 }}>{paymentLabel}</span></div>
          )}

          {servedByName && (
            <div style={{ ...printLine, marginTop:4 }}><span style={{ color:C.textFaint }}>{t("receiptServedBy")}</span><span style={{ color:C.textFaint }}>{servedByName}</span></div>
          )}

          {divider}
          <div style={{ textAlign:"center", fontSize:11.5, color:C.textSub, fontWeight:500 }}>{t("receiptThankYou")}</div>
        </div>

        <div style={{ display:"flex", gap:10, marginTop:18 }}>
          <button
            type="button"
            onClick={onClose}
            className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("receiptClose")}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("printReceipt")}
          </button>
        </div>
      </div>

      {/* Print-only view: hide everything except the receipt itself. A
          browser's own "Save as PDF" print destination covers the PDF
          case without adding a PDF-generation dependency. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .stv-receipt-print, .stv-receipt-print * { visibility: visible; }
          .stv-receipt-print {
            position: fixed; inset: 0; margin: 0; border: none !important;
            width: 100%; max-width: 340px; left: 50%; transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  )
}

/* ── OWNER DASHBOARD ─────────────────────────────────────── */
function OwnerDashboard({ sales, expenses, services }) {
  const { t, lang } = useLanguage()
  const today  = todayStr()
  const month  = thisMonth()

  const todaySales  = sales.filter(s => s.date?.startsWith(today)).reduce((a, b) => a + Number(b.amount || 0), 0)
  const todayExp    = expenses.filter(e => e.date?.startsWith(today)).reduce((a, b) => a + Number(b.cost || 0), 0)
  const monthSales  = sales.filter(s => s.date?.startsWith(month)).reduce((a, b) => a + Number(b.amount || 0), 0)
  const monthExp    = expenses.filter(e => e.date?.startsWith(month)).reduce((a, b) => a + Number(b.cost || 0), 0)
  const netProfit   = monthSales - monthExp

  // 7-day trend
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const ds = d.toISOString().split("T")[0]
    return {
      day: d.toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-US", { weekday:"short" }),
      Sales:    sales.filter(x => x.date?.startsWith(ds)).reduce((a, b) => a + Number(b.amount || 0), 0),
      Expenses: expenses.filter(x => x.date?.startsWith(ds)).reduce((a, b) => a + Number(b.cost || 0), 0),
    }
  })

  // Pie — revenue by service this month
  const byService = services.map(s => ({
    name:  s.name,
    emoji: s.emoji || "",
    value: sales.filter(x => x.service === s.name && x.date?.startsWith(month)).reduce((a, b) => a + Number(b.amount || 0), 0),
  })).filter(x => x.value > 0)

  const getColor = (name) => services.find(s => s.name === name)?.color || "#aaa"

  const recent = [...sales].slice(0, 6)

  return (
    <div>
      <h1 style={pT}>{t("overview")}</h1>
      <p style={{ margin:"0 0 " + SPACE.xl + "px", color:C.textSub, fontSize:13.5 }}>{t("monthPerformance")}</p>

      {/* Stat cards */}
      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label={t("todaysSales")}    value={TZS(todaySales)} color={C.accent} icon="💰" sub={t("todayExpensesSub", { amount: TZS(todayExp) })} />
        <StatCard label={t("monthlyRevenue")}  value={TZS(monthSales)} color={C.accent} icon="📈" />
        <StatCard label={t("monthlyExpenses")} value={TZS(monthExp)}   color={C.warn} icon="🧾" />
        <StatCard label={t("netProfit")}       value={TZS(netProfit)}  color={netProfit >= 0 ? C.accent : C.warn} icon={netProfit >= 0 ? "✅" : "⚠️"} />
      </div>

      {/* Charts row */}
      <div style={{ display:"flex", gap:SPACE.md, marginBottom:SPACE.xl, flexWrap:"wrap" }}>
        <div style={{ ...panelS, flex:2, minWidth:280 }}>
          <h2 style={{ margin:"0 0 16px", fontSize:14, fontWeight:600, color:C.text }}>{t("salesVsExpenses7d")}</h2>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={trend} barSize={13}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
              <XAxis dataKey="day" tick={{ fontSize:11, fill:"#888" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,.1)", fontSize:12 }} />
              <Legend wrapperStyle={{ fontSize:12 }} />
              <Bar dataKey="Sales"    fill="#81B29A" radius={[5,5,0,0]} />
              <Bar dataKey="Expenses" fill="#E07A5F" radius={[5,5,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...panelS, flex:1, minWidth:200 }}>
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>{t("revenueByService")}</h2>
          {byService.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={62} innerRadius={32} paddingAngle={3}>
                    {byService.map((e, i) => <Cell key={i} fill={getColor(e.name)} />)}
                  </Pie>
                  <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, fontSize:12, boxShadow:SHADOW.hover }} />
                </PieChart>
              </ResponsiveContainer>
              {byService.map(s => (
                <div key={s.name} style={{ display:"flex", alignItems:"center", gap:7, fontSize:11.5, color:C.textSub, marginTop:7 }}>
                  <span aria-hidden="true" style={{ width:8, height:8, borderRadius:RADIUS.pill, background:getColor(s.name), display:"inline-block", flexShrink:0 }} />
                  {s.emoji} {s.name}
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>{t("noDataThisMonth")}</div>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div style={panelS}>
        <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>{t("recentTransactions")}</h2>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table className="stv-table" style={{ width:"100%", minWidth:480, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {[t("colDate"),t("colService"),t("colAmount"),t("colNote")].map(h => (
                <th key={h} scope="col" style={{ textAlign:"left", padding:"0 0 10px", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(s => (
              <tr key={s.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                <td style={tS}>{s.date?.slice(0, 10)}</td>
                <td style={tS}><ServiceBadge name={s.service} services={services} /></td>
                <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
                <td style={{ ...tS, color:C.textFaint }}>{s.note || "—"}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={4} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("noSalesYet")}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

/* ── WORKER HOME ─────────────────────────────────────────── */
function WorkerHome({ sales, displayName, setPage }) {
  const { t } = useLanguage()
  const count      = sales.filter(s => s.date?.startsWith(todayStr())).length
  const todaySales = sales.filter(s => s.date?.startsWith(todayStr())).reduce((a, b) => a + Number(b.amount || 0), 0)

  return (
    <div>
      <h1 style={pT}>{t("goodDay", { name: displayName })}</h1>
      <p style={{ margin:"0 0 " + SPACE.xl + "px", color:C.textSub, fontSize:13.5 }}>{t("whatToRecordToday")}</p>

      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label={t("todaysSales")} value={TZS(todaySales)} color={C.accent} icon="💰" sub={t("transactionsRecorded", { count, plural: count !== 1 ? "s" : "" })} />
      </div>

      <div style={{ display:"grid", gap:SPACE.md, gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))" }}>
        <button
          type="button"
          onClick={() => setPage("sales")}
          className="stv-btn"
          style={{
            flex:1, minWidth:180, padding:"28px 24px",
            borderRadius:RADIUS.lg, border:"none", background:C.accentStrong,
            color:"#fff", cursor:"pointer", textAlign:"center",
            fontFamily:FONT,
            boxShadow:`0 4px 16px ${C.accent}33`,
            transition:"transform .15s, box-shadow .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "none"}
        >
          <span style={{ fontSize:30, marginBottom:10, display:"block" }}>💰</span>
          <span style={{ fontSize:15.5, fontWeight:700, display:"block" }}>{t("recordSale")}</span>
          <span style={{ fontSize:12, opacity:.85, marginTop:5, display:"block" }}>{t("recordSaleCardSub")}</span>
        </button>

        <button
          type="button"
          onClick={() => setPage("expenses")}
          className="stv-btn"
          style={{
            flex:1, minWidth:180, padding:"28px 24px",
            borderRadius:RADIUS.lg, border:"none", background:C.warnStrong,
            color:"#fff", cursor:"pointer", textAlign:"center",
            fontFamily:FONT,
            boxShadow:`0 4px 16px ${C.warn}33`,
            transition:"transform .15s, box-shadow .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "none"}
        >
          <span style={{ fontSize:30, marginBottom:10, display:"block" }}>🧾</span>
          <span style={{ fontSize:15.5, fontWeight:700, display:"block" }}>{t("recordExpense")}</span>
          <span style={{ fontSize:12, opacity:.85, marginTop:5, display:"block" }}>{t("recordExpenseCardSub")}</span>
        </button>
      </div>
    </div>
  )
}

/* ── SALES PAGE ──────────────────────────────────────────── */
function SalesPage({ sales, services, fetchAll, user, showToast, isOwner, onOpenAddService }) {
  const { t, lang } = useLanguage()
  const [form, setForm] = useState({
    service: services[0]?.name || "",
    amount:  "",
    note:    "",
    date:    todayStr(),
  })
  const [filter, setFilter] = useState({ service:"All", from:"", to:"" })
  const [busy, setBusy]     = useState(false)

  // Post-save "Sale saved ✓ [Print Receipt]" prompt -- the just-recorded
  // row plus the current moment (real wall-clock time, unlike the sale's
  // own stored `date`, which only ever carries a date and a fixed noon
  // placeholder time; see ReceiptModal for why that distinction matters).
  const [lastSaved, setLastSaved] = useState(null)
  // Which sale (if any) the receipt modal is currently open for, and
  // whether it's the "just saved" case (servedBy/time known and accurate)
  // or a reprint of an older row (deliberately without those two fields --
  // see ReceiptModal).
  const [receiptTarget, setReceiptTarget] = useState(null)
  // Customer name/contact/payment method are NEVER persisted to the sales
  // table (no schema change for this) -- they only exist for as long as
  // the receipt is open. This in-memory map just lets a worker re-open the
  // same sale's receipt later in the session without retyping what they
  // already entered; it's cleared on refresh like everything else here.
  const [receiptDrafts, setReceiptDrafts] = useState({})

  const displayName = user?.user_metadata?.name || user?.email?.split("@")[0] || "User"

  // Keep selected service valid when services list updates
  const svcNames     = services.map(s => s.name)
  const safeService  = svcNames.includes(form.service) ? form.service : (services[0]?.name || "")

  const submit = async () => {
    if (!user?.id) { showToast(t("notAuthenticated"), "error"); return }
    if (!form.amount || Number(form.amount) <= 0) { showToast(t("enterValidAmount"), "error"); return }
    if (!safeService) { showToast(t("selectService"), "error"); return }
    setBusy(true)
    const payload = {
      service: safeService,
      amount:  Number(form.amount),
      note:    form.note,
      date:    new Date(form.date + "T12:00:00").toISOString(),
      user_id: user.id,
    }
    console.log("Inserting sale:", payload)
    // .select() added so the receipt flow below can use the real inserted
    // row (its id, for a human-readable receipt reference) -- this doesn't
    // change what's written, only what comes back from the same insert.
    const { data, error } = await supabase.from("sales").insert([payload]).select()
    setBusy(false)
    if (error) { console.error("Sale insert error:", error.message); showToast(error.message, "error"); return }
    setForm(f => ({ ...f, amount:"", note:"" }))
    fetchAll()
    showToast(t("saleRecorded"))
    const saved = data?.[0] || { ...payload, id: null }
    setLastSaved({ sale: saved, capturedAt: new Date() })
  }

  const deleteSale = async (id) => {
    if (!confirm(t("confirmDeleteSale"))) return
    const { error } = await supabase.from("sales").delete().eq("id", id)
    if (error) { showToast(error.message, "error"); return }
    fetchAll()
    showToast(t("saleDeleted"))
    if (lastSaved?.sale?.id === id) setLastSaved(null)
  }

  const filtered = sales
    .filter(s => filter.service === "All" || s.service === filter.service)
    .filter(s => !filter.from || s.date >= filter.from)
    .filter(s => !filter.to   || s.date <= filter.to + "T99")
    .sort((a, b) => b.date?.localeCompare(a.date))

  const total = filtered.reduce((a, b) => a + Number(b.amount || 0), 0)

  return (
    <div>
      <h1 style={pT}>{t("salesTitle")}</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>

        {/* Form card */}
        <div style={{ ...fC, flex: isOwner ? "1 1 280px" : "1 1 100%", flexShrink:1, width:"auto", maxWidth: isOwner ? 340 : 460 }}>
          <h2 style={fTi}>{t("recordASale")}</h2>

          <label style={lS} id="sale-service-label">{t("serviceLabel")}</label>
          <div role="group" aria-labelledby="sale-service-label" style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:8 }}>
            {services.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setForm(f => ({ ...f, service:s.name }))}
                className="stv-btn"
                aria-pressed={safeService === s.name}
                style={{
                  padding:"8px 13px", borderRadius:RADIUS.sm,
                  border:"1.5px solid",
                  borderColor: safeService === s.name ? s.color : C.border,
                  background:  safeService === s.name ? s.color : C.surface,
                  color:       safeService === s.name ? "#fff" : C.textSub,
                  fontSize:12, fontWeight:600, cursor:"pointer",
                  fontFamily:FONT,
                  display:"flex", alignItems:"center", gap:5,
                }}
              >
                {s.emoji && <span>{s.emoji}</span>}
                {s.name}
              </button>
            ))}
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={onOpenAddService}
              className="stv-btn stv-btn-ghost"
              style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:`1.5px dashed ${C.borderStrong}`, color:C.textSub, borderRadius:RADIUS.sm, padding:"7px 12px", fontSize:12, fontWeight:500, cursor:"pointer", marginBottom:SPACE.md+2, fontFamily:FONT }}
            >
              <span style={{ fontSize:15 }}>＋</span> {t("addNewService")}
            </button>
          )}
          {!isOwner && <div style={{ marginBottom:16 }} />}

          <label style={lS} htmlFor="sale-amount">{t("amountTzs")}</label>
          <input id="sale-amount" type="number" placeholder={t("amountPlaceholder")} value={form.amount} onChange={e => setForm(f => ({ ...f, amount:e.target.value }))} style={{ ...iS, fontSize:21, fontWeight:700, marginBottom:14 }} />

          <label style={lS} htmlFor="sale-date">{t("dateLabel")}</label>
          <input id="sale-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS} htmlFor="sale-note">{t("notesOptional")}</label>
          <input id="sale-note" placeholder={t("notesPlaceholderSale")} value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={{ ...iS, marginBottom:SPACE.lg+2 }} />

          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary" style={{ ...sB, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("recordSaleBtn")}
          </button>

          {/* Natural next action after saving -- entirely optional, never
              blocks recording the next sale. Clears itself once the worker
              starts a new entry (see the amount-change effect isn't
              needed: we simply clear it on next successful submit/delete,
              or the worker can dismiss it directly). */}
          {lastSaved && (
            <div style={{ marginTop:12, padding:"10px 12px", background:C.accentSoft, borderRadius:RADIUS.sm, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, fontWeight:600, color:C.accentStrong }}>{t("saleSavedPrompt")}</span>
              <div style={{ display:"flex", gap:6 }}>
                <button
                  type="button"
                  onClick={() => setReceiptTarget({ sale: lastSaved.sale, servedByName: displayName, capturedAt: lastSaved.capturedAt })}
                  className="stv-btn stv-btn-secondary"
                  style={{ background:C.surface, color:C.accentStrong, border:`1.5px solid ${C.accentStrong}`, borderRadius:RADIUS.sm, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:FONT }}
                >
                  {t("printReceipt")}
                </button>
                <button
                  type="button"
                  onClick={() => setLastSaved(null)}
                  className="stv-btn stv-btn-ghost"
                  aria-label={t("receiptSkip")}
                  style={{ background:"none", border:"none", color:C.accentStrong, borderRadius:RADIUS.sm, padding:"6px 10px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:FONT }}
                >
                  {t("receiptSkip")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              {/* Filters */}
              <div style={{ display:"flex", gap:SPACE.sm, marginBottom:SPACE.md, flexWrap:"wrap", alignItems:"center" }}>
                <select aria-label={t("filterByService")} value={filter.service} onChange={e => setFilter(f => ({ ...f, service:e.target.value }))} style={seS}>
                  <option value="All">{t("allServices")}</option>
                  {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                <input aria-label={t("fromDate")} type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from:e.target.value }))} style={seS} />
                <input aria-label={t("toDate")} type="date" value={filter.to}   onChange={e => setFilter(f => ({ ...f, to:e.target.value }))}   style={seS} />
                <button type="button" onClick={() => setFilter({ service:"All", from:"", to:"" })} className="stv-btn stv-btn-ghost" aria-label={t("reset")} style={{ ...seS, background:C.bg, border:"none", cursor:"pointer" }}>{t("reset")}</button>
                <div style={{ marginLeft:"auto", fontWeight:700, color:C.text, fontSize:13 }}>{t("total")}: {TZS(total)}</div>
              </div>

              <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table className="stv-table" style={{ width:"100%", minWidth:560, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                    {[t("colDate"),t("colService"),t("colAmount"),t("colNote"),""].map(h => (
                      <th key={h} scope="col" style={{ textAlign:"left", padding:"0 0 10px", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 50).map(s => (
                    <tr key={s.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                      <td style={tS}>{s.date?.slice(0, 10)}</td>
                      <td style={tS}><ServiceBadge name={s.service} services={services} /></td>
                      <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
                      <td style={{ ...tS, color:C.textFaint }}>{s.note || "—"}</td>
                      <td style={tS}>
                        <div style={{ display:"flex", gap:6 }}>
                          <button
                            type="button"
                            onClick={() => setReceiptTarget({ sale: s })}
                            className="stv-btn stv-btn-secondary"
                            aria-label={t("printReceipt")}
                            title={t("printReceipt")}
                            style={{ background:C.surface, color:C.textSub, border:`1px solid ${C.border}`, padding:"5px 9px", borderRadius:RADIUS.sm, fontSize:12, cursor:"pointer" }}
                          >
                            🧾
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSale(s.id)}
                            className="stv-btn stv-btn-danger"
                            aria-label={t("delete")}
                            style={{ background:C.warnSoft, color:C.warnStrong, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}
                          >
                            {t("delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("noSalesYet")}</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {receiptTarget && (
        <ReceiptModal
          sale={receiptTarget.sale}
          servedByName={receiptTarget.servedByName}
          capturedAt={receiptTarget.capturedAt}
          draft={receiptDrafts[receiptTarget.sale.id]}
          onDraftChange={(d) => setReceiptDrafts(prev => ({ ...prev, [receiptTarget.sale.id]: d }))}
          onClose={() => setReceiptTarget(null)}
        />
      )}
    </div>
  )
}

/* ── EXPENSES PAGE ───────────────────────────────────────── */
const CAT_KEYS = {
  Restaurant:    "catRestaurant",
  "Go Kart":     "catGoKart",
  Paintball:     "catPaintball",
  "Park Entry":  "catParkEntry",
  Utilities:     "catUtilities",
  Staff:         "catStaff",
  Maintenance:   "catMaintenance",
  Other:         "catOther",
}

function ExpensesPage({ expenses, fetchAll, user, showToast, isOwner }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ category:EXPENSE_CATS[0], item:"", cost:"", date:todayStr(), time:nowTimeStr() })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!user?.id) { showToast(t("notAuthenticated"), "error"); return }
    if (!form.item.trim())            { showToast(t("enterItemDescription"), "error"); return }
    if (!form.cost || Number(form.cost) <= 0) { showToast(t("enterValidCost"), "error"); return }
    setBusy(true)
    // Combine the user-selected date AND time into one timestamp -- the
    // `expenses.date` column is already `timestamptz` (same as `sales.date`),
    // so no schema change was needed here. Previously this always hardcoded
    // "T12:00:00", silently discarding any notion of time of day.
    //
    // Built directly as a "Z"-suffixed string (never via `new Date(local
    // string).toISOString()`) so the stored date/time are NOT reinterpreted
    // through the browser's timezone. That matters because every existing
    // report/filter/sort in this app (Reports, Tax export, this same table)
    // reads the date by string-slicing the first 10 characters of this
    // field -- e.g. `e.date.slice(0,10)`. Parsing through a local Date
    // object first would risk the UTC-converted date rolling back a day for
    // early-morning times, silently moving the expense into the wrong day
    // in every report. Building the ISO string directly guarantees the
    // stored date always equals exactly the date the user picked.
    const timePart = /^\d{2}:\d{2}$/.test(form.time || "") ? form.time : "12:00"
    const payload = {
      category:   form.category,
      item:       form.item,
      cost:       Number(form.cost),
      date:       `${form.date}T${timePart}:00.000Z`,
      user_id:    user.id,
      created_by: user.email,
    }
    console.log("Inserting expense:", payload)
    const { error } = await supabase.from("expenses").insert([payload])
    setBusy(false)
    if (error) { console.error("Expense insert error:", error.message); showToast(error.message, "error"); return }
    setForm(f => ({ ...f, item:"", cost:"" }))
    fetchAll()
    showToast(t("expenseRecorded"))
  }

  const deleteExpense = async (id) => {
    if (!confirm(t("confirmDeleteExpense"))) return
    const { error } = await supabase.from("expenses").delete().eq("id", id)
    if (error) { showToast(error.message, "error"); return }
    fetchAll()
    showToast(t("expenseDeleted"))
  }

  const sorted = [...expenses].sort((a, b) => b.date?.localeCompare(a.date))
  const total  = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)

  return (
    <div>
      <h1 style={pT}>{t("expensesTitle")}</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>

        {/* Form */}
        <div style={{ ...fC, flex: isOwner ? "1 1 280px" : "1 1 100%", flexShrink:1, width:"auto", maxWidth: isOwner ? 340 : 460 }}>
          <h2 style={fTi}>{t("recordAnExpense")}</h2>

          <label style={lS} htmlFor="exp-category">{t("categoryLabel")}</label>
          <select id="exp-category" value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={{ ...iS, marginBottom:14 }}>
            {EXPENSE_CATS.map(c => <option key={c} value={c}>{t(CAT_KEYS[c] || c)}</option>)}
          </select>

          <label style={lS} htmlFor="exp-item">{t("itemDescription")}</label>
          <input id="exp-item" placeholder={t("itemPlaceholder")} value={form.item} onChange={e => setForm(f => ({ ...f, item:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS} htmlFor="exp-cost">{t("costTzs")}</label>
          <input id="exp-cost" type="number" placeholder={t("costPlaceholder")} value={form.cost} onChange={e => setForm(f => ({ ...f, cost:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />

          <div style={{ display:"flex", gap:10, marginBottom:22 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <label style={lS} htmlFor="exp-date">{t("dateLabel")}</label>
              <input id="exp-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={iS} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <label style={lS} htmlFor="exp-time">{t("timeLabel")}</label>
              <input id="exp-time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={iS} />
            </div>
          </div>

          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-danger-solid" style={{ ...sB, background:C.warnStrong, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("recordExpenseBtn")}
          </button>
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              <div style={{ fontWeight:700, color:C.text, marginBottom:SPACE.md, fontSize:13 }}>
                {t("total")}: {TZS(total)}
              </div>
              <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table className="stv-table" style={{ width:"100%", minWidth:560, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                    {[t("colDate"),t("timeLabel"),t("colCategory"),t("colItem"),t("colCost"),""].map((h, i) => (
                      <th key={i} scope="col" style={{ textAlign:"left", padding:"0 0 10px", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 50).map(e => (
                    <tr key={e.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                      <td style={tS}>{e.date?.slice(0, 10)}</td>
                      <td style={tS}>{/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.date || "") ? e.date.slice(11, 16) : "—"}</td>
                      <td style={tS}>{t(CAT_KEYS[e.category] || e.category)}</td>
                      <td style={tS}>{e.item}</td>
                      <td style={{ ...tS, fontWeight:600, color:C.warnStrong }}>{TZS(e.cost)}</td>
                      <td style={tS}>
                        <button
                          type="button"
                          onClick={() => deleteExpense(e.id)}
                          className="stv-btn stv-btn-danger"
                          style={{ background:C.warnSoft, color:C.warnStrong, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}
                        >
                          {t("delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={6} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("noExpensesYet")}</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── INVENTORY ───────────────────────────────────────────────
   A lightweight stock-awareness system -- NOT a warehouse/ERP/recipe/
   procurement system. It answers three questions per item: how much do we
   have, is it running low, and who changed it and when. It deliberately
   does NOT connect to Sales -- nothing here auto-deducts stock when a sale
   is recorded, and there is no recipe/ingredient deduction anywhere.

   Data lives in Supabase (inventory_categories / inventory_items /
   inventory_movements / drink_weeks / drink_week_lines /
   drink_week_additions), guarded by the exact same
   has_application_access('stv-pos') / has_minimum_role('stv-pos','admin')
   RLS pattern already used for sales/expenses/services -- no parallel
   permission system. The only way inventory_items.quantity ever changes is
   the record_inventory_movement() RPC (SECURITY DEFINER), which updates
   the item and writes its history row atomically, and itself enforces who
   may call it (any app member for 'add', admin+ for 'adjustment') -- so a
   Worker can never write directly to quantity or to the movement log, even
   if a UI check were somehow bypassed.

   Categories are a real table (inventory_categories), not a hardcoded
   list, so a new category can be added later with a plain INSERT and no
   code change -- catDisplayName() below only translates the five
   categories this task shipped with; anything else falls back to its own
   `name` column untranslated, since at that point it's business data the
   Owner typed in, not interface text. */

const INV_CATEGORY_KEYS = {
  drinks:    "invCatDrinks",
  groceries: "invCatGroceries",
  bnb:       "invCatBnb",
  park:      "invCatPark",
  other:     "invCatOther",
}
function catDisplayName(cat, t) {
  if (!cat) return ""
  const key = INV_CATEGORY_KEYS[cat.id]
  return key ? t(key) : cat.name
}

const UNIT_KEYS = {
  Pieces:  "unitPieces",
  Kg:      "unitKg",
  Grams:   "unitGrams",
  Litres:  "unitLitres",
  Bottles: "unitBottles",
  Cans:    "unitCans",
  Packs:   "unitPacks",
  Boxes:   "unitBoxes",
  Dozens:  "unitDozens",
  Other:   "unitOther",
}
const UNIT_OPTIONS = Object.keys(UNIT_KEYS)
function unitDisplayName(unit, t) {
  return UNIT_KEYS[unit] ? t(UNIT_KEYS[unit]) : (unit || "")
}

// Trims trailing zeros without ever showing false precision.
function fmtQty(n) {
  return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// Exactly three levels, on purpose -- Finished = 0 or below, Low = above
// zero but at/under the minimum, Good = above the minimum. No further
// alert tiers.
function inventoryStatus(item) {
  const qty = Number(item?.quantity) || 0
  const min = Number(item?.min_quantity) || 0
  if (qty <= 0) return "finished"
  if (qty <= min) return "low"
  return "good"
}

const STATUS_META = {
  good:     { emoji: "🟢", key: "statusGood",     color: C.accentStrong, bg: C.accentSoft },
  low:      { emoji: "🟡", key: "statusLow",      color: "#8A6416",      bg: "#FBF0D9" },
  finished: { emoji: "🔴", key: "statusFinished", color: C.warnStrong,   bg: C.warnSoft },
}

// Status is always emoji + text together -- never color alone.
function StatusBadge({ status }) {
  const { t } = useLanguage()
  const meta = STATUS_META[status] || STATUS_META.good
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:5,
      background: meta.bg, color: meta.color,
      border:`1px solid ${meta.color}33`,
      padding:"4px 10px", borderRadius:RADIUS.pill,
      fontSize:11.5, fontWeight:600, whiteSpace:"nowrap",
    }}>
      <span aria-hidden="true">{meta.emoji}</span>
      {t(meta.key)}
    </span>
  )
}

/* ── INVENTORY DASHBOARD ─────────────────────────────────── */
function InventoryPage({ user, isOwner, showToast }) {
  const { t } = useLanguage()
  const [categories, setCategories] = useState([])
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [activeCat,  setActiveCat]  = useState(null) // category id, or null = dashboard

  async function loadAll() {
    const [{ data: cats, error: catErr }, { data: itms, error: itmErr }] = await Promise.all([
      supabase.from("inventory_categories").select("*").eq("is_active", true).order("sort_order", { ascending:true }),
      supabase.from("inventory_items").select("*").eq("is_active", true).order("name", { ascending:true }),
    ])
    if (catErr) console.error("Inventory categories fetch error:", catErr.message)
    if (itmErr) console.error("Inventory items fetch error:", itmErr.message)
    setCategories(cats || [])
    setItems(itms || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  if (loading) return <p style={{ color:C.textFaint, fontSize:13 }}>{t("loadingLabel")}</p>

  const activeCategory = categories.find(c => c.id === activeCat) || null

  if (activeCategory) {
    const catItems = items.filter(i => i.category === activeCategory.id)
    return (
      <div>
        <button
          type="button"
          onClick={() => setActiveCat(null)}
          className="stv-btn stv-btn-ghost"
          style={{ background:"none", border:"none", color:C.textSub, fontSize:12.5, fontWeight:600, cursor:"pointer", padding:0, marginBottom:16, fontFamily:FONT }}
        >
          {t("backToInventory")}
        </button>
        {activeCategory.id === "drinks" ? (
          <DrinksCategoryView
            category={activeCategory} items={catItems}
            user={user} isOwner={isOwner} showToast={showToast}
            reloadItems={loadAll}
          />
        ) : (
          <InventoryCategoryView
            category={activeCategory} items={catItems}
            user={user} isOwner={isOwner} showToast={showToast}
            reloadItems={loadAll}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <h1 style={pT}>{t("inventoryTitle")}</h1>
      <p style={{ margin:"0 0 24px", color:C.textFaint, fontSize:13 }}>{t("inventoryDashboardSubtitle")}</p>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:16 }}>
        {categories.map(cat => {
          const catItems = items.filter(i => i.category === cat.id)
          const lowCount = catItems.filter(i => inventoryStatus(i) === "low").length
          const finishedCount = catItems.filter(i => inventoryStatus(i) === "finished").length
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCat(cat.id)}
              className="stv-card stv-card-hover stv-btn"
              style={{
                textAlign:"left", cursor:"pointer",
                background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.md,
                padding:"18px 20px", boxShadow:SHADOW.card, fontFamily:FONT,
                display:"flex", flexDirection:"column", gap:10,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:14.5, fontWeight:700, color:C.text }}>{catDisplayName(cat, t)}</span>
                <span aria-hidden="true" style={{ fontSize:18 }}>
                  {finishedCount > 0 ? "🔴" : lowCount > 0 ? "🟡" : "🟢"}
                </span>
              </div>
              <div style={{ fontSize:12.5, color:C.textSub, fontWeight:500 }}>
                {t("itemsCount", { count: catItems.length })}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {lowCount > 0 && (
                  <span style={{ fontSize:11, fontWeight:600, color:STATUS_META.low.color, background:STATUS_META.low.bg, padding:"3px 9px", borderRadius:RADIUS.pill }}>
                    {t("lowStockCount", { count: lowCount })}
                  </span>
                )}
                {finishedCount > 0 && (
                  <span style={{ fontSize:11, fontWeight:600, color:STATUS_META.finished.color, background:STATUS_META.finished.bg, padding:"3px 9px", borderRadius:RADIUS.pill }}>
                    {t("finishedCount", { count: finishedCount })}
                  </span>
                )}
                {lowCount === 0 && finishedCount === 0 && (
                  <span style={{ fontSize:11, fontWeight:600, color:STATUS_META.good.color, background:STATUS_META.good.bg, padding:"3px 9px", borderRadius:RADIUS.pill }}>
                    {t("statusGood")}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── GENERIC CATEGORY VIEW (Groceries / BnB / Park / Other, and the
   "Stock" tab of Drinks) ─────────────────────────────────── */
function InventoryCategoryView({ category, items, user, isOwner, showToast, reloadItems, skipTitle }) {
  const { t } = useLanguage()
  const [showAdd,     setShowAdd]     = useState(false)
  const [stockItem,   setStockItem]   = useState(null)
  const [adjustItem,  setAdjustItem]  = useState(null)
  const [historyItem, setHistoryItem] = useState(null)

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent: skipTitle ? "flex-end" : "space-between", marginBottom:SPACE.lg, flexWrap:"wrap", gap:12 }}>
        {!skipTitle && <h1 style={{ ...pT, marginBottom:0 }}>{catDisplayName(category, t)}</h1>}
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="stv-btn stv-btn-primary"
            style={{ ...sB, width:"auto", padding:"10px 18px", fontSize:13 }}
          >
            {t("addInventoryItem")}
          </button>
        )}
      </div>

      <div style={panelS}>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          <table className="stv-table" style={{ width:"100%", minWidth:640, borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                {[t("colItemName"),t("colUnit"),t("colQuantity"),t("colMin"),t("colStatus"),t("colActions")].map((h, i) => (
                  <th key={i} scope="col" style={{ textAlign:"left", padding:"0 0 10px", paddingRight:12, fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => {
                const status = inventoryStatus(item)
                return (
                  <tr key={item.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                    <td style={{ ...tS, fontWeight:600 }}>{item.name}</td>
                    <td style={tS}>{unitDisplayName(item.unit, t)}</td>
                    <td style={tS}>{fmtQty(item.quantity)}</td>
                    <td style={{ ...tS, color:C.textFaint }}>{fmtQty(item.min_quantity)}</td>
                    <td style={tS}><StatusBadge status={status} /></td>
                    <td style={tS}>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        <button type="button" onClick={() => setStockItem(item)} className="stv-btn stv-btn-accent"
                          style={{ background:C.accentSoft, color:C.accentStrong, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}>
                          {t("addStock")}
                        </button>
                        {isOwner && (
                          <button type="button" onClick={() => setAdjustItem(item)} className="stv-btn stv-btn-secondary"
                            style={{ background:C.surface, color:C.textSub, border:`1px solid ${C.border}`, padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}>
                            {t("adjustStock")}
                          </button>
                        )}
                        <button type="button" onClick={() => setHistoryItem(item)} className="stv-btn stv-btn-ghost"
                          style={{ background:"none", color:C.textFaint, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}>
                          {t("viewHistory")}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={6} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("noItemsInCategory")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <AddInventoryItemModal
          category={category} existing={items} user={user} showToast={showToast}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reloadItems() }}
        />
      )}
      {stockItem && (
        <AddStockModal
          item={stockItem} user={user} showToast={showToast}
          onClose={() => setStockItem(null)}
          onSaved={() => { setStockItem(null); reloadItems() }}
        />
      )}
      {adjustItem && (
        <AdjustStockModal
          item={adjustItem} user={user} showToast={showToast}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); reloadItems() }}
        />
      )}
      {historyItem && (
        <InventoryHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
      )}
    </div>
  )
}

/* ── ADD INVENTORY ITEM ─────────────────────────────────────
   One shared modal for every category. Selling price only appears for
   Drinks -- generic items (Groceries/BnB/Park/Other) never asked for one
   per the spec, so it stays hidden rather than being an unused mandatory
   field. */
function AddInventoryItemModal({ category, existing, user, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const isDrinks = category.id === "drinks"
  const [name,         setName]         = useState("")
  const [unit,         setUnit]         = useState(UNIT_OPTIONS[0])
  const [qty,          setQty]          = useState("")
  const [minQty,       setMinQty]       = useState("")
  const [cost,         setCost]         = useState("")
  const [sellingPrice, setSellingPrice] = useState("")
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr(t("itemNameRequired")); return }
    if (existing.some(i => i.name.toLowerCase() === trimmed.toLowerCase())) {
      setErr(t("itemNameExists")); return
    }
    if (qty === "" || isNaN(Number(qty)) || Number(qty) < 0) { setErr(t("enterValidQuantity")); return }
    if (minQty === "" || isNaN(Number(minQty)) || Number(minQty) < 0) { setErr(t("enterValidMinQuantity")); return }
    setBusy(true)
    const { error } = await supabase.from("inventory_items").insert([{
      category: category.id,
      name: trimmed,
      unit,
      quantity: Number(qty),
      min_quantity: Number(minQty),
      cost_per_unit: cost === "" ? null : Number(cost),
      selling_price: isDrinks && sellingPrice !== "" ? Number(sellingPrice) : null,
      created_by: user?.id || null,
      created_by_name: user?.user_metadata?.name || user?.email || null,
    }])
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("itemSavedToast"))
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-item-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 420px)", maxHeight:"90vh", overflowY:"auto", boxShadow:SHADOW.modal }}>
        <h2 id="add-item-title" style={{ margin:"0 0 4px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("addInventoryItemTitle")}</h2>
        <p style={{ margin:"0 0 20px", fontSize:12.5, color:C.textFaint }}>{catDisplayName(category, t)}</p>

        <label style={lS} htmlFor="inv-item-name">{t("itemNameLabel")}</label>
        <input id="inv-item-name" autoFocus placeholder={t("itemNamePlaceholder")} value={name}
          onChange={e => { setName(e.target.value); setErr("") }} style={{ ...iS, marginBottom:14 }} />

        <label style={lS} htmlFor="inv-item-unit">{t("unitLabel")}</label>
        <select id="inv-item-unit" value={unit} onChange={e => setUnit(e.target.value)} style={{ ...iS, marginBottom:14 }}>
          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{t(UNIT_KEYS[u])}</option>)}
        </select>

        <div style={{ display:"flex", gap:10, marginBottom:14 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <label style={lS} htmlFor="inv-item-qty">{t("currentQuantityLabel")}</label>
            <input id="inv-item-qty" type="number" min="0" step="any" value={qty} onChange={e => { setQty(e.target.value); setErr("") }} style={iS} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <label style={lS} htmlFor="inv-item-min">{t("minQuantityLabel")}</label>
            <input id="inv-item-min" type="number" min="0" step="any" value={minQty} onChange={e => { setMinQty(e.target.value); setErr("") }} style={iS} />
          </div>
        </div>

        <div style={{ display:"flex", gap:10, marginBottom:14 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <label style={lS} htmlFor="inv-item-cost">{t("costPerUnitLabel")}</label>
            <input id="inv-item-cost" type="number" min="0" step="any" value={cost} onChange={e => setCost(e.target.value)} style={iS} />
          </div>
          {isDrinks && (
            <div style={{ flex:1, minWidth:0 }}>
              <label style={lS} htmlFor="inv-item-price">{t("sellingPriceLabel")}</label>
              <input id="inv-item-price" type="number" min="0" step="any" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} style={iS} />
            </div>
          )}
        </div>

        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}

        <div style={{ display:"flex", gap:10, marginTop:8 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("saveItemBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── ADD STOCK -- "opening 25kg + 20 added = 45kg", computed, never typed
   in by hand. Any signed-in app member may do this (matches the
   record_inventory_movement RPC's own 'add' permission check). ────── */
function AddStockModal({ item, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const [qty,  setQty]  = useState("")
  const [note, setNote] = useState("")
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)

  const numQty = Number(qty)
  const newTotal = qty !== "" && !isNaN(numQty) ? Number(item.quantity || 0) + numQty : null

  const submit = async () => {
    if (qty === "" || isNaN(Number(qty)) || Number(qty) <= 0) { setErr(t("enterQuantityToAdd")); return }
    setBusy(true)
    const { error } = await supabase.rpc("record_inventory_movement", {
      p_item_id: item.id,
      p_delta: Number(qty),
      p_movement_type: "add",
      p_reason: null,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("stockAddedToast"))
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-stock-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 380px)", boxShadow:SHADOW.modal }}>
        <h2 id="add-stock-title" style={{ margin:"0 0 4px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("addStockTitle")}</h2>
        <p style={{ margin:"0 0 20px", fontSize:12.5, color:C.textFaint }}>{item.name} · {fmtQty(item.quantity)} {unitDisplayName(item.unit, t)}</p>

        <label style={lS} htmlFor="add-stock-qty">{t("quantityAddedLabel")}</label>
        <input id="add-stock-qty" type="number" min="0" step="any" autoFocus value={qty} onChange={e => { setQty(e.target.value); setErr("") }} style={{ ...iS, marginBottom:6 }} />

        {newTotal !== null && (
          <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.accentStrong, fontWeight:600 }}>
            {t("newTotalLabel")}: {fmtQty(newTotal)} {unitDisplayName(item.unit, t)}
          </p>
        )}

        <label style={{ ...lS, marginTop: newTotal === null ? 8 : 0 }} htmlFor="add-stock-note">{t("optionalNoteLabel")}</label>
        <input id="add-stock-note" value={note} onChange={e => setNote(e.target.value)} style={{ ...iS, marginBottom:14 }} />

        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}

        <div style={{ display:"flex", gap:10 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("addStockBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── ADJUST STOCK -- Owner/Admin only (also enforced by the RPC itself
   and by RLS on inventory_items/inventory_movements), always requires a
   reason, always logged. Never a silent overwrite of the quantity. ─── */
function AdjustStockModal({ item, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const [delta,  setDelta]  = useState("")
  const [reason, setReason] = useState("")
  const [note,   setNote]   = useState("")
  const [err,    setErr]    = useState("")
  const [busy,   setBusy]   = useState(false)

  const numDelta = Number(delta)
  const newTotal = delta !== "" && !isNaN(numDelta) ? Number(item.quantity || 0) + numDelta : null

  const submit = async () => {
    if (delta === "" || isNaN(numDelta) || numDelta === 0) { setErr(t("enterAdjustmentQuantity")); return }
    if (!reason.trim()) { setErr(t("reasonLabel")); return }
    setBusy(true)
    const { error } = await supabase.rpc("record_inventory_movement", {
      p_item_id: item.id,
      p_delta: numDelta,
      p_movement_type: "adjustment",
      p_reason: reason.trim(),
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("stockAdjustedToast"))
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="adjust-stock-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 400px)", boxShadow:SHADOW.modal }}>
        <h2 id="adjust-stock-title" style={{ margin:"0 0 4px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("adjustStockTitle")}</h2>
        <p style={{ margin:"0 0 20px", fontSize:12.5, color:C.textFaint }}>{item.name} · {fmtQty(item.quantity)} {unitDisplayName(item.unit, t)}</p>

        <label style={lS} htmlFor="adjust-delta">{t("adjustmentLabel")}</label>
        <input id="adjust-delta" type="number" step="any" autoFocus value={delta} onChange={e => { setDelta(e.target.value); setErr("") }} style={{ ...iS, marginBottom:6 }} />
        <p style={{ margin:"0 0 14px", fontSize:11.5, color:C.textFaint }}>{t("adjustmentHint")}</p>

        {newTotal !== null && (
          <p style={{ margin:"0 0 14px", fontSize:12.5, color: newTotal < 0 ? C.warnStrong : C.accentStrong, fontWeight:600 }}>
            {t("newTotalLabel")}: {fmtQty(newTotal)} {unitDisplayName(item.unit, t)}
          </p>
        )}

        <label style={lS} htmlFor="adjust-reason">{t("reasonLabel")}</label>
        <input id="adjust-reason" placeholder={t("reasonPlaceholder")} value={reason} onChange={e => { setReason(e.target.value); setErr("") }} style={{ ...iS, marginBottom:14 }} />

        <label style={lS} htmlFor="adjust-note">{t("optionalNoteLabel")}</label>
        <input id="adjust-note" value={note} onChange={e => setNote(e.target.value)} style={{ ...iS, marginBottom:14 }} />

        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}

        <div style={{ display:"flex", gap:10 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-danger-solid"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.warnStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("saveAdjustmentBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── INVENTORY HISTORY -- lightweight movement log, not a full audit
   system: just what changed, by how much, by whom, and when. ───────── */
function InventoryHistoryModal({ item, onClose }) {
  const { t } = useLanguage()
  const [movements, setMovements] = useState([])
  const [loading,    setLoading]  = useState(true)

  useEffect(() => {
    let active = true
    supabase.from("inventory_movements").select("*").eq("item_id", item.id).order("created_at", { ascending:false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) console.error("Inventory history fetch error:", error.message)
        setMovements(data || [])
        setLoading(false)
      })
    return () => { active = false }
  }, [item.id])

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="history-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 480px)", maxHeight:"84vh", overflowY:"auto", boxShadow:SHADOW.modal }}>
        <h2 id="history-title" style={{ margin:"0 0 4px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("inventoryHistoryTitle")}</h2>
        <p style={{ margin:"0 0 20px", fontSize:12.5, color:C.textFaint }}>{item.name}</p>

        {loading ? (
          <p style={{ color:C.textFaint, fontSize:13 }}>{t("loadingLabel")}</p>
        ) : movements.length === 0 ? (
          <p style={{ color:C.textFaint, fontSize:13 }}>{t("noHistoryYet")}</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {movements.map(m => (
              <div key={m.id} style={{ borderBottom:`1px solid ${C.bg}`, paddingBottom:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:10 }}>
                  <span style={{ fontWeight:700, fontSize:13.5, color: Number(m.delta) < 0 ? C.warnStrong : C.accentStrong }}>
                    {Number(m.delta) > 0 ? "+" : ""}{fmtQty(m.delta)}
                  </span>
                  <span style={{ fontSize:11.5, color:C.textFaint }}>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>
                  {m.movement_type === "adjustment" ? t("movementAdjustment") : t("movementAdd")}
                  {m.reason ? ` — ${m.reason}` : ""}
                </div>
                {m.note && <div style={{ fontSize:11.5, color:C.textFaint, marginTop:2 }}>{m.note}</div>}
                <div style={{ fontSize:11, color:C.textFaint, marginTop:2 }}>
                  {m.created_by_name || "—"} · {t("newTotalLabel")}: {fmtQty(m.resulting_quantity)}
                </div>
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
          style={{ marginTop:20, width:"100%", padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
          {t("cancel")}
        </button>
      </div>
    </div>
  )
}

/* ── DRINKS ──────────────────────────────────────────────────
   Drinks get everything the generic categories get (the "Stock" tab below
   -- e.g. logging a supplier delivery into the storeroom count) PLUS a
   second, completely separate workflow: the real Tuesday-to-Monday
   physical count against the restaurant worker, which is what actually
   answers "did the money collected match what was sold". These two are
   intentionally decoupled -- the weekly count is never derived from, and
   never writes to, inventory_items.quantity. The weekly physical count
   stays the source of truth for what was sold and collected; this is a
   design choice worth confirming with the Owner (see final report). */
function DrinksCategoryView({ category, items, user, isOwner, showToast, reloadItems }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState("stock") // "stock" | "weekly"

  return (
    <div>
      <h1 style={{ ...pT, marginBottom:18 }}>{catDisplayName(category, t)}</h1>

      <div role="tablist" aria-label={catDisplayName(category, t)} style={{ display:"flex", gap:0, marginBottom:20, borderBottom:`1.5px solid ${C.border}` }}>
        {[["stock", t("invStockTab")], ["weekly", t("invWeeklyTab")]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="stv-btn"
            style={{
              padding:"10px 4px", marginRight:22, background:"none", border:"none",
              borderBottom: tab === id ? `2px solid ${C.accentStrong}` : "2px solid transparent",
              color: tab === id ? C.text : C.textFaint,
              fontWeight: tab === id ? 700 : 500, fontSize:13.5, cursor:"pointer", fontFamily:FONT,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stock" ? (
        <InventoryCategoryView category={category} items={items} user={user} isOwner={isOwner} showToast={showToast} reloadItems={reloadItems} skipTitle />
      ) : (
        <DrinksWeeklyView items={items} user={user} isOwner={isOwner} showToast={showToast} />
      )}
    </div>
  )
}

/* ── DRINKS WEEKLY RECONCILIATION ────────────────────────────
   Tuesday: opening count handed to the restaurant worker, per drink, with
   its own selling price (different sizes = different items = different
   prices -- never one price for all variants). During the week: more
   stock can be handed over ("additions"), tracked separately and never
   overwriting the opening count. Monday: physical remaining count is
   entered; Sold and Expected Money are always computed, never typed in by
   hand. Settling a week is one-way -- RLS itself blocks a Worker's own
   update from ever setting status to 'settled' or touching an
   already-settled week (see drink_weeks_stvpos_update_open's with_check),
   so this is enforced at the database level, not just in this UI. */
function DrinksWeeklyView({ items, user, isOwner, showToast }) {
  const { t } = useLanguage()
  const [weeks,      setWeeks]      = useState([])
  const [lines,      setLines]      = useState([])
  const [additions,  setAdditions]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showNewWeek, setShowNewWeek] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [additionFor, setAdditionFor] = useState(null) // line object

  async function loadAll() {
    const [{ data: w, error: wErr }, { data: l, error: lErr }, { data: a, error: aErr }] = await Promise.all([
      supabase.from("drink_weeks").select("*").order("week_start", { ascending:false }),
      supabase.from("drink_week_lines").select("*"),
      supabase.from("drink_week_additions").select("*"),
    ])
    if (wErr) console.error("Drink weeks fetch error:", wErr.message)
    if (lErr) console.error("Drink week lines fetch error:", lErr.message)
    if (aErr) console.error("Drink week additions fetch error:", aErr.message)
    setWeeks(w || [])
    setLines(l || [])
    setAdditions(a || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  if (loading) return <p style={{ color:C.textFaint, fontSize:13 }}>{t("loadingLabel")}</p>

  const openWeek = weeks.find(w => w.status === "open") || null
  const pastWeeks = weeks.filter(w => w.status !== "open")

  const linesFor = (weekId) => lines.filter(l => l.week_id === weekId)
  const additionsFor = (lineId) => additions.filter(a => a.week_line_id === lineId)

  return (
    <div>
      {!openWeek && (
        <div style={{ ...panelS, marginBottom:20, textAlign:"center", padding:"28px 20px" }}>
          <p style={{ margin:"0 0 16px", color:C.textSub, fontSize:13.5 }}>{t("noWeeksYet")}</p>
          <button type="button" onClick={() => setShowNewWeek(true)} className="stv-btn stv-btn-primary" style={{ ...sB, width:"auto", padding:"10px 20px" }}>
            {t("newWeeklyDrinksCount")}
          </button>
        </div>
      )}

      {openWeek && (
        <OpenDrinkWeekPanel
          week={openWeek}
          lines={linesFor(openWeek.id)}
          additionsAll={additions}
          items={items}
          isOwner={isOwner}
          user={user}
          showToast={showToast}
          reload={loadAll}
          onAddLine={() => setShowAddLine(true)}
          onAddAddition={(line) => setAdditionFor(line)}
        />
      )}

      <h2 style={{ ...fTi, marginTop:32 }}>{t("drinkWeekHistory")}</h2>
      <div style={panelS}>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          <table className="stv-table" style={{ width:"100%", minWidth:640, borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                {[t("weekLabel"),t("totalDrinksSold"),t("expectedLabel"),t("moneyReceivedLabel"),t("differenceLabel"),t("colStatus")].map((h, i) => (
                  <th key={i} scope="col" style={{ textAlign:"left", padding:"0 0 10px", paddingRight:12, fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pastWeeks.map(w => {
                const wLines = linesFor(w.id)
                let sold = 0, expected = 0
                wLines.forEach(l => {
                  const added = additionsFor(l.id).reduce((a, b) => a + Number(b.qty || 0), 0)
                  if (l.closing_qty == null) return
                  const s = Number(l.opening_qty || 0) + added - Number(l.closing_qty)
                  sold += s
                  expected += s * Number(l.selling_price || 0)
                })
                const received = w.money_received == null ? null : Number(w.money_received)
                const diff = received == null ? null : received - expected
                return (
                  <tr key={w.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                    <td style={tS}>{formatDMY(w.week_start)} – {formatDMY(w.week_end)}</td>
                    <td style={tS}>{fmtQty(sold)}</td>
                    <td style={tS}>{TZS(expected)}</td>
                    <td style={tS}>{received == null ? "—" : TZS(received)}</td>
                    <td style={{ ...tS, fontWeight:600, color: diff == null ? C.textFaint : diff < 0 ? C.warnStrong : C.accentStrong }}>
                      {diff == null ? "—" : TZS(diff)}
                    </td>
                    <td style={tS}>
                      <span style={{
                        fontSize:11, fontWeight:600, padding:"4px 10px", borderRadius:RADIUS.pill,
                        background: w.status === "settled" ? C.accentSoft : C.warnSoft,
                        color: w.status === "settled" ? C.accentStrong : C.warnStrong,
                      }}>
                        {w.status === "settled" ? t("settledLabel") : t("openLabel")}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {pastWeeks.length === 0 && (
                <tr><td colSpan={6} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("noWeeksYet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNewWeek && (
        <NewDrinkWeekModal user={user} showToast={showToast} onClose={() => setShowNewWeek(false)} onSaved={() => { setShowNewWeek(false); loadAll() }} />
      )}
      {showAddLine && openWeek && (
        <AddDrinkLineModal
          week={openWeek} items={items} existingLines={linesFor(openWeek.id)}
          showToast={showToast}
          onClose={() => setShowAddLine(false)}
          onSaved={() => { setShowAddLine(false); loadAll() }}
        />
      )}
      {additionFor && (
        <AddDrinkAdditionModal
          line={additionFor} item={items.find(i => i.id === additionFor.item_id)} user={user} showToast={showToast}
          onClose={() => setAdditionFor(null)}
          onSaved={() => { setAdditionFor(null); loadAll() }}
        />
      )}
    </div>
  )
}

function OpenDrinkWeekPanel({ week, lines, additionsAll, items, isOwner, user, showToast, reload, onAddLine, onAddAddition }) {
  const { t } = useLanguage()
  const [closingDrafts, setClosingDrafts] = useState({})
  const [moneyReceived, setMoneyReceived] = useState(week.money_received ?? "")
  const [note,          setNote]          = useState(week.reconciliation_note || "")
  const [busy,          setBusy]          = useState(false)

  useEffect(() => {
    setMoneyReceived(week.money_received ?? "")
    setNote(week.reconciliation_note || "")
    setClosingDrafts({})
    // Re-sync whenever a different week becomes the open one, or its saved
    // values change underneath us (e.g. after saveReconciliation()).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.id, week.money_received, week.reconciliation_note])

  const additionsFor = (lineId) => additionsAll.filter(a => a.week_line_id === lineId)

  const rows = lines.map(line => {
    const item = items.find(i => i.id === line.item_id)
    const added = additionsFor(line.id).reduce((a, b) => a + Number(b.qty || 0), 0)
    const available = Number(line.opening_qty || 0) + added
    const draft = closingDrafts[line.id]
    const closingVal = draft !== undefined ? draft : (line.closing_qty ?? "")
    const hasClosing = closingVal !== "" && closingVal !== null && !isNaN(Number(closingVal))
    const sold = hasClosing ? available - Number(closingVal) : null
    const expected = sold == null ? null : sold * Number(line.selling_price || 0)
    return { line, item, added, available, closingVal, sold, expected }
  })

  const totalSold = rows.reduce((a, r) => a + (r.sold || 0), 0)
  const totalExpected = rows.reduce((a, r) => a + (r.expected || 0), 0)
  const receivedNum = moneyReceived === "" || isNaN(Number(moneyReceived)) ? null : Number(moneyReceived)
  const diff = receivedNum == null ? null : receivedNum - totalExpected
  const allClosed = rows.length > 0 && rows.every(r => r.sold != null)
  const hasClosingDrafts = Object.keys(closingDrafts).length > 0

  async function saveClosingCounts() {
    const toSave = rows.filter(r => closingDrafts[r.line.id] !== undefined && closingDrafts[r.line.id] !== "" && !isNaN(Number(closingDrafts[r.line.id])))
    if (toSave.length === 0) return
    setBusy(true)
    const results = await Promise.all(toSave.map(r =>
      supabase.from("drink_week_lines").update({ closing_qty: Number(r.closingVal) }).eq("id", r.line.id)
    ))
    setBusy(false)
    const failed = results.find(r => r.error)
    if (failed) { showToast(failed.error.message, "error"); return }
    showToast(t("closingSavedToast"))
    reload()
  }

  async function saveReconciliation() {
    setBusy(true)
    const { error } = await supabase.from("drink_weeks").update({
      money_received: moneyReceived === "" ? null : Number(moneyReceived),
      reconciliation_note: note.trim() || null,
    }).eq("id", week.id)
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("closingSavedToast"))
    reload()
  }

  async function settleWeek() {
    if (!confirm(t("confirmSettleWeek"))) return
    setBusy(true)
    const { error } = await supabase.from("drink_weeks").update({
      money_received: moneyReceived === "" ? null : Number(moneyReceived),
      reconciliation_note: note.trim() || null,
      status: "settled",
      settled_by: user?.id || null,
      settled_by_name: user?.user_metadata?.name || user?.email || null,
      settled_at: new Date().toISOString(),
    }).eq("id", week.id)
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("weekSettledToast"))
    reload()
  }

  return (
    <div style={{ ...panelS, marginBottom:24 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:16 }}>
        <div>
          <div style={{ fontSize:11, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{t("weekLabel")}</div>
          <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{formatDMY(week.week_start)} – {formatDMY(week.week_end)}</div>
        </div>
        <button type="button" onClick={onAddLine} className="stv-btn stv-btn-secondary"
          style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, padding:"9px 16px", borderRadius:RADIUS.sm, fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>
          {t("addDrinkLineBtn")}
        </button>
      </div>

      <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch", marginBottom: rows.length > 0 ? 14 : 20 }}>
        <table className="stv-table" style={{ width:"100%", minWidth:760, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {[t("drinkColLabel"),t("sellingPriceColLabel"),t("openingColLabel"),t("addedColLabel"),t("availableColLabel"),t("remainingLabel"),t("soldLabel"),t("expectedMoneyLabel")].map((h, i) => (
                <th key={i} scope="col" style={{ textAlign:"left", padding:"0 0 10px", paddingRight:10, fontSize:10, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, item, added, available, closingVal, sold, expected }) => (
              <tr key={line.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                <td style={{ ...tS, fontWeight:600 }}>{item?.name || "—"}</td>
                <td style={tS}>{TZS(line.selling_price)}</td>
                <td style={tS}>{fmtQty(line.opening_qty)}</td>
                <td style={tS}>
                  {fmtQty(added)}
                  <button type="button" onClick={() => onAddAddition(line)} className="stv-btn stv-btn-ghost"
                    style={{ marginLeft:8, background:"none", border:"none", color:C.accentStrong, cursor:"pointer", fontSize:11, fontWeight:700, padding:0, fontFamily:FONT }}>
                    {t("addAdditionBtn")}
                  </button>
                </td>
                <td style={{ ...tS, fontWeight:600 }}>{fmtQty(available)}</td>
                <td style={tS}>
                  <input
                    type="number" min="0" step="any"
                    aria-label={`${t("remainingLabel")} — ${item?.name || ""}`}
                    value={closingVal}
                    onChange={e => setClosingDrafts(d => ({ ...d, [line.id]: e.target.value }))}
                    style={{ ...seS, width:80, padding:"7px 9px" }}
                  />
                </td>
                <td style={tS}>{sold == null ? <span style={{ color:C.textFaint }}>{t("pendingClosing")}</span> : fmtQty(sold)}</td>
                <td style={{ ...tS, fontWeight:600 }}>{expected == null ? "—" : TZS(expected)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>{t("addDrinkItemFirst")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <button type="button" onClick={saveClosingCounts} disabled={busy || !hasClosingDrafts} className="stv-btn stv-btn-secondary"
          style={{ marginBottom:28, background:C.surface, color:C.text, border:`1px solid ${C.border}`, padding:"10px 18px", borderRadius:RADIUS.sm, fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:FONT, opacity: (busy || !hasClosingDrafts) ? 0.6 : 1 }}>
          {t("saveClosingBtn")}
        </button>
      )}

      <div style={{ borderTop:`1.5px solid ${C.border}`, paddingTop:20 }}>
        <h3 style={{ ...fTi, marginBottom:16 }}>{t("weeklyReconciliation")}</h3>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:16, marginBottom:16 }}>
          <div>
            <div style={lS}>{t("totalDrinksSold")}</div>
            <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{fmtQty(totalSold)}</div>
          </div>
          <div>
            <div style={lS}>{t("expectedLabel")}</div>
            <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{TZS(totalExpected)}</div>
          </div>
          <div>
            <label style={lS} htmlFor="drink-money-received">{t("moneyReceivedLabel")}</label>
            <input id="drink-money-received" type="number" min="0" step="any" placeholder={t("enterMoneyReceivedPlaceholder")}
              value={moneyReceived} onChange={e => setMoneyReceived(e.target.value)} style={iS} />
          </div>
          <div>
            <div style={lS}>{t("differenceLabel")}</div>
            <div style={{ fontSize:18, fontWeight:700, color: diff == null ? C.textFaint : diff < 0 ? C.warnStrong : C.accentStrong }}>
              {diff == null ? "—" : TZS(diff)}
            </div>
          </div>
        </div>

        <label style={lS} htmlFor="drink-note">{t("reconciliationNoteLabel")}</label>
        <textarea id="drink-note" rows={2} placeholder={t("reconciliationNotePlaceholder")} value={note} onChange={e => setNote(e.target.value)}
          style={{ ...iS, marginBottom:16, resize:"vertical", fontFamily:FONT }} />

        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <button type="button" onClick={saveReconciliation} disabled={busy} className="stv-btn stv-btn-secondary"
            style={{ background:C.surface, color:C.text, border:`1px solid ${C.border}`, padding:"11px 20px", borderRadius:RADIUS.sm, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT, opacity: busy ? 0.7 : 1 }}>
            {t("saveBtn")}
          </button>
          {isOwner && (
            <button type="button" onClick={settleWeek} disabled={busy || !allClosed} className="stv-btn stv-btn-primary"
              title={!allClosed ? t("pendingClosing") : undefined}
              style={{ ...sB, width:"auto", padding:"11px 22px", opacity: (busy || !allClosed) ? 0.6 : 1 }}>
              {t("markSettledBtn")}
            </button>
          )}
          {week.settled_by_name && (
            <span style={{ fontSize:11.5, color:C.textFaint }}>{t("settledByLabel")}: {week.settled_by_name}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function NewDrinkWeekModal({ user, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const [weekStart, setWeekStart] = useState(todayStr())
  const [weekEnd,    setWeekEnd]  = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 6)
    return d.toISOString().split("T")[0]
  })
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!weekStart || !weekEnd) { setErr(t("enterValidQuantity")); return }
    setBusy(true)
    const { error } = await supabase.from("drink_weeks").insert([{
      week_start: weekStart,
      week_end: weekEnd,
      status: "open",
      created_by: user?.id || null,
      created_by_name: user?.user_metadata?.name || user?.email || null,
    }])
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("weekCreatedToast"))
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-week-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 380px)", boxShadow:SHADOW.modal }}>
        <h2 id="new-week-title" style={{ margin:"0 0 20px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("newWeeklyDrinksCount")}</h2>

        <label style={lS} htmlFor="week-start">{t("weekStartLabel")}</label>
        <input id="week-start" type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} style={{ ...iS, marginBottom:14 }} />

        <label style={lS} htmlFor="week-end">{t("weekEndLabel")}</label>
        <input id="week-end" type="date" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} style={{ ...iS, marginBottom:8 }} />

        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}

        <div style={{ display:"flex", gap:10, marginTop:14 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("startWeekBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddDrinkLineModal({ week, items, existingLines, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const usedIds = new Set(existingLines.map(l => l.item_id))
  const available = items.filter(i => !usedIds.has(i.id))
  const [itemId,     setItemId]     = useState(available[0]?.id || "")
  const [price,      setPrice]      = useState(available[0]?.selling_price ?? "")
  const [openingQty, setOpeningQty] = useState("")
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)

  const onSelectItem = (id) => {
    setItemId(id)
    const it = items.find(i => i.id === id)
    setPrice(it?.selling_price ?? "")
  }

  const submit = async () => {
    if (!itemId) { setErr(t("selectDrink")); return }
    if (price === "" || isNaN(Number(price)) || Number(price) < 0) { setErr(t("enterValidPrice")); return }
    if (openingQty === "" || isNaN(Number(openingQty)) || Number(openingQty) < 0) { setErr(t("enterValidQuantity")); return }
    setBusy(true)
    const { error } = await supabase.from("drink_week_lines").insert([{
      week_id: week.id,
      item_id: itemId,
      selling_price: Number(price),
      opening_qty: Number(openingQty),
    }])
    if (!error) {
      // Keep the item's own price as a convenience default for next week --
      // never required, always overridable per line.
      await supabase.from("inventory_items").update({ selling_price: Number(price) }).eq("id", itemId)
    }
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-line-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 400px)", boxShadow:SHADOW.modal }}>
        <h2 id="add-line-title" style={{ margin:"0 0 20px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("addDrinkLineBtn")}</h2>

        {available.length === 0 ? (
          <p style={{ color:C.textFaint, fontSize:13, marginBottom:20 }}>{t("addDrinkItemFirst")}</p>
        ) : (
          <>
            <label style={lS} htmlFor="drink-line-item">{t("selectDrinkItemLabel")}</label>
            <select id="drink-line-item" value={itemId} onChange={e => onSelectItem(e.target.value)} style={{ ...iS, marginBottom:14 }}>
              {available.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>

            <div style={{ display:"flex", gap:10, marginBottom:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <label style={lS} htmlFor="drink-line-price">{t("sellingPriceColLabel")}</label>
                <input id="drink-line-price" type="number" min="0" step="any" value={price} onChange={e => { setPrice(e.target.value); setErr("") }} style={iS} />
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <label style={lS} htmlFor="drink-line-opening">{t("openingQtyColLabel")}</label>
                <input id="drink-line-opening" type="number" min="0" step="any" value={openingQty} onChange={e => { setOpeningQty(e.target.value); setErr("") }} style={iS} />
              </div>
            </div>
            {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}
          </>
        )}

        <div style={{ display:"flex", gap:10, marginTop: available.length === 0 ? 0 : 8 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          {available.length > 0 && (
            <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary"
              style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
              {busy ? t("saving") : t("add")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddDrinkAdditionModal({ line, item, user, showToast, onClose, onSaved }) {
  const { t } = useLanguage()
  const [qty,  setQty]  = useState("")
  const [note, setNote] = useState("")
  const [err,  setErr]  = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (qty === "" || isNaN(Number(qty)) || Number(qty) <= 0) { setErr(t("enterValidQuantity")); return }
    setBusy(true)
    const { error } = await supabase.from("drink_week_additions").insert([{
      week_line_id: line.id,
      qty: Number(qty),
      note: note.trim() || null,
      created_by: user?.id || null,
      created_by_name: user?.user_metadata?.name || user?.email || null,
    }])
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
    showToast(t("additionRecordedToast"))
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-addition-title"
        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:RADIUS.lg, padding:"clamp(22px,5vw,32px)", width:"min(92vw, 380px)", boxShadow:SHADOW.modal }}>
        <h2 id="add-addition-title" style={{ margin:"0 0 4px", fontFamily:FONT, fontWeight:700, fontSize:17, color:C.text }}>{t("addAdditionBtn")}</h2>
        <p style={{ margin:"0 0 20px", fontSize:12.5, color:C.textFaint }}>{item?.name || ""}</p>

        <label style={lS} htmlFor="addition-qty">{t("quantityAddedLabel")}</label>
        <input id="addition-qty" type="number" min="0" step="any" autoFocus value={qty} onChange={e => { setQty(e.target.value); setErr("") }} style={{ ...iS, marginBottom:14 }} />

        <label style={lS} htmlFor="addition-note">{t("optionalNoteLabel")}</label>
        <input id="addition-note" value={note} onChange={e => setNote(e.target.value)} style={{ ...iS, marginBottom:14 }} />

        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"0 0 14px" }}>{err}</p>}

        <div style={{ display:"flex", gap:10 }}>
          <button type="button" onClick={onClose} className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? t("saving") : t("add")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── TAX / ACCOUNTING REPORT EXPORT ─────────────────────────
   Pure, hook-free helpers (no React state) so the shaping logic is easy to
   reason about and test in isolation. None of these ever mutate the
   sales/expenses arrays passed in from ReportsPage -- every step below
   only ever reads them and returns new arrays/objects. */

// "YYYY-MM-DD" (or a full ISO timestamp) -> "DD/MM/YYYY". Returns "" for
// anything that doesn't look like a date so a malformed record can't crash
// the export.
function formatDMY(dateStr) {
  const d = (dateStr || "").slice(0, 10)
  const [y, m, day] = d.split("-")
  if (!y || !m || !day) return ""
  return `${day}/${m}/${y}`
}

// Shapes the already-filtered sales/expenses into the flat
// Date | Amount | Sales | Expenses | Note rows the Tax Report sheet uses,
// combined and sorted chronologically ascending. Array.prototype.sort is
// spec-guaranteed stable, so combining [...saleRows, ...expenseRows] before
// sorting deterministically keeps "sales before expenses" for same-day
// records without any extra tie-break bookkeeping.
function buildTaxReportRows(filtSales, filtExp) {
  const saleRows = filtSales.map((s) => ({
    sortKey:  (s.date || "").slice(0, 10),
    date:     formatDMY(s.date),
    amount:   Number(s.amount) || 0,
    sales:    Number(s.amount) || 0,
    expenses: null,
    note:     s.service || "Sale",
  }))
  const expenseRows = filtExp.map((e) => {
    const category = (e.category || "").trim()
    const item      = (e.item || "").trim()
    const note = category && item
      ? `${category} — ${item}`
      : (category || item || "Expense")
    return {
      sortKey:  (e.date || "").slice(0, 10),
      date:     formatDMY(e.date),
      amount:   Number(e.cost) || 0,
      sales:    null,
      expenses: Number(e.cost) || 0,
      note,
    }
  })
  return [...saleRows, ...expenseRows].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

function buildTaxReportFilename(range) {
  const safe = (s) => (s || "").replace(/[^0-9-]/g, "")
  if (range.from && range.to) return `Swahili_Tent_Village_Tax_Report_${safe(range.from)}_to_${safe(range.to)}.xlsx`
  if (range.from) return `Swahili_Tent_Village_Tax_Report_from_${safe(range.from)}.xlsx`
  if (range.to)   return `Swahili_Tent_Village_Tax_Report_to_${safe(range.to)}.xlsx`
  return `Swahili_Tent_Village_Tax_Report.xlsx`
}

// Builds the two-sheet workbook (Tax Report + Summary). Styling colors are
// pulled from the app's own design tokens (C) so the exported file reads as
// an extension of the POS's brand rather than an arbitrary color scheme.
//
// Totals use real Excel formulas (SUM / subtraction / COUNT) referencing the
// data range, not hardcoded numbers, whenever there is at least one row to
// sum -- for the zero-row (empty period) case there is no data range to
// reference, so the totals are written as plain 0 values instead.
//
// Known limitation (xlsx-js-style, verified empirically against the raw
// OOXML it writes): frozen header rows (`!views`) and page setup / print
// orientation (`!pageSetup`) are silently dropped by this library on write,
// so they are intentionally left out below rather than set-and-hope. Column
// AutoFilter, a defined Print Area, and print margins DO write correctly and
// are included.
function buildTaxReportWorkbook({ rows, totalSales, totalExpenses, fromDisplay, toDisplay }) {
  const net = totalSales - totalExpenses
  const currencyFmt = '"TZS "#,##0'
  const hairline      = { style: "thin", color: { rgb: "FFEBE8E3" } } // C.border
  const thickHairline = { style: "thin", color: { rgb: "FFDCD8D1" } } // C.borderStrong
  const cellBorder = { top: hairline, bottom: hairline, left: hairline, right: hairline }

  const titleStyle    = { font: { bold: true, sz: 16, color: { rgb: "FF1F2233" } }, alignment: { horizontal: "center" } } // C.text
  const subtitleStyle = { font: { bold: true, sz: 12, color: { rgb: "FF4B5163" } }, alignment: { horizontal: "center" } } // C.textSub
  const periodStyle   = { font: { italic: true, sz: 10, color: { rgb: "FF6B7080" } }, alignment: { horizontal: "center" } } // C.textFaint
  const headerStyle   = {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFFFF" } },
    fill: { fgColor: { rgb: "FF3F7259" } }, // C.accentStrong
    alignment: { horizontal: "center", vertical: "center" },
    border: cellBorder,
  }
  const dataCellStyle   = { border: cellBorder, alignment: { vertical: "center" } }
  const amountCellStyle = { border: cellBorder, alignment: { vertical: "center", horizontal: "right" } }
  const noteCellStyle   = { border: cellBorder, alignment: { vertical: "center", wrapText: true } }
  const totalLabelStyle = { font: { bold: true, sz: 11, color: { rgb: "FF1F2233" } }, border: { top: thickHairline } }
  const totalValueStyle = { font: { bold: true, sz: 11, color: { rgb: "FF1F2233" } }, border: { top: thickHairline }, alignment: { horizontal: "right" } }
  const netBorder      = { top: thickHairline, bottom: { style: "double", color: { rgb: "FF3F7259" } } }
  const netLabelStyle  = { font: { bold: true, sz: 12, color: { rgb: "FF1F2233" } }, border: netBorder }
  const netValueStyle  = { font: { bold: true, sz: 12, color: { rgb: "FF1F2233" } }, border: netBorder, alignment: { horizontal: "right" } }

  const HEADERS = ["Date", "Amount", "Sales", "Expenses", "Note"]
  const headerRowIdx = 4 // 0-based: rows 0-2 title block, row 3 spacer, row 4 header
  const dataStart = headerRowIdx + 1
  const dataEnd   = dataStart + rows.length - 1
  const hasRows   = rows.length > 0
  const totalsStart = hasRows ? dataEnd + 2 : dataStart + 1 // one spacer row, or one blank placeholder row when empty

  const aoa = [
    ["SWAHILI TENT VILLAGE", "", "", "", ""],
    ["TAX / ACCOUNTING REPORT", "", "", "", ""],
    [`Period: ${fromDisplay} - ${toDisplay}`, "", "", "", ""],
    ["", "", "", "", ""],
    HEADERS,
    ...(hasRows ? rows.map((r) => [r.date, r.amount, r.sales ?? "", r.expenses ?? "", r.note]) : [["", "", "", "", ""]]),
    ["", "", "", "", ""],
    ["TOTAL SALES", totalSales, "", "", ""],
    ["TOTAL EXPENSES", totalExpenses, "", "", ""],
    ["NET", net, "", "", ""],
  ]

  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)

  // Totals as real formulas over the data range (not hardcoded), when there
  // is a data range to reference.
  const totalSalesRef = XLSXStyle.utils.encode_cell({ r: totalsStart, c: 1 })
  const totalExpRef   = XLSXStyle.utils.encode_cell({ r: totalsStart + 1, c: 1 })
  const netRef         = XLSXStyle.utils.encode_cell({ r: totalsStart + 2, c: 1 })
  if (hasRows) {
    ws[totalSalesRef].f = `SUM(C${dataStart + 1}:C${dataEnd + 1})`
    ws[totalExpRef].f   = `SUM(D${dataStart + 1}:D${dataEnd + 1})`
    ws[netRef].f         = `${totalSalesRef}-${totalExpRef}`
  }

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
  ]
  if (ws.A1) ws.A1.s = titleStyle
  if (ws.A2) ws.A2.s = subtitleStyle
  if (ws.A3) ws.A3.s = periodStyle

  HEADERS.forEach((_, c) => {
    const ref = XLSXStyle.utils.encode_cell({ r: headerRowIdx, c })
    if (ws[ref]) ws[ref].s = headerStyle
  })

  const bodyLastRow = hasRows ? dataEnd : dataStart
  for (let r = dataStart; r <= bodyLastRow; r++) {
    for (let c = 0; c < 5; c++) {
      const ref = XLSXStyle.utils.encode_cell({ r, c })
      const cell = ws[ref]
      if (!cell) continue
      cell.s = c === 4 ? noteCellStyle : c === 0 ? dataCellStyle : amountCellStyle
      if ((c === 1 || c === 2 || c === 3) && typeof cell.v === "number") cell.z = currencyFmt
    }
  }

  const totalRowDefs = [
    { r: totalsStart,     labelStyle: totalLabelStyle, valueStyle: totalValueStyle },
    { r: totalsStart + 1, labelStyle: totalLabelStyle, valueStyle: totalValueStyle },
    { r: totalsStart + 2, labelStyle: netLabelStyle,   valueStyle: netValueStyle },
  ]
  totalRowDefs.forEach(({ r, labelStyle, valueStyle }) => {
    const labelRef = XLSXStyle.utils.encode_cell({ r, c: 0 })
    const valueRef = XLSXStyle.utils.encode_cell({ r, c: 1 })
    if (ws[labelRef]) ws[labelRef].s = labelStyle
    if (ws[valueRef]) { ws[valueRef].s = valueStyle; ws[valueRef].z = currencyFmt }
  })

  ws["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 42 }]
  const lastRow = totalsStart + 2
  ws["!ref"] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 4 } })
  // AutoFilter over header + data rows only. Note: when there's no data
  // (hasRows === false) this writer's OOXML output extends a single-row
  // filter range down to the sheet's last row -- a quirk in how it computes
  // the autoFilter element, verified against the raw XML. That only affects
  // the empty-period edge case cosmetically (the totals rows sit inside the
  // filterable range); it doesn't hide or corrupt any data.
  const filterEnd = hasRows ? dataEnd : headerRowIdx
  ws["!autofilter"] = { ref: XLSXStyle.utils.encode_range({ s: { r: headerRowIdx, c: 0 }, e: { r: filterEnd, c: 4 } }) }
  ws["!margins"] = { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }

  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, "Tax Report")
  // Defined Print Area confined to the actual used range, so printing this
  // sheet doesn't spill onto blank pages.
  wb.Workbook = wb.Workbook || {}
  wb.Workbook.Names = [
    { Sheet: 0, Name: "_xlnm.Print_Area", Ref: `'Tax Report'!$A$1:$E$${lastRow + 1}` },
  ]

  const salesCount = rows.filter((r) => r.sales !== null).length
  const expCount   = rows.filter((r) => r.expenses !== null).length

  const summaryWs = XLSXStyle.utils.aoa_to_sheet([
    ["Swahili Tent Village — Tax / Accounting Report Summary", "", ""],
    [`Period: ${fromDisplay} - ${toDisplay}`, "", ""],
    ["", "", ""],
    ["Total Sales", totalSales, ""],
    ["Total Expenses", totalExpenses, ""],
    ["Net", net, ""],
    ["Sales Transactions", salesCount, ""],
    ["Expense Transactions", expCount, ""],
  ])
  // Summary figures reference the Tax Report sheet's own totals/formulas
  // rather than duplicating hardcoded numbers, so the two sheets can never
  // drift out of sync.
  if (hasRows) {
    summaryWs.B4.f = `'Tax Report'!${totalSalesRef}`
    summaryWs.B5.f = `'Tax Report'!${totalExpRef}`
    summaryWs.B6.f = `'Tax Report'!${netRef}`
    summaryWs.B7.f = `COUNT('Tax Report'!C${dataStart + 1}:C${dataEnd + 1})`
    summaryWs.B8.f = `COUNT('Tax Report'!D${dataStart + 1}:D${dataEnd + 1})`
  }
  if (summaryWs.A1) summaryWs.A1.s = { font: { bold: true, sz: 13, color: { rgb: "FF1F2233" } } }
  if (summaryWs.A2) summaryWs.A2.s = { font: { italic: true, sz: 10, color: { rgb: "FF6B7080" } } }
  ;["B4", "B5", "B6"].forEach((ref) => { if (summaryWs[ref]) summaryWs[ref].z = currencyFmt })
  summaryWs["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 4 }]
  summaryWs["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  XLSXStyle.utils.book_append_sheet(wb, summaryWs, "Summary")

  return wb
}

/* ── REPORTS PAGE ────────────────────────────────────────── */
function ReportsPage({ sales, expenses, services, showToast }) {
  const { t } = useLanguage()
  const [range, setRange]     = useState({ from:"", to:"" })
  const [service, setService] = useState("All")

  const getColor = (name) => services.find(s => s.name === name)?.color || "#aaa"

  const filtSales = sales
    .filter(s => service === "All" || s.service === service)
    .filter(s => !range.from || s.date >= range.from)
    .filter(s => !range.to   || s.date <= range.to + "T99")

  const filtExp = expenses
    .filter(e => !range.from || e.date >= range.from)
    .filter(e => !range.to   || e.date <= range.to + "T99")

  // Build date-keyed trend map
  const dateMap = {}
  filtSales.forEach(s => {
    const d = s.date?.slice(0, 10)
    if (!d) return
    if (!dateMap[d]) dateMap[d] = { date:d, Sales:0, Expenses:0 }
    dateMap[d].Sales += Number(s.amount || 0)
  })
  filtExp.forEach(e => {
    const d = e.date?.slice(0, 10)
    if (!d) return
    if (!dateMap[d]) dateMap[d] = { date:d, Sales:0, Expenses:0 }
    dateMap[d].Expenses += Number(e.cost || 0)
  })
  const trend = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)

  const byService = services.map(s => ({
    name:  s.name,
    value: filtSales.filter(x => x.service === s.name).reduce((a, b) => a + Number(b.amount || 0), 0),
  })).filter(x => x.value > 0)

  const totalSales = filtSales.reduce((a, b) => a + Number(b.amount || 0), 0)
  const totalExp   = filtExp.reduce((a, b) => a + Number(b.cost || 0), 0)

  const exportCSV = () => {
    if (!filtSales.length && !filtExp.length) { showToast(t("noDataToExport"), "error"); return }
    const rows = [
      ["Date","Service","Amount","Note"],
      ...filtSales.map(s => [s.date?.slice(0, 10), s.service, s.amount, s.note || ""])
    ]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type:"text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "swahili_sales.csv"
    a.click()
    showToast(t("csvExportedToast"))
  }

  const exportExcel = () => {
    if (!filtSales.length && !filtExp.length) { showToast(t("noDataToExport"), "error"); return }
    const wb = XLSX.utils.book_new()
    if (filtSales.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtSales), "Sales")
    if (filtExp.length)   XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtExp),   "Expenses")
    XLSX.writeFile(wb, "report.xlsx")
    showToast(t("excelExportedToast"))
  }

  // Clean, accountant-facing export for ZRA tax return preparation -- not
  // an official ZRA filing format, just a readable Date/Amount/Sales/
  // Expenses/Note transaction report a tax preparer can work from. Reuses
  // the same filtSales/filtExp this page already computes above (sales
  // respect the service filter, expenses follow the date filter only), and
  // never mutates either array.
  const exportTaxExcel = () => {
    const rows = buildTaxReportRows(filtSales, filtExp)
    const fromDisplay = range.from ? formatDMY(range.from) : (rows[0]?.date || "—")
    const toDisplay   = range.to   ? formatDMY(range.to)   : (rows[rows.length - 1]?.date || "—")
    const wb = buildTaxReportWorkbook({
      rows, totalSales, totalExpenses: totalExp, fromDisplay, toDisplay,
    })
    XLSXStyle.writeFile(wb, buildTaxReportFilename(range))
    showToast(
      rows.length === 0
        ? t("noTaxDataToast")
        : t("taxExportedToast")
    )
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACE.xl, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>{t("reportsTitle")}</h1>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button type="button" onClick={exportCSV}   className="stv-btn stv-btn-secondary" style={{ background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>{t("exportCsv")}</button>
          <button type="button" onClick={exportExcel} className="stv-btn stv-btn-secondary" style={{ background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>{t("exportExcel")}</button>
          <button
            type="button"
            onClick={exportTaxExcel}
            className="stv-btn stv-btn-primary"
            aria-label={t("exportTaxAria")}
            style={{ background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }}
          >
            {t("exportTaxExcel")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:SPACE.sm, marginBottom:SPACE.lg, flexWrap:"wrap", alignItems:"center" }}>
        <select aria-label={t("filterByServiceReports")} value={service} onChange={e => setService(e.target.value)} style={seS}>
          <option value="All">{t("allServices")}</option>
          {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <input aria-label={t("fromDate")} type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from:e.target.value }))} style={seS} />
        <input aria-label={t("toDate")} type="date" value={range.to}   onChange={e => setRange(r => ({ ...r, to:e.target.value }))}   style={seS} />
        <button type="button" onClick={() => setRange({ from:"", to:"" })} className="stv-btn stv-btn-ghost" aria-label={t("resetFilters")} style={{ ...seS, background:C.bg, border:"none", cursor:"pointer" }}>{t("reset")}</button>
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label={t("totalRevenue")}  value={TZS(totalSales)}            color={C.accent} icon="📈" />
        <StatCard label={t("totalExpensesStat")} value={TZS(totalExp)}              color={C.warn} icon="🧾" />
        <StatCard label={t("netProfit")}     value={TZS(totalSales - totalExp)} color={totalSales - totalExp >= 0 ? C.accent : C.warn} icon="✅" />
      </div>

      {/* Line chart */}
      {trend.length > 0 && (
        <div style={{ ...panelS, marginBottom:SPACE.md }}>
          <h2 style={{ margin:"0 0 18px", fontSize:14, fontWeight:600, color:C.text }}>{t("revenueVsExpensesTime")}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
              <XAxis dataKey="date" tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,.1)", fontSize:12 }} />
              <Legend wrapperStyle={{ fontSize:12 }} />
              <Line type="monotone" dataKey="Sales"    stroke="#81B29A" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="Expenses" stroke="#E07A5F" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pie + Bar */}
      <div style={{ display:"grid", gap:14, gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div style={{ ...panelS, minWidth:0 }}>
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>{t("revenueByService")}</h2>
          {byService.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={34} paddingAngle={3}>
                    {byService.map((e, i) => <Cell key={i} fill={getColor(e.name)} />)}
                  </Pie>
                  <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, fontSize:12, boxShadow:SHADOW.hover }} />
                </PieChart>
              </ResponsiveContainer>
              {byService.map(s => (
                <div key={s.name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:8, color:C.textSub }}>
                  <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <span aria-hidden="true" style={{ width:8, height:8, borderRadius:RADIUS.pill, background:getColor(s.name), display:"inline-block" }} />
                    {s.name}
                  </span>
                  <span style={{ fontWeight:600, color:C.text }}>{TZS(s.value)}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>{t("noData")}</div>
          )}
        </div>

        <div style={{ ...panelS, minWidth:0 }}>
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>{t("revenueByServiceBar")}</h2>
          {byService.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={byService} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:"#555" }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
                <Bar dataKey="value" radius={[0,5,5,0]}>
                  {byService.map((e, i) => <Cell key={i} fill={getColor(e.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>{t("noData")}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── USERS PAGE ──────────────────────────────────────────── */
function UsersPage({ showToast }) {
  const { t } = useLanguage()
  const { accessToken } = useAuth()
  const [users,  setUsers]  = useState([])
  const [err,    setErr]    = useState("")
  const [busy,   setBusy]   = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newUser, setNewUser]   = useState({ email:"", password:"", name:"", role:"worker" })

  async function loadUsers() {
    try {
      const data = await adminFetch("/users", accessToken)
      setUsers(Array.isArray(data) ? data : [])
    } catch (e) {
      setErr(e.message)
    }
  }

  useEffect(() => { loadUsers() }, [])

  async function createUser() {
    if (!newUser.email || !newUser.password) { showToast(t("emailAndPasswordRequired"), "error"); return }
    setBusy(true)
    try {
      await adminFetch("/users", accessToken, {
        method:"POST",
        body: JSON.stringify(newUser),
      })
      setNewUser({ email:"", password:"", name:"", role:"worker" })
      setShowForm(false)
      loadUsers()
      showToast(t("userCreated"))
    } catch (e) {
      showToast(e.message, "error")
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(id, role) {
    try {
      await adminFetch("/role", accessToken, { method:"PATCH", body: JSON.stringify({ userId:id, role }) })
      loadUsers()
      showToast(t("roleUpdated"))
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  async function toggleActive(id, active) {
    try {
      await adminFetch("/active", accessToken, { method:"PATCH", body: JSON.stringify({ userId:id, active }) })
      loadUsers()
      showToast(active ? t("userEnabledToast") : t("userDisabledToast"))
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  async function revokeAccess(id) {
    if (!confirm(t("confirmRevokeAccess"))) return
    try {
      await adminFetch(`/role/${id}`, accessToken, { method:"DELETE" })
      loadUsers()
      showToast(t("accessRevoked"))
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACE.xl, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>{t("usersTitle")}</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className={`stv-btn ${showForm ? "stv-btn-secondary" : "stv-btn-primary"}`}
          style={showForm
            ? { background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }
            : { ...sB, width:"auto", background:C.accentStrong, padding:"10px 18px", fontSize:13 }}
        >
          {showForm ? `✕ ${t("cancel")}` : t("addUser")}
        </button>
      </div>

      {err && <p role="alert" style={{ color:C.warnStrong, marginBottom:SPACE.md, fontSize:13 }}>{err}</p>}

      {/* Add User Form */}
      {showForm && (
        <div style={{ ...panelS, marginBottom:SPACE.xl, maxWidth:560 }}>
          <h2 style={fTi}>{t("newUser")}</h2>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:14 }}>
            <div>
              <label style={lS} htmlFor="new-user-email">{t("emailLabel")}</label>
              <input id="new-user-email" type="email" placeholder={t("emailPlaceholder")} value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-name">{t("displayNameLabel")}</label>
              <input id="new-user-name" placeholder={t("namePlaceholder")} value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-password">{t("passwordLabel")}</label>
              <input id="new-user-password" type="password" placeholder={t("passwordHint")} value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-role">{t("roleLabel")}</label>
              <select id="new-user-role" value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role:e.target.value }))} style={iS}>
                <option value="worker">{t("roleWorker")}</option>
                <option value="admin">{t("roleAdmin")}</option>
                <option value="owner">{t("roleOwner")}</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={createUser} disabled={busy} className="stv-btn stv-btn-primary" style={{ ...sB, opacity: busy ? 0.7 : 1, width:"auto", padding:"12px 26px" }}>
            {busy ? t("creating") : t("createUserBtn")}
          </button>
        </div>
      )}

      {/* Users Table */}
      <div style={panelS}>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table className="stv-table" style={{ width:"100%", minWidth:620, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {[t("colEmail"),t("colName"),t("colRole"),t("colStatus"),t("colCreated"),t("colActions")].map((h, i) => (
                <th key={i} scope="col" style={{ textAlign:"left", padding:"0 0 10px 0", paddingRight:12, fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const role = u.stv_pos_role || ""
              const name = u.user_metadata?.name || "—"
              const active = !u.banned
              return (
                <tr key={u.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                  <td style={tS}>{u.email}</td>
                  <td style={tS}>{name}</td>
                  <td style={tS}>
                    <select
                      value={role}
                      onChange={e => {
                        const next = e.target.value
                        if (!next) revokeAccess(u.id)
                        else changeRole(u.id, next)
                      }}
                      style={{ ...seS, fontSize:12, padding:"5px 10px" }}
                    >
                      <option value="">{t("noAccessOption")}</option>
                      <option value="worker">{t("roleWorker")}</option>
                      <option value="admin">{t("roleAdmin")}</option>
                      <option value="owner">{t("roleOwner")}</option>
                    </select>
                  </td>
                  <td style={tS}>
                    <span style={{
                      fontSize:11, fontWeight:600, padding:"4px 10px", borderRadius:RADIUS.pill,
                      background: active ? C.accentSoft : C.warnSoft,
                      color: active ? C.accentStrong : C.warnStrong,
                    }}>
                      {active ? t("active") : t("disabled")}
                    </span>
                  </td>
                  <td style={{ ...tS, color:C.textFaint }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td style={tS}>
                    <button
                      type="button"
                      onClick={() => toggleActive(u.id, !active)}
                      className={`stv-btn ${active ? "stv-btn-danger" : "stv-btn-accent"}`}
                      style={{
                        background: active ? C.warnSoft : C.accentSoft,
                        color: active ? C.warnStrong : C.accentStrong,
                        border:"none", padding:"5px 12px", borderRadius:RADIUS.sm,
                        fontSize:11, cursor:"pointer", fontWeight:600,
                      }}
                    >
                      {active ? t("disable") : t("enable")}
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>
                  {err ? t("couldNotLoadUsers", { error: err }) : t("noUsersFound")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

/* ── INVOICES ────────────────────────────────────────────────
   Standalone invoice system -- not derived from a POS sale. Create/edit/
   delete is gated to owner/admin via Supabase RLS (has_minimum_role, same
   pattern as sales/expenses/inventory); any stv-pos user, workers
   included, can view and download. Invoice numbers (STV-001, STV-002, ...)
   are assigned by a Postgres trigger from a dedicated sequence -- never
   computed client-side -- so two people saving at the same moment can
   never collide or skip a number. grand_total/paid are stored as entered;
   amount_left and each line's total are DB-generated columns, so they can
   never drift from grand_total/paid/quantity/unit_price server-side. */

function emptyInvoiceItem() {
  return {
    key: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    description: "",
    quantity: "1",
    unit_price: "0",
  }
}

function emptyInvoiceForm(preparedByDefault) {
  return {
    customer_name: "",
    customer_company: "",
    customer_contact_person: "",
    customer_phone: "",
    customer_email: "",
    invoice_date: todayStr(),
    valid_until: "",
    prepared_by: preparedByDefault || "",
    reference: "",
    notes: "",
    paid: "0",
  }
}

async function fetchInvoiceItemsFor(invoiceId) {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return data || []
}

function InvoicePreviewModal({ invoice, url, onClose, onPrint, onDownload }) {
  const { t } = useLanguage()
  const iframeRef = useRef(null)

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(20,20,30,0.6)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-preview-title"
        style={{ background:C.surface, borderRadius:RADIUS.lg, padding:"clamp(16px,3vw,22px)", width:"min(96vw, 820px)", height:"min(94vh, 960px)", display:"flex", flexDirection:"column", boxShadow:SHADOW.modal }}
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <h2 id="invoice-preview-title" style={{ margin:0, fontFamily:FONT, fontWeight:700, fontSize:16, color:C.text }}>
            {t("previewPdfTitle")} — {invoice.invoice_number}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closePreviewBtn")}
            style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.textSub, lineHeight:1, padding:4 }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex:1, minHeight:0, border:`1px solid ${C.border}`, borderRadius:RADIUS.sm, overflow:"hidden", background:C.bg }}>
          <iframe ref={iframeRef} src={url} title={t("previewPdfTitle")} style={{ width:"100%", height:"100%", border:"none" }} />
        </div>

        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button
            type="button"
            onClick={onClose}
            className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("closePreviewBtn")}
          </button>
          <button
            type="button"
            onClick={() => onPrint(iframeRef)}
            className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("printInvoiceBtn")}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            {t("downloadPdfBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}

function InvoicesPage({ user, isOwner, displayName, showToast }) {
  const { t } = useLanguage()
  const [view, setView] = useState("list") // "list" | "form"
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState("")
  const [search, setSearch] = useState("")

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(() => emptyInvoiceForm(displayName))
  const [items, setItems] = useState(() => [emptyInvoiceItem()])
  const [saving, setSaving] = useState(false)

  const [rowBusyId, setRowBusyId] = useState(null) // invoice id currently loading items for view/download/edit
  const [preview, setPreview] = useState(null) // { invoice, url }

  async function loadInvoices() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false })
      if (error) throw error
      setInvoices(data || [])
      setLoadErr("")
    } catch (e) {
      setLoadErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInvoices() }, [])

  const filtered = invoices.filter(inv => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (inv.customer_name || "").toLowerCase().includes(q) || (inv.invoice_number || "").toLowerCase().includes(q)
  })

  function startNew() {
    setEditingId(null)
    setForm(emptyInvoiceForm(displayName))
    setItems([emptyInvoiceItem()])
    setView("form")
  }

  async function startEdit(inv) {
    setRowBusyId(inv.id)
    try {
      const rows = await fetchInvoiceItemsFor(inv.id)
      setEditingId(inv.id)
      setForm({
        customer_name: inv.customer_name || "",
        customer_company: inv.customer_company || "",
        customer_contact_person: inv.customer_contact_person || "",
        customer_phone: inv.customer_phone || "",
        customer_email: inv.customer_email || "",
        invoice_date: inv.invoice_date || todayStr(),
        valid_until: inv.valid_until || "",
        prepared_by: inv.prepared_by || "",
        reference: inv.reference || "",
        notes: inv.notes || "",
        paid: String(inv.paid ?? 0),
      })
      setItems(rows.length
        ? rows.map(r => ({ key: r.id, description: r.description, quantity: String(r.quantity), unit_price: String(r.unit_price) }))
        : [emptyInvoiceItem()])
      setView("form")
    } catch (e) {
      showToast(t("invoiceLoadError", { error: e.message }), "error")
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDelete(inv) {
    if (!confirm(t("confirmDeleteInvoice"))) return
    setRowBusyId(inv.id)
    try {
      const { error } = await supabase.from("invoices").delete().eq("id", inv.id)
      if (error) throw error
      setInvoices(prev => prev.filter(i => i.id !== inv.id))
      showToast(t("invoiceDeletedToast"))
    } catch (e) {
      showToast(t("invoiceDeleteError", { error: e.message }), "error")
    } finally {
      setRowBusyId(null)
    }
  }

  async function openPreview(inv) {
    setRowBusyId(inv.id)
    try {
      const rows = await fetchInvoiceItemsFor(inv.id)
      const { url } = await getInvoicePdfBlobUrl(inv, rows)
      setPreview({ invoice: inv, url })
    } catch (e) {
      showToast(t("invoiceLoadError", { error: e.message }), "error")
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDownload(inv) {
    setRowBusyId(inv.id)
    try {
      const rows = await fetchInvoiceItemsFor(inv.id)
      await downloadInvoicePdf(inv, rows)
    } catch (e) {
      showToast(t("invoiceLoadError", { error: e.message }), "error")
    } finally {
      setRowBusyId(null)
    }
  }

  function handlePrint(iframeRef) {
    try {
      const win = iframeRef.current?.contentWindow
      if (win) {
        win.focus()
        win.print()
        return
      }
    } catch (err) {
      console.error("[Invoices] iframe print failed:", err.message)
    }
    if (preview?.url) window.open(preview.url, "_blank")
  }

  function updateItem(key, field, value) {
    setItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value } : it))
  }
  function removeItem(key) {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.key !== key) : prev)
  }
  function addItem() {
    setItems(prev => [...prev, emptyInvoiceItem()])
  }

  const grandTotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  const paidNum = Number(form.paid) || 0
  const amountLeft = grandTotal - paidNum

  async function handleSave() {
    if (!isOwner) return
    if (!form.customer_name.trim()) { showToast(t("customerNameRequiredError"), "error"); return }
    const validItems = items.filter(it => it.description.trim())
    if (validItems.length === 0) { showToast(t("atLeastOneItemRequired"), "error"); return }

    setSaving(true)
    const payload = {
      customer_name: form.customer_name.trim(),
      customer_company: form.customer_company.trim() || null,
      customer_contact_person: form.customer_contact_person.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      customer_email: form.customer_email.trim() || null,
      invoice_date: form.invoice_date || todayStr(),
      valid_until: form.valid_until || null,
      prepared_by: form.prepared_by.trim() || null,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      grand_total: grandTotal,
      paid: paidNum,
    }

    try {
      let savedNumber
      if (editingId) {
        const { error: updErr } = await supabase.from("invoices").update(payload).eq("id", editingId)
        if (updErr) throw updErr
        const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", editingId)
        if (delErr) throw delErr
        const itemsPayload = validItems.map((it, i) => ({
          invoice_id: editingId,
          description: it.description.trim(),
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          sort_order: i,
        }))
        const { error: insErr } = await supabase.from("invoice_items").insert(itemsPayload)
        if (insErr) throw insErr
        savedNumber = invoices.find(i => i.id === editingId)?.invoice_number
      } else {
        const { data, error: insErr } = await supabase
          .from("invoices")
          .insert([{ ...payload, created_by: user.id, created_by_name: displayName }])
          .select()
          .single()
        if (insErr) throw insErr
        const itemsPayload = validItems.map((it, i) => ({
          invoice_id: data.id,
          description: it.description.trim(),
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          sort_order: i,
        }))
        const { error: itemsErr } = await supabase.from("invoice_items").insert(itemsPayload)
        if (itemsErr) {
          // Don't leave a zero-item invoice header behind -- undo the
          // header insert so a failed save doesn't burn an invoice number
          // silently or show up as an empty invoice in the list.
          await supabase.from("invoices").delete().eq("id", data.id)
          throw itemsErr
        }
        savedNumber = data.invoice_number
      }

      await loadInvoices()
      setView("list")
      showToast(t(editingId ? "invoiceUpdatedToast" : "invoiceCreatedToast", { number: savedNumber }))
    } catch (e) {
      showToast(t("invoiceSaveError", { error: e.message }), "error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p style={{ color:C.textFaint, fontSize:13 }}>{t("loadingLabel")}</p>

  if (view === "form") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setView("list")}
          className="stv-btn stv-btn-ghost"
          style={{ background:"none", border:"none", color:C.textSub, fontSize:12.5, fontWeight:600, cursor:"pointer", padding:0, marginBottom:16, fontFamily:FONT }}
        >
          {t("backToInvoicesBtn")}
        </button>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", gap:16, marginBottom:16 }}>
          <div style={panelS}>
            <h2 style={fTi}>{t("customerDetailsSection")}</h2>
            <div style={{ display:"grid", gap:14 }}>
              <div>
                <label style={lS} htmlFor="inv-customer-name">{t("invCustomerNameLabel")} *</label>
                <input id="inv-customer-name" placeholder={t("invCustomerNamePlaceholder")} value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-customer-company">{t("invCustomerCompanyLabel")}</label>
                <input id="inv-customer-company" placeholder={t("invCustomerCompanyPlaceholder")} value={form.customer_company} onChange={e => setForm(f => ({ ...f, customer_company:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-contact-person">{t("invContactPersonLabel")}</label>
                <input id="inv-contact-person" placeholder={t("invContactPersonPlaceholder")} value={form.customer_contact_person} onChange={e => setForm(f => ({ ...f, customer_contact_person:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-customer-phone">{t("invCustomerPhoneLabel")}</label>
                <input id="inv-customer-phone" type="tel" placeholder={t("invCustomerPhonePlaceholder")} value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-customer-email">{t("invCustomerEmailLabel")}</label>
                <input id="inv-customer-email" type="email" placeholder={t("invCustomerEmailPlaceholder")} value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email:e.target.value }))} style={iS} />
              </div>
            </div>
          </div>

          <div style={panelS}>
            <h2 style={fTi}>{t("invoiceDetailsSection")}</h2>
            <div style={{ display:"grid", gap:14 }}>
              <div>
                <label style={lS}>{t("invoiceNumberLabel")}</label>
                <div style={{ ...iS, background:C.bg, color:C.textFaint, display:"flex", alignItems:"center" }}>
                  {editingId ? (invoices.find(i => i.id === editingId)?.invoice_number || "—") : t("invoiceNumberAutoHint")}
                </div>
              </div>
              <div>
                <label style={lS} htmlFor="inv-date">{t("invoiceDateLabel")}</label>
                <input id="inv-date" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-valid-until">{t("validUntilLabel")}</label>
                <input id="inv-valid-until" type="date" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-prepared-by">{t("preparedByLabel")}</label>
                <input id="inv-prepared-by" value={form.prepared_by} onChange={e => setForm(f => ({ ...f, prepared_by:e.target.value }))} style={iS} />
              </div>
              <div>
                <label style={lS} htmlFor="inv-reference">{t("referenceLabel")}</label>
                <input id="inv-reference" placeholder={t("referencePlaceholder")} value={form.reference} onChange={e => setForm(f => ({ ...f, reference:e.target.value }))} style={iS} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...panelS, marginBottom:16 }}>
          <h2 style={fTi}>{t("itemsSectionTitle")}</h2>
          <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            <table style={{ width:"100%", minWidth:640, borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                  {[t("itemDescriptionLabel"), t("itemQuantityLabel"), t("itemUnitPriceLabel"), t("itemTotalLabel"), ""].map((h, i) => (
                    <th key={i} scope="col" style={{ textAlign: i===0 ? "left" : "right", padding:"0 8px 10px 0", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
                  return (
                    <tr key={it.key} style={{ borderBottom:`1px solid ${C.bg}` }}>
                      <td style={{ ...tS, paddingRight:8 }}>
                        <input placeholder={t("itemDescriptionPlaceholder")} value={it.description} onChange={e => updateItem(it.key, "description", e.target.value)} style={iS} />
                      </td>
                      <td style={{ ...tS, paddingRight:8, width:100 }}>
                        <input type="number" min="0" step="1" value={it.quantity} onChange={e => updateItem(it.key, "quantity", e.target.value)} style={{ ...iS, textAlign:"right" }} />
                      </td>
                      <td style={{ ...tS, paddingRight:8, width:150 }}>
                        <input type="number" min="0" step="1" value={it.unit_price} onChange={e => updateItem(it.key, "unit_price", e.target.value)} style={{ ...iS, textAlign:"right" }} />
                      </td>
                      <td style={{ ...tS, textAlign:"right", fontWeight:700, width:140 }}>{TZS(lineTotal)}</td>
                      <td style={{ ...tS, width:36 }}>
                        <button
                          type="button"
                          onClick={() => removeItem(it.key)}
                          aria-label={t("removeItemLabel")}
                          disabled={items.length <= 1}
                          style={{ background:"none", border:"none", cursor: items.length > 1 ? "pointer" : "default", opacity: items.length > 1 ? 1 : 0.35, fontSize:16, color:C.warnStrong, padding:4 }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="stv-btn stv-btn-secondary"
            style={{ marginTop:14, padding:"9px 16px", borderRadius:RADIUS.sm, border:`1.5px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13 }}
          >
            {t("addItemBtn")}
          </button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", gap:16, marginBottom:16 }}>
          <div style={panelS}>
            <h2 style={fTi}>{t("notesLabel")}</h2>
            <textarea
              rows={5}
              placeholder={t("notesPlaceholder")}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes:e.target.value }))}
              style={{ ...iS, resize:"vertical", fontFamily:FONT }}
            />
          </div>

          <div style={panelS}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"6px 0" }}>
              <span style={{ fontSize:13, color:C.textSub, fontWeight:600 }}>{t("grandTotalLabel")}</span>
              <span style={{ fontSize:17, fontWeight:800, color:C.text }}>{TZS(grandTotal)}</span>
            </div>
            <div style={{ borderTop:`1px dashed ${C.borderStrong}`, margin:"8px 0" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", gap:12 }}>
              <label htmlFor="inv-paid" style={{ fontSize:13, color:C.textSub, fontWeight:600 }}>{t("paidLabel")}</label>
              <input id="inv-paid" type="number" min="0" step="1" value={form.paid} onChange={e => setForm(f => ({ ...f, paid:e.target.value }))} style={{ ...iS, width:160, textAlign:"right" }} />
            </div>
            <div style={{ borderTop:`1px dashed ${C.borderStrong}`, margin:"8px 0" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"6px 0" }}>
              <span style={{ fontSize:13.5, color:C.text, fontWeight:700 }}>{t("amountLeftLabel")}</span>
              <span style={{ fontSize:19, fontWeight:800, color: amountLeft > 0 ? C.warnStrong : C.accentStrong }}>{TZS(amountLeft)}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="stv-btn stv-btn-primary"
          style={{ ...sB, width:"auto", padding:"13px 30px", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? t("savingInvoiceBtn") : t("saveInvoiceBtn")}
        </button>

        {preview && (
          <InvoicePreviewModal
            invoice={preview.invoice}
            url={preview.url}
            onClose={() => setPreview(null)}
            onPrint={handlePrint}
            onDownload={() => handleDownload(preview.invoice)}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACE.xl, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ ...pT, marginBottom:4 }}>{t("invoicesTitle")}</h1>
          <p style={{ margin:0, color:C.textFaint, fontSize:13 }}>{t("invoicesSubtitle")}</p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={startNew}
            className="stv-btn stv-btn-primary"
            style={{ ...sB, width:"auto", padding:"10px 18px", fontSize:13 }}
          >
            {t("newInvoiceBtn")}
          </button>
        )}
      </div>

      <div style={{ marginBottom:16, maxWidth:360 }}>
        <input
          placeholder={t("searchInvoicesPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={iS}
          aria-label={t("searchInvoicesPlaceholder")}
        />
      </div>

      <div style={panelS}>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          <table className="stv-table" style={{ width:"100%", minWidth:720, borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                {[t("colInvoiceNumber"), t("colCustomer"), t("colDate"), t("colGrandTotal"), t("colPaid"), t("colAmountLeft"), t("colActions")].map((h, i) => (
                  <th key={i} scope="col" style={{ textAlign: i>=3 ? "right" : "left", padding:"0 12px 10px 0", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const busy = rowBusyId === inv.id
                return (
                  <tr key={inv.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                    <td style={{ ...tS, fontWeight:700 }}>{inv.invoice_number}</td>
                    <td style={tS}>{inv.customer_name}</td>
                    <td style={tS}>{formatDMY(inv.invoice_date)}</td>
                    <td style={{ ...tS, textAlign:"right", fontWeight:600 }}>{TZS(inv.grand_total)}</td>
                    <td style={{ ...tS, textAlign:"right" }}>{TZS(inv.paid)}</td>
                    <td style={{ ...tS, textAlign:"right", fontWeight:700, color: Number(inv.amount_left) > 0 ? C.warnStrong : C.accentStrong }}>{TZS(inv.amount_left)}</td>
                    <td style={{ ...tS, textAlign:"right", whiteSpace:"nowrap" }}>
                      <button
                        type="button"
                        onClick={() => openPreview(inv)}
                        disabled={busy}
                        title={t("viewPdfBtn")}
                        style={{ background:"none", border:"none", cursor:"pointer", color:C.accentStrong, fontWeight:600, fontSize:12.5, padding:"4px 6px", opacity: busy ? 0.5 : 1 }}
                      >
                        {t("viewPdfBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(inv)}
                        disabled={busy}
                        title={t("downloadPdfBtn")}
                        style={{ background:"none", border:"none", cursor:"pointer", color:C.accentStrong, fontWeight:600, fontSize:12.5, padding:"4px 6px", opacity: busy ? 0.5 : 1 }}
                      >
                        ⭳
                      </button>
                      {isOwner && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(inv)}
                            disabled={busy}
                            title={t("editInvoiceBtn")}
                            style={{ background:"none", border:"none", cursor:"pointer", color:C.textSub, fontWeight:600, fontSize:12.5, padding:"4px 6px", opacity: busy ? 0.5 : 1 }}
                          >
                            {t("editInvoiceBtn")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(inv)}
                            disabled={busy}
                            title={t("deleteInvoiceBtn")}
                            style={{ background:"none", border:"none", cursor:"pointer", color:C.warnStrong, fontWeight:600, fontSize:12.5, padding:"4px 6px", opacity: busy ? 0.5 : 1 }}
                          >
                            {t("deleteInvoiceBtn")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>
                    {loadErr ? t("invoiceLoadError", { error: loadErr }) : t("noInvoicesFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <InvoicePreviewModal
          invoice={preview.invoice}
          url={preview.url}
          onClose={() => setPreview(null)}
          onPrint={handlePrint}
          onDownload={() => handleDownload(preview.invoice)}
        />
      )}
    </div>
  )
}

/* ── SHARED STYLE CONSTANTS ──────────────────────────────── */
const iS    = { width:"100%", padding:"11px 14px", border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, fontSize:14, outline:"none", background:C.surface, fontFamily:FONT, color:C.text }
const seS   = { padding:"9px 12px", border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, fontSize:12.5, background:C.surface, fontFamily:FONT, color:C.textSub, fontWeight:500 }
const lS    = { display:"block", fontSize:11, fontWeight:600, color:C.textSub, marginBottom:6, textTransform:"uppercase", letterSpacing:.5 }
const fC    = { background:C.surface, borderRadius:RADIUS.md, padding:SPACE.xl, flexShrink:0, border:`1px solid ${C.border}`, boxShadow:SHADOW.card }
const fTi   = { margin:"0 0 20px", fontFamily:FONT, fontWeight:700, fontSize:"clamp(15px, 2.2vw, 17px)", color:C.text, letterSpacing:"-0.01em" }
const sB    = { width:"100%", padding:"13px", background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, fontSize:14.5, fontWeight:600, cursor:"pointer", fontFamily:FONT }
const tS    = { padding:"12px 0", paddingRight:12, fontSize:13, color:C.text, verticalAlign:"middle" }
const pT    = { margin:"0 0 6px", fontFamily:FONT, fontWeight:700, fontSize:"clamp(19px, 3.4vw, 24px)", color:C.text, letterSpacing:"-0.01em" }
const panelS = { background:C.surface, borderRadius:RADIUS.md, padding:SPACE.xl, border:`1px solid ${C.border}`, boxShadow:SHADOW.card }