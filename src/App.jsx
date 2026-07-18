import { useEffect, useState } from "react"
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
import { ADMIN_API } from "./api"
import { supabase } from "./api/supabaseClient"
import { useAuth } from "./context/AuthContext"

/* ── CONFIG ─────────────────────────────────────────────── */
const LOGO        = "/logo.png"
const TZS         = (n) => `TZS ${Number(n || 0).toLocaleString()}`
const todayStr    = () => new Date().toISOString().split("T")[0]
const thisMonth   = () => new Date().toISOString().slice(0, 7)

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

/* Admin backend helper — uses VITE_API_URL via src/api/index.js */
async function adminFetch(path, opts = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const url = `${ADMIN_API}${path}`
  console.log("API BASE:", ADMIN_API)
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || "Admin request failed")
  return json
}

/* ── ROOT APP ────────────────────────────────────────────── */
export default function App() {
  const { user, isOwner, logout } = useAuth()

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
    const { data: session } = await supabase.auth.getSession()
    console.log("SESSION:", session?.session)
    console.log("USER ID:", session?.session?.user?.id)

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
    showToast(`"${newSvc.name}" added ✓`)
  }

  if (!user) return <LoginPage />

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
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
            style={{ background:"none", border:"none", borderRadius:RADIUS.sm, cursor:"pointer", fontSize:19, padding:6, color:C.textSub, lineHeight:1 }}
          >
            ☰
          </button>
          <span style={{ fontSize:13, color:C.textFaint, fontWeight:500 }}>
            {new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}
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
  const ownerNav = [
    { id:"dashboard", label:"Dashboard", icon:"📊" },
    { id:"sales",     label:"Sales",     icon:"💰" },
    { id:"expenses",  label:"Expenses",  icon:"🧾" },
    { id:"reports",   label:"Reports",   icon:"📈" },
    { id:"users",     label:"Users",     icon:"👥" },
  ]
  const workerNav = [
    { id:"dashboard", label:"Home",        icon:"🏠" },
    { id:"sales",     label:"Record Sale", icon:"💰" },
    { id:"expenses",  label:"Expenses",    icon:"🧾" },
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
            {isOwner ? "OWNER DASHBOARD" : "WORKER PANEL"}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"12px 10px" }} aria-label="Main navigation">
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
                {isOwner ? "Owner" : "Worker"}
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="stv-btn stv-nav-item"
          aria-label="Sign out"
          title="Sign out"
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
          {open && "Sign Out"}
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
  const [name,  setName]  = useState("")
  const [emoji, setEmoji] = useState("🎪")
  const [color, setColor] = useState(PALETTE[existing.length % PALETTE.length])
  const [err,   setErr]   = useState("")
  const [busy,  setBusy]  = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr("Service name is required."); return }
    if (existing.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setErr("A service with this name already exists."); return
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
          Add New Service
        </h2>

        <label style={lS} htmlFor="svc-name">Service Name</label>
        <input
          id="svc-name"
          autoFocus
          placeholder="e.g. Swimming Pool"
          value={name}
          onChange={e => { setName(e.target.value); setErr("") }}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={{ ...iS, marginBottom: err ? 4 : SPACE.md+2 }}
        />
        {err && <p role="alert" style={{ color:C.warnStrong, fontSize:12, margin:"4px 0 14px" }}>{err}</p>}

        <label style={lS} id="svc-icon-label">Icon</label>
        <div role="group" aria-labelledby="svc-icon-label" style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:SPACE.md+2 }}>
          {EMOJI_LIST.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className="stv-btn"
              aria-label={`Icon: ${e}`}
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

        <label style={lS} id="svc-color-label">Color</label>
        <div role="group" aria-labelledby="svc-color-label" style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:SPACE.lg+4 }}>
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="stv-btn"
              aria-label={`Color swatch ${c}`}
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
            {name || "Preview"}
          </span>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button
            type="button"
            onClick={onClose}
            className="stv-btn stv-btn-secondary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:`1px solid ${C.border}`, background:C.surface, color:C.text, cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="stv-btn stv-btn-primary"
            style={{ flex:1, padding:"12px", borderRadius:RADIUS.sm, border:"none", background:C.accentStrong, color:"#fff", cursor:"pointer", fontFamily:FONT, fontWeight:600, fontSize:13.5, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Saving…" : `${emoji} Add Service`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── OWNER DASHBOARD ─────────────────────────────────────── */
function OwnerDashboard({ sales, expenses, services }) {
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
      day: d.toLocaleDateString("en-US", { weekday:"short" }),
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
      <h1 style={pT}>Overview</h1>
      <p style={{ margin:"0 0 " + SPACE.xl + "px", color:C.textSub, fontSize:13.5 }}>This month's performance</p>

      {/* Stat cards */}
      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label="Today's Sales"    value={TZS(todaySales)} color={C.accent} icon="💰" sub={`Today expenses: ${TZS(todayExp)}`} />
        <StatCard label="Monthly Revenue"  value={TZS(monthSales)} color={C.accent} icon="📈" />
        <StatCard label="Monthly Expenses" value={TZS(monthExp)}   color={C.warn} icon="🧾" />
        <StatCard label="Net Profit"       value={TZS(netProfit)}  color={netProfit >= 0 ? C.accent : C.warn} icon={netProfit >= 0 ? "✅" : "⚠️"} />
      </div>

      {/* Charts row */}
      <div style={{ display:"flex", gap:SPACE.md, marginBottom:SPACE.xl, flexWrap:"wrap" }}>
        <div style={{ ...panelS, flex:2, minWidth:280 }}>
          <h2 style={{ margin:"0 0 16px", fontSize:14, fontWeight:600, color:C.text }}>Sales vs Expenses — Last 7 Days</h2>
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
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>Revenue by Service</h2>
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
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>No data this month</div>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div style={panelS}>
        <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>Recent Transactions</h2>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table className="stv-table" style={{ width:"100%", minWidth:480, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {["Date","Service","Amount","Note"].map(h => (
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
              <tr><td colSpan={4} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>No sales yet</td></tr>
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
  const count      = sales.filter(s => s.date?.startsWith(todayStr())).length
  const todaySales = sales.filter(s => s.date?.startsWith(todayStr())).reduce((a, b) => a + Number(b.amount || 0), 0)

  return (
    <div>
      <h1 style={pT}>Good day, {displayName} 👋</h1>
      <p style={{ margin:"0 0 " + SPACE.xl + "px", color:C.textSub, fontSize:13.5 }}>What would you like to record today?</p>

      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label="Today's Sales" value={TZS(todaySales)} color={C.accent} icon="💰" sub={`${count} transaction${count !== 1 ? "s" : ""} recorded`} />
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
          <span style={{ fontSize:15.5, fontWeight:700, display:"block" }}>Record Sale</span>
          <span style={{ fontSize:12, opacity:.85, marginTop:5, display:"block" }}>Restaurant, Go Kart, Paintball…</span>
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
          <span style={{ fontSize:15.5, fontWeight:700, display:"block" }}>Record Expense</span>
          <span style={{ fontSize:12, opacity:.85, marginTop:5, display:"block" }}>Supplies, purchases, costs…</span>
        </button>
      </div>
    </div>
  )
}

/* ── SALES PAGE ──────────────────────────────────────────── */
function SalesPage({ sales, services, fetchAll, user, showToast, isOwner, onOpenAddService }) {
  const [form, setForm] = useState({
    service: services[0]?.name || "",
    amount:  "",
    note:    "",
    date:    todayStr(),
  })
  const [filter, setFilter] = useState({ service:"All", from:"", to:"" })
  const [busy, setBusy]     = useState(false)

  // Keep selected service valid when services list updates
  const svcNames     = services.map(s => s.name)
  const safeService  = svcNames.includes(form.service) ? form.service : (services[0]?.name || "")

  const submit = async () => {
    if (!user?.id) { showToast("Not authenticated", "error"); return }
    if (!form.amount || Number(form.amount) <= 0) { showToast("Enter a valid amount", "error"); return }
    if (!safeService) { showToast("Select a service", "error"); return }
    setBusy(true)
    const payload = {
      service: safeService,
      amount:  Number(form.amount),
      note:    form.note,
      date:    new Date(form.date + "T12:00:00").toISOString(),
      user_id: user.id,
    }
    console.log("Inserting sale:", payload)
    const { error } = await supabase.from("sales").insert([payload])
    setBusy(false)
    if (error) { console.error("Sale insert error:", error.message); showToast(error.message, "error"); return }
    setForm(f => ({ ...f, amount:"", note:"" }))
    fetchAll()
    showToast("Sale recorded ✓")
  }

  const deleteSale = async (id) => {
    if (!confirm("Delete this sale?")) return
    const { error } = await supabase.from("sales").delete().eq("id", id)
    if (error) { showToast(error.message, "error"); return }
    fetchAll()
    showToast("Sale deleted")
  }

  const filtered = sales
    .filter(s => filter.service === "All" || s.service === filter.service)
    .filter(s => !filter.from || s.date >= filter.from)
    .filter(s => !filter.to   || s.date <= filter.to + "T99")
    .sort((a, b) => b.date?.localeCompare(a.date))

  const total = filtered.reduce((a, b) => a + Number(b.amount || 0), 0)

  return (
    <div>
      <h1 style={pT}>Sales</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>

        {/* Form card */}
        <div style={{ ...fC, flex: isOwner ? "1 1 280px" : "1 1 100%", flexShrink:1, width:"auto", maxWidth: isOwner ? 340 : 460 }}>
          <h2 style={fTi}>Record a Sale</h2>

          <label style={lS} id="sale-service-label">Service</label>
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
              <span style={{ fontSize:15 }}>＋</span> Add New Service
            </button>
          )}
          {!isOwner && <div style={{ marginBottom:16 }} />}

          <label style={lS} htmlFor="sale-amount">Amount (TZS)</label>
          <input id="sale-amount" type="number" placeholder="e.g. 15000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount:e.target.value }))} style={{ ...iS, fontSize:21, fontWeight:700, marginBottom:14 }} />

          <label style={lS} htmlFor="sale-date">Date</label>
          <input id="sale-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS} htmlFor="sale-note">Notes (optional)</label>
          <input id="sale-note" placeholder="e.g. Group of 5" value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={{ ...iS, marginBottom:SPACE.lg+2 }} />

          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-primary" style={{ ...sB, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving…" : "✓ Record Sale"}
          </button>
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              {/* Filters */}
              <div style={{ display:"flex", gap:SPACE.sm, marginBottom:SPACE.md, flexWrap:"wrap", alignItems:"center" }}>
                <select aria-label="Filter by service" value={filter.service} onChange={e => setFilter(f => ({ ...f, service:e.target.value }))} style={seS}>
                  <option>All</option>
                  {services.map(s => <option key={s.id}>{s.name}</option>)}
                </select>
                <input aria-label="From date" type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from:e.target.value }))} style={seS} />
                <input aria-label="To date" type="date" value={filter.to}   onChange={e => setFilter(f => ({ ...f, to:e.target.value }))}   style={seS} />
                <button type="button" onClick={() => setFilter({ service:"All", from:"", to:"" })} className="stv-btn stv-btn-ghost" aria-label="Reset filters" style={{ ...seS, background:C.bg, border:"none", cursor:"pointer" }}>Reset</button>
                <div style={{ marginLeft:"auto", fontWeight:700, color:C.text, fontSize:13 }}>Total: {TZS(total)}</div>
              </div>

              <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table className="stv-table" style={{ width:"100%", minWidth:560, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                    {["Date","Service","Amount","Note",""].map(h => (
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
                        <button
                          type="button"
                          onClick={() => deleteSale(s.id)}
                          className="stv-btn stv-btn-danger"
                          style={{ background:C.warnSoft, color:C.warnStrong, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>No sales found</td></tr>
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

/* ── EXPENSES PAGE ───────────────────────────────────────── */
function ExpensesPage({ expenses, fetchAll, user, showToast, isOwner }) {
  const [form, setForm] = useState({ category:EXPENSE_CATS[0], item:"", cost:"", date:todayStr() })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!user?.id) { showToast("Not authenticated", "error"); return }
    if (!form.item.trim())            { showToast("Enter an item description", "error"); return }
    if (!form.cost || Number(form.cost) <= 0) { showToast("Enter a valid cost", "error"); return }
    setBusy(true)
    const payload = {
      category:   form.category,
      item:       form.item,
      cost:       Number(form.cost),
      date:       new Date(form.date + "T12:00:00").toISOString(),
      user_id:    user.id,
      created_by: user.email,
    }
    console.log("Inserting expense:", payload)
    const { error } = await supabase.from("expenses").insert([payload])
    setBusy(false)
    if (error) { console.error("Expense insert error:", error.message); showToast(error.message, "error"); return }
    setForm(f => ({ ...f, item:"", cost:"" }))
    fetchAll()
    showToast("Expense recorded ✓")
  }

  const deleteExpense = async (id) => {
    if (!confirm("Delete this expense?")) return
    const { error } = await supabase.from("expenses").delete().eq("id", id)
    if (error) { showToast(error.message, "error"); return }
    fetchAll()
    showToast("Expense deleted")
  }

  const sorted = [...expenses].sort((a, b) => b.date?.localeCompare(a.date))
  const total  = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)

  return (
    <div>
      <h1 style={pT}>Expenses</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>

        {/* Form */}
        <div style={{ ...fC, flex: isOwner ? "1 1 280px" : "1 1 100%", flexShrink:1, width:"auto", maxWidth: isOwner ? 340 : 460 }}>
          <h2 style={fTi}>Record an Expense</h2>

          <label style={lS} htmlFor="exp-category">Category</label>
          <select id="exp-category" value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={{ ...iS, marginBottom:14 }}>
            {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
          </select>

          <label style={lS} htmlFor="exp-item">Item / Description</label>
          <input id="exp-item" placeholder="e.g. Potato sack, Fuel…" value={form.item} onChange={e => setForm(f => ({ ...f, item:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS} htmlFor="exp-cost">Cost (TZS)</label>
          <input id="exp-cost" type="number" placeholder="e.g. 20000" value={form.cost} onChange={e => setForm(f => ({ ...f, cost:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />

          <label style={lS} htmlFor="exp-date">Date</label>
          <input id="exp-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={{ ...iS, marginBottom:22 }} />

          <button type="button" onClick={submit} disabled={busy} className="stv-btn stv-btn-danger-solid" style={{ ...sB, background:C.warnStrong, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving…" : "✓ Record Expense"}
          </button>
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              <div style={{ fontWeight:700, color:C.text, marginBottom:SPACE.md, fontSize:13 }}>
                Total: {TZS(total)}
              </div>
              <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
              <table className="stv-table" style={{ width:"100%", minWidth:560, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
                    {["Date","Category","Item","Cost",""].map(h => (
                      <th key={h} scope="col" style={{ textAlign:"left", padding:"0 0 10px", fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 50).map(e => (
                    <tr key={e.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                      <td style={tS}>{e.date?.slice(0, 10)}</td>
                      <td style={tS}>{e.category}</td>
                      <td style={tS}>{e.item}</td>
                      <td style={{ ...tS, fontWeight:600, color:C.warnStrong }}>{TZS(e.cost)}</td>
                      <td style={tS}>
                        <button
                          type="button"
                          onClick={() => deleteExpense(e.id)}
                          className="stv-btn stv-btn-danger"
                          style={{ background:C.warnSoft, color:C.warnStrong, border:"none", padding:"5px 11px", borderRadius:RADIUS.sm, fontSize:11, cursor:"pointer", fontWeight:600 }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>No expenses yet</td></tr>
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

/* ── REPORTS PAGE ────────────────────────────────────────── */
function ReportsPage({ sales, expenses, services, showToast }) {
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
    if (!filtSales.length && !filtExp.length) { showToast("No data to export", "error"); return }
    const rows = [
      ["Date","Service","Amount","Note"],
      ...filtSales.map(s => [s.date?.slice(0, 10), s.service, s.amount, s.note || ""])
    ]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type:"text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "swahili_sales.csv"
    a.click()
    showToast("CSV exported ✓")
  }

  const exportExcel = () => {
    if (!filtSales.length && !filtExp.length) { showToast("No data to export", "error"); return }
    const wb = XLSX.utils.book_new()
    if (filtSales.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtSales), "Sales")
    if (filtExp.length)   XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtExp),   "Expenses")
    XLSX.writeFile(wb, "report.xlsx")
    showToast("Excel exported ✓")
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACE.xl, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>Reports</h1>
        <div style={{ display:"flex", gap:8 }}>
          <button type="button" onClick={exportCSV}   className="stv-btn stv-btn-secondary" style={{ background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>↓ CSV</button>
          <button type="button" onClick={exportExcel} className="stv-btn stv-btn-secondary" style={{ background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }}>↓ Excel</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:SPACE.sm, marginBottom:SPACE.lg, flexWrap:"wrap", alignItems:"center" }}>
        <select aria-label="Filter by service" value={service} onChange={e => setService(e.target.value)} style={seS}>
          <option>All</option>
          {services.map(s => <option key={s.id}>{s.name}</option>)}
        </select>
        <input aria-label="From date" type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from:e.target.value }))} style={seS} />
        <input aria-label="To date" type="date" value={range.to}   onChange={e => setRange(r => ({ ...r, to:e.target.value }))}   style={seS} />
        <button type="button" onClick={() => setRange({ from:"", to:"" })} className="stv-btn stv-btn-ghost" aria-label="Reset filters" style={{ ...seS, background:C.bg, border:"none", cursor:"pointer" }}>Reset</button>
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gap:SPACE.md, marginBottom:SPACE.xl, gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
        <StatCard label="Total Revenue"  value={TZS(totalSales)}            color={C.accent} icon="📈" />
        <StatCard label="Total Expenses" value={TZS(totalExp)}              color={C.warn} icon="🧾" />
        <StatCard label="Net Profit"     value={TZS(totalSales - totalExp)} color={totalSales - totalExp >= 0 ? C.accent : C.warn} icon="✅" />
      </div>

      {/* Line chart */}
      {trend.length > 0 && (
        <div style={{ ...panelS, marginBottom:SPACE.md }}>
          <h2 style={{ margin:"0 0 18px", fontSize:14, fontWeight:600, color:C.text }}>Revenue vs Expenses Over Time</h2>
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
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>Revenue by Service</h2>
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
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>No data</div>
          )}
        </div>

        <div style={{ ...panelS, minWidth:0 }}>
          <h2 style={{ margin:"0 0 14px", fontSize:14, fontWeight:600, color:C.text }}>Revenue by Service (Bar)</h2>
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
            <div style={{ textAlign:"center", color:C.textFaint, fontSize:13, paddingTop:40 }}>No data</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── USERS PAGE ──────────────────────────────────────────── */
function UsersPage({ showToast }) {
  const [users,  setUsers]  = useState([])
  const [err,    setErr]    = useState("")
  const [busy,   setBusy]   = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newUser, setNewUser]   = useState({ email:"", password:"", name:"", role:"WORKER" })

  async function loadUsers() {
    try {
      const data = await adminFetch("/users")
      setUsers(Array.isArray(data) ? data : [])
    } catch (e) {
      setErr(e.message)
    }
  }

  useEffect(() => { loadUsers() }, [])

  async function createUser() {
    if (!newUser.email || !newUser.password) { showToast("Email and password required", "error"); return }
    setBusy(true)
    try {
      await adminFetch("/users", {
        method:"POST",
        body: JSON.stringify(newUser),
      })
      setNewUser({ email:"", password:"", name:"", role:"WORKER" })
      setShowForm(false)
      loadUsers()
      showToast("User created ✓")
    } catch (e) {
      showToast(e.message, "error")
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(id, role) {
    try {
      await adminFetch("/role", { method:"PATCH", body: JSON.stringify({ userId:id, role }) })
      loadUsers()
      showToast("Role updated ✓")
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  async function toggleActive(id, active) {
    try {
      await adminFetch("/active", { method:"PATCH", body: JSON.stringify({ userId:id, active }) })
      loadUsers()
      showToast(`User ${active ? "enabled" : "disabled"}`)
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACE.xl, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>Users</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className={`stv-btn ${showForm ? "stv-btn-secondary" : "stv-btn-primary"}`}
          style={showForm
            ? { background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:FONT }
            : { ...sB, width:"auto", background:C.accentStrong, padding:"10px 18px", fontSize:13 }}
        >
          {showForm ? "✕ Cancel" : "＋ Add User"}
        </button>
      </div>

      {err && <p role="alert" style={{ color:C.warnStrong, marginBottom:SPACE.md, fontSize:13 }}>{err}</p>}

      {/* Add User Form */}
      {showForm && (
        <div style={{ ...panelS, marginBottom:SPACE.xl, maxWidth:560 }}>
          <h2 style={fTi}>New User</h2>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:14 }}>
            <div>
              <label style={lS} htmlFor="new-user-email">Email</label>
              <input id="new-user-email" type="email" placeholder="user@example.com" value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-name">Display Name</label>
              <input id="new-user-name" placeholder="e.g. John" value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-password">Password</label>
              <input id="new-user-password" type="password" placeholder="min 6 characters" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS} htmlFor="new-user-role">Role</label>
              <select id="new-user-role" value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role:e.target.value }))} style={iS}>
                <option value="WORKER">Worker</option>
                <option value="OWNER">Owner</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={createUser} disabled={busy} className="stv-btn stv-btn-primary" style={{ ...sB, opacity: busy ? 0.7 : 1, width:"auto", padding:"12px 26px" }}>
            {busy ? "Creating…" : "✓ Create User"}
          </button>
        </div>
      )}

      {/* Users Table */}
      <div style={panelS}>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table className="stv-table" style={{ width:"100%", minWidth:620, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1.5px solid ${C.border}` }}>
              {["Email","Name","Role","Status","Created","Actions"].map(h => (
                <th key={h} scope="col" style={{ textAlign:"left", padding:"0 0 10px 0", paddingRight:12, fontSize:10.5, color:C.textFaint, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const role = u.user_metadata?.role || "WORKER"
              const name = u.user_metadata?.name || "—"
              const active = !u.banned
              return (
                <tr key={u.id} style={{ borderBottom:`1px solid ${C.bg}` }}>
                  <td style={tS}>{u.email}</td>
                  <td style={tS}>{name}</td>
                  <td style={tS}>
                    <select
                      value={role}
                      onChange={e => changeRole(u.id, e.target.value)}
                      style={{ ...seS, fontSize:12, padding:"5px 10px" }}
                    >
                      <option value="WORKER">Worker</option>
                      <option value="OWNER">Owner</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td style={tS}>
                    <span style={{
                      fontSize:11, fontWeight:600, padding:"4px 10px", borderRadius:RADIUS.pill,
                      background: active ? C.accentSoft : C.warnSoft,
                      color: active ? C.accentStrong : C.warnStrong,
                    }}>
                      {active ? "Active" : "Disabled"}
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
                      {active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tS, textAlign:"center", color:C.textFaint, paddingTop:24 }}>
                  {err ? `Could not load users — ${err}` : "No users found"}
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