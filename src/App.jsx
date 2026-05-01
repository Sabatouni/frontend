import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import { supabase } from "./supabaseClient";

const LOGO = "/logo.png";

const DEFAULT_SERVICES = [
  { id: "restaurant", name: "Restaurant", color: "#E07A5F" },
  { id: "gokart", name: "Go Kart", color: "#3D405B" },
  { id: "paintball", name: "Paintball", color: "#81B29A" },
  { id: "entry", name: "Park Entry", color: "#F2CC8F" },
];

const EXPENSE_CATS = [
  "Restaurant","Go Kart","Paintball","Park Entry",
  "Utilities","Staff","Maintenance","Marketing","Other",
];

const todayStr = () => new Date().toISOString().split("T")[0];
const TZS = (n) => `TZS ${Number(n).toLocaleString()}`;

export default function App() {
  const { user, logout, isAdmin } = useAuth();

  const [db, setDb] = useState({ sales: [], expenses: [] });
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);

  // FETCH DATA
  const fetchAll = async () => {
    if (!supabase) return;

    const { data: sales } = await supabase.from("sales").select("*");
    const { data: expenses } = await supabase.from("expenses").select("*");

    setDb({
      sales: (sales || []).map(s => ({ ...s, amount: Number(s.amount) })),
      expenses: (expenses || []).map(e => ({ ...e, cost: Number(e.cost) })),
    });
  };

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, []);

  const showToast = (msg, type="success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!user) return <Login />;

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F7F5F0" }}>
      <Sidebar user={user} logout={logout} setPage={setPage} />

      <main style={{ flex:1, padding:24 }}>
        {page==="dashboard" && <Dashboard db={db} />}
        {page==="sales" && <Sales db={db} refresh={fetchAll} showToast={showToast} />}
        {page==="expenses" && <Expenses db={db} refresh={fetchAll} showToast={showToast} />}
        {page==="reports" && isAdmin && <Reports db={db} />}
      </main>

      {toast && (
        <div style={{
          position:"fixed", bottom:20, right:20,
          background: toast.type==="success" ? "#81B29A" : "#E07A5F",
          color:"#fff", padding:12, borderRadius:10
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// SIDEBAR
function Sidebar({ user, logout, setPage }) {
  return (
    <aside style={{ width:200, background:"#2A2D40", color:"#fff", padding:20 }}>
      <h2>🏕️ Swahili</h2>
      <button onClick={()=>setPage("dashboard")}>Dashboard</button>
      <button onClick={()=>setPage("sales")}>Sales</button>
      <button onClick={()=>setPage("expenses")}>Expenses</button>
      <button onClick={()=>setPage("reports")}>Reports</button>
      <hr/>
      <button onClick={logout}>Logout</button>
    </aside>
  );
}

// DASHBOARD
function Dashboard({ db }) {
  const totalSales = db.sales.reduce((a,b)=>a+b.amount,0);
  const totalExp = db.expenses.reduce((a,b)=>a+b.cost,0);
  const profit = totalSales-totalExp;

  return (
    <div>
      <h1>Dashboard</h1>
      <h2>{TZS(profit)} {profit>=0?"📈":"📉"}</h2>
    </div>
  );
}

// SALES
function Sales({ db, refresh, showToast }) {
  const [form,setForm]=useState({ service:"Restaurant", amount:"", date:todayStr(), note:"" });

  const submit = async () => {
    await supabase.from("sales").insert([{
      ...form,
      amount:Number(form.amount)
    }]);
    showToast("Sale added");
    refresh();
  };

  return (
    <div>
      <h1>Sales</h1>
      <input placeholder="Amount" onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
      <input placeholder="Note" onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
      <button onClick={submit}>Add</button>

      {db.sales.map(s=>(
        <div key={s.id}>{s.amount} - {s.note}</div>
      ))}
    </div>
  );
}

// EXPENSES
function Expenses({ db, refresh, showToast }) {
  const [form,setForm]=useState({ item:"", cost:"", date:todayStr(), note:"" });

  const submit = async () => {
    await supabase.from("expenses").insert([{
      ...form,
      cost:Number(form.cost)
    }]);
    showToast("Expense added");
    refresh();
  };

  return (
    <div>
      <h1>Expenses</h1>
      <input placeholder="Item" onChange={e=>setForm(f=>({...f,item:e.target.value}))}/>
      <input placeholder="Cost" onChange={e=>setForm(f=>({...f,cost:e.target.value}))}/>
      <input placeholder="Note" onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
      <button onClick={submit}>Add</button>

      {db.expenses.map(e=>(
        <div key={e.id}>{e.cost} - {e.note}</div>
      ))}
    </div>
  );
}

// REPORTS + EXCEL
function Reports({ db }) {
  const exportExcel = () => {
    const data = db.sales.map(s => ({
      Date: s.date,
      Service: s.service,
      Amount: s.amount,
      Note: s.note
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    XLSX.writeFile(wb, "report.xlsx");
  };

  return (
    <div>
      <h1>Reports</h1>
      <button onClick={exportExcel}>Export Excel</button>
    </div>
  );
}