import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";

const fmt = (n) =>
  Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        // 🟢 Fetch sales
        const { data: sales, error: salesError } = await supabase
          .from("sales")
          .select("*");

        // 🟢 Fetch expenses
        const { data: expenses, error: expensesError } = await supabase
          .from("expenses")
          .select("*");

        if (salesError || expensesError) {
          throw new Error("Failed to fetch data");
        }

        const today = new Date();
        const isToday = (d) => new Date(d).toDateString() === today.toDateString();
        const isThisMonth = (d) => {
          const date = new Date(d);
          return (
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear()
          );
        };

        // 🟢 Calculations
        const salesToday = sales.filter((s) => isToday(s.date));
        const expensesToday = expenses.filter((e) => isToday(e.date));

        const salesMonth = sales.filter((s) => isThisMonth(s.date));
        const expensesMonth = expenses.filter((e) => isThisMonth(e.date));

        const result = {
          salesToday: salesToday.reduce((sum, s) => sum + Number(s.cost), 0),
          salesCountToday: salesToday.length,
          expensesToday: expensesToday.reduce((sum, e) => sum + Number(e.cost), 0),

          salesThisMonth: salesMonth.reduce((sum, s) => sum + Number(s.cost), 0),
          expensesThisMonth: expensesMonth.reduce((sum, e) => sum + Number(e.cost), 0),
          netThisMonth:
            salesMonth.reduce((sum, s) => sum + Number(s.cost), 0) -
            expensesMonth.reduce((sum, e) => sum + Number(e.cost), 0),
        };

        setStats(result);
      } catch (e) {
        setErr(e.message);
      }
    };

    loadData();
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!stats) return <div className="muted">Loading…</div>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Today</h2>
      <div className="cards">
        <div className="card">
          <div className="label">Sales</div>
          <div className="value">{fmt(stats.salesToday)}</div>
        </div>
        <div className="card">
          <div className="label">Sales count</div>
          <div className="value">{stats.salesCountToday}</div>
        </div>
        <div className="card">
          <div className="label">Expenses</div>
          <div className="value">{fmt(stats.expensesToday)}</div>
        </div>
      </div>

      <h2>This month</h2>
      <div className="cards">
        <div className="card">
          <div className="label">Sales</div>
          <div className="value">{fmt(stats.salesThisMonth)}</div>
        </div>
        <div className="card">
          <div className="label">Expenses</div>
          <div className="value">{fmt(stats.expensesThisMonth)}</div>
        </div>
        <div className="card">
          <div className="label">Net</div>
          <div className="value">{fmt(stats.netThisMonth)}</div>
        </div>
      </div>
    </>
  );
}