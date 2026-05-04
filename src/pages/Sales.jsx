import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

const todayStr = () => new Date().toISOString().split("T")[0];

export default function Sales() {
  const { isAdmin } = useAuth();

  const [sales, setSales] = useState([]);
  const [services, setServices] = useState([]);

  const [form, setForm] = useState({
    service: "",
    amount: "",
    date: todayStr(),
    note: "",
  });

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: s } = await supabase.from("sales").select("*");
    const { data: srv } = await supabase.from("services").select("*");

    setSales(s || []);
    setServices(srv || []);

    if (srv?.length && !form.service) {
      setForm((f) => ({ ...f, service: srv[0].id }));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("sales").insert([
        {
          service: form.service,
          amount: Number(form.amount),
          note: form.note,
          date: new Date(form.date).toISOString(),
          created_by: user?.email || "unknown",
        },
      ]);

      if (error) throw error;

      setForm({
        service: services[0]?.id || "",
        amount: "",
        date: todayStr(),
        note: "",
      });

      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm("Delete?")) return;
    await supabase.from("sales").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <h2>Sales</h2>

      {isAdmin && (
        <button onClick={() => window.dispatchEvent(new Event("openAddService"))}>
          ➕ Add Service
        </button>
      )}

      <form onSubmit={submit}>
        <select
          value={form.service}
          onChange={(e) =>
            setForm({ ...form, service: e.target.value })
          }
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.emoji} {s.name}
            </option>
          ))}
        </select>

        <input
          type="number"
          value={form.amount}
          onChange={(e) =>
            setForm({ ...form, amount: e.target.value })
          }
        />

        <input
          type="date"
          value={form.date}
          onChange={(e) =>
            setForm({ ...form, date: e.target.value })
          }
        />

        <input
          placeholder="Note"
          value={form.note}
          onChange={(e) =>
            setForm({ ...form, note: e.target.value })
          }
        />

        <button disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Service</th>
            <th>Amount</th>
            <th>By</th>
            {isAdmin && <th />}
          </tr>
        </thead>

        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.date).toLocaleDateString()}</td>
              <td>
                {services.find(x => x.id === s.service)?.emoji}{" "}
                {services.find(x => x.id === s.service)?.name}
              </td>
              <td>{s.amount}</td>
              <td>{s.created_by}</td>

              {isAdmin && (
                <td>
                  <button onClick={() => remove(s.id)}>
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}