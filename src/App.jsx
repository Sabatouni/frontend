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

  const showToast = (msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  async function fetchAll() {
    const [{ data: s }, { data: e }, { data: srv }] = await Promise.all([
      supabase.from("sales").select("*").order("date", { ascending: false }),
      supabase.from("expenses").select("*").order("date", { ascending: false }),
      supabase.from("services").select("*"),
    ])
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
    <div style={{ display:"flex", height:"100vh", fontFamily:"'DM Sans',sans-serif", background:"#F7F5F0", overflow:"hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <Sidebar
        page={page}
        setPage={setPage}
        isOwner={isOwner}
        displayName={displayName}
        onLogout={() => { logout(); setPage("dashboard") }}
        open={sidebarOpen}
      />

      <main style={{ flex:1, overflow:"auto" }}>
        {/* Top bar */}
        <div style={{ padding:"16px 28px 0", display:"flex", alignItems:"center", gap:14, marginBottom:6 }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, padding:4, color:"#555", lineHeight:1 }}
          >
            ☰
          </button>
          <span style={{ fontSize:13, color:"#999" }}>
            {new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}
          </span>
        </div>

        <div style={{ padding:"18px 28px 32px" }}>
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
        <div style={{
          position:"fixed", bottom:28, right:28, zIndex:9999,
          background: toast.type === "success" ? "#81B29A" : "#E07A5F",
          color:"#fff", padding:"13px 22px", borderRadius:12,
          fontWeight:600, fontSize:14, boxShadow:"0 8px 28px rgba(0,0,0,0.18)",
        }}>
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
        body { background:#F7F5F0; }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:#D4CFC7; border-radius:3px; }
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
      fontFamily:"'DM Sans',sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />
      <div style={{ background:"#fff", borderRadius:24, padding:"44px 40px", width:400, boxShadow:"0 32px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <img src={LOGO} alt="Swahili Tent Village" style={{ width:200, height:"auto", marginBottom:4, mixBlendMode:"multiply" }} />
          <p style={{ margin:"4px 0 0", color:"#888", fontSize:13, letterSpacing:1 }}>POINT OF SALE</p>
        </div>

        <label style={lS}>Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handle()}
          style={iS}
        />

        <label style={{ ...lS, marginTop:14 }}>Password</label>
        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handle()}
          style={{ ...iS, marginTop:0 }}
        />

        {error && <p style={{ color:"#E07A5F", fontSize:13, marginTop:8 }}>{error}</p>}

        <button
          type="button"
          onClick={handle}
          disabled={busy}
          style={{
            width:"100%", marginTop:22, padding:"15px",
            background:"#3D405B", color:"#fff", border:"none",
            borderRadius:12, fontSize:15, fontWeight:600,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
            fontFamily:"'DM Sans',sans-serif",
          }}
        >
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </div>
    </div>
  )
}

/* ── SIDEBAR ─────────────────────────────────────────────── */
function Sidebar({ page, setPage, isOwner, displayName, onLogout, open }) {
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
    <aside style={{
      width: open ? 232 : 66,
      minWidth: open ? 232 : 66,
      background:"#2A2D40",
      color:"#fff",
      display:"flex",
      flexDirection:"column",
      transition:"width .25s, min-width .25s",
      overflow:"hidden",
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: open ? "22px 16px 14px" : "18px 10px 14px",
        display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column", gap:6,
        borderBottom:"1px solid #3D405B",
      }}>
        <img
          src={LOGO}
          alt="logo"
          style={{ width: open ? 110 : 42, height:"auto", transition:"width .25s", objectFit:"contain", mixBlendMode:"screen" }}
        />
        {open && (
          <div style={{ fontSize:10, color:"#8B8FA8", textAlign:"center", marginTop:2, letterSpacing:0.5 }}>
            {isOwner ? "Owner Dashboard" : "Worker Panel"}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"8px 10px" }}>
        {nav.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            style={{
              display:"flex", alignItems:"center", gap:10,
              width:"100%",
              padding: open ? "11px 14px" : "11px 7px",
              marginBottom:3, borderRadius:10,
              border:"none", cursor:"pointer",
              background: page === item.id ? "#3D405B" : "transparent",
              color: page === item.id ? "#fff" : "#8B8FA8",
              fontSize:13,
              fontWeight: page === item.id ? 600 : 400,
              textAlign:"left",
              fontFamily:"'DM Sans',sans-serif",
              justifyContent: open ? "flex-start" : "center",
              transition:"background 0.15s",
            }}
          >
            <span style={{ fontSize:17, flexShrink:0 }}>{item.icon}</span>
            {open && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User + Logout */}
      <div style={{ padding:"14px 10px", borderTop:"1px solid #3D405B" }}>
        {open && (
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:10 }}>
            <div style={{
              width:32, height:32, borderRadius:"50%",
              background:"#E07A5F",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, fontWeight:700, flexShrink:0,
            }}>
              {displayName[0]?.toUpperCase()}
            </div>
            <div style={{ overflow:"hidden" }}>
              <div style={{ fontSize:12, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {displayName}
              </div>
              <div style={{ fontSize:10, color:"#8B8FA8", textTransform:"capitalize" }}>
                {isOwner ? "Owner" : "Worker"}
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          style={{
            width:"100%", padding:"9px 14px", borderRadius:9,
            border:"1px solid #3D405B", background:"transparent",
            color:"#8B8FA8", cursor:"pointer", fontSize:12,
            fontFamily:"'DM Sans',sans-serif",
            display:"flex", alignItems:"center", gap:7,
            justifyContent: open ? "flex-start" : "center",
          }}
        >
          <span>🚪</span>
          {open && "Sign Out"}
        </button>
      </div>
    </aside>
  )
}

/* ── STAT CARD ───────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{
      background:"#fff", borderRadius:18, padding:"22px 20px",
      boxShadow:"0 2px 10px rgba(0,0,0,0.06)",
      flex:1, minWidth:0, borderTop:`4px solid ${color}`,
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>{label}</span>
        <span style={{ fontSize:22 }}>{icon}</span>
      </div>
      <div style={{ fontSize:21, fontWeight:700, color:"#2A2D40", fontFamily:"'Playfair Display',serif" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:11, color:"#aaa", marginTop:5 }}>{sub}</div>}
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
      background: color + "22", color,
      border:`1px solid ${color}44`,
      padding:"3px 9px", borderRadius:6,
      fontSize:11, fontWeight:600,
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
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:22, padding:"36px 32px", width:400, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}
      >
        <h3 style={{ margin:"0 0 24px", fontFamily:"'Playfair Display',serif", fontSize:20, color:"#2A2D40" }}>
          Add New Service
        </h3>

        <label style={lS}>Service Name</label>
        <input
          autoFocus
          placeholder="e.g. Swimming Pool"
          value={name}
          onChange={e => { setName(e.target.value); setErr("") }}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={{ ...iS, marginBottom: err ? 4 : 18 }}
        />
        {err && <p style={{ color:"#E07A5F", fontSize:12, margin:"4px 0 14px" }}>{err}</p>}

        <label style={lS}>Icon</label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:18 }}>
          {EMOJI_LIST.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              style={{
                width:38, height:38, borderRadius:9,
                border:`2px solid ${emoji === e ? "#3D405B" : "#E8E4DF"}`,
                background: emoji === e ? "#3D405B" : "#fff",
                fontSize:18, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <label style={lS}>Color</label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:26 }}>
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{
                width:30, height:30, borderRadius:8,
                border:`3px solid ${color === c ? "#2A2D40" : "transparent"}`,
                background:c, cursor:"pointer", outline:"none",
              }}
            />
          ))}
        </div>

        {/* Preview */}
        <div style={{ marginBottom:22, padding:"12px 16px", background:"#F7F5F0", borderRadius:12, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:22 }}>{emoji}</span>
          <span style={{
            background: color + "22", color,
            border:`1px solid ${color}44`,
            padding:"4px 12px", borderRadius:7,
            fontSize:13, fontWeight:600,
          }}>
            {name || "Preview"}
          </span>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex:1, padding:"13px", borderRadius:11, border:"2px solid #E8E4DF", background:"#fff", color:"#555", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{ flex:1, padding:"13px", borderRadius:11, border:"none", background:"#3D405B", color:"#fff", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:14, opacity: busy ? 0.7 : 1 }}
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
      <p style={{ margin:"-10px 0 22px", color:"#888", fontSize:13 }}>This month's performance</p>

      {/* Stat cards */}
      <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        <StatCard label="Today's Sales"    value={TZS(todaySales)} color="#81B29A" icon="💰" sub={`Today expenses: ${TZS(todayExp)}`} />
        <StatCard label="Monthly Revenue"  value={TZS(monthSales)} color="#E07A5F" icon="📈" />
        <StatCard label="Monthly Expenses" value={TZS(monthExp)}   color="#F2CC8F" icon="🧾" />
        <StatCard label="Net Profit"       value={TZS(netProfit)}  color={netProfit >= 0 ? "#81B29A" : "#E07A5F"} icon={netProfit >= 0 ? "✅" : "⚠️"} />
      </div>

      {/* Charts row */}
      <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        <div style={{ ...panelS, flex:2, minWidth:280 }}>
          <h3 style={{ margin:"0 0 18px", fontSize:14, color:"#2A2D40" }}>Sales vs Expenses — Last 7 Days</h3>
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
          <h3 style={{ margin:"0 0 14px", fontSize:14, color:"#2A2D40" }}>Revenue by Service</h3>
          {byService.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={62} innerRadius={32} paddingAngle={3}>
                    {byService.map((e, i) => <Cell key={i} fill={getColor(e.name)} />)}
                  </Pie>
                  <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
                </PieChart>
              </ResponsiveContainer>
              {byService.map(s => (
                <div key={s.name} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#666", marginTop:6 }}>
                  <span style={{ width:9, height:9, borderRadius:2, background:getColor(s.name), display:"inline-block", flexShrink:0 }} />
                  {s.emoji} {s.name}
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign:"center", color:"#bbb", fontSize:13, paddingTop:40 }}>No data this month</div>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div style={panelS}>
        <h3 style={{ margin:"0 0 14px", fontSize:14, color:"#2A2D40" }}>Recent Transactions</h3>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
              {["Date","Service","Amount","Note"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(s => (
              <tr key={s.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                <td style={tS}>{s.date?.slice(0, 10)}</td>
                <td style={tS}><ServiceBadge name={s.service} services={services} /></td>
                <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
                <td style={{ ...tS, color:"#aaa" }}>{s.note || "—"}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={4} style={{ ...tS, textAlign:"center", color:"#bbb", paddingTop:20 }}>No sales yet</td></tr>
            )}
          </tbody>
        </table>
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
      <p style={{ margin:"-10px 0 26px", color:"#888" }}>What would you like to record today?</p>

      <div style={{ display:"flex", gap:14, marginBottom:28, flexWrap:"wrap" }}>
        <StatCard label="Today's Sales" value={TZS(todaySales)} color="#81B29A" icon="💰" sub={`${count} transaction${count !== 1 ? "s" : ""} recorded`} />
      </div>

      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        <button
          type="button"
          onClick={() => setPage("sales")}
          style={{
            flex:1, minWidth:180, padding:"34px 26px",
            borderRadius:20, border:"none", background:"#81B29A",
            color:"#fff", cursor:"pointer", textAlign:"center",
            fontFamily:"'DM Sans',sans-serif",
            boxShadow:"0 8px 26px #81B29A55",
            transition:"transform .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "none"}
        >
          <span style={{ fontSize:34, marginBottom:10, display:"block" }}>💰</span>
          <span style={{ fontSize:16, fontWeight:700, display:"block" }}>Record Sale</span>
          <span style={{ fontSize:12, opacity:.8, marginTop:5, display:"block" }}>Restaurant, Go Kart, Paintball…</span>
        </button>

        <button
          type="button"
          onClick={() => setPage("expenses")}
          style={{
            flex:1, minWidth:180, padding:"34px 26px",
            borderRadius:20, border:"none", background:"#E07A5F",
            color:"#fff", cursor:"pointer", textAlign:"center",
            fontFamily:"'DM Sans',sans-serif",
            boxShadow:"0 8px 26px #E07A5F55",
            transition:"transform .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "none"}
        >
          <span style={{ fontSize:34, marginBottom:10, display:"block" }}>🧾</span>
          <span style={{ fontSize:16, fontWeight:700, display:"block" }}>Record Expense</span>
          <span style={{ fontSize:12, opacity:.8, marginTop:5, display:"block" }}>Supplies, purchases, costs…</span>
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
    if (!form.amount || Number(form.amount) <= 0) { showToast("Enter a valid amount", "error"); return }
    if (!safeService) { showToast("Select a service", "error"); return }
    setBusy(true)
    const { error } = await supabase.from("sales").insert([{
      service: safeService,
      amount:  Number(form.amount),
      note:    form.note,
      date:    new Date(form.date + "T12:00:00").toISOString(),
      user_id: user.id,
    }])
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
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
        <div style={{ ...fC, width: isOwner ? 300 : "100%", maxWidth: isOwner ? 300 : 460 }}>
          <h3 style={fTi}>Record a Sale</h3>

          <label style={lS}>Service</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:6 }}>
            {services.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setForm(f => ({ ...f, service:s.name }))}
                style={{
                  padding:"9px 14px", borderRadius:9,
                  border:"2px solid",
                  borderColor: safeService === s.name ? s.color : "#E8E4DF",
                  background:  safeService === s.name ? s.color : "#fff",
                  color:       safeService === s.name ? "#fff" : "#555",
                  fontSize:12, fontWeight:600, cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif",
                  display:"flex", alignItems:"center", gap:5,
                  transition:"all .15s",
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
              style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"1.5px dashed #C4BEB6", color:"#888", borderRadius:9, padding:"7px 12px", fontSize:12, cursor:"pointer", marginBottom:18, fontFamily:"'DM Sans',sans-serif" }}
            >
              <span style={{ fontSize:16 }}>＋</span> Add New Service
            </button>
          )}
          {!isOwner && <div style={{ marginBottom:16 }} />}

          <label style={lS}>Amount (TZS)</label>
          <input type="number" placeholder="e.g. 15000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />

          <label style={lS}>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS}>Notes (optional)</label>
          <input placeholder="e.g. Group of 5" value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={{ ...iS, marginBottom:22 }} />

          <button type="button" onClick={submit} disabled={busy} style={{ ...sB, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving…" : "✓ Record Sale"}
          </button>
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              {/* Filters */}
              <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
                <select value={filter.service} onChange={e => setFilter(f => ({ ...f, service:e.target.value }))} style={seS}>
                  <option>All</option>
                  {services.map(s => <option key={s.id}>{s.name}</option>)}
                </select>
                <input type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from:e.target.value }))} style={seS} />
                <input type="date" value={filter.to}   onChange={e => setFilter(f => ({ ...f, to:e.target.value }))}   style={seS} />
                <button type="button" onClick={() => setFilter({ service:"All", from:"", to:"" })} style={{ ...seS, background:"#F0EDE8", border:"none", cursor:"pointer" }}>Reset</button>
                <div style={{ marginLeft:"auto", fontWeight:700, color:"#2A2D40", fontSize:13 }}>Total: {TZS(total)}</div>
              </div>

              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
                    {["Date","Service","Amount","Note",""].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 50).map(s => (
                    <tr key={s.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                      <td style={tS}>{s.date?.slice(0, 10)}</td>
                      <td style={tS}><ServiceBadge name={s.service} services={services} /></td>
                      <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
                      <td style={{ ...tS, color:"#aaa" }}>{s.note || "—"}</td>
                      <td style={tS}>
                        <button
                          type="button"
                          onClick={() => deleteSale(s.id)}
                          style={{ background:"#E07A5F15", color:"#E07A5F", border:"none", padding:"4px 10px", borderRadius:7, fontSize:11, cursor:"pointer", fontWeight:600 }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tS, textAlign:"center", color:"#bbb", paddingTop:24 }}>No sales found</td></tr>
                  )}
                </tbody>
              </table>
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
    if (!form.item.trim())            { showToast("Enter an item description", "error"); return }
    if (!form.cost || Number(form.cost) <= 0) { showToast("Enter a valid cost", "error"); return }
    setBusy(true)
    const { error } = await supabase.from("expenses").insert([{
      category: form.category,
      item:     form.item,
      cost:     Number(form.cost),
      date:     new Date(form.date + "T12:00:00").toISOString(),
      user_id:  user.id,
    }])
    setBusy(false)
    if (error) { showToast(error.message, "error"); return }
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
        <div style={{ ...fC, width: isOwner ? 300 : "100%", maxWidth: isOwner ? 300 : 460 }}>
          <h3 style={fTi}>Record an Expense</h3>

          <label style={lS}>Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={{ ...iS, marginBottom:14 }}>
            {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
          </select>

          <label style={lS}>Item / Description</label>
          <input placeholder="e.g. Potato sack, Fuel…" value={form.item} onChange={e => setForm(f => ({ ...f, item:e.target.value }))} style={{ ...iS, marginBottom:14 }} />

          <label style={lS}>Cost (TZS)</label>
          <input type="number" placeholder="e.g. 20000" value={form.cost} onChange={e => setForm(f => ({ ...f, cost:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />

          <label style={lS}>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} style={{ ...iS, marginBottom:22 }} />

          <button type="button" onClick={submit} disabled={busy} style={{ ...sB, background:"#E07A5F", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving…" : "✓ Record Expense"}
          </button>
        </div>

        {/* Table (owner only) */}
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={panelS}>
              <div style={{ fontWeight:700, color:"#2A2D40", marginBottom:14, fontSize:13 }}>
                Total: {TZS(total)}
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
                    {["Date","Category","Item","Cost",""].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 50).map(e => (
                    <tr key={e.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                      <td style={tS}>{e.date?.slice(0, 10)}</td>
                      <td style={tS}>{e.category}</td>
                      <td style={tS}>{e.item}</td>
                      <td style={{ ...tS, fontWeight:600, color:"#E07A5F" }}>{TZS(e.cost)}</td>
                      <td style={tS}>
                        <button
                          type="button"
                          onClick={() => deleteExpense(e.id)}
                          style={{ background:"#E07A5F15", color:"#E07A5F", border:"none", padding:"4px 10px", borderRadius:7, fontSize:11, cursor:"pointer", fontWeight:600 }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tS, textAlign:"center", color:"#bbb", paddingTop:24 }}>No expenses yet</td></tr>
                  )}
                </tbody>
              </table>
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
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>Reports</h1>
        <div style={{ display:"flex", gap:10 }}>
          <button type="button" onClick={exportCSV}   style={{ ...sB, background:"#3D405B", padding:"11px 18px", fontSize:13 }}>↓ CSV</button>
          <button type="button" onClick={exportExcel} style={{ ...sB, background:"#3D405B", padding:"11px 18px", fontSize:13 }}>↓ Excel</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
        <select value={service} onChange={e => setService(e.target.value)} style={seS}>
          <option>All</option>
          {services.map(s => <option key={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from:e.target.value }))} style={seS} />
        <input type="date" value={range.to}   onChange={e => setRange(r => ({ ...r, to:e.target.value }))}   style={seS} />
        <button type="button" onClick={() => setRange({ from:"", to:"" })} style={{ ...seS, background:"#F0EDE8", border:"none", cursor:"pointer" }}>Reset</button>
      </div>

      {/* Stat cards */}
      <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        <StatCard label="Total Revenue"  value={TZS(totalSales)}            color="#81B29A" icon="📈" />
        <StatCard label="Total Expenses" value={TZS(totalExp)}              color="#E07A5F" icon="🧾" />
        <StatCard label="Net Profit"     value={TZS(totalSales - totalExp)} color={totalSales - totalExp >= 0 ? "#81B29A" : "#E07A5F"} icon="✅" />
      </div>

      {/* Line chart */}
      {trend.length > 0 && (
        <div style={{ ...panelS, marginBottom:16 }}>
          <h3 style={{ margin:"0 0 18px", fontSize:14 }}>Revenue vs Expenses Over Time</h3>
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
      <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
        <div style={{ ...panelS, flex:1, minWidth:220 }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14 }}>Revenue by Service</h3>
          {byService.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={34} paddingAngle={3}>
                    {byService.map((e, i) => <Cell key={i} fill={getColor(e.name)} />)}
                  </Pie>
                  <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
                </PieChart>
              </ResponsiveContainer>
              {byService.map(s => (
                <div key={s.name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:7, color:"#555" }}>
                  <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <span style={{ width:9, height:9, borderRadius:2, background:getColor(s.name), display:"inline-block" }} />
                    {s.name}
                  </span>
                  <span style={{ fontWeight:600 }}>{TZS(s.value)}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign:"center", color:"#bbb", fontSize:13, paddingTop:40 }}>No data</div>
          )}
        </div>

        <div style={{ ...panelS, flex:1, minWidth:220 }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14 }}>Revenue by Service (Bar)</h3>
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
            <div style={{ textAlign:"center", color:"#bbb", fontSize:13, paddingTop:40 }}>No data</div>
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
      const data = await adminFetch("/admin/users")
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
      await adminFetch("/admin/users", {
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
      await adminFetch("/admin/role", { method:"PATCH", body: JSON.stringify({ userId:id, role }) })
      loadUsers()
      showToast("Role updated ✓")
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  async function toggleActive(id, active) {
    try {
      await adminFetch("/admin/active", { method:"PATCH", body: JSON.stringify({ userId:id, active }) })
      loadUsers()
      showToast(`User ${active ? "enabled" : "disabled"}`)
    } catch (e) {
      showToast(e.message, "error")
    }
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>Users</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          style={{ ...sB, background:"#3D405B", padding:"11px 20px", fontSize:13 }}
        >
          {showForm ? "✕ Cancel" : "＋ Add User"}
        </button>
      </div>

      {err && <p style={{ color:"#E07A5F", marginBottom:14, fontSize:13 }}>{err}</p>}

      {/* Add User Form */}
      {showForm && (
        <div style={{ ...panelS, marginBottom:24, maxWidth:560 }}>
          <h3 style={{ margin:"0 0 18px", fontFamily:"'Playfair Display',serif", fontSize:17, color:"#2A2D40" }}>New User</h3>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <div>
              <label style={lS}>Email</label>
              <input type="email" placeholder="user@example.com" value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS}>Display Name</label>
              <input placeholder="e.g. John" value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS}>Password</label>
              <input type="password" placeholder="min 6 characters" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password:e.target.value }))} style={iS} />
            </div>
            <div>
              <label style={lS}>Role</label>
              <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role:e.target.value }))} style={iS}>
                <option value="WORKER">Worker</option>
                <option value="OWNER">Owner</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={createUser} disabled={busy} style={{ ...sB, opacity: busy ? 0.7 : 1, width:"auto", padding:"12px 28px" }}>
            {busy ? "Creating…" : "✓ Create User"}
          </button>
        </div>
      )}

      {/* Users Table */}
      <div style={panelS}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
              {["Email","Name","Role","Status","Created","Actions"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"0 0 10px 0", paddingRight:12, fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const role = u.user_metadata?.role || "WORKER"
              const name = u.user_metadata?.name || "—"
              const active = !u.banned
              return (
                <tr key={u.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
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
                      fontSize:11, fontWeight:600, padding:"3px 9px", borderRadius:20,
                      background: active ? "#81B29A22" : "#E07A5F22",
                      color: active ? "#81B29A" : "#E07A5F",
                    }}>
                      {active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td style={{ ...tS, color:"#aaa" }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td style={tS}>
                    <button
                      type="button"
                      onClick={() => toggleActive(u.id, !active)}
                      style={{
                        background: active ? "#E07A5F15" : "#81B29A15",
                        color: active ? "#E07A5F" : "#81B29A",
                        border:"none", padding:"5px 12px", borderRadius:7,
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
                <td colSpan={6} style={{ ...tS, textAlign:"center", color:"#bbb", paddingTop:24 }}>
                  {err ? `Could not load users — ${err}` : "No users found"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── SHARED STYLE CONSTANTS ──────────────────────────────── */
const iS    = { width:"100%", padding:"12px 14px", border:"2px solid #E8E4DF", borderRadius:11, fontSize:14, outline:"none", background:"#FAFAF8", fontFamily:"'DM Sans',sans-serif", color:"#2A2D40" }
const seS   = { padding:"9px 12px", border:"2px solid #E8E4DF", borderRadius:9, fontSize:12, background:"#FAFAF8", fontFamily:"'DM Sans',sans-serif", color:"#555" }
const lS    = { display:"block", fontSize:11, fontWeight:600, color:"#888", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 }
const fC    = { background:"#fff", borderRadius:18, padding:22, flexShrink:0, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }
const fTi   = { margin:"0 0 18px", fontFamily:"'Playfair Display',serif", fontSize:18, color:"#2A2D40" }
const sB    = { width:"100%", padding:"14px", background:"#81B29A", color:"#fff", border:"none", borderRadius:11, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }
const tS    = { padding:"11px 0", paddingRight:12, fontSize:13, color:"#444", verticalAlign:"middle" }
const pT    = { margin:"0 0 18px", fontFamily:"'Playfair Display',serif", fontSize:28, color:"#2A2D40" }
const panelS = { background:"#fff", borderRadius:18, padding:22, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }