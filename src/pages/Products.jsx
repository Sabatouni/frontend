import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

const empty = { name: "", price: 0, stock: 0, category: "", active: true };

export default function Products() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState("");

  // 🔄 Load products
  async function load() {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("id", { ascending: false });

      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // ➕ Add / Update product
  async function submit(e) {
    e.preventDefault();
    setErr("");

    const payload = {
      name: form.name,
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      active: form.active,
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", editingId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("products")
          .insert([payload]);

        if (error) throw error;
      }

      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  // ✏️ Edit
  function edit(p) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      price: p.price,
      stock: p.stock,
      category: p.category || "",
      active: p.active,
    });
  }

  // 🗑 Delete
  async function remove(id) {
    if (!confirm("Delete this product?")) return;

    try {
      const { error } = await supabase
        .from("products")
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
      <h2 style={{ marginTop: 0 }}>Products</h2>

      {isAdmin && (
        <form className="panel" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
              />
            </label>

            <label>
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.price}
                onChange={(e) =>
                  setForm({ ...form, price: e.target.value })
                }
              />
            </label>

            <label>
              Stock
              <input
                type="number"
                min="0"
                required
                value={form.stock}
                onChange={(e) =>
                  setForm({ ...form, stock: e.target.value })
                }
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

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm({ ...form, active: e.target.checked })
                }
                style={{ width: "auto" }}
              />
              Active
            </label>
          </div>

          {err && <div className="error">{err}</div>}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" type="submit">
              {editingId ? "Update" : "Add"} product
            </button>

            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(empty);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Active</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>

          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.category}</td>
                <td>{Number(p.price).toFixed(2)}</td>
                <td>{p.stock}</td>
                <td>{p.active ? "yes" : "no"}</td>

                {isAdmin && (
                  <td className="row">
                    <button onClick={() => edit(p)}>Edit</button>
                    <button
                      className="danger"
                      onClick={() => remove(p.id)}
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
                  colSpan={isAdmin ? 6 : 5}
                  className="muted"
                  style={{ padding: 18 }}
                >
                  No products yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}