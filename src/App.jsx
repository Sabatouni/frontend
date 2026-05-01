import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import { supabase } from "./api/supabaseClient";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";

const LOGO = "/logo.png";

const DEFAULT_SERVICES = [
  { id: "restaurant", name: "Restaurant", color: "#E07A5F" },
  { id: "gokart", name: "Go Kart", color: "#3D405B" },
  { id: "paintball", name: "Paintball", color: "#81B29A" },
  { id: "entry", name: "Park Entry", color: "#F2CC8F" },
];

const EXPENSE_CATS = [
  "Restaurant", "Go Kart", "Paintball", "Park Entry",
  "Utilities", "Staff", "Maintenance", "Marketing", "Other",
];

const todayStr = () => new Date().toISOString().split("T")[0];
const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`;
const formatDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

export default function App() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "owner";

  const [db, setDb] = useState({ sales: [], expenses: [], services: DEFAULT_SERVICES, users: [] });
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);

  const fetchAll = async () => {
    if (!supabase) return;

    try {
      const { data: sales } = await supabase.from("sales").select("*").order("date", { ascending: false });
      const { data: expenses } = await supabase.from("expenses").select("*").order("date", { ascending: false });
      const { data: users } = await supabase.from("users").select("*");

      setDb(prev => ({
        ...prev,
        sales: (sales || []).map(s => ({ ...s, amount: Number(s.amount) })),
        expenses: (expenses || []).map(e => ({ ...e, cost: Number(e.cost) })),
        users: users || [],
      }));
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!user) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#F7F5F0", fontFamily: "'DM Sans', 'Playfair Display', system-ui, sans-serif" }}>
      <Sidebar user={user} logout={logout} setPage={setPage} page={page} isAdmin={isAdmin} />

      <main style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        {page === "dashboard" && <Dashboard db={db} />}
        {page === "sales" && <SalesPage db={db} refresh={fetchAll} showToast={showToast} />}
        {page === "expenses" && <ExpensesPage db={db} refresh={fetchAll} showToast={showToast} />}
        {page === "reports" && isAdmin && <ReportsPage db={db} showToast={showToast} />}
        {page === "users" && isAdmin && <UsersPage db={db} refresh={fetchAll} showToast={showToast} />}
      </main>

      {showAddServiceModal && isAdmin && (
        <AddServiceModal onClose={() => setShowAddServiceModal(false)} db={db} setDb={setDb} showToast={showToast} />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 9999,
          background: toast.type === "success" ? "#81B29A" : "#E07A5F",
          color: "#fff", padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)", animation: "slideIn 0.3s ease-out",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ============ SIDEBAR ============
function Sidebar({ user, logout, setPage, page, isAdmin }) {
  return (
    <aside style={{
      width: 240, background: "#2A2D40", color: "#fff", padding: 24, display: "flex", flexDirection: "column",
      boxShadow: "2px 0 12px rgba(0,0,0,0.1)", minHeight: "100vh",
    }}>
      <div style={{ marginBottom: 32 }}>
        <img src={LOGO} alt="Swahili" style={{ width: "100%", height: "auto", borderRadius: 8, marginBottom: 12 }} />
        <h1 style={{ margin: "8px 0", fontSize: 20, fontWeight: 700 }}>🏕️ Swahili</h1>
        <p style={{ margin: 0, fontSize: 11, color: "#A0A0A0", textTransform: "uppercase", letterSpacing: 1 }}>Tent Village POS</p>
      </div>

      <nav style={{ flex: 1, marginBottom: 24 }}>
        {[
          { id: "dashboard", label: "📊 Dashboard" },
          { id: "sales", label: "💰 Sales" },
          { id: "expenses", label: "📉 Expenses" },
          { id: "reports", label: "📄 Reports" },
          ...(isAdmin ? [{ id: "users", label: "👥 Users" }] : []),
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            style={{
              width: "100%", padding: "12px 16px", margin: "6px 0", border: "none",
              background: page === item.id ? "rgba(255,255,255,0.2)" : "transparent",
              color: page === item.id ? "#fff" : "#B0B0B0", borderRadius: 6, cursor: "pointer",
              fontSize: 14, fontWeight: page === item.id ? 600 : 500, textAlign: "left",
              transition: "all 0.2s", borderLeft: page === item.id ? "3px solid #81B29A" : "3px solid transparent",
              paddingLeft: page === item.id ? 13 : 16,
            }}
            onMouseEnter={e => !page === item.id && (e.target.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => !page === item.id && (e.target.style.background = "transparent")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
        <p style={{ margin: "0 0 8px 0", fontSize: 11, color: "#A0A0A0", textTransform: "uppercase", fontWeight: 600 }}>Account</p>
        <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#fff", fontWeight: 500 }}>{user?.email || "User"}</p>
        {isAdmin && <p style={{ display: "inline-block", fontSize: 10, background: "rgba(129,178,154,0.3)", padding: "4px 8px", borderRadius: 4, color: "#81B29A", fontWeight: 600, marginBottom: 12 }}>OWNER</p>}
        <button
          onClick={logout}
          style={{
            width: "100%", padding: "10px 12px", margin: "12px 0 0 0", border: "none",
            background: "rgba(224,122,95,0.15)", color: "#E07A5F", borderRadius: 6, cursor: "pointer",
            fontSize: 13, fontWeight: 500, transition: "all 0.2s",
          }}
          onMouseEnter={e => e.target.style.background = "rgba(224,122,95,0.25)"}
          onMouseLeave={e => e.target.style.background = "rgba(224,122,95,0.15)"}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}

// ============ DASHBOARD ============
function Dashboard({ db }) {
  const totalSales = db.sales.reduce((a, b) => a + b.amount, 0);
  const totalExp = db.expenses.reduce((a, b) => a + b.cost, 0);
  const profit = totalSales - totalExp;
  const transactionCount = db.sales.length + db.expenses.length;

  const salesByService = DEFAULT_SERVICES.map(s => ({
    name: s.name,
    value: db.sales.filter(x => x.service === s.id).reduce((a, b) => a + b.amount, 0),
    color: s.color,
  })).filter(x => x.value > 0);

  const expensesByCategory = EXPENSE_CATS.map((cat, idx) => ({
    name: cat,
    value: db.expenses.filter(x => x.category === cat).reduce((a, b) => a + b.cost, 0),
    color: ["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#D4A574", "#9B7653", "#C6B8A8", "#7A8B8B", "#B5A89E"][idx % 9],
  })).filter(x => x.value > 0);

  const dailyTrend = groupByDate(db.sales, "date").map(([date, items]) => ({
    date: formatDate(date),
    sales: items.reduce((a, b) => a + b.amount, 0),
    count: items.length,
  })).slice(-14);

  return (
    <div>
      <h1 style={{ margin: "0 0 8px 0", fontSize: 36, fontWeight: 700, color: "#2A2D40", fontFamily: "'Playfair Display'" }}>Dashboard</h1>
      <p style={{ margin: "0 0 28px 0", color: "#A0A0A0", fontSize: 14 }}>Welcome back. Here's your business summary.</p>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Revenue" value={TZS(totalSales)} icon="💰" color="#81B29A" />
        <StatCard label="Total Expenses" value={TZS(totalExp)} icon="📉" color="#E07A5F" />
        <StatCard label="Net Profit" value={TZS(profit)} icon={profit >= 0 ? "📈" : "⚠️"} color={profit >= 0 ? "#81B29A" : "#E07A5F"} />
        <StatCard label="Transactions" value={transactionCount} icon="📊" color="#3D405B" />
      </div>

      {/* Charts Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, marginBottom: 32 }}>
        {/* Sales by Service */}
        <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Sales by Service</h3>
          {salesByService.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={salesByService}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${TZS(value)}`}
                >
                  {salesByService.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={v => TZS(v)} contentStyle={{ background: "#fff", border: "1px solid #E0E0E0", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", textAlign: "center", margin: "60px 0" }}>No sales data yet</p>
          )}
        </div>

        {/* Daily Sales Trend */}
        <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Sales Trend (14 days)</h3>
          {dailyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#A0A0A0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#A0A0A0" />
                <Tooltip formatter={v => TZS(v)} contentStyle={{ background: "#fff", border: "1px solid #E0E0E0", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="#81B29A" strokeWidth={2} dot={{ fill: "#81B29A", r: 4 }} name="Revenue" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", textAlign: "center", margin: "60px 0" }}>No sales data yet</p>
          )}
        </div>

        {/* Expenses by Category */}
        <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", gridColumn: "span 1" }}>
          <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Expenses by Category</h3>
          {expensesByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={expensesByCategory} layout="vertical" margin={{ left: 140, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#A0A0A0" />
                <YAxis dataKey="name" width={130} tick={{ fontSize: 12 }} stroke="#A0A0A0" />
                <Tooltip formatter={v => TZS(v)} contentStyle={{ background: "#fff", border: "1px solid #E0E0E0", borderRadius: 8 }} />
                <Bar dataKey="value" fill="#E07A5F" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", textAlign: "center", margin: "60px 0" }}>No expense data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      borderTop: `4px solid ${color}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, color: "#A0A0A0", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
        <h3 style={{ margin: "12px 0 0 0", fontSize: typeof value === "string" ? 28 : 32, fontWeight: 700, color: color, fontFamily: "'Playfair Display'" }}>{value}</h3>
      </div>
      <span style={{ fontSize: 40 }}>{icon}</span>
    </div>
  );
}

// ============ SALES PAGE ============
function SalesPage({ db, refresh, showToast }) {
  const [form, setForm] = useState({ service: "restaurant", amount: "", date: todayStr(), note: "" });
  const [deleting, setDeleting] = useState(null);

  const submit = async () => {
    if (!form.amount || isNaN(form.amount)) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    const { error } = await supabase.from("sales").insert([{
      ...form,
      amount: Number(form.amount),
    }]);

    if (!error) {
      showToast("Sale recorded successfully ✓");
      setForm({ service: "restaurant", amount: "", date: todayStr(), note: "" });
      refresh();
    } else {
      showToast("Error adding sale", "error");
    }
  };

  const deleteSale = async (id) => {
    setDeleting(id);
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (!error) {
      showToast("Sale deleted");
      refresh();
    } else {
      showToast("Error deleting sale", "error");
    }
    setDeleting(null);
  };

  const handleKeyPress = e => e.key === "Enter" && submit();

  return (
    <div>
      <h1 style={{ margin: "0 0 8px 0", fontSize: 36, fontWeight: 700, color: "#2A2D40", fontFamily: "'Playfair Display'" }}>Sales</h1>
      <p style={{ margin: "0 0 28px 0", color: "#A0A0A0", fontSize: 14 }}>Record and manage daily sales transactions.</p>

      {/* Add Sale Form */}
      <div style={{ background: "#fff", padding: 28, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 28 }}>
        <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>New Sale</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 16 }}>
          <FormField label="Service" type="select">
            <select
              value={form.service}
              onChange={e => setForm(f => ({ ...f, service: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, background: "#fff", cursor: "pointer" }}
            >
              {DEFAULT_SERVICES.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Amount (TZS)">
            <input
              type="number"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="0"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
            />
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
            />
          </FormField>
        </div>
        <FormField label="Notes">
          <input
            type="text"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            onKeyPress={handleKeyPress}
            placeholder="Optional notes about this sale"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
          />
        </FormField>
        <button
          onClick={submit}
          style={{
            padding: "11px 28px", background: "#81B29A", color: "#fff", border: "none", borderRadius: 6,
            cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all 0.2s", marginTop: 8,
          }}
          onMouseEnter={e => e.target.style.background = "#6FA085"}
          onMouseLeave={e => e.target.style.background = "#81B29A"}
        >
          Record Sale
        </button>
      </div>

      {/* Sales Table */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #E0E0E0", background: "#F7F5F0" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2A2D40" }}>{db.sales.length} Sales</h3>
        </div>
        {db.sales.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F7F5F0", borderBottom: "2px solid #E0E0E0" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Date</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Service</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Amount</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Notes</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {db.sales.map((s, idx) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #E0E0E0", background: idx % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{formatDate(s.date)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        display: "inline-block", padding: "4px 10px", background: getServiceColor(s.service, 0.15),
                        color: getServiceColor(s.service), borderRadius: 5, fontWeight: 500, fontSize: 12,
                      }}>
                        {DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#81B29A", textAlign: "right" }}>{TZS(s.amount)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#A0A0A0" }}>{s.note || "—"}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <button
                        onClick={() => deleteSale(s.id)}
                        disabled={deleting === s.id}
                        style={{
                          padding: "6px 10px", background: deleting === s.id ? "#ddd" : "#E07A5F", color: "#fff",
                          border: "none", borderRadius: 5, cursor: deleting === s.id ? "not-allowed" : "pointer", fontSize: 12,
                          fontWeight: 500, transition: "all 0.2s",
                        }}
                        onMouseEnter={e => deleting !== s.id && (e.target.style.background = "#D96949")}
                        onMouseLeave={e => deleting !== s.id && (e.target.style.background = "#E07A5F")}
                      >
                        {deleting === s.id ? "..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ padding: 32, margin: 0, color: "#A0A0A0", textAlign: "center", fontSize: 14 }}>No sales recorded yet</p>
        )}
      </div>
    </div>
  );
}

// ============ EXPENSES PAGE ============
function ExpensesPage({ db, refresh, showToast }) {
  const [form, setForm] = useState({ category: "Other", item: "", cost: "", date: todayStr(), note: "" });
  const [deleting, setDeleting] = useState(null);

  const submit = async () => {
    if (!form.item || !form.cost || isNaN(form.cost)) {
      showToast("Please fill all required fields", "error");
      return;
    }

    const { error } = await supabase.from("expenses").insert([{
      ...form,
      cost: Number(form.cost),
    }]);

    if (!error) {
      showToast("Expense recorded successfully ✓");
      setForm({ category: "Other", item: "", cost: "", date: todayStr(), note: "" });
      refresh();
    } else {
      showToast("Error adding expense", "error");
    }
  };

  const deleteExpense = async (id) => {
    setDeleting(id);
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (!error) {
      showToast("Expense deleted");
      refresh();
    } else {
      showToast("Error deleting expense", "error");
    }
    setDeleting(null);
  };

  const handleKeyPress = e => e.key === "Enter" && submit();

  return (
    <div>
      <h1 style={{ margin: "0 0 8px 0", fontSize: 36, fontWeight: 700, color: "#2A2D40", fontFamily: "'Playfair Display'" }}>Expenses</h1>
      <p style={{ margin: "0 0 28px 0", color: "#A0A0A0", fontSize: 14 }}>Track and manage business expenses.</p>

      {/* Add Expense Form */}
      <div style={{ background: "#fff", padding: 28, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 28 }}>
        <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>New Expense</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 16 }}>
          <FormField label="Category" type="select">
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, background: "#fff", cursor: "pointer" }}
            >
              {EXPENSE_CATS.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Item Name">
            <input
              type="text"
              value={form.item}
              onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="e.g., Fuel, Supplies"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
            />
          </FormField>
          <FormField label="Cost (TZS)">
            <input
              type="number"
              value={form.cost}
              onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="0"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
            />
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
            />
          </FormField>
        </div>
        <FormField label="Notes">
          <input
            type="text"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            onKeyPress={handleKeyPress}
            placeholder="Optional notes"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
          />
        </FormField>
        <button
          onClick={submit}
          style={{
            padding: "11px 28px", background: "#E07A5F", color: "#fff", border: "none", borderRadius: 6,
            cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all 0.2s", marginTop: 8,
          }}
          onMouseEnter={e => e.target.style.background = "#D96949"}
          onMouseLeave={e => e.target.style.background = "#E07A5F"}
        >
          Record Expense
        </button>
      </div>

      {/* Expenses Table */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #E0E0E0", background: "#F7F5F0" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2A2D40" }}>{db.expenses.length} Expenses</h3>
        </div>
        {db.expenses.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F7F5F0", borderBottom: "2px solid #E0E0E0" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Date</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Category</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Item</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Cost</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Notes</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {db.expenses.map((e, idx) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #E0E0E0", background: idx % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{formatDate(e.date)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ display: "inline-block", padding: "4px 10px", background: "rgba(224,122,95,0.15)", color: "#E07A5F", borderRadius: 5, fontWeight: 500, fontSize: 12 }}>
                        {e.category || "Other"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#2A2D40", fontWeight: 500 }}>{e.item}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#E07A5F", textAlign: "right" }}>{TZS(e.cost)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#A0A0A0" }}>{e.note || "—"}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <button
                        onClick={() => deleteExpense(e.id)}
                        disabled={deleting === e.id}
                        style={{
                          padding: "6px 10px", background: deleting === e.id ? "#ddd" : "#E07A5F", color: "#fff",
                          border: "none", borderRadius: 5, cursor: deleting === e.id ? "not-allowed" : "pointer", fontSize: 12,
                          fontWeight: 500, transition: "all 0.2s",
                        }}
                        onMouseEnter={e => deleting !== e.id && (e.target.style.background = "#D96949")}
                        onMouseLeave={e => deleting !== e.id && (e.target.style.background = "#E07A5F")}
                      >
                        {deleting === e.id ? "..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ padding: 32, margin: 0, color: "#A0A0A0", textAlign: "center", fontSize: 14 }}>No expenses recorded yet</p>
        )}
      </div>
    </div>
  );
}

// ============ REPORTS PAGE ============
function ReportsPage({ db, showToast }) {
  const exportSales = () => {
    if (!db.sales.length) {
      showToast("No sales to export", "error");
      return;
    }
    const data = db.sales.map(s => ({
      Date: s.date,
      Service: DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service,
      Amount: s.amount,
      Notes: s.note || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    XLSX.writeFile(wb, `sales_${todayStr()}.xlsx`);
    showToast("Sales exported ✓");
  };

  const exportExpenses = () => {
    if (!db.expenses.length) {
      showToast("No expenses to export", "error");
      return;
    }
    const data = db.expenses.map(e => ({
      Date: e.date,
      Category: e.category,
      Item: e.item,
      Cost: e.cost,
      Notes: e.note || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");
    XLSX.writeFile(wb, `expenses_${todayStr()}.xlsx`);
    showToast("Expenses exported ✓");
  };

  const exportAll = () => {
    if (!db.sales.length && !db.expenses.length) {
      showToast("No data to export", "error");
      return;
    }
    const wb = XLSX.utils.book_new();
    if (db.sales.length) {
      const salesData = db.sales.map(s => ({
        Date: s.date,
        Service: DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service,
        Amount: s.amount,
        Notes: s.note || "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesData), "Sales");
    }
    if (db.expenses.length) {
      const expenseData = db.expenses.map(e => ({
        Date: e.date,
        Category: e.category,
        Item: e.item,
        Cost: e.cost,
        Notes: e.note || "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseData), "Expenses");
    }
    XLSX.writeFile(wb, `report_${todayStr()}.xlsx`);
    showToast("Report exported ✓");
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 8px 0", fontSize: 36, fontWeight: 700, color: "#2A2D40", fontFamily: "'Playfair Display'" }}>Reports</h1>
      <p style={{ margin: "0 0 28px 0", color: "#A0A0A0", fontSize: 14 }}>Export your data and generate reports.</p>

      <div style={{ background: "#fff", padding: 28, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        <h3 style={{ margin: "0 0 20px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Export Options</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <ExportButton label="📊 Export Sales" onClick={exportSales} />
          <ExportButton label="📉 Export Expenses" onClick={exportExpenses} color="#E07A5F" />
          <ExportButton label="📄 Export Full Report" onClick={exportAll} color="#3D405B" />
        </div>
      </div>
    </div>
  );
}

function ExportButton({ label, onClick, color = "#81B29A" }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "14px 20px", background: color, color: "#fff", border: "none", borderRadius: 8,
        cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s", textAlign: "center",
      }}
      onMouseEnter={e => e.target.style.opacity = "0.9"}
      onMouseLeave={e => e.target.style.opacity = "1"}
    >
      {label}
    </button>
  );
}

// ============ USERS PAGE ============
function UsersPage({ db, refresh, showToast }) {
  const [deleting, setDeleting] = useState(null);

  const deleteUser = async (id) => {
    setDeleting(id);
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (!error) {
      showToast("User deleted");
      refresh();
    } else {
      showToast("Error deleting user", "error");
    }
    setDeleting(null);
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 8px 0", fontSize: 36, fontWeight: 700, color: "#2A2D40", fontFamily: "'Playfair Display'" }}>Users</h1>
      <p style={{ margin: "0 0 28px 0", color: "#A0A0A0", fontSize: 14 }}>Manage team members and their access.</p>

      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #E0E0E0", background: "#F7F5F0" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2A2D40" }}>{db.users.length} Users</h3>
        </div>
        {db.users.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F7F5F0", borderBottom: "2px solid #E0E0E0" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Email</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Role</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Joined</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {db.users.map((u, idx) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #E0E0E0", background: idx % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#2A2D40", fontWeight: 500 }}>{u.email}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        display: "inline-block", padding: "4px 10px",
                        background: u.role === "owner" ? "rgba(129,178,154,0.15)" : "rgba(212,165,116,0.15)",
                        color: u.role === "owner" ? "#81B29A" : "#D4A574",
                        borderRadius: 5, fontWeight: 500, fontSize: 12, textTransform: "capitalize",
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#A0A0A0" }}>{formatDate(u.created_at)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <button
                        onClick={() => deleteUser(u.id)}
                        disabled={deleting === u.id}
                        style={{
                          padding: "6px 10px", background: deleting === u.id ? "#ddd" : "#E07A5F", color: "#fff",
                          border: "none", borderRadius: 5, cursor: deleting === u.id ? "not-allowed" : "pointer", fontSize: 12,
                          fontWeight: 500, transition: "all 0.2s",
                        }}
                        onMouseEnter={e => deleting !== u.id && (e.target.style.background = "#D96949")}
                        onMouseLeave={e => deleting !== u.id && (e.target.style.background = "#E07A5F")}
                      >
                        {deleting === u.id ? "..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ padding: 32, margin: 0, color: "#A0A0A0", textAlign: "center", fontSize: 14 }}>No users yet</p>
        )}
      </div>
    </div>
  );
}

// ============ MODALS ============
function AddServiceModal({ onClose, db, setDb, showToast }) {
  const [form, setForm] = useState({ name: "", color: "#F2CC8F" });

  const submit = () => {
    if (!form.name.trim()) {
      showToast("Service name required", "error");
      return;
    }
    const newService = {
      id: form.name.toLowerCase().replace(/\s+/g, "-"),
      name: form.name,
      color: form.color,
    };
    setDb(prev => ({ ...prev, services: [...prev.services, newService] }));
    showToast("Service added ✓");
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "#fff", padding: 32, borderRadius: 12, maxWidth: 400, width: "100%", boxShadow: "0 20px 25px rgba(0,0,0,0.1)" }}>
        <h2 style={{ margin: "0 0 20px 0", fontSize: 20, fontWeight: 700, color: "#2A2D40" }}>Add Service</h2>
        <FormField label="Service Name">
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g., ATV Tours"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13 }}
          />
        </FormField>
        <FormField label="Color">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#D4A574", "#9B7653"].map(color => (
              <button
                key={color}
                onClick={() => setForm(f => ({ ...f, color }))}
                style={{
                  width: 40, height: 40, background: color, border: form.color === color ? "3px solid #2A2D40" : "2px solid #E0E0E0",
                  borderRadius: 6, cursor: "pointer", transition: "all 0.2s",
                }}
              />
            ))}
          </div>
        </FormField>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "10px", background: "#E0E0E0", color: "#666", border: "none", borderRadius: 6,
              cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            style={{
              flex: 1, padding: "10px", background: "#81B29A", color: "#fff", border: "none", borderRadius: 6,
              cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}
          >
            Add Service
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ FORM FIELD ============
function FormField({ label, children, type = "text" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ============ UTILITIES ============
function getServiceColor(serviceId, opacity = 1) {
  const service = DEFAULT_SERVICES.find(s => s.id === serviceId);
  if (!service) return "#999";
  if (opacity === 1) return service.color;
  const hex = service.color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function groupByDate(items, dateField) {
  const grouped = {};
  items.forEach(item => {
    const date = item[dateField];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(item);
  });
  return Object.entries(grouped);
}