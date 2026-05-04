import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

export default function Expenses() {
  const { isAdmin } = useAuth();

  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    item: "",
    cost: "",
    category: "OTHER",
  });

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 🔄 Load
  async function load() {
    try {
      const { data, error } = await supabase
        .from("expenses")
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

  // ➕ Add expense
  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);

    try {
      if (!form.item || Number(form.cost) <= 0) {
        throw new Error("Enter valid data");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("expenses").insert([
        {
          item: form.item,
          cost: Number(form.cost),
          category: form.category,
          date: new Date().toISOString(),
          created_by: user?.email || "unknown",
        },
      ]);

      if (error) throw error;

      setForm({ item: "", cost: "", category: "OTHER" });
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm("Delete this expense?")) return;

    try {
      const { error } = await supabase
        .from("expenses")
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
      <h2>Expenses</h2>

      <form className="panel" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Description
            <input
              value={form.item}
              onChange={(e) =>
                setForm({ ...form, item: e.target.value })
              }
              required
            />
          </label>

          <label>
            Amount
            <input
              type="number"
              value={form.cost}
              onChange={(e) =>
                setForm({ ...form, cost: e.target.value })
              }
              required
            />
          </label>

          <label>
            Category
            <input
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value })
              }
            />
          </label>
        </div>

        {err && <div className="error">{err}</div>}

        <button className="primary" disabled={busy}>
          {busy ? "Saving..." : "Save Expense"}
        </button>
      </form>

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Category</th>
              <th>Amount</th>
              <th>By</th>
              {isAdmin && <th />}
            </tr>
          </thead>

          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{new Date(x.date).toLocaleDateString()}</td>
                <td>{x.item}</td>
                <td>{x.category}</td>
                <td>{Number(x.cost).toFixed(2)}</td>
                <td>{x.created_by}</td>

                {isAdmin && (
                  <td>
                    <button onClick={() => remove(x.id)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}