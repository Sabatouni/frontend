import { useState } from "react";
import { useAuth } from "./context/AuthContext.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Expenses from "./pages/Expenses.jsx";
import Login from "./pages/Login.jsx";
import Products from "./pages/Products.jsx";
import Sales from "./pages/Sales.jsx";
import Users from "./pages/Users.jsx";

const NAV = [
  { id: "dashboard", label: "Dashboard", admin: false },
  { id: "sales",     label: "Sales",     admin: false },
  { id: "expenses",  label: "Expenses",  admin: false },
  { id: "products",  label: "Products",  admin: false },
  { id: "users",     label: "Users",     admin: true  },
];

export default function App() {
  const { user, logout, isAdmin } = useAuth();
  const [view, setView] = useState("dashboard");

  if (!user) return <Login />;

  const items = NAV.filter((n) => !n.admin || isAdmin);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🏕️ Swahili Tent Village</h1>
        <nav className="nav">
          {items.map((n) => (
            <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 28, color: "var(--muted)", fontSize: 12 }}>
          Signed in as <strong>{user.fullName || user.username}</strong> ({user.role})
        </div>
        <button style={{ marginTop: 12, width: "100%" }} onClick={logout}>Log out</button>
      </aside>
      <main className="main">
        {view === "dashboard" && <Dashboard />}
        {view === "sales"     && <Sales />}
        {view === "expenses"  && <Expenses />}
        {view === "products"  && <Products />}
        {view === "users"     && isAdmin && <Users />}
      </main>
    </div>
  );
}