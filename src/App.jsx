import { useEffect, useState } from "react"
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { supabase } from "./api/supabaseClient"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"

const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`

export default function App() {
  const { user } = useAuth()
  const isAdmin = user?.role === "owner"

  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [services, setServices] = useState([])
  const [users, setUsers] = useState([])
  const [page, setPage] = useState("dashboard")

  const [newSale, setNewSale] = useState({ service: "", amount: "" })
  const [newExpense, setNewExpense] = useState({ category: "", cost: "" })

  const [showAddService, setShowAddService] = useState(false)
  const [newService, setNewService] = useState({ name: "", color: "#81B29A" })

  // 🔄 FETCH DATA
  const fetchAll = async () => {
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

  // 🟢 ADD SALE
  const handleAddSale = async () => {
    if (!newSale.service || !newSale.amount) return

    await supabase.from("sales").insert([
      {
        service: newSale.service,
        amount: Number(newSale.amount),
        date: new Date().toISOString(),
        user_id: user?.id,
      },
    ])

    setNewSale({ service: "", amount: "" })
    fetchAll()
  }

  // 🔴 ADD EXPENSE
  const handleAddExpense = async () => {
    if (!newExpense.category || !newExpense.cost) return

    await supabase.from("expenses").insert([
      {
        category: newExpense.category,
        cost: Number(newExpense.cost),
        date: new Date().toISOString(),
        user_id: user?.id,
      },
    ])

    setNewExpense({ category: "", cost: "" })
    fetchAll()
  }

  // ➕ ADD SERVICE
  const handleAddService = async () => {
    if (!newService.name) return

    await supabase.from("services").insert([
      {
        id: newService.name.toLowerCase().replace(/\s+/g, "-"),
        name: newService.name,
        color: newService.color,
      },
    ])

    setShowAddService(false)
    setNewService({ name: "", color: "#81B29A" })
    fetchAll()
  }

  // 📊 CALCULATIONS
  const totalSales = sales.reduce((a, s) => a + Number(s.amount || 0), 0)
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.cost || 0), 0)
  const netProfit = totalSales - totalExpenses

  if (!user) return <Login />

  return (
    <div className="app">

      {/* SIDEBAR */}
      <aside className="sidebar">
        <h2>Swahili POS</h2>

        <button type="button" onClick={() => setPage("dashboard")}>Dashboard</button>
        <button type="button" onClick={() => setPage("sales")}>Sales</button>
        <button type="button" onClick={() => setPage("expenses")}>Expenses</button>
        <button type="button" onClick={() => setPage("reports")}>Reports</button>
      </aside>

      {/* MAIN */}
      <main>

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <>
            <h1>Dashboard</h1>

            <div className="cards">
              <div>Total Sales: {TZS(totalSales)}</div>
              <div>Total Expenses: {TZS(totalExpenses)}</div>
              <div>Profit: {TZS(netProfit)}</div>
            </div>

            <div style={{ display: "flex" }}>
              <ResponsiveContainer width="50%" height={300}>
                <PieChart>
                  <Pie
                    data={services.map(s => ({
                      name: s.name,
                      value: sales.filter(x => x.service === s.id)
                        .reduce((a, b) => a + Number(b.amount || 0), 0),
                    }))}
                    dataKey="value"
                  >
                    {services.map((s, i) => (
                      <Cell key={i} fill={s.color || "#999"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>

              <ResponsiveContainer width="50%" height={300}>
                <LineChart data={sales.slice(0, 10)}>
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line dataKey="amount" stroke="#81B29A" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* SALES */}
        {page === "sales" && (
          <>
            <h1>Sales</h1>

            <select onChange={e => setNewSale({ ...newSale, service: e.target.value })}>
              <option value="">Select service</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <input
              type="number"
              placeholder="Amount"
              onChange={e => setNewSale({ ...newSale, amount: e.target.value })}
            />

            <button type="button" onClick={handleAddSale}>Add Sale</button>

            {isAdmin && (
              <button type="button" onClick={() => setShowAddService(true)}>
                + Add Service
              </button>
            )}

            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Service</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td>{new Date(s.date).toLocaleDateString()}</td>
                    <td>{services.find(x => x.id === s.service)?.name}</td>
                    <td>{TZS(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* EXPENSES */}
        {page === "expenses" && (
          <>
            <h1>Expenses</h1>

            <input
              placeholder="Category"
              onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
            />

            <input
              type="number"
              placeholder="Cost"
              onChange={e => setNewExpense({ ...newExpense, cost: e.target.value })}
            />

            <button type="button" onClick={handleAddExpense}>
              Add Expense
            </button>

            <table>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id}>
                    <td>{e.category}</td>
                    <td>{TZS(e.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* REPORTS */}
        {page === "reports" && (
          <>
            <h1>Reports</h1>
            <p>Total Sales: {TZS(totalSales)}</p>
            <p>Total Expenses: {TZS(totalExpenses)}</p>
            <p>Profit: {TZS(netProfit)}</p>
          </>
        )}

      </main>

      {/* ADD SERVICE MODAL */}
      {showAddService && isAdmin && (
        <div className="modal">
          <input
            placeholder="Service name"
            onChange={e => setNewService({ ...newService, name: e.target.value })}
          />
          <input
            type="color"
            value={newService.color}
            onChange={e => setNewService({ ...newService, color: e.target.value })}
          />
          <button onClick={handleAddService}>Save</button>
          <button onClick={() => setShowAddService(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}