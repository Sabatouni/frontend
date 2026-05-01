import { useEffect, useState } from "react";
import {
  Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip
} from "recharts";
import * as XLSX from "xlsx";
import { supabase } from "./api/supabaseClient";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";

const LOGO = "/logo.png";

const todayStr = () => new Date().toISOString().split("T")[0];
const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`;

export default function App() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "owner";

  const [db, setDb] = useState({
    sales: [],
    expenses: [],
    services: [],
    users: []
  });

  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);

  const fetchAll = async () => {
    const { data: sales } = await supabase.from("sales").select("*").order("date", { ascending: false });
    const { data: expenses } = await supabase.from("expenses").select("*").order("date", { ascending: false });
    const { data: services } = await supabase.from("services").select("*");
    const { data: users } = await supabase.from("users").select("*");

    setDb({
      sales: sales || [],
      expenses: expenses || [],
      services: services || [],
      users: users || []
    });
  };

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const handler = () => setShowAddServiceModal(true);
    window.addEventListener("openAddService", handler);
    return () => window.removeEventListener("openAddService", handler);
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!user) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#F7F5F0", fontFamily: "'DM Sans', sans-serif" }}>

      {/* SIDEBAR */}
      <aside style={{
        width: 240,
        background: "#2A2D40",
        color: "#fff",
        padding: 20,
        display: "flex",
        flexDirection: "column"
      }}>
        <img src={LOGO} style={{ width: "100%", marginBottom: 20 }} />

        {[
          { id: "dashboard", label: "📊 Dashboard" },
          { id: "sales", label: "💰 Sales" },
          { id: "expenses", label: "🧾 Expenses" },
          { id: "reports", label: "📈 Reports" }
        ].map(item => (
          <button key={item.id}
            onClick={() => setPage(item.id)}
            style={{
              width: "100%",
              padding: "12px 14px",
              marginBottom: 8,
              background: page === item.id ? "#3D405B" : "transparent",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              textAlign: "left",
              fontWeight: page === item.id ? 600 : 400
            }}>
            {item.label}
          </button>
        ))}

        {isAdmin && (
          <button onClick={() => setPage("users")}
            style={{ marginTop: 6 }}>
            👥 Users
          </button>
        )}

        <button onClick={logout} style={{ marginTop: "auto" }}>
          Logout
        </button>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, padding: 28, overflowY: "auto" }}>
        {page === "dashboard" && <Dashboard db={db} />}
        {page === "sales" && <SalesPage db={db} refresh={fetchAll} showToast={showToast} isAdmin={isAdmin} />}
        {page === "expenses" && <ExpensesPage />}
        {page === "reports" && isAdmin && <ReportsPage db={db} showToast={showToast} />}
        {page === "users" && isAdmin && <UsersPage db={db} />}
      </main>

      {showAddServiceModal && (
        <AddServiceModal
          onClose={() => setShowAddServiceModal(false)}
          showToast={showToast}
          refresh={fetchAll}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          background: "#81B29A",
          color: "#fff",
          padding: "12px 18px",
          borderRadius: 10
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ================= DASHBOARD ================= */

function Dashboard({ db }) {
  const totalSales = db.sales.reduce((a, b) => a + Number(b.amount), 0);
  const totalExp = db.expenses.reduce((a, b) => a + Number(b.cost), 0);

  const data = db.services.map(s => ({
    name: s.name,
    value: db.sales.filter(x => x.service === s.id).reduce((a, b) => a + Number(b.amount), 0),
    color: s.color
  })).filter(x => x.value > 0);

  return (
    <div>
      <h1 style={{ fontSize: 28, marginBottom: 20 }}>Overview</h1>

      <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
        <StatCard label="Revenue" value={TZS(totalSales)} color="#81B29A" />
        <StatCard label="Expenses" value={TZS(totalExp)} color="#E07A5F" />
        <StatCard label="Profit" value={TZS(totalSales - totalExp)} color="#3D405B" />
      </div>

      <div style={{ background: "#fff", padding: 20, borderRadius: 16 }}>
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

function StatCard({ label, value, color }) {
  return (
    <div style={{
      flex: 1,
      background: "#fff",
      padding: 20,
      borderRadius: 16,
      borderTop: `4px solid ${color}`
    }}>
      <div style={{ color: "#888", fontSize: 12 }}>{label}</div>
      <h2>{value}</h2>
    </div>
  );
}

/* ================= SALES ================= */

function SalesPage({ db, refresh, showToast, isAdmin }) {
  const [form, setForm] = useState({
    service: "",
    amount: "",
    date: todayStr(),
    note: ""
  });

  const submit = async () => {
    if (!form.amount) return;

    await supabase.from("sales").insert([{
      ...form,
      amount: Number(form.amount)
    }]);

    showToast("Sale added");
    refresh();
  };

  return (
    <div>
      <h1 style={{ fontSize: 28 }}>Sales</h1>

      {isAdmin && (
        <button onClick={() => window.dispatchEvent(new Event("openAddService"))}>
          ➕ Add Service
        </button>
      )}

      {/* SERVICE BUTTONS */}
      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        {db.services.map(s => (
          <button key={s.id}
            onClick={() => setForm(f => ({ ...f, service: s.id }))}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              background: form.service === s.id ? s.color : "#fff",
              color: form.service === s.id ? "#fff" : "#555",
              border: "2px solid #ddd"
            }}>
            {s.name}
          </button>
        ))}
      </div>

      <input placeholder="Amount"
        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />

      <button onClick={submit}>Save</button>
    </div>
  );
}

/* ================= REPORTS ================= */

function ReportsPage({ db, showToast }) {
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(db.sales), "Sales");
    XLSX.writeFile(wb, "report.xlsx");
    showToast("Exported");
  };

  return (
    <div>
      <h1>Reports</h1>
      <button onClick={exportExcel}>Export Excel</button>
    </div>
  );
}

/* ================= USERS ================= */

function UsersPage({ db }) {
  return <div><h1>Users ({db.users.length})</h1></div>;
}

/* ================= ADD SERVICE ================= */

function AddServiceModal({ onClose, showToast, refresh }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#81B29A");

  const submit = async () => {
    await supabase.from("services").insert([{
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      color
    }]);

    showToast("Service added");
    refresh();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0005", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div style={{ background: "#fff", padding: 24, borderRadius: 16 }}>
        <input placeholder="Service name" onChange={e => setName(e.target.value)} />
        <button onClick={submit}>Add</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}