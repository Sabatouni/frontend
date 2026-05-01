import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

const PAY = ["CASH", "CARD", "MOBILE", "OTHER"];

export default function Sales() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ productName: "", quantity: 1, unitPrice: 0, paymentMethod: "CASH" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const page = await api.listSales(0, 100); setItems(page.content || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api.createSale({
        productName: form.productName,
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice),
        paymentMethod: form.paymentMethod,
      });
      setForm({ productName: "", quantity: 1, unitPrice: 0, paymentMethod: "CASH" });
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Delete this sale?")) return;
    try { await api.deleteSale(id); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Record a sale</h2>
      <form className="panel" onSubmit={submit}>
        <div className="form-grid">
          <label>Product<input required value={form.productName} onChange={(e)=>setForm({...form, productName: e.target.value})}/></label>
          <label>Quantity<input type="number" min="1" required value={form.quantity} onChange={(e)=>setForm({...form, quantity: e.target.value})}/></label>
          <label>Unit price<input type="number" min="0" step="0.01" required value={form.unitPrice} onChange={(e)=>setForm({...form, unitPrice: e.target.value})}/></label>
          <label>Payment<select value={form.paymentMethod} onChange={(e)=>setForm({...form, paymentMethod: e.target.value})}>{PAY.map(p=><option key={p}>{p}</option>)}</select></label>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Saving…" : "Save sale"}</button>
      </form>

      <h2>Recent sales</h2>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>When</th><th>Product</th><th>Qty</th><th>Unit</th><th>Total</th><th>Pay</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.soldAt).toLocaleString()}</td>
                <td>{s.productName}</td>
                <td>{s.quantity}</td>
                <td>{Number(s.unitPrice).toFixed(2)}</td>
                <td>{Number(s.total).toFixed(2)}</td>
                <td>{s.paymentMethod}</td>
                {isAdmin && <td><button className="danger" onClick={()=>remove(s.id)}>Delete</button></td>}
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="muted" style={{ padding: 18 }}>No sales yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}