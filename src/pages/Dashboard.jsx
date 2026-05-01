import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const fmt = (n) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.dashboard().then(setS).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!s)  return <div className="muted">Loading…</div>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Today</h2>
      <div className="cards">
        <div className="card"><div className="label">Sales</div><div className="value">{fmt(s.salesToday)}</div></div>
        <div className="card"><div className="label">Sales count</div><div className="value">{s.salesCountToday}</div></div>
        <div className="card"><div className="label">Expenses</div><div className="value">{fmt(s.expensesToday)}</div></div>
      </div>
      <h2>This month</h2>
      <div className="cards">
        <div className="card"><div className="label">Sales</div><div className="value">{fmt(s.salesThisMonth)}</div></div>
        <div className="card"><div className="label">Expenses</div><div className="value">{fmt(s.expensesThisMonth)}</div></div>
        <div className="card"><div className="label">Net</div><div className="value">{fmt(s.netThisMonth)}</div></div>
      </div>
    </>
  );
}