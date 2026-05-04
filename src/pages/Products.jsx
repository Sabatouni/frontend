import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

const empty = { name: "", emoji: "📦", color: "#8884d8" };

export default function Products() {
  const { isAdmin } = useAuth();

  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    const { data } = await supabase.from("services").select("*");
    setItems(data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();

    try {
      if (editingId) {
        await supabase
          .from("services")
          .update(form)
          .eq("id", editingId);
      } else {
        await supabase.from("services").insert([
          {
            id: form.name.toLowerCase(),
            ...form,
          },
        ]);
      }

      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function edit(p) {
    setEditingId(p.id);
    setForm(p);
  }

  async function remove(id) {
    if (!confirm("Delete?")) return;
    await supabase.from("services").delete().eq("id", id);
    load();
  }

  return (
    <>
      <h2>Services</h2>

      {isAdmin && (
        <form onSubmit={submit}>
          <input
            placeholder="Name"
            value={form.name}
            onChange={(e) =>
              setForm({ ...form, name: e.target.value })
            }
          />

          <input
            placeholder="Emoji"
            value={form.emoji}
            onChange={(e) =>
              setForm({ ...form, emoji: e.target.value })
            }
          />

          <input
            type="color"
            value={form.color}
            onChange={(e) =>
              setForm({ ...form, color: e.target.value })
            }
          />

          <button>{editingId ? "Update" : "Add"}</button>
        </form>
      )}

      <table>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.emoji}</td>
              <td>{p.name}</td>

              {isAdmin && (
                <td>
                  <button onClick={() => edit(p)}>Edit</button>
                  <button onClick={() => remove(p.id)}>
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}