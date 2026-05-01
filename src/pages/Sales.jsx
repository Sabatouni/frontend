import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

const PAY = ["CASH", "CARD", "MOBILE", "OTHER"];

export default function Sales() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    productName: "",
    quantity: 1,
    unitPrice: 0,
    paymentMethod: "CASH",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 🔄 Load sales
  async function load() {
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("date", { ascending: false });

      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // ➕ Add sale
  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);

    try {
      const total =
        Number(form.quantity) * Number(form.unitPrice);

      const { error } = await supabase.from("sales").insert([
        {
          item: form.productName,
          quantity: Number(form.quantity),
          unit_price: Number(form.unitPrice),
          total: total,
          payment_method: form.paymentMethod,
          date: new Date().toISOString(),
        },
      ]);

      if (error) throw error;

      setForm({
        productName: "",
        quantity: 1,
        unitPrice: 0,
        paymentMethod: "CASH",
      });

      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // 🗑 Delete
  async function remove(id) {
    if (!confirm("Delete this sale?")) return;

    try {
      const { error } = await supabase
        .from("sales")
        .delete()
        .eq("id", id);

      if (error) throw error;

      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Record a sale</h2>

      <form className="panel" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Product
            <input
              required
              value={form.productName}
              onChange={(e) =>
                setForm({ ...form, productName: e.target.value })
              }
            />
          </label>

          <label>
            Quantity
            <input
              type="number"
              min="1"
              required
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: e.target.value })
              }
            />
          </label>

          <label>
            Unit price
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.unitPrice}
              onChange={(e) =>
                setForm({ ...form, unitPrice: e.target.value })
              }
            />
          </label>

          <label>
            Payment
            <select
              value={form.paymentMethod}
              onChange={(e) =>
                setForm({ ...form, paymentMethod: e.target.value })
              }
            >
              {PAY.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>

        {err && <div className="error">{err}</div>}

        <button
          className="primary"
          type="submit"
          disabled={busy}
          style={{ marginTop: 12 }}
        >
          {busy ? "Saving…" : "Save sale"}
        </button>
      </form>

      <h2>Recent sales</h2>

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Total</th>
              <th>Pay</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>

          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.date).toLocaleString()}</td>
                <td>{s.item}</td>
                <td>{s.quantity}</td>
                <td>{Number(s.unit_price).toFixed(2)}</td>
                <td>{Number(s.total).toFixed(2)}</td>
                <td>{s.payment_method}</td>

                {isAdmin && (
                  <td>
                    <button
                      className="danger"
                      onClick={() => remove(s.id)}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {items.length === 0 && (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 6}
                  className="muted"
                  style={{ padding: 18 }}
                >
                  No sales yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}