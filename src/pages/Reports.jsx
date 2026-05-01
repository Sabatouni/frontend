import { useEffect, useState } from "react"
import * as XLSX from "xlsx"
import StatCard from "../components/StatCard"
import { supabase } from "../supabaseClient"
import { TZS } from "../utils/helpers"

export default function ReportsPage({ showToast }) {
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])

  const fetchData = async () => {
    const { data: s } = await supabase.from("sales").select("*")
    const { data: e } = await supabase.from("expenses").select("*")
    setSales(s || [])
    setExpenses(e || [])
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  const totalSales = sales.reduce((a, b) => a + Number(b.amount || 0), 0)
  const totalExp = expenses.reduce((a, b) => a + Number(b.cost || 0), 0)

  const exportExcel = () => {
    if (!sales.length && !expenses.length) {
      showToast("No data to export", "error")
      return
    }

    const wb = XLSX.utils.book_new()

    if (sales.length) {
      const sheet = XLSX.utils.json_to_sheet(sales)
      XLSX.utils.book_append_sheet(wb, sheet, "Sales")
    }

    if (expenses.length) {
      const sheet = XLSX.utils.json_to_sheet(expenses)
      XLSX.utils.book_append_sheet(wb, sheet, "Expenses")
    }

    XLSX.writeFile(wb, "report.xlsx")
    showToast("Report exported ✓")
  }

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Reports</h1>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <StatCard label="Total Sales" value={TZS(totalSales)} color="#81B29A" />
        <StatCard label="Total Expenses" value={TZS(totalExp)} color="#E07A5F" />
        <StatCard
          label="Profit"
          value={TZS(totalSales - totalExp)}
          color="#3D405B"
        />
      </div>

      <button
        type="button"
        onClick={exportExcel}
        style={{
          padding: "12px 20px",
          background: "#3D405B",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        📄 Export Excel
      </button>
    </div>
  )
}
