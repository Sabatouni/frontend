import { useEffect, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import { supabase } from "./api/supabaseClient";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";

const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`;
const today = () => new Date().toISOString().split("T")[0];

export default function App() {
  const { user, logout } = useAuth();
  const isOwner = user?.role === "owner";

  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);

  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [services, setServices] = useState([]);

  // 🔄 FETCH FROM SUPABASE
  async function load() {
    const { data: s } = await supabase.from("sales").select("*").order("date", { ascending: false });
    const { data: e } = await supabase.from("expenses").select("*").order("date", { ascending: false });
    const { data: srv } = await supabase.from("services").select("*");

    setSales(s || []);
    setExpenses(e || []);
    setServices(srv || []);
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!user) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#F7F5F0", fontFamily: "DM Sans" }}>

      {/* SIDEBAR */}
      <aside style={{ width: 240, background: "#2A2D40", color: "#fff", padding: 20 }}>
        <img src="/logo.png" style={{ width: "100%", marginBottom: 20 }} />

        {[
          { id: "dashboard", label: "📊 Dashboard" },
          { id: "sales", label: "💰 Sales" },
          { id: "expenses", label: "🧾 Expenses" },
          { id: "reports", label: "📈 Reports" },
        ].map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            style={{
              width: "100%", padding: 10, marginBottom: 8,
              background: page === item.id ? "#3D405B" : "transparent",
              color: "#fff", border: "none", borderRadius: 6, cursor: "pointer"
            }}
          >
            {item.label}
          </button>
        ))}

        {isOwner && (
          <button type="button" onClick={() => setPage("users")} style={{ width: "100%", marginTop: 10 }}>
            👥 Users
          </button>
        )}

        <button onClick={logout} style={{ marginTop: 20, width: "100%" }}>
          Logout
        </button>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, padding: 28, overflowY: "auto" }}>
        {page === "dashboard" && <Dashboard sales={sales} expenses={expenses} services={services} />}
        {page === "sales" && <SalesPage services={services} refresh={load} showToast={showToast} />}
        {page === "expenses" && <ExpensesPage refresh={load} showToast={showToast} />}
        {page === "reports" && isOwner && <ReportsPage sales={sales} expenses={expenses} services={services} />}
      </main>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20,
          background: "#81B29A", color: "#fff",
          padding: "12px 18px", borderRadius: 8
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ================= DASHBOARD ================= */

function Dashboard({ sales, expenses, services }) {
  const totalSales = sales.reduce((a, b) => a + Number(b.amount), 0);
  const totalExp = expenses.reduce((a, b) => a + Number(b.cost), 0);

  const data = services.map(s => ({
    name: s.name,
    value: sales.filter(x => x.service === s.id)
      .reduce((a, b) => a + Number(b.amount), 0),
    color: s.color
  })).filter(x => x.value > 0);

  return (
    <div>
      <h1>Dashboard</h1>

      <div style={{ display: "flex", gap: 10 }}>
        <StatCard label="Revenue" value={TZS(totalSales)} />
        <StatCard label="Expenses" value={TZS(totalExp)} />
        <StatCard label="Profit" value={TZS(totalSales - totalExp)} />
      </div>

      <div style={{ background: "#fff", padding: 20, marginTop: 20 }}>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={data} dataKey="value">
              {data.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <Tooltip formatter={v => TZS(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", padding: 20, borderRadius: 10, flex: 1 }}>
      <div>{label}</div>
      <h2>{value}</h2>
    </div>
  );
}

/* ================= SALES ================= */

function SalesPage({ services, refresh, showToast }) {
  const [form, setForm] = useState({ service: "", amount: "", date: today(), note: "" });

  async function submit() {
    await supabase.from("sales").insert([
      { ...form, amount: Number(form.amount) }
    ]);
    showToast("Sale added");
    refresh();
  }

  return (
    <div>
      <h1>Sales</h1>

      <select onChange={e => setForm(f => ({ ...f, service: e.target.value }))}>
        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <button onClick={() => window.dispatchEvent(new Event("openAddService"))}>
        + Add Service
      </button>

      <input placeholder="Amount" onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />

      <button onClick={submit}>Save</button>
    </div>
  );
}

/* ================= EXPENSES ================= */

function ExpensesPage({ refresh, showToast }) {
  const [form, setForm] = useState({ item: "", cost: "", date: today() });

  async function submit() {
    await supabase.from("expenses").insert([
      { ...form, cost: Number(form.cost) }
    ]);
    showToast("Expense added");
    refresh();
  }

  return (
    <div>
      <h1>Expenses</h1>

      <input placeholder="Item" onChange={e => setForm(f => ({ ...f, item: e.target.value }))} />
      <input placeholder="Cost" onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />

      <button onClick={submit}>Save</button>
    </div>
  );
}

/* ================= REPORTS ================= */

function ReportsPage({ sales }) {
  return (
    <div>
      <h1>Reports</h1>
      <p>Total sales: {TZS(sales.reduce((a, b) => a + Number(b.amount), 0))}</p>
    </div>
  );
}