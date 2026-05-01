import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Expenses() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ description: "", amount: 0, category: "OTHER" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const page = await api.listExpenses(0, 100); setItems(page.content || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api.createExpense({ description: form.description, amount: Number(form.amount), category: form.category });
      setForm({ description: "", amount: 0, category: "OTHER" });
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Delete this expense?")) return;
    try { await api.deleteExpense(id); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Record an expense</h2>
      <form className="panel" onSubmit={submit}>
        <div className="form-grid">
          <label>Description<input required value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})}/></label>
          <label>Amount<input type="number" min="0" step="0.01" required value={form.amount} onChange={(e)=>setForm({...form, amount: e.target.value})}/></label>
          <label>Category<input value={form.category} onChange={(e)=>setForm({...form, category: e.target.value})}/></label>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Saving…" : "Save expense"}</button>
      </form>

      <h2>Recent expenses</h2>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>When</th><th>Description</th><th>Category</th><th>Amount</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{new Date(x.spentAt).toLocaleString()}</td>
                <td>{x.description}</td>
                <td>{x.category}</td>
                <td>{Number(x.amount).toFixed(2)}</td>
                {isAdmin && <td><button className="danger" onClick={()=>remove(x.id)}>Delete</button></td>}
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={isAdmin ? 5 : 4} className="muted" style={{ padding: 18 }}>No expenses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}