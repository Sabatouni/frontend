import { useEffect, useState } from "react"
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis,
} from "recharts"
import "./App.css"
import { useAuth } from "./AuthContext"
import Login from "./Login"
import { supabase } from "./supabaseClient"

export default function App() {
  const { user, role } = useAuth()

  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [services, setServices] = useState([])
  const [users, setUsers] = useState([])
  const [page, setPage] = useState("dashboard")

  const [newSale, setNewSale] = useState({ service_id: "", amount: "" })
  const [newExpense, setNewExpense] = useState({ category: "", cost: "" })

  const [showAddService, setShowAddService] = useState(false)
  const [newService, setNewService] = useState({ name: "", color: "#8884d8" })

  // ---- Fetch from Supabase ----
  const fetchAll = async () => {
    const { data: s } = await supabase
      .from("sales")
      .select("*")
      .order("date", { ascending: false })
    const { data: e } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
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

  // ---- Event listeners for Add Service ----
  useEffect(() => {
    const openModal = () => setShowAddService(true)
    window.addEventListener("openAddService", openModal)
    return () => window.removeEventListener("openAddService", openModal)
  }, [])

  // ---- Insert Operations ----
  const handleAddSale = async () => {
    if (!newSale.service_id || !newSale.amount) return
    await supabase.from("sales").insert([
      {
        service_id: newSale.service_id,
        amount: Number(newSale.amount),
        date: new Date().toISOString(),
        user_id: user.id,
      },
    ])
    setNewSale({ service_id: "", amount: "" })
    fetchAll()
  }

  const handleAddExpense = async () => {
    if (!newExpense.category || !newExpense.cost) return
    await supabase.from("expenses").insert([
      {
        category: newExpense.category,
        cost: Number(newExpense.cost),
        date: new Date().toISOString(),
        user_id: user.id,
      },
    ])
    setNewExpense({ category: "", cost: "" })
    fetchAll()
  }

  const handleAddService = async () => {
    if (!newService.name) return
    await supabase.from("services").insert([
      {
        id: newService.name.toLowerCase(),
        name: newService.name,
        color: newService.color,
      },
    ])
    setNewService({ name: "", color: "#8884d8" })
    setShowAddService(false)
    fetchAll()
  }

  // ---- Derived Calculations ----
  const totalSales = sales.reduce((a, s) => a + Number(s.amount || 0), 0)
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.cost || 0), 0)
  const netProfit = totalSales - totalExpenses

  if (!user) return <Login />

  // ---- UI ----
  return (
    <div className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <h2>POS System</h2>
        <button type="button" onClick={() => setPage("dashboard")}>
          Dashboard
        </button>
        <button type="button" onClick={() => setPage("sales")}>
          Sales
        </button>
        <button type="button" onClick={() => setPage("expenses")}>
          Expenses
        </button>
        <button type="button" onClick={() => setPage("reports")}>
          Reports
        </button>
      </aside>

      {/* MAIN CONTENT */}
      <main>
        {page === "dashboard" && (
          <div className="dashboard">
            <h1>Dashboard</h1>
            <div className="cards">
              <div className="card">Total Sales: ${totalSales}</div>
              <div className="card">Total Expenses: ${totalExpenses}</div>
              <div className="card">Net Profit: ${netProfit}</div>
            </div>

            <div className="charts">
              <ResponsiveContainer width="50%" height={300}>
                <PieChart>
                  <Pie
                    data={services.map(srv => ({
                      name: srv.name,
                      value: sales.filter(s => s.service_id === srv.id)
                                  .reduce((a, b) => a + Number(b.amount || 0), 0),
                    }))}
                    dataKey="value"
                    outerRadius={80}
                    label
                  >
                    {services.map((s, i) => (
                      <Cell key={i} fill={s.color || "#8884d8"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>

              <ResponsiveContainer width="50%" height={300}>
                <LineChart data={sales.slice(0, 10).reverse()}>
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="amount" stroke="#8884d8" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {page === "sales" && (
          <div className="sales-page">
            <h1>Sales</h1>
            <div className="form">
              <select
                value={newSale.service_id}
                onChange={(e) =>
                  setNewSale({ ...newSale, service_id: e.target.value })
                }
              >
                <option value="">Select service</option>
                {services.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Amount"
                value={newSale.amount}
                onChange={(e) =>
                  setNewSale({ ...newSale, amount: e.target.value })
                }
              />
              <button type="button" onClick={handleAddSale}>
                Add Sale
              </button>
              {role === "admin" && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => window.dispatchEvent(new Event("openAddService"))}
                >
                  Add Service
                </button>
              )}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Service</th>
                  <th>Amount</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i}>
                    <td>{new Date(s.date).toLocaleDateString()}</td>
                    <td>{services.find(x => x.id === s.service_id)?.name || "—"}</td>
                    <td>${Number(s.amount)}</td>
                    <td>{users.find(x => x.id === s.user_id)?.name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page === "expenses" && (
          <div className="expenses-page">
            <h1>Expenses</h1>
            <div className="form">
              <input
                type="text"
                placeholder="Category"
                value={newExpense.category}
                onChange={(e) =>
                  setNewExpense({ ...newExpense, category: e.target.value })
                }
              />
              <input
                type="number"
                placeholder="Cost"
                value={newExpense.cost}
                onChange={(e) =>
                  setNewExpense({ ...newExpense, cost: e.target.value })
                }
              />
              <button type="button" onClick={handleAddExpense}>
                Add Expense
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Cost</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, i) => (
                  <tr key={i}>
                    <td>{new Date(e.date).toLocaleDateString()}</td>
                    <td>{e.category}</td>
                    <td>${Number(e.cost)}</td>
                    <td>{users.find(x => x.id === e.user_id)?.name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page === "reports" && (
          <div className="reports-page">
            <h1>Reports</h1>
            <p>Total Sales: ${totalSales}</p>
            <p>Total Expenses: ${totalExpenses}</p>
            <p>Net Profit: ${netProfit}</p>
            {/* CSV / Excel export can be added here based on your existing lib */}
          </div>
        )}
      </main>

      {/* MODAL: Add Service */}
      {showAddService && role === "admin" && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Add New Service</h2>
            <input
              type="text"
              placeholder="Service name"
              value={newService.name}
              onChange={(e) =>
                setNewService({ ...newService, name: e.target.value })
              }
            />
            <input
              type="color"
              value={newService.color}
              onChange={(e) =>
                setNewService({ ...newService, color: e.target.value })
              }
            />
            <div className="actions">
              <button type="button" onClick={handleAddService}>
                Save
              </button>
              <button type="button" className="secondary" onClick={() => setShowAddService(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
