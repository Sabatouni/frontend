import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import api from "./client";
import { supabase } from "./supabaseClient";

const LOGO = "/logo.png";

const DEFAULT_SERVICES = [
  { id: "restaurant", name: "Restaurant", color: "#E07A5F", emoji: "🍽️" },
  { id: "gokart",     name: "Go Kart",    color: "#3D405B", emoji: "🏎️" },
  { id: "paintball",  name: "Paintball",  color: "#81B29A", emoji: "🎯" },
  { id: "entry",      name: "Park Entry", color: "#F2CC8F", emoji: "🎟️" },
];

const EXPENSE_CATS = [
  "Restaurant","Go Kart","Paintball","Park Entry",
  "Utilities","Staff","Maintenance","Marketing","Other",
];

const ROLES = { WORKER: "worker", OWNER: "owner" };

function getStoredUsers() {
  try {
    const raw = localStorage.getItem("swahili_users");
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    admin:  { password: "admin123",  role: ROLES.OWNER,  name: "Owner"  },
    worker: { password: "worker123", role: ROLES.WORKER, name: "Worker" },
  };
}

function saveStoredUsers(users) {
  try { localStorage.setItem("swahili_users", JSON.stringify(users)); } catch {}
}

const TZS      = (n) => `TZS ${Number(n).toLocaleString()}`;
const todayStr = ()  => new Date().toISOString().split("T")[0];
const PALETTE  = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#9C89B8","#F0A500","#00B4D8","#E63946"];

// ── APP ───────────────────────────────────────────────────────
export default function App() {
  const [users,       setUsers]       = useState(() => getStoredUsers());
  const [user,        setUser]        = useState(null);
  const [services,    setServices]    = useState(DEFAULT_SERVICES);
  const [page,        setPage]        = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast,       setToast]       = useState(null);
  const [db, setDb] = useState({ sales: [], expenses: [] });

  // ── SUPABASE SALES FETCH ────────────────────────────────────
  const fetchSales = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("date", { ascending: false });

      if (error) {
        console.error("Supabase fetch error:", error);
        return;
      }

      const salesWithDateStrings = (data || []).map(sale => ({
        ...sale,
        date: new Date(sale.date).toISOString().split("T")[0]
      }));

      setDb(prev => ({ ...prev, sales: salesWithDateStrings }));
    } catch (err) {
      console.error("Sales fetch error:", err);
    }
  };

  // ── API POLLING (EXPENSES & USERS ONLY) ─────────────────────
  useEffect(() => {
    const fetchExpensesAndUsers = () => {
      Promise.all([
        api.get("/api/expenses"),
        api.get("/api/users").catch(() => ({ data: null })),
      ])
        .then(([expensesRes, usersRes]) => {
          setDb(prev => ({
            ...prev,
            expenses: (expensesRes.data || []).map(e => ({ ...e, deleted: false })),
          }));

          if (usersRes?.data && Array.isArray(usersRes.data)) {
            const backendUsers = {};
            usersRes.data.forEach(u => {
              if (u.username && u.role) {
                backendUsers[u.username] = {
                  role:     u.role,
                  name:     u.name || u.username,
                  password: u.password || "",
                };
              }
            });
            if (Object.keys(backendUsers).length > 0) {
              setUsers(prev => ({ ...prev, ...backendUsers }));
            }
          }
        })
        .catch(err => console.error("API sync error:", err));
    };

    fetchSales();
    fetchExpensesAndUsers();
    const interval = setInterval(fetchExpensesAndUsers, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── UPDATE DB (EXPENSES ONLY) ───────────────────────────────
  const updateDb = (updater) => {
    setDb(prev => {
      const updated = typeof updater === "function" ? updater(prev) : updater;
      const prevExpenses = prev.expenses || [];
      const newExpenses  = updated.expenses || [];

      const addedExpenses = newExpenses.filter(
        e => !prevExpenses.some(p => p.id === e.id)
      );
      addedExpenses.forEach(exp => {
        api.post("/api/expenses", exp)
          .catch(err => console.error("Expense POST error:", err));
      });

      const deletedExpenses = newExpenses.filter(
        e => e.deleted && !prevExpenses.find(p => p.id === e.id)?.deleted
      );
      deletedExpenses.forEach(exp => {
        api.delete(`/api/expenses/${exp.id}`)
          .catch(err => console.error("Expense DELETE error:", err));
      });

      return updated;
    });
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const addService = (newSvc) => {
    setServices(prev => [...prev, newSvc]);
    showToast(`"${newSvc.name}" added ✓`);
  };

  const addUser = (newUser) => {
    const updated = {
      ...users,
      [newUser.username]: {
        password: newUser.password,
        role:     newUser.role,
        name:     newUser.name || newUser.username,
      },
    };
    setUsers(updated);
    saveStoredUsers(updated);
    api.post("/api/users", {
      username: newUser.username,
      password: newUser.password,
      role:     newUser.role,
      name:     newUser.name || newUser.username,
    }).catch(err => console.warn("User backend sync skipped:", err.message));
    showToast(`User "${newUser.username}" created ✓`);
  };

  if (!user) return <Login users={users} onLogin={setUser} />;

  const visibleDb = {
    sales:    db.sales,
    expenses: db.expenses.filter(e => !e.deleted),
  };

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"'DM Sans', sans-serif", background:"#F7F5F0", overflow:"hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
      <Sidebar page={page} setPage={setPage} user={user} onLogout={() => { setUser(null); setPage("dashboard"); }} open={sidebarOpen} />
      <main style={{ flex:1, overflow:"auto", padding:"24px 28px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, padding:4, color:"#555" }}>☰</button>
          <div style={{ fontSize:13, color:"#999" }}>{new Date().toLocaleDateString("en-US",{ weekday:"long", year:"numeric", month:"long", day:"numeric" })}</div>
        </div>
        {page === "dashboard" && user.role === ROLES.OWNER  && <Dashboard db={visibleDb} services={services} />}
        {page === "dashboard" && user.role === ROLES.WORKER && <WorkerHome db={visibleDb} user={user} setPage={setPage} />}
        {page === "sales"     && <SalesPage db={visibleDb} user={user} showToast={showToast} services={services} addService={addService} fetchSales={fetchSales} />}
        {page === "expenses"  && <ExpensesPage db={db} visibleDb={visibleDb} updateDb={updateDb} user={user} showToast={showToast} />}
        {page === "reports"   && user.role === ROLES.OWNER && <ReportsPage db={visibleDb} services={services} />}
        {page === "users"     && user.role === ROLES.OWNER && <UsersPage users={users} onAddUser={addUser} showToast={showToast} />}
      </main>
      {toast && (
        <div style={{ position:"fixed", bottom:28, right:28, zIndex:9999, background: toast.type==="success" ? "#81B29A" : "#E07A5F", color:"#fff", padding:"13px 22px", borderRadius:12, fontWeight:600, fontSize:14, boxShadow:"0 8px 28px rgba(0,0,0,0.18)" }}>
          {toast.msg}
        </div>
      )}
      <style>{`* { box-sizing:border-box; } ::-webkit-scrollbar { width:5px; } ::-webkit-scrollbar-thumb { background:#D4CFC7; border-radius:3px; }`}</style>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────
function Login({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");

  const handle = async () => {
    const u = users[username];
    if (u && u.password === password) {
      try {
        const res   = await api.post("/api/auth/login", { username, password });
        const token = res.data?.token || res.data?.accessToken || res.data?.jwt;
        if (token) localStorage.setItem("jwt_token", token);
      } catch (e) {
        console.warn("Backend auth unavailable, using local only:", e.message);
      }
      onLogin({ username, ...u });
    } else {
      setError("Invalid credentials.");
    }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(145deg, #1a1c2b 0%, #2f3347 50%, #3a2e1e 100%)", fontFamily:"'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />
      <div style={{ background:"#fff", borderRadius:24, padding:"44px 40px", width:400, boxShadow:"0 32px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <img src={LOGO} alt="Swahili Tent Village" style={{ width:200, height:"auto", marginBottom:4, mixBlendMode:"multiply" }} />
          <p style={{ margin:"4px 0 0", color:"#888", fontSize:13, letterSpacing:1 }}>POINT OF SALE</p>
        </div>
        <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} style={iS} />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} style={{ ...iS, marginTop:10 }} />
        {error && <p style={{ color:"#E07A5F", fontSize:13, marginTop:6 }}>{error}</p>}
        <button onClick={handle} style={{ width:"100%", marginTop:20, padding:"15px", background:"#3D405B", color:"#fff", border:"none", borderRadius:12, fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans', sans-serif" }}>
          Sign In
        </button>
      </div>
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────
function Sidebar({ page, setPage, user, onLogout, open }) {
  const isOwner = user.role === ROLES.OWNER;
  const nav = isOwner
    ? [
        { id:"dashboard", label:"Dashboard", icon:"📊" },
        { id:"sales",     label:"Sales",     icon:"💰" },
        { id:"expenses",  label:"Expenses",  icon:"🧾" },
        { id:"reports",   label:"Reports",   icon:"📈" },
        { id:"users",     label:"Users",     icon:"👥" },
      ]
    : [
        { id:"dashboard", label:"Home",        icon:"🏠" },
        { id:"sales",     label:"Add Sale",    icon:"💰" },
        { id:"expenses",  label:"Add Expense", icon:"🧾" },
      ];

  return (
    <aside style={{ width:open?232:66, minWidth:open?232:66, background:"#2A2D40", color:"#fff", display:"flex", flexDirection:"column", transition:"width .3s,min-width .3s", overflow:"hidden" }}>
      <div style={{ padding:open?"22px 16px 12px":"22px 10px 12px", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:6, borderBottom:"1px solid #3D405B" }}>
        <img src={LOGO} alt="logo" style={{ width:open?110:42, height:"auto", transition:"width .3s", objectFit:"contain", mixBlendMode:"screen" }} />
        {open && <div style={{ fontSize:10, color:"#8B8FA8", textAlign:"center", marginTop:2 }}>{isOwner ? "Owner Dashboard" : "Worker Panel"}</div>}
      </div>
      <nav style={{ flex:1, padding:"8px 10px" }}>
        {nav.map(item => (
          <button key={item.id} onClick={() => setPage(item.id)} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:open?"11px 14px":"11px 7px", marginBottom:3, borderRadius:10, border:"none", cursor:"pointer", background:page===item.id?"#3D405B":"transparent", color:page===item.id?"#fff":"#9B9EC0", fontSize:13, fontWeight:page===item.id?600:400, fontFamily:"'DM Sans',sans-serif", transition:"background .15s" }}>
            <span style={{ fontSize:17, flexShrink:0 }}>{item.icon}</span>
            {open && item.label}
          </button>
        ))}
      </nav>
      <div style={{ padding:"14px 10px", borderTop:"1px solid #3D405B" }}>
        {open && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, padding:"0 4px" }}>
            <div style={{ width:32, height:32, borderRadius:"50%", background:"#3D405B", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, flexShrink:0 }}>
              {user.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:600 }}>{user.name}</div>
              <div style={{ fontSize:10, color:"#8B8FA8", textTransform:"uppercase" }}>{user.role}</div>
            </div>
          </div>
        )}
        <button onClick={onLogout} style={{ width:"100%", padding:"9px 14px", borderRadius:9, border:"none", background:"#E07A5F22", color:"#E07A5F", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:12, display:"flex", alignItems:"center", gap:8, justifyContent:open?"flex-start":"center" }}>
          <span>🚪</span>{open && "Sign Out"}
        </button>
      </div>
    </aside>
  );
}

// ── STAT CARD ──────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:"#fff", borderRadius:18, padding:"22px 20px", boxShadow:"0 2px 10px rgba(0,0,0,0.06)", flex:1, minWidth:0, borderTop:`4px solid ${color}` }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>{label}</span>
        <span style={{ fontSize:22 }}>{icon}</span>
      </div>
      <div style={{ fontSize:21, fontWeight:700, color:"#2A2D40", fontFamily:"'Playfair Display',serif" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"#aaa", marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ── SERVICE BADGE ──────────────────────────────────────────────
function ServiceBadge({ service, services }) {
  const svc   = services ? services.find(s => s.name === service) : null;
  const color = svc ? svc.color : "#aaa";
  return (
    <span style={{ background:`${color}22`, color, border:`1px solid ${color}44`, padding:"3px 9px", borderRadius:6, fontSize:11, fontWeight:600 }}>
      {service}
    </span>
  );
}

// ── CONFIRM DELETE MODAL ───────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onCancel}>
      <div style={{ background:"#fff", borderRadius:18, padding:"32px 28px", width:340, boxShadow:"0 20px 60px rgba(0,0,0,0.25)", textAlign:"center" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:36, marginBottom:14 }}>🗑️</div>
        <p style={{ margin:"0 0 24px", color:"#2A2D40", fontSize:14, lineHeight:1.6 }}>{message}</p>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onCancel}  style={{ flex:1, padding:"12px", borderRadius:10, border:"2px solid #E8E4DF", background:"#fff",     color:"#555", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex:1, padding:"12px", borderRadius:10, border:"none",             background:"#E07A5F", color:"#fff", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── ADD SERVICE MODAL ──────────────────────────────────────────
function AddServiceModal({ onAdd, onClose, existing }) {
  const [name,  setName]  = useState("");
  const [emoji, setEmoji] = useState("🏕️");
  const [color, setColor] = useState(PALETTE[existing.length % PALETTE.length]);
  const [err,   setErr]   = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr("Service name required."); return; }
    if (existing.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) { setErr("A service with this name already exists."); return; }
    onAdd({ id: `${trimmed.toLowerCase().replace(/\s+/g,"-")}-${Date.now()}`, name: trimmed, color, emoji });
    onClose();
  };

  const emojis = ["🏕️","🎯","🏎️","🎟️","🍽️","🎪","🌊","🎭","🎨","🏊","🚵","🧗","🎣","🏄","🌿"];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:20, padding:"36px 32px", width:380, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin:"0 0 24px", fontFamily:"'Playfair Display',serif", fontSize:20, color:"#2A2D40" }}>Add New Service</h3>
        <label style={lS}>Service Name</label>
        <input placeholder="e.g. Swimming Pool" value={name} onChange={e => { setName(e.target.value); setErr(""); }} style={{ ...iS, marginBottom:4 }} />
        {err  && <p style={{ color:"#E07A5F", fontSize:12, margin:"4px 0 12px" }}>{err}</p>}
        {!err && <div style={{ marginBottom:16 }} />}
        <label style={lS}>Icon</label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:18 }}>
          {emojis.map(e => (
            <button key={e} onClick={() => setEmoji(e)} style={{ width:38, height:38, borderRadius:9, border:`2px solid ${emoji===e?"#3D405B":"#E8E4DF"}`, background:emoji===e?"#3D405B":"#fff", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>{e}</button>
          ))}
        </div>
        <label style={lS}>Color</label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:24 }}>
          {PALETTE.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{ width:32, height:32, borderRadius:8, border:`3px solid ${color===c?"#2A2D40":"transparent"}`, background:c, cursor:"pointer" }} />
          ))}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"13px", borderRadius:11, border:"2px solid #E8E4DF", background:"#fff",    color:"#555", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>Cancel</button>
          <button onClick={submit}  style={{ flex:1, padding:"13px", borderRadius:11, border:"none",             background:"#3D405B", color:"#fff", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:14 }}>{emoji} Add Service</button>
        </div>
      </div>
    </div>
  );
}

// ── DASHBOARD (OWNER) ──────────────────────────────────────────
function Dashboard({ db, services }) {
  const { sales, expenses } = db;
  const todaySales = sales.filter(s => s.date === todayStr()).reduce((a,b) => a+b.amount, 0);
  const todayExp   = expenses.filter(e => e.date === todayStr()).reduce((a,b) => a+b.cost, 0);
  const thisMonth  = new Date().toISOString().slice(0,7);
  const monthSales = sales.filter(s => s.date.startsWith(thisMonth)).reduce((a,b) => a+b.amount, 0);
  const monthExp   = expenses.filter(e => e.date.startsWith(thisMonth)).reduce((a,b) => a+b.cost, 0);
  const netProfit  = monthSales - monthExp;

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d  = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    trend.push({
      day:      d.toLocaleDateString("en-US", { weekday:"short" }),
      Sales:    sales.filter(x => x.date === ds).reduce((a,b) => a+b.amount, 0),
      Expenses: expenses.filter(x => x.date === ds).reduce((a,b) => a+b.cost, 0),
    });
  }

  const byService = services
    .map(s => ({ name:s.name, value: sales.filter(x => x.service===s.name && x.date.startsWith(thisMonth)).reduce((a,b) => a+b.amount, 0) }))
    .filter(x => x.value > 0);

  const getColor = (name) => { const s = services.find(x => x.name===name); return s ? s.color : "#aaa"; };
  const recent   = [...sales].sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);

  return (
    <div>
      <h1 style={{ margin:"0 0 6px", fontFamily:"'Playfair Display',serif", fontSize:28, color:"#2A2D40" }}>Overview</h1>
      <p style={{ margin:"0 0 22px", color:"#888", fontSize:13 }}>This month's performance</p>
      <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap" }}>
        <StatCard label="Today's Sales"    value={TZS(todaySales)} color="#81B29A" icon="💵" sub={`Expenses: ${TZS(todayExp)}`} />
        <StatCard label="Monthly Revenue"  value={TZS(monthSales)} color="#E07A5F" icon="📈" />
        <StatCard label="Monthly Expenses" value={TZS(monthExp)}   color="#F2CC8F" icon="🧾" />
        <StatCard label="Net Profit"       value={TZS(netProfit)}  color={netProfit>=0?"#81B29A":"#E07A5F"} icon={netProfit>=0?"✅":"⚠️"} />
      </div>
      <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap" }}>
        <div style={{ background:"#fff", borderRadius:18, padding:22, flex:2, minWidth:280, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
          <h3 style={{ margin:"0 0 18px", fontSize:14, color:"#2A2D40" }}>Sales vs Expenses — Last 7 Days</h3>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={trend} barSize={13}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
              <XAxis dataKey="day"   tick={{ fontSize:11, fill:"#888" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${v/1000}k`} />
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,.1)", fontSize:12 }} />
              <Bar dataKey="Sales"    fill="#81B29A" radius={[5,5,0,0]} />
              <Bar dataKey="Expenses" fill="#E07A5F" radius={[5,5,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:"#fff", borderRadius:18, padding:22, flex:1, minWidth:200, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14, color:"#2A2D40" }}>Revenue by Service</h3>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={62} innerRadius={32} paddingAngle={3}>
                {byService.map((e,i) => <Cell key={i} fill={getColor(e.name)} />)}
              </Pie>
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
            </PieChart>
          </ResponsiveContainer>
          {byService.map(s => (
            <div key={s.name} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#666", marginTop:5 }}>
              <span style={{ width:9, height:9, borderRadius:2, background:getColor(s.name), display:"inline-block" }} />
              {s.name}
            </div>
          ))}
        </div>
      </div>
      <div style={{ background:"#fff", borderRadius:18, padding:22, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
        <h3 style={{ margin:"0 0 14px", fontSize:14, color:"#2A2D40" }}>Recent Transactions</h3>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
              {["Date","Service","Amount"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(s => (
              <tr key={s.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                <td style={tS}>{s.date}</td>
                <td style={tS}><ServiceBadge service={s.service} services={services} /></td>
                <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── WORKER HOME ────────────────────────────────────────────────
function WorkerHome({ db, user, setPage }) {
  const todaySales = db.sales.filter(s => s.date === todayStr()).reduce((a,b) => a+b.amount, 0);
  const todayCount = db.sales.filter(s => s.date === todayStr()).length;
  return (
    <div>
      <h1 style={{ margin:"0 0 6px", fontFamily:"'Playfair Display',serif", fontSize:28, color:"#2A2D40" }}>Good day, {user.name} 👋</h1>
      <p style={{ margin:"0 0 26px", color:"#888" }}>What would you like to record today?</p>
      <div style={{ display:"flex", gap:14, marginBottom:26, flexWrap:"wrap" }}>
        <StatCard label="Today's Sales" value={TZS(todaySales)} color="#81B29A" icon="💵" sub={`${todayCount} transaction${todayCount!==1?"s":""}`} />
      </div>
      <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
        <button onClick={() => setPage("sales")} style={{ flex:1, minWidth:180, padding:"34px 26px", borderRadius:20, border:"none", background:"#81B29A", color:"#fff", cursor:"pointer", textAlign:"center", fontFamily:"'DM Sans',sans-serif", boxShadow:"0 8px 26px #81B29A55" }}>
          <span style={{ fontSize:34, marginBottom:10, display:"block" }}>💰</span>
          <span style={{ fontSize:16, fontWeight:700, display:"block" }}>Record Sale</span>
          <span style={{ fontSize:12, opacity:.8, marginTop:4, display:"block" }}>Restaurant, Go Kart, Paintball...</span>
        </button>
        <button onClick={() => setPage("expenses")} style={{ flex:1, minWidth:180, padding:"34px 26px", borderRadius:20, border:"none", background:"#E07A5F", color:"#fff", cursor:"pointer", textAlign:"center", fontFamily:"'DM Sans',sans-serif", boxShadow:"0 8px 26px #E07A5F55" }}>
          <span style={{ fontSize:34, marginBottom:10, display:"block" }}>🧾</span>
          <span style={{ fontSize:16, fontWeight:700, display:"block" }}>Record Expense</span>
          <span style={{ fontSize:12, opacity:.8, marginTop:4, display:"block" }}>Supplies, purchases, costs...</span>
        </button>
      </div>
    </div>
  );
}

// ── SALES PAGE (SUPABASE) ──────────────────────────────────────
function SalesPage({ db, user, showToast, services, addService, fetchSales }) {
  const isOwner = user.role === ROLES.OWNER;
  const [form,      setForm]      = useState({ service: services[0]?.name || "", amount:"", date:todayStr() });
  const [filter,    setFilter]    = useState({ service:"All", from:"", to:"" });
  const [showModal, setShowModal] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const currentServiceNames = services.map(s => s.name);
  const safeService = currentServiceNames.includes(form.service) ? form.service : (services[0]?.name || "");

  const submit = async () => {
    if (!form.amount || Number(form.amount) <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!supabase) {
      showToast("Database not configured", "error");
      return;
    }

    try {
      const { error } = await supabase
        .from("sales")
        .insert([{
          service: safeService,
          amount: Number(form.amount),
          date: new Date(form.date).toISOString()
        }]);

      if (error) {
        console.error("Supabase insert error:", error);
        showToast("Failed to save sale", "error");
        return;
      }

      await fetchSales();
      setForm(f => ({ ...f, amount:"" }));
      showToast("Sale recorded ✓");
    } catch (err) {
      console.error("Sale insert error:", err);
      showToast("Failed to save sale", "error");
    }
  };

  const hardDelete = async (id) => {
    if (!supabase) {
      showToast("Database not configured", "error");
      return;
    }
    try {
      const { error } = await supabase
        .from("sales")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Supabase delete error:", error);
        showToast("Failed to delete sale", "error");
        return;
      }

      await fetchSales();
      showToast("Sale deleted");
      setConfirmId(null);
    } catch (err) {
      console.error("Sale delete error:", err);
      showToast("Failed to delete sale", "error");
    }
  };

  const handleAddService = (newSvc) => {
    addService(newSvc);
    setForm(f => ({ ...f, service:newSvc.name }));
  };

  const filtered = db.sales
    .filter(s => filter.service==="All" || s.service===filter.service)
    .filter(s => !filter.from || s.date >= filter.from)
    .filter(s => !filter.to   || s.date <= filter.to)
    .sort((a,b) => b.date.localeCompare(a.date));

  const total = filtered.reduce((a,b) => a+b.amount, 0);

  return (
    <div>
      {showModal && <AddServiceModal onAdd={handleAddService} onClose={() => setShowModal(false)} existing={services} />}
      {confirmId && <ConfirmModal message="Delete this sale? This cannot be undone." onConfirm={() => hardDelete(confirmId)} onCancel={() => setConfirmId(null)} />}
      <h1 style={pT}>Sales</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>
        <div style={fC}>
          <h3 style={fTi}>Record a Sale</h3>
          <label style={lS}>Service</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:18 }}>
            {services.map(s => (
              <button key={s.id} onClick={() => setForm(f => ({ ...f, service:s.name }))} style={{ padding:"9px 14px", borderRadius:9, border:"2px solid", borderColor:safeService===s.name?s.color:"#E8E4DF", background:safeService===s.name?s.color:"#fff", color:safeService===s.name?"#fff":"#555", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                <span>{s.emoji}</span>{s.name}
              </button>
            ))}
          </div>
          {isOwner && (
            <button onClick={() => setShowModal(true)} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"1.5px dashed #C4BEB6", color:"#888", borderRadius:9, padding:"7px 12px", fontSize:12, cursor:"pointer", marginBottom:18, fontFamily:"'DM Sans',sans-serif" }}>
              <span style={{ fontSize:16 }}>＋</span> Add New Service
            </button>
          )}
          {!isOwner && <div style={{ marginBottom:18 }} />}
          <label style={lS}>Amount (TZS)</label>
          <input type="number" placeholder="e.g. 15000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />
          <label style={lS}>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={{ ...iS, marginBottom:22 }} />
          <button onClick={submit} style={sB}>✓ Record Sale</button>
        </div>
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={{ background:"#fff", borderRadius:18, padding:22, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
                <select value={filter.service} onChange={e => setFilter(f => ({ ...f, service:e.target.value }))} style={seS}>
                  <option>All</option>
                  {services.map(s => <option key={s.id}>{s.name}</option>)}
                </select>
                <input type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from:e.target.value }))} style={seS} />
                <input type="date" value={filter.to}   onChange={e => setFilter(f => ({ ...f, to:e.target.value }))}   style={seS} />
                <div style={{ marginLeft:"auto", fontWeight:700, color:"#2A2D40", fontSize:13 }}>Total: {TZS(total)}</div>
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
                    {["Date","Service","Amount",""].map((h,i) => (
                      <th key={i} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0,40).map(s => (
                    <tr key={s.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                      <td style={tS}>{s.date}</td>
                      <td style={tS}><ServiceBadge service={s.service} services={services} /></td>
                      <td style={{ ...tS, fontWeight:600 }}>{TZS(s.amount)}</td>
                      <td style={tS}>
                        <button onClick={() => setConfirmId(s.id)} style={{ background:"none", border:"1px solid #E07A5F44", color:"#E07A5F", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── EXPENSES PAGE ──────────────────────────────────────────────
function ExpensesPage({ db, visibleDb, updateDb, user, showToast }) {
  const isOwner = user.role === ROLES.OWNER;
  const [form,      setForm]      = useState({ category:EXPENSE_CATS[0], item:"", cost:"", date:todayStr() });
  const [confirmId, setConfirmId] = useState(null);

  const submit = () => {
    if (!form.item.trim())                  { showToast("Enter an item name","error"); return; }
    if (!form.cost || Number(form.cost)<=0) { showToast("Enter a valid cost","error"); return; }
    updateDb(p => ({
      ...p,
      expenses: [
        { id:`e-${Date.now()}`, category:form.category, item:form.item, cost:Number(form.cost), date:form.date, createdBy:user.username, deleted:false },
        ...p.expenses,
      ],
    }));
    setForm(f => ({ ...f, item:"", cost:"" }));
    showToast("Expense recorded ✓");
  };

  const softDelete = (id) => {
    updateDb(p => ({ ...p, expenses: p.expenses.map(e => e.id===id ? { ...e, deleted:true } : e) }));
    showToast("Expense deleted");
    setConfirmId(null);
  };

  const sorted = [...visibleDb.expenses].sort((a,b) => b.date.localeCompare(a.date));

  return (
    <div>
      {confirmId && <ConfirmModal message="Delete this expense? This cannot be undone." onConfirm={() => softDelete(confirmId)} onCancel={() => setConfirmId(null)} />}
      <h1 style={pT}>Expenses</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>
        <div style={fC}>
          <h3 style={fTi}>Record an Expense</h3>
          <label style={lS}>Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={{ ...iS, marginBottom:14 }}>
            {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
          </select>
          <label style={lS}>Item / Description</label>
          <input placeholder="e.g. Potato sack" value={form.item} onChange={e => setForm(f => ({ ...f, item:e.target.value }))} style={{ ...iS, marginBottom:14 }} />
          <label style={lS}>Cost (TZS)</label>
          <input type="number" placeholder="e.g. 20000" value={form.cost} onChange={e => setForm(f => ({ ...f, cost:e.target.value }))} style={{ ...iS, fontSize:22, fontWeight:700, marginBottom:14 }} />
          <label style={lS}>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} style={{ ...iS, marginBottom:22 }} />
          <button onClick={submit} style={{ ...sB, background:"#E07A5F" }}>✓ Record Expense</button>
        </div>
        {isOwner && (
          <div style={{ flex:2, minWidth:0 }}>
            <div style={{ background:"#fff", borderRadius:18, padding:22, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
              <div style={{ fontWeight:700, color:"#2A2D40", marginBottom:14, fontSize:13 }}>
                Total: {TZS(visibleDb.expenses.reduce((a,b) => a+b.cost, 0))}
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
                    {["Date","Category","Item","Cost","By",""].map((h,i) => (
                      <th key={i} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0,40).map(e => (
                    <tr key={e.id} style={{ borderBottom:"1px solid #F7F5F0" }}>
                      <td style={tS}>{e.date}</td>
                      <td style={tS}>{e.category}</td>
                      <td style={tS}>{e.item}</td>
                      <td style={{ ...tS, fontWeight:600, color:"#E07A5F" }}>{TZS(e.cost)}</td>
                      <td style={{ ...tS, color:"#888", fontSize:12 }}>{e.createdBy || "—"}</td>
                      <td style={tS}>
                        <button onClick={() => setConfirmId(e.id)} style={{ background:"none", border:"1px solid #E07A5F44", color:"#E07A5F", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── REPORTS PAGE ───────────────────────────────────────────────
function ReportsPage({ db, services }) {
  const [range,   setRange]   = useState({ from:"", to:"" });
  const [service, setService] = useState("All");

  const getColor = (name) => { const s = services.find(x => x.name===name); return s ? s.color : "#aaa"; };

  const sales    = db.sales.filter(s => service==="All" || s.service===service).filter(s => !range.from || s.date >= range.from).filter(s => !range.to || s.date <= range.to);
  const expenses = db.expenses.filter(e => !range.from || e.date >= range.from).filter(e => !range.to || e.date <= range.to);

  const dateMap = {};
  sales.forEach(s    => { dateMap[s.date] = dateMap[s.date] || { date:s.date, Sales:0, Expenses:0 }; dateMap[s.date].Sales    += s.amount; });
  expenses.forEach(e => { dateMap[e.date] = dateMap[e.date] || { date:e.date, Sales:0, Expenses:0 }; dateMap[e.date].Expenses += e.cost;   });

  const trend = Object.values(dateMap).sort((a,b) => a.date.localeCompare(b.date)).slice(-30);

  const byService = services
    .map(s => ({ name:s.name, value: db.sales.filter(x => x.service===s.name && (!range.from||x.date>=range.from) && (!range.to||x.date<=range.to)).reduce((a,b) => a+b.amount, 0) }))
    .filter(x => x.value > 0);

  const totalSales = sales.reduce((a,b) => a+b.amount, 0);
  const totalExp   = expenses.reduce((a,b) => a+b.cost, 0);

  const exportCSV = () => {
    const rows = [
      ["Date","Service","Amount"],
      ...sales.map(s => [s.date, s.service, s.amount]),
    ];
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "swahili_sales.csv";
    a.click();
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:10 }}>
        <h1 style={{ ...pT, marginBottom:0 }}>Reports</h1>
        <button onClick={exportCSV} style={{ padding:"11px 20px", background:"#3D405B", color:"#fff", border:"none", borderRadius:11, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>↓ Export CSV</button>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
        <select value={service} onChange={e => setService(e.target.value)} style={seS}>
          <option>All</option>
          {services.map(s => <option key={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from:e.target.value }))} style={seS} />
        <input type="date" value={range.to}   onChange={e => setRange(r => ({ ...r, to:e.target.value }))}   style={seS} />
        <button onClick={() => setRange({ from:"", to:"" })} style={{ ...seS, background:"#F0EDE8", cursor:"pointer", border:"none" }}>Reset</button>
      </div>
      <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap" }}>
        <StatCard label="Total Revenue"  value={TZS(totalSales)}            color="#81B29A" icon="📈" />
        <StatCard label="Total Expenses" value={TZS(totalExp)}              color="#E07A5F" icon="🧾" />
        <StatCard label="Net Profit"     value={TZS(totalSales - totalExp)} color={totalSales-totalExp>=0?"#81B29A":"#E07A5F"} icon={totalSales-totalExp>=0?"✅":"⚠️"} />
      </div>
      <div style={{ background:"#fff", borderRadius:18, padding:22, marginBottom:16, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
        <h3 style={{ margin:"0 0 18px", fontSize:14 }}>Revenue vs Expenses Over Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
            <XAxis dataKey="date" tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => v.slice(5)} />
            <YAxis tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${v/1000}k`} />
            <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,.1)", fontSize:12 }} />
            <Legend wrapperStyle={{ fontSize:12 }} />
            <Line type="monotone" dataKey="Sales"    stroke="#81B29A" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="Expenses" stroke="#E07A5F" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
        <div style={{ background:"#fff", borderRadius:18, padding:22, flex:1, minWidth:220, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14 }}>Revenue by Service</h3>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={byService} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={34} paddingAngle={3}>
                {byService.map((e,i) => <Cell key={i} fill={getColor(e.name)} />)}
              </Pie>
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
            </PieChart>
          </ResponsiveContainer>
          {byService.map(s => (
            <div key={s.name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:7, color:"#555" }}>
              <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ width:9, height:9, borderRadius:2, background:getColor(s.name), display:"inline-block" }} />{s.name}
              </span>
              <span style={{ fontWeight:600 }}>{TZS(s.value)}</span>
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:18, padding:22, flex:1, minWidth:220, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14 }}>Revenue by Service (Bar)</h3>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={byService} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
              <XAxis type="number"   tick={{ fontSize:10, fill:"#888" }} axisLine={false} tickLine={false} tickFormatter={v => `${v/1000}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:"#555" }} axisLine={false} tickLine={false} width={75} />
              <Tooltip formatter={v => TZS(v)} contentStyle={{ borderRadius:10, border:"none", fontSize:12 }} />
              <Bar dataKey="value" radius={[0,5,5,0]}>
                {byService.map((e,i) => <Cell key={i} fill={getColor(e.name)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── USERS PAGE (OWNER ONLY) ────────────────────────────────────
function UsersPage({ users, onAddUser, showToast }) {
  const [form, setForm] = useState({ username:"", password:"", role:ROLES.WORKER, name:"" });
  const [err,  setErr]  = useState("");

  const submit = () => {
    if (!form.username.trim())                            { setErr("Username required."); return; }
    if (!form.password.trim() || form.password.length < 4) { setErr("Password must be at least 4 characters."); return; }
    if (users[form.username])                             { setErr("Username already exists."); return; }
    onAddUser({ username:form.username.trim(), password:form.password, role:form.role, name:form.name.trim() || form.username.trim() });
    setForm({ username:"", password:"", role:ROLES.WORKER, name:"" });
    setErr("");
  };

  const userList = Object.entries(users).map(([username, data]) => ({ username, ...data }));

  return (
    <div>
      <h1 style={pT}>User Management</h1>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>
        <div style={fC}>
          <h3 style={fTi}>Create New User</h3>
          <label style={lS}>Display Name</label>
          <input placeholder="e.g. John" value={form.name} onChange={e => { setForm(f => ({ ...f, name:e.target.value })); setErr(""); }} style={{ ...iS, marginBottom:14 }} />
          <label style={lS}>Username</label>
          <input placeholder="e.g. john123" value={form.username} onChange={e => { setForm(f => ({ ...f, username:e.target.value.toLowerCase() })); setErr(""); }} style={{ ...iS, marginBottom:14 }} />
          <label style={lS}>Password</label>
          <input type="password" placeholder="Min 4 characters" value={form.password} onChange={e => { setForm(f => ({ ...f, password:e.target.value })); setErr(""); }} style={{ ...iS, marginBottom:14 }} />
          <label style={lS}>Role</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role:e.target.value }))} style={{ ...iS, marginBottom:22 }}>
            <option value={ROLES.WORKER}>Worker</option>
            <option value={ROLES.OWNER}>Owner / Admin</option>
          </select>
          {err && <p style={{ color:"#E07A5F", fontSize:12, margin:"-14px 0 14px" }}>{err}</p>}
          <button onClick={submit} style={{ ...sB, background:"#3D405B" }}>+ Create User</button>
        </div>
        <div style={{ flex:2, minWidth:0 }}>
          <div style={{ background:"#fff", borderRadius:18, padding:22, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
            <h3 style={{ margin:"0 0 18px", fontSize:14, color:"#2A2D40" }}>All Users ({userList.length})</h3>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #F0EDE8" }}>
                  {["Name","Username","Role"].map(h => (
                    <th key={h} style={{ textAlign:"left", padding:"0 0 10px", fontSize:10, color:"#aaa", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {userList.map(u => (
                  <tr key={u.username} style={{ borderBottom:"1px solid #F7F5F0" }}>
                    <td style={tS}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:"50%", background:u.role===ROLES.OWNER?"#3D405B":"#81B29A", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, fontWeight:700, flexShrink:0 }}>
                          {u.name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span style={{ fontWeight:500 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ ...tS, color:"#888" }}>{u.username}</td>
                    <td style={tS}>
                      <span style={{ background:u.role===ROLES.OWNER?"#3D405B22":"#81B29A22", color:u.role===ROLES.OWNER?"#3D405B":"#81B29A", border:`1px solid ${u.role===ROLES.OWNER?"#3D405B44":"#81B29A44"}`, padding:"3px 9px", borderRadius:6, fontSize:11, fontWeight:600, textTransform:"uppercase" }}>
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SHARED STYLES ──────────────────────────────────────────────
const iS  = { width:"100%", padding:"12px 14px", border:"2px solid #E8E4DF", borderRadius:11, fontSize:14, outline:"none", background:"#FAFAF8", fontFamily:"'DM Sans',sans-serif", color:"#2A2D40" };
const seS = { padding:"9px 12px", border:"2px solid #E8E4DF", borderRadius:9, fontSize:12, background:"#FAFAF8", fontFamily:"'DM Sans',sans-serif", color:"#555", cursor:"pointer" };
const lS  = { display:"block", fontSize:11, fontWeight:600, color:"#888", marginBottom:5, textTransform:"uppercase", letterSpacing:.5 };
const fC  = { background:"#fff", borderRadius:18, padding:22, width:320, flexShrink:0, boxShadow:"0 2px 10px rgba(0,0,0,.06)" };
const fTi = { margin:"0 0 18px", fontFamily:"'Playfair Display',serif", fontSize:18, color:"#2A2D40" };
const sB  = { width:"100%", padding:"14px", background:"#81B29A", color:"#fff", border:"none", borderRadius:11, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };
const tS  = { padding:"10px 0", fontSize:13, color:"#444", verticalAlign:"middle" };
const pT  = { margin:"0 0 18px", fontFamily:"'Playfair Display',serif", fontSize:28, color:"#2A2D40" };