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
  XAxis,
  YAxis,
} from "recharts"
import * as XLSX from "xlsx"
import { supabase } from "./api/supabaseClient"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"

/* ── CONSTANTS ──────────────────────────────────── */
const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`
const todayStr = () => new Date().toISOString().split("T")[0]
const PALETTE = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#14B8A6"]

/* ── DESIGN TOKENS ──────────────────────────────── */
const C = {
  bg: "#F8FAFC",
  sidebar: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#1E293B",
  muted: "#64748B",
  faint: "#94A3B8",
  accent: "#6366F1",
  accentLight: "#EEF2FF",
  success: "#10B981",
  danger: "#EF4444",
  warn: "#F59E0B",
}

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: SquaresIcon },
  { id: "sales",     label: "Sales",     icon: CurrencyIcon },
  { id: "expenses",  label: "Expenses",  icon: ReceiptIcon  },
  { id: "reports",   label: "Reports",   icon: ChartIcon    },
]

/* ── ROOT ────────────────────────────────────────── */
export default function App() {
  const { user, role } = useAuth()
  const [sales, setSales]       = useState([])
  const [expenses, setExpenses] = useState([])
  const [services, setServices] = useState([])
  const [users, setUsers]       = useState([])
  const [page, setPage]         = useState("dashboard")
  const [toast, setToast]       = useState(null)
  const [showAddService, setShowAddService]   = useState(false)
  const [newService, setNewService]           = useState({ name: "", color: PALETTE[0] })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const showToast = (msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchAll() {
    const { data: s }   = await supabase.from("sales").select("*").order("date", { ascending: false })
    const { data: e }   = await supabase.from("expenses").select("*").order("date", { ascending: false })
    const { data: srv } = await supabase.from("services").select("*")
    const { data: u }   = await supabase.from("users").select("*")
    setSales(s || [])
    setExpenses(e || [])
    setServices(srv || [])
    setUsers(u || [])
  }

  useEffect(() => {
    fetchAll()
    const i = setInterval(fetchAll, 5000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const openModal = () => setShowAddService(true)
    window.addEventListener("openAddService", openModal)
    return () => window.removeEventListener("openAddService", openModal)
  }, [])

  const addService = async () => {
    if (!newService.name.trim()) return
    await supabase
      .from("services")
      .insert([{ id: newService.name.toLowerCase(), name: newService.name, color: newService.color }])
    setNewService({ name: "", color: PALETTE[0] })
    setShowAddService(false)
    fetchAll()
    showToast("Service added ✓")
  }

  if (!user) return <Login />

  const currentPage = NAV_ITEMS.find(n => n.id === page)?.label || "Dashboard"

  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', system-ui, sans-serif; background: ${C.bg}; color: ${C.text}; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div style={{ display: "flex", height: "100vh", background: C.bg, overflow: "hidden" }}>

        {/* ── SIDEBAR ── */}
        <aside style={{
          width: sidebarCollapsed ? 64 : 240,
          background: C.sidebar,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          transition: "width 0.2s ease",
          overflow: "hidden",
        }}>
          {/* Brand */}
          <div style={{
            padding: sidebarCollapsed ? "20px 16px" : "20px 20px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            gap: 10,
          }}>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: C.accent, display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <span style={{ color: "#fff", fontSize: 15 }}>⛺</span>
                </div>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>Swahili Village</div>
                  <div style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>POS System</div>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: C.accent, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "#fff", fontSize: 15 }}>⛺</span>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: C.muted, padding: 4, borderRadius: 4,
                display: "flex", alignItems: "center", flexShrink: 0,
              }}
              title={sidebarCollapsed ? "Expand" : "Collapse"}
            >
              <ChevronIcon dir={sidebarCollapsed ? "right" : "left"} />
            </button>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: "12px 10px", overflow: "hidden" }}>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = page === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPage(id)}
                  title={sidebarCollapsed ? label : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: sidebarCollapsed ? "10px 12px" : "9px 12px",
                    marginBottom: 2,
                    borderRadius: 8,
                    background: active ? C.accentLight : "transparent",
                    border: "none",
                    color: active ? C.accent : C.muted,
                    cursor: "pointer",
                    fontWeight: active ? 600 : 500,
                    fontSize: 13,
                    transition: "all 0.15s",
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#F8FAFC" }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}
                >
                  <Icon size={16} color={active ? C.accent : C.muted} />
                  {!sidebarCollapsed && <span>{label}</span>}
                </button>
              )
            })}
          </nav>

          {/* User Footer */}
          {!sidebarCollapsed && (
            <div style={{
              padding: "14px 16px",
              borderTop: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: C.accentLight, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: C.accent, flexShrink: 0,
                }}>
                  {user?.email?.[0]?.toUpperCase() || "U"}
                </div>
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user?.email || "User"}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, textTransform: "capitalize" }}>{role || "worker"}</div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ── MAIN ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Top Header */}
          <header style={{
            height: 56,
            background: C.sidebar,
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            flexShrink: 0,
          }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{currentPage}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
              <div style={{
                width: 1, height: 20, background: C.border,
              }} />
              <span style={{
                fontSize: 11, fontWeight: 600, color: C.accent,
                background: C.accentLight, padding: "3px 10px", borderRadius: 20,
                textTransform: "capitalize",
              }}>
                {role || "worker"}
              </span>
            </div>
          </header>

          {/* Page Content */}
          <main style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
            {page === "dashboard" && (
              <DashboardPage sales={sales} expenses={expenses} services={services} />
            )}
            {page === "sales" && (
              <SalesPage
                sales={sales}
                services={services}
                fetchAll={fetchAll}
                user={user}
                showToast={showToast}
                role={role}
              />
            )}
            {page === "expenses" && (
              <ExpensesPage expenses={expenses} fetchAll={fetchAll} user={user} showToast={showToast} />
            )}
            {page === "reports" && (
              <ReportsPage sales={sales} expenses={expenses} showToast={showToast} />
            )}
          </main>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: toast.type === "success" ? "#1E293B" : C.danger,
          color: "#fff",
          padding: "12px 20px",
          borderRadius: 10,
          fontWeight: 500,
          fontSize: 13,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span>{toast.type === "success" ? "✓" : "✕"}</span>
          {toast.msg}
        </div>
      )}

      {/* Add Service Modal */}
      {showAddService && role === "admin" && (
        <div
          onClick={() => setShowAddService(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(15,23,42,0.4)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 500,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.card,
              borderRadius: 16,
              padding: 32,
              width: 400,
              boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
            }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>New Service</h3>

            <label style={labelStyle}>Service name</label>
            <input
              placeholder="e.g. Accommodation, Transport..."
              value={newService.name}
              onChange={(e) => setNewService({ ...newService, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addService()}
              style={inputStyle}
              autoFocus
            />

            <label style={{ ...labelStyle, marginTop: 16 }}>Color</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewService({ ...newService, color: c })}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: c, border: "none", cursor: "pointer",
                    outline: newService.color === c ? `2px solid ${C.text}` : "2px solid transparent",
                    outlineOffset: 2,
                    transition: "outline 0.1s",
                  }}
                />
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowAddService(false)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "transparent", cursor: "pointer",
                  fontWeight: 500, fontSize: 13, color: C.muted,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addService}
                style={{
                  flex: 2, padding: "10px 0", borderRadius: 8,
                  border: "none", background: C.accent,
                  color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
                }}
              >
                Save Service
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── DASHBOARD ─────────────────────────────────── */
function DashboardPage({ sales, expenses, services }) {
  const today = todayStr()

  const todaySales = sales
    .filter((s) => s.date?.startsWith(today))
    .reduce((a, b) => a + Number(b.amount || 0), 0)

  const todayExp = expenses
    .filter((e) => e.date?.startsWith(today))
    .reduce((a, b) => a + Number(b.cost || 0), 0)

  const totalSales = sales.reduce((a, b) => a + Number(b.amount || 0), 0)
  const totalExp   = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)
  const net        = todaySales - todayExp

  // Last 7 days bar chart
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const key = d.toISOString().split("T")[0]
    return {
      day: d.toLocaleDateString(undefined, { weekday: "short" }),
      Sales: sales.filter(s => s.date?.startsWith(key)).reduce((a, b) => a + Number(b.amount || 0), 0),
      Expenses: expenses.filter(e => e.date?.startsWith(key)).reduce((a, b) => a + Number(b.cost || 0), 0),
    }
  })

  // Pie chart — revenue by service
  const byService = services
    .map((s) => ({
      name: s.name,
      value: sales.filter((x) => x.service_id === s.id).reduce((a, b) => a + Number(b.amount || 0), 0),
    }))
    .filter(s => s.value > 0)

  const statsRow = [
    { label: "Today's Revenue",  value: TZS(todaySales), accent: C.accent,   icon: "↑", trend: true  },
    { label: "Today's Expenses", value: TZS(todayExp),   accent: C.danger,   icon: "↓", trend: false },
    { label: "Net Profit",       value: TZS(net),        accent: net >= 0 ? C.success : C.danger, icon: net >= 0 ? "+" : "−", trend: net >= 0 },
    { label: "All-Time Sales",   value: TZS(totalSales), accent: C.warn,     icon: "∑", trend: true  },
  ]

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={pageTitle}>Overview</h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
        {statsRow.map(({ label, value, accent, icon }) => (
          <div key={label} style={{
            background: C.card, borderRadius: 12,
            padding: "20px 22px",
            border: `1px solid ${C.border}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
              </span>
              <span style={{
                width: 28, height: 28, borderRadius: 7,
                background: accent + "18",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, color: accent, fontWeight: 700,
              }}>
                {icon}
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 10, letterSpacing: "-0.02em" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>

        {/* Bar Chart */}
        <div style={panelStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>7-Day Overview</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Sales vs expenses per day</div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={last7} barSize={10} barGap={4}>
              <CartesianGrid vertical={false} stroke={C.border} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={60} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v) => TZS(v)}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: C.muted }} />
              <Bar dataKey="Sales"    fill={C.accent}  radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill={C.danger}  radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div style={panelStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Revenue by Service</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>All-time breakdown</div>
          </div>
          {byService.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={byService}
                    dataKey="value"
                    outerRadius={70}
                    innerRadius={40}
                    strokeWidth={0}
                  >
                    {byService.map((_, i) => (
                      <Cell key={i} fill={services.find(s => s.name === byService[i]?.name)?.color || PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => TZS(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                {byService.slice(0, 4).map((s, i) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        background: services.find(x => x.name === s.name)?.color || PALETTE[i % PALETTE.length],
                      }} />
                      <span style={{ fontSize: 12, color: C.muted }}>{s.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{TZS(s.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: C.faint, fontSize: 13, paddingTop: 40 }}>No sales data yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── SALES PAGE ─────────────────────────────────── */
function SalesPage({ sales, services, fetchAll, user, showToast, role }) {
  const [form, setForm] = useState({ service_id: "", amount: "" })

  const addSale = async () => {
    if (!form.service_id || !form.amount) return showToast("Missing data", "error")
    await supabase.from("sales").insert([
      { service_id: form.service_id, amount: Number(form.amount), date: new Date().toISOString(), user_id: user.id },
    ])
    setForm({ service_id: "", amount: "" })
    fetchAll()
    showToast("Sale recorded ✓")
  }

  const totalToday = sales
    .filter(s => s.date?.startsWith(todayStr()))
    .reduce((a, b) => a + Number(b.amount || 0), 0)

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={pageTitle}>Sales</h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          {sales.length} transactions · Today: {TZS(totalToday)}
        </p>
      </div>

      {/* Form Card */}
      <div style={{ ...panelStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 18 }}>Record a sale</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Service</label>
            <select
              value={form.service_id}
              onChange={(e) => setForm({ ...form, service_id: e.target.value })}
              style={inputStyle}
            >
              <option value="">Select a service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Amount (TZS)</label>
            <input
              type="number"
              placeholder="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addSale()}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={addSale} style={primaryBtn}>
            Record Sale
          </button>
          {role === "admin" && (
            <button
              type="button"
              style={ghostBtn}
              onClick={() => window.dispatchEvent(new Event("openAddService"))}
            >
              + Add Service
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={panelStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>
          All Sales
          <span style={{ marginLeft: 8, fontSize: 12, color: C.muted, fontWeight: 400 }}>
            {sales.length} records
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {(() => {
                      const svc = services.find((x) => x.id === s.service_id)
                      return svc ? (
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          padding: "3px 10px", borderRadius: 20,
                          background: (svc.color || C.accent) + "18",
                          color: svc.color || C.accent,
                        }}>
                          {svc.name}
                        </span>
                      ) : <span style={{ color: C.faint, fontSize: 12 }}>—</span>
                    })()}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {TZS(s.amount)}
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "40px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>
                    No sales recorded yet
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

/* ── EXPENSES PAGE ──────────────────────────────── */
function ExpensesPage({ expenses, fetchAll, user, showToast }) {
  const [form, setForm] = useState({ category: "", cost: "" })

  const addExpense = async () => {
    if (!form.category || !form.cost) return showToast("Missing data", "error")
    await supabase.from("expenses").insert([
      { category: form.category, cost: Number(form.cost), date: new Date().toISOString(), user_id: user.id },
    ])
    setForm({ category: "", cost: "" })
    fetchAll()
    showToast("Expense added ✓")
  }

  const totalToday = expenses
    .filter(e => e.date?.startsWith(todayStr()))
    .reduce((a, b) => a + Number(b.cost || 0), 0)

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={pageTitle}>Expenses</h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          {expenses.length} records · Today: {TZS(totalToday)}
        </p>
      </div>

      {/* Form Card */}
      <div style={{ ...panelStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 18 }}>Record an expense</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <input
              placeholder="e.g. Supplies, Utilities..."
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Cost (TZS)</label>
            <input
              type="number"
              placeholder="0"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              style={inputStyle}
            />
          </div>
        </div>

        <button type="button" onClick={addExpense} style={primaryBtn}>
          Record Expense
        </button>
      </div>

      {/* Table */}
      <div style={panelStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>
          All Expenses
          <span style={{ marginLeft: 8, fontSize: 12, color: C.muted, fontWeight: 400 }}>
            {expenses.length} records
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={ev => ev.currentTarget.style.background = C.bg}
                  onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
                >
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      padding: "3px 10px", borderRadius: 20,
                      background: C.warn + "18",
                      color: C.warn,
                    }}>
                      {e.category || "—"}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: C.danger }}>
                    {TZS(e.cost)}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "40px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>
                    No expenses recorded yet
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

/* ── REPORTS PAGE ───────────────────────────────── */
function ReportsPage({ sales, expenses, showToast }) {
  const exportExcel = () => {
    if (!sales.length && !expenses.length) return showToast("No data to export", "error")
    const wb = XLSX.utils.book_new()
    if (sales.length)    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sales),    "Sales")
    if (expenses.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses), "Expenses")
    XLSX.writeFile(wb, "report.xlsx")
    showToast("Report exported ✓")
  }

  const totalSales = sales.reduce((a, b) => a + Number(b.amount || 0), 0)
  const totalExp   = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)
  const profit     = totalSales - totalExp

  // Monthly trend
  const monthlyMap = {}
  sales.forEach(s => {
    if (!s.date) return
    const key = s.date.slice(0, 7)
    monthlyMap[key] = (monthlyMap[key] || 0) + Number(s.amount || 0)
  })
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, amount]) => ({
      month: new Date(month + "-01").toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      Revenue: amount,
    }))

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={pageTitle}>Reports</h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Summary and data exports</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "Total Revenue", value: TZS(totalSales), accent: C.success, icon: "↑" },
          { label: "Total Expenses", value: TZS(totalExp), accent: C.danger, icon: "↓" },
          { label: "Net Profit", value: TZS(profit), accent: profit >= 0 ? C.accent : C.danger, icon: profit >= 0 ? "+" : "−" },
        ].map(({ label, value, accent, icon }) => (
          <div key={label} style={{
            background: C.card, borderRadius: 12,
            padding: "20px 22px",
            border: `1px solid ${C.border}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
              </span>
              <span style={{
                width: 28, height: 28, borderRadius: 7,
                background: accent + "18",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, color: accent, fontWeight: 700,
              }}>
                {icon}
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 10, letterSpacing: "-0.02em" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Monthly Revenue Chart */}
      {monthlyData.length > 0 && (
        <div style={{ ...panelStyle, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 18 }}>Monthly Revenue Trend</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={monthlyData}>
              <CartesianGrid vertical={false} stroke={C.border} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={60} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v) => TZS(v)}
              />
              <Line
                type="monotone"
                dataKey="Revenue"
                stroke={C.accent}
                strokeWidth={2}
                dot={{ fill: C.accent, strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Export */}
      <div style={{ ...panelStyle }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Export Data</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
          Download all sales and expenses as an Excel spreadsheet.
        </p>
        <button type="button" onClick={exportExcel} style={primaryBtn}>
          ↓ Export Excel
        </button>
      </div>
    </div>
  )
}

/* ── ICON COMPONENTS ────────────────────────────── */
function SquaresIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" fill={color} opacity="0.7" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" fill={color} />
      <rect x="1" y="9" width="6" height="6" rx="1.5" fill={color} />
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill={color} opacity="0.7" />
    </svg>
  )
}
function CurrencyIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
      <text x="8" y="12" textAnchor="middle" fill={color} fontSize="8" fontWeight="700">$</text>
    </svg>
  )
}
function ReceiptIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 2h10v12l-2-1.5-2 1.5-2-1.5L5 14 3 14V2z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="5.5" y1="6" x2="10.5" y2="6" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5.5" y1="9" x2="8.5" y2="9" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function ChartIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="8" width="3" height="6" rx="1" fill={color} opacity="0.6" />
      <rect x="6.5" y="5" width="3" height="9" rx="1" fill={color} />
      <rect x="11" y="2" width="3" height="12" rx="1" fill={color} opacity="0.8" />
    </svg>
  )
}
function ChevronIcon({ dir = "left", size = 14 }) {
  const d = dir === "left" ? "M9 4L5 8l4 4" : "M7 4l4 4-4 4"
  return (
    <svg width={size} height={size} viewBox="0 0 14 16" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── SHARED STYLES ──────────────────────────────── */
const pageTitle = {
  fontSize: 22,
  fontWeight: 700,
  color: C.text,
  letterSpacing: "-0.03em",
}

const panelStyle = {
  background: C.card,
  borderRadius: 12,
  padding: "20px 22px",
  border: `1px solid ${C.border}`,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
}

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.bg,
  fontSize: 13,
  color: C.text,
  outline: "none",
  transition: "border-color 0.15s",
}

const primaryBtn = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: C.accent,
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
}

const ghostBtn = {
  padding: "9px 18px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "transparent",
  color: C.muted,
  fontWeight: 500,
  fontSize: 13,
  cursor: "pointer",
}

const thStyle = {
  textAlign: "left",
  padding: "8px 14px",
  fontSize: 11,
  fontWeight: 600,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}

const tdStyle = {
  padding: "12px 14px",
  fontSize: 13,
  color: C.text,
  transition: "background 0.1s",
}