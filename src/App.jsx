import { useEffect, useState } from "react"
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts"
import * as XLSX from "xlsx"
import { useAuth } from "./context/AuthContext"
import Login from "./Login"
import { supabase } from "./supabaseClient"

const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`
const todayStr = () => new Date().toISOString().split("T")[0]
const PALETTE = ["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#9C89B8", "#F0A500", "#00B4D8", "#E63946"]

export default function App() {
  const { user, role } = useAuth()
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [services, setServices] = useState([])
  const [users, setUsers] = useState([])
  const [page, setPage] = useState("dashboard")
  const [toast, setToast] = useState(null)
  const [showAddService, setShowAddService] = useState(false)
  const [newService, setNewService] = useState({ name: "", color: PALETTE[0] })

  const showToast = (msg, type = "success") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchAll() {
    const { data: s } = await supabase.from("sales").select("*").order("date", { ascending: false })
    const { data: e } = await supabase.from("expenses").select("*").order("date", { ascending: false })
    const { data: srv } = await supabase.from("services").select("*")
    const { data: u } = await supabase.from("users").select("*")
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

  const totalSales = sales.reduce((a, s) => a + Number(s.amount || 0), 0)
  const totalExp = expenses.reduce((a, e) => a + Number(e.cost || 0), 0)
  const net = totalSales - totalExp

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#F7F5F0", overflow: "hidden" }}>
      <link href="[fonts.googleapis.com](https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:wght@700&display=swap)" rel="stylesheet" />
      {/* SIDEBAR */}
      <aside style={{ width: 230, background: "#2A2D40", color: "#fff", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 14px", borderBottom: "1px solid #3D405B", textAlign: "center" }}>
          <h3 style={{ margin: 0, fontSize: 15, color: "#9B9EC0" }}>{role}</h3>
        </div>
        <nav style={{ padding: "8px 10px", flex: 1 }}>
          {[
            { id: "dashboard", label: "Dashboard", icon: "📊" },
            { id: "sales", label: "Sales", icon: "💰" },
            { id: "expenses", label: "Expenses", icon: "🧾" },
            { id: "reports", label: "Reports", icon: "📈" },
          ].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setPage(x.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "9px 10px",
                marginBottom: 3,
                borderRadius: 10,
                background: page === x.id ? "#3D405B" : "transparent",
                border: "none",
                color: page === x.id ? "#fff" : "#9B9EC0",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <span>{x.icon}</span> {x.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: "auto", padding: 28 }}>
        {page === "dashboard" && (
          <Dashboard sales={sales} expenses={expenses} services={services} />
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

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            right: 28,
            background: toast.type === "success" ? "#81B29A" : "#E07A5F",
            color: "#fff",
            padding: "13px 22px",
            borderRadius: 12,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {toast.msg}
        </div>
      )}

      {showAddService && role === "admin" && (
        <div
          onClick={() => setShowAddService(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 20, padding: 32, width: 380 }}
          >
            <h3 style={{ marginTop: 0, fontFamily: "'Playfair Display',serif" }}>Add Service</h3>
            <input
              placeholder="Service name"
              value={newService.name}
              onChange={(e) => setNewService({ ...newService, name: e.target.value })}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "2px solid #E8E4DF", marginBottom: 10 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewService({ ...newService, color: c })}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: c,
                    border: newService.color === c ? "3px solid #2A2D40" : "none",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <button type="button" onClick={addService} style={{ ...btn, background: "#3D405B" }}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── SUB‑COMPONENTS ───────────────────────────── */

function Dashboard({ sales, expenses, services }) {
  const todaySales = sales.filter((s) => s.date?.startsWith(todayStr())).reduce((a, b) => a + Number(b.amount || 0), 0)
  const todayExp = expenses.filter((e) => e.date?.startsWith(todayStr())).reduce((a, b) => a + Number(b.cost || 0), 0)
  const net = todaySales - todayExp
  const byService = services.map((s) => ({
    name: s.name,
    value: sales.filter((x) => x.service_id === s.id).reduce((a, b) => a + Number(b.amount || 0), 0),
  }))
  return (
    <div>
      <h1 style={h1}>Dashboard</h1>
      <div style={cards}>
        <StatCard label="Today's Sales" value={TZS(todaySales)} color="#81B29A" />
        <StatCard label="Today's Expenses" value={TZS(todayExp)} color="#E07A5F" />
        <StatCard label="Net Profit" value={TZS(net)} color={net >= 0 ? "#81B29A" : "#E07A5F"} />
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 24, flexWrap: "wrap" }}>
        <div style={panel}>
          <h3 style={h3}>Revenue by Service</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byService} dataKey="value" outerRadius={80} innerRadius={40}>
                {byService.map((e, i) => (
                  <Cell key={i} fill={services[i]?.color || "#ccc"} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => TZS(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

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

  return (
    <div>
      <h1 style={h1}>Sales</h1>
      <div>
        <select
          value={form.service_id}
          onChange={(e) => setForm({ ...form, service_id: e.target.value })}
          style={{ ...input, marginBottom: 10 }}
        >
          <option value="">Select service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          style={{ ...input, marginBottom: 10 }}
        />
        <button type="button" style={btn} onClick={addSale}>
          Record Sale
        </button>
        {role === "admin" && (
          <button
            type="button"
            style={{ ...btn, background: "#888", marginLeft: 8 }}
            onClick={() => window.dispatchEvent(new Event("openAddService"))}
          >
            + Add Service
          </button>
        )}
      </div>
      <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #eee" }}>
            <th style={th}>Date</th>
            <th style={th}>Service</th>
            <th style={th}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={td}>{new Date(s.date).toLocaleDateString()}</td>
              <td style={td}>{services.find((x) => x.id === s.service_id)?.name}</td>
              <td style={td}>{TZS(s.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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

  return (
    <div>
      <h1 style={h1}>Expenses</h1>
      <input
        placeholder="Category"
        value={form.category}
        onChange={(e) => setForm({ ...form, category: e.target.value })}
        style={{ ...input, marginBottom: 10 }}
      />
      <input
        type="number"
        placeholder="Cost"
        value={form.cost}
        onChange={(e) => setForm({ ...form, cost: e.target.value })}
        style={{ ...input, marginBottom: 10 }}
      />
      <button type="button" style={btn} onClick={addExpense}>
        Record Expense
      </button>
      <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #eee" }}>
            <th style={th}>Date</th>
            <th style={th}>Category</th>
            <th style={th}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e, i) => (
            <tr key={i}>
              <td style={td}>{new Date(e.date).toLocaleDateString()}</td>
              <td style={td}>{e.category}</td>
              <td style={td}>{TZS(e.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportsPage({ sales, expenses, showToast }) {
  const exportExcel = () => {
    if (!sales.length && !expenses.length) return showToast("No data to export", "error")
    const wb = XLSX.utils.book_new()
    if (sales.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sales), "Sales")
    if (expenses.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses), "Expenses")
    XLSX.writeFile(wb, "report.xlsx")
    showToast("Report exported ✓")
  }
  const totalSales = sales.reduce((a, b) => a + Number(b.amount || 0), 0)
  const totalExp = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)
  return (
    <div>
      <h1 style={h1}>Reports</h1>
      <div style={cards}>
        <StatCard label="Total Sales" value={TZS(totalSales)} color="#81B29A" />
        <StatCard label="Total Expenses" value={TZS(totalExp)} color="#E07A5F" />
        <StatCard label="Profit" value={TZS(totalSales - totalExp)} color="#3D405B" />
      </div>
      <button type="button" style={{ ...btn, background: "#3D405B", marginTop: 24 }} onClick={exportExcel}>
        📄 Export Excel
      </button>
    </div>
  )
}

/* ── STYLING HELPERS ───────────────────────────────── */
function StatCard({ label, value, color }) {
  return (
    <div style={{ background: "#fff", borderRadius: 18, padding: 20, flex: 1, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#2A2D40" }}>{value}</div>
    </div>
  )
}

const h1 = { fontFamily: "'Playfair Display',serif", fontSize: 28, color: "#2A2D40", marginBottom: 18 }
const h3 = { margin: "0 0 12px", fontSize: 14, color: "#2A2D40" }
const cards = { display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }
const panel = { background: "#fff", borderRadius: 18, padding: 22, flex: 1, boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }
const input = { width: "100%", padding: "10px", border: "2px solid #E8E4DF", borderRadius: 9, background: "#FAFAF8" }
const btn = { padding: "12px 20px", borderRadius: 9, border: "none", background: "#81B29A", color: "#fff", fontWeight: 700, cursor: "pointer" }
const th = { textAlign: "left", padding: "8px 0", fontSize: 11, color: "#888" }
const td = { padding: "6px 0", fontSize: 13, color: "#333" }
