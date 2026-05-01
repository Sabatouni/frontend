import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

const COLORS = ["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#D4A574", "#9B7653", "#C6B8A8", "#7A8B8B", "#B5A89E"];

const todayStr = () => new Date().toISOString().split("T")[0];
const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`;
const formatDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function App() {
  const { user, logout, isAdmin } = useAuth();

  const [db, setDb] = useState({ sales: [], expenses: [] });
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data: sales } = await supabase.from("sales").select("*").order("date", { ascending: false });
      const { data: expenses } = await supabase.from("expenses").select("*").order("date", { ascending: false });

      setDb({
        sales: (sales || []).map(s => ({ ...s, amount: Number(s.amount) })),
        expenses: (expenses || []).map(e => ({ ...e, cost: Number(e.cost) })),
      });
    } catch (err) {
      showToast("Error fetching data", "error");
    } finally {
      setLoading(false);
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
    <div style={{ display: "flex", height: "100vh", background: "#F7F5F0", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <Sidebar user={user} logout={logout} setPage={setPage} isAdmin={isAdmin} page={page} />

      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        {page === "dashboard" && <Dashboard db={db} />}
        {page === "sales" && <SalesPage db={db} refresh={fetchAll} showToast={showToast} loading={loading} />}
        {page === "expenses" && <ExpensesPage db={db} refresh={fetchAll} showToast={showToast} loading={loading} />}
        {page === "reports" && isAdmin && <ReportsPage db={db} showToast={showToast} />}
      </main>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20,
          background: toast.type === "success" ? "#81B29A" : "#E07A5F",
          color: "#fff", padding: "12px 20px", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", fontSize: 14, fontWeight: 500,
          animation: "slideIn 0.3s ease-out",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ============ SIDEBAR ============
function Sidebar({ user, logout, setPage, isAdmin, page }) {
  const pages = isAdmin
    ? ["dashboard", "sales", "expenses", "reports"]
    : ["dashboard", "sales", "expenses"];

  const labels = {
    dashboard: "📊 Dashboard",
    sales: "💰 Sales",
    expenses: "📉 Expenses",
    reports: "📄 Reports",
  };

  return (
    <aside style={{
      width: 220, background: "#2A2D40", color: "#fff", padding: 20, display: "flex", flexDirection: "column",
      boxShadow: "0 0 20px rgba(0,0,0,0.1)", overflowY: "auto",
    }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 24, fontWeight: 700 }}>🏕️ Swahili</h2>
      <p style={{ margin: "0 0 24px 0", fontSize: 12, color: "#A0A0A0", fontWeight: 500 }}>Tent Village POS</p>

      <nav style={{ flex: 1 }}>
        {pages.map(p => (
          <button
            key={p}
            onClick={() => setPage(p)}
            style={{
              width: "100%", padding: "10px 12px", margin: "8px 0", border: "none", background: page === p ? "rgba(255,255,255,0.2)" : "transparent",
              color: page === p ? "#fff" : "#A0A0A0", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: page === p ? 600 : 400,
              transition: "all 0.2s", textAlign: "left",
            }}
            onMouseEnter={(e) => !page === p && (e.target.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={(e) => !page === p && (e.target.style.background = "transparent")}
          >
            {labels[p]}
          </button>
        ))}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
        <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "#A0A0A0", textTransform: "uppercase", fontWeight: 500 }}>Account</p>
        <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#fff" }}>{user?.email || "User"}</p>
        {isAdmin && <p style={{ margin: "0 0 12px 0", fontSize: 11, background: "rgba(129,178,154,0.3)", padding: "4px 8px", borderRadius: 4, color: "#81B29A", fontWeight: 500, display: "inline-block" }}>Admin</p>}
        <button
          onClick={logout}
          style={{
            width: "100%", padding: "8px 12px", margin: "12px 0 0 0", border: "none", background: "rgba(224,122,95,0.2)",
            color: "#E07A5F", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.2s",
          }}
          onMouseEnter={(e) => e.target.style.background = "rgba(224,122,95,0.35)"}
          onMouseLeave={(e) => e.target.style.background = "rgba(224,122,95,0.2)"}
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
  const salesCount = db.sales.length;
  const expenseCount = db.expenses.length;

  // Chart data
  const salesByService = DEFAULT_SERVICES.map(s => ({
    name: s.name,
    value: db.sales.filter(x => x.service === s.id).reduce((a, b) => a + b.amount, 0),
    color: s.color,
  })).filter(x => x.value > 0);

  const expensesByCategory = EXPENSE_CATS.map((cat, idx) => ({
    name: cat,
    value: db.expenses.filter(x => x.category === cat).reduce((a, b) => a + b.cost, 0),
    color: COLORS[idx % COLORS.length],
  })).filter(x => x.value > 0);

  const dailySales = groupByDate(db.sales, "date").map(([date, items]) => ({
    date: formatDate(date),
    amount: items.reduce((a, b) => a + b.amount, 0),
  })).slice(-7);

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0", fontSize: 32, fontWeight: 700, color: "#2A2D40" }}>Dashboard</h1>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Revenue" value={TZS(totalSales)} icon="💰" color="#81B29A" />
        <StatCard label="Total Expenses" value={TZS(totalExp)} icon="📉" color="#E07A5F" />
        <StatCard label="Profit" value={TZS(profit)} icon={profit >= 0 ? "📈" : "📉"} color={profit >= 0 ? "#81B29A" : "#E07A5F"} />
        <StatCard label="Transactions" value={salesCount + expenseCount} icon="📊" color="#3D405B" />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {/* Sales by Service */}
        <div style={{ background: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Sales by Service</h3>
          {salesByService.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={salesByService} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${TZS(value)}`} outerRadius={80} fill="#8884d8" dataKey="value">
                  {salesByService.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => TZS(value)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", margin: 0 }}>No sales data</p>
          )}
        </div>

        {/* Daily Sales Trend */}
        <div style={{ background: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Daily Sales (7 days)</h3>
          {dailySales.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dailySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => TZS(value)} />
                <Bar dataKey="amount" fill="#81B29A" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", margin: 0 }}>No sales data</p>
          )}
        </div>

        {/* Expenses by Category */}
        <div style={{ background: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600, color: "#2A2D40" }}>Expenses by Category</h3>
          {expensesByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={expensesByCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" width={100} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => TZS(value)} />
                <Bar dataKey="value" fill="#E07A5F" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: "#A0A0A0", margin: 0 }}>No expense data</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      background: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      borderLeft: `4px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: "#A0A0A0", fontWeight: 500, textTransform: "uppercase" }}>{label}</p>
        <h3 style={{ margin: "8px 0 0 0", fontSize: 24, fontWeight: 700, color: color }}>{value}</h3>
      </div>
      <span style={{ fontSize: 40 }}>{icon}</span>
    </div>
  );
}

// ============ SALES PAGE ============
function SalesPage({ db, refresh, showToast, loading }) {
  const [form, setForm] = useState({ service: "restaurant", amount: "", date: todayStr(), note: "" });
  const [deleting, setDeleting] = useState(null);

  const submit = async () => {
    if (!form.amount || isNaN(form.amount)) {
      showToast("Enter a valid amount", "error");
      return;
    }

    const res = await supabase.from("sales").insert([{ ...form, amount: Number(form.amount) }]);
    if (!res.error) {
      showToast("Sale added ✓");
      setForm({ service: "restaurant", amount: "", date: todayStr(), note: "" });
      refresh();
    } else {
      showToast("Error adding sale", "error");
    }
  };

  const deleteSale = async (id) => {
    setDeleting(id);
    const res = await supabase.from("sales").delete().eq("id", id);
    setDeleting(null);
    if (!res.error) {
      showToast("Sale deleted");
      refresh();
    } else {
      showToast("Error deleting sale", "error");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0", fontSize: 32, fontWeight: 700, color: "#2A2D40" }}>Sales</h1>

      {/* Form Card */}
      <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add Sale</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Service</label>
            <select
              value={form.service}
              onChange={(e) => setForm(f => ({ ...f, service: e.target.value }))}
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                background: "#fff", cursor: "pointer",
              }}
            >
              {DEFAULT_SERVICES.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Amount (TZS)</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="0"
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Note</label>
          <input
            type="text"
            value={form.note}
            onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
            onKeyPress={handleKeyPress}
            placeholder="Optional note"
            style={{
              width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          onClick={submit}
          style={{
            padding: "10px 24px", background: "#81B29A", color: "#fff", border: "none", borderRadius: 6,
            cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s",
          }}
          onMouseEnter={(e) => e.target.style.background = "#6FA085"}
          onMouseLeave={(e) => e.target.style.background = "#81B29A"}
        >
          Add Sale
        </button>
      </div>

      {/* Sales List */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #E0E0E0" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{db.sales.length} Total Sales</h3>
        </div>
        {db.sales.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F7F5F0", borderBottom: "2px solid #E0E0E0" }}>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Date</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Service</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Amount</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Note</th>
                  <th style={{ padding: 12, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#666" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {db.sales.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #E0E0E0", hover: { background: "#F7F5F0" } }}>
                    <td style={{ padding: 12, fontSize: 13 }}>{formatDate(s.date)}</td>
                    <td style={{ padding: 12, fontSize: 13 }}>
                      <span style={{ display: "inline-block", padding: "4px 8px", background: getServiceColor(s.service, 0.1), color: getServiceColor(s.service), borderRadius: 4, fontWeight: 500, fontSize: 12 }}>
                        {DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service}
                      </span>
                    </td>
                    <td style={{ padding: 12, fontSize: 13, fontWeight: 600, color: "#81B29A" }}>{TZS(s.amount)}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#A0A0A0" }}>{s.note || "—"}</td>
                    <td style={{ padding: 12, textAlign: "center" }}>
                      <button
                        onClick={() => deleteSale(s.id)}
                        disabled={deleting === s.id}
                        style={{
                          padding: "4px 8px", background: "#E07A5F", color: "#fff", border: "none", borderRadius: 4,
                          cursor: deleting === s.id ? "not-allowed" : "pointer", fontSize: 12, opacity: deleting === s.id ? 0.5 : 1,
                        }}
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
          <p style={{ padding: 20, margin: 0, color: "#A0A0A0", textAlign: "center" }}>No sales yet</p>
        )}
      </div>
    </div>
  );
}

// ============ EXPENSES PAGE ============
function ExpensesPage({ db, refresh, showToast, loading }) {
  const [form, setForm] = useState({ category: "Other", item: "", cost: "", date: todayStr(), note: "" });
  const [deleting, setDeleting] = useState(null);

  const submit = async () => {
    if (!form.cost || isNaN(form.cost) || !form.item) {
      showToast("Fill all required fields", "error");
      return;
    }

    const res = await supabase.from("expenses").insert([{
      ...form,
      cost: Number(form.cost),
    }]);
    if (!res.error) {
      showToast("Expense added ✓");
      setForm({ category: "Other", item: "", cost: "", date: todayStr(), note: "" });
      refresh();
    } else {
      showToast("Error adding expense", "error");
    }
  };

  const deleteExpense = async (id) => {
    setDeleting(id);
    const res = await supabase.from("expenses").delete().eq("id", id);
    setDeleting(null);
    if (!res.error) {
      showToast("Expense deleted");
      refresh();
    } else {
      showToast("Error deleting expense", "error");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0", fontSize: 32, fontWeight: 700, color: "#2A2D40" }}>Expenses</h1>

      {/* Form Card */}
      <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add Expense</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                background: "#fff", cursor: "pointer",
              }}
            >
              {EXPENSE_CATS.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Item</label>
            <input
              type="text"
              value={form.item}
              onChange={(e) => setForm(f => ({ ...f, item: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="e.g., Diesel"
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Cost (TZS)</label>
            <input
              type="number"
              value={form.cost}
              onChange={(e) => setForm(f => ({ ...f, cost: e.target.value }))}
              onKeyPress={handleKeyPress}
              placeholder="0"
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
              style={{
                width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 4 }}>Note</label>
          <input
            type="text"
            value={form.note}
            onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
            onKeyPress={handleKeyPress}
            placeholder="Optional note"
            style={{
              width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          onClick={submit}
          style={{
            padding: "10px 24px", background: "#E07A5F", color: "#fff", border: "none", borderRadius: 6,
            cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s",
          }}
          onMouseEnter={(e) => e.target.style.background = "#D96949"}
          onMouseLeave={(e) => e.target.style.background = "#E07A5F"}
        >
          Add Expense
        </button>
      </div>

      {/* Expenses List */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #E0E0E0" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{db.expenses.length} Total Expenses</h3>
        </div>
        {db.expenses.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F7F5F0", borderBottom: "2px solid #E0E0E0" }}>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Date</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Category</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Item</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Cost</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 600, color: "#666" }}>Note</th>
                  <th style={{ padding: 12, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#666" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {db.expenses.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #E0E0E0" }}>
                    <td style={{ padding: 12, fontSize: 13 }}>{formatDate(e.date)}</td>
                    <td style={{ padding: 12, fontSize: 13 }}>
                      <span style={{ display: "inline-block", padding: "4px 8px", background: "rgba(224,122,95,0.1)", color: "#E07A5F", borderRadius: 4, fontWeight: 500, fontSize: 12 }}>
                        {e.category || "Other"}
                      </span>
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>{e.item}</td>
                    <td style={{ padding: 12, fontSize: 13, fontWeight: 600, color: "#E07A5F" }}>{TZS(e.cost)}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#A0A0A0" }}>{e.note || "—"}</td>
                    <td style={{ padding: 12, textAlign: "center" }}>
                      <button
                        onClick={() => deleteExpense(e.id)}
                        disabled={deleting === e.id}
                        style={{
                          padding: "4px 8px", background: "#E07A5F", color: "#fff", border: "none", borderRadius: 4,
                          cursor: deleting === e.id ? "not-allowed" : "pointer", fontSize: 12, opacity: deleting === e.id ? 0.5 : 1,
                        }}
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
          <p style={{ padding: 20, margin: 0, color: "#A0A0A0", textAlign: "center" }}>No expenses yet</p>
        )}
      </div>
    </div>
  );
}

// ============ REPORTS PAGE ============
function ReportsPage({ db, showToast }) {
  const exportSales = () => {
    if (db.sales.length === 0) {
      showToast("No sales to export", "error");
      return;
    }

    const data = db.sales.map(s => ({
      Date: formatDate(s.date),
      Service: DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service,
      Amount: s.amount,
      Note: s.note || "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    XLSX.writeFile(wb, `sales_${todayStr()}.xlsx`);
    showToast("Sales exported ✓");
  };

  const exportExpenses = () => {
    if (db.expenses.length === 0) {
      showToast("No expenses to export", "error");
      return;
    }

    const data = db.expenses.map(e => ({
      Date: formatDate(e.date),
      Category: e.category,
      Item: e.item,
      Cost: e.cost,
      Note: e.note || "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");
    XLSX.writeFile(wb, `expenses_${todayStr()}.xlsx`);
    showToast("Expenses exported ✓");
  };

  const exportAll = () => {
    if (db.sales.length === 0 && db.expenses.length === 0) {
      showToast("No data to export", "error");
      return;
    }

    const wb = XLSX.utils.book_new();

    if (db.sales.length > 0) {
      const salesData = db.sales.map(s => ({
        Date: formatDate(s.date),
        Service: DEFAULT_SERVICES.find(x => x.id === s.service)?.name || s.service,
        Amount: s.amount,
        Note: s.note || "",
      }));
      const ws1 = XLSX.utils.json_to_sheet(salesData);
      XLSX.utils.book_append_sheet(wb, ws1, "Sales");
    }

    if (db.expenses.length > 0) {
      const expenseData = db.expenses.map(e => ({
        Date: formatDate(e.date),
        Category: e.category,
        Item: e.item,
        Cost: e.cost,
        Note: e.note || "",
      }));
      const ws2 = XLSX.utils.json_to_sheet(expenseData);
      XLSX.utils.book_append_sheet(wb, ws2, "Expenses");
    }

    XLSX.writeFile(wb, `report_${todayStr()}.xlsx`);
    showToast("Report exported ✓");
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0", fontSize: 32, fontWeight: 700, color: "#2A2D40" }}>Reports</h1>

      <div style={{ background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Export Data</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <button
            onClick={exportSales}
            style={{
              padding: "12px 20px", background: "#81B29A", color: "#fff", border: "none", borderRadius: 6,
              cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s",
            }}
            onMouseEnter={(e) => e.target.style.background = "#6FA085"}
            onMouseLeave={(e) => e.target.style.background = "#81B29A"}
          >
            📊 Export Sales
          </button>
          <button
            onClick={exportExpenses}
            style={{
              padding: "12px 20px", background: "#E07A5F", color: "#fff", border: "none", borderRadius: 6,
              cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s",
            }}
            onMouseEnter={(e) => e.target.style.background = "#D96949"}
            onMouseLeave={(e) => e.target.style.background = "#E07A5F"}
          >
            📉 Export Expenses
          </button>
          <button
            onClick={exportAll}
            style={{
              padding: "12px 20px", background: "#3D405B", color: "#fff", border: "none", borderRadius: 6,
              cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.2s",
            }}
            onMouseEnter={(e) => e.target.style.background = "#2A2D40"}
            onMouseLeave={(e) => e.target.style.background = "#3D405B"}
          >
            📄 Export All
          </button>
        </div>
      </div>
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