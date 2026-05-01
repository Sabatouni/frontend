import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext.jsx";

const todayStr = () => new Date().toISOString().split("T")[0];
const TZS = (n) => `TZS ${Number(n || 0).toLocaleString()}`;

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

  // 🔄 Load everything
  async function load() {
    try {
      const { data: salesData } = await supabase
        .from("sales")
        .select("*")
        .order("date", { ascending: false });

      const { data: servicesData } = await supabase
        .from("services")
        .select("*");

      setSales(salesData || []);
      setServices(servicesData || []);

      // auto select first service
      if (servicesData?.length && !form.service) {
        setForm((f) => ({ ...f, service: servicesData[0].id }));
      }
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
      if (!form.amount || Number(form.amount) <= 0) {
        throw new Error("Enter valid amount");
      }

      const { error } = await supabase.from("sales").insert([
        {
          service: form.service,
          amount: Number(form.amount),
          note: form.note,
          date: new Date(form.date).toISOString(),
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

  // 🎨 get service color
  function getColor(id) {
    return services.find((s) => s.id === id)?.color || "#999";
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Record a sale</h2>

      {/* ➕ ADD SERVICE BUTTON */}
      {isAdmin && (
        <button
          onClick={() =>
            window.dispatchEvent(new Event("openAddService"))
          }
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "#3D405B",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ➕ Add Service
        </button>
      )}

      {/* FORM */}
      <form className="panel" onSubmit={submit}>
        <div className="form-grid">

          <label>
            Service
            <select
              value={form.service}
              onChange={(e) =>
                setForm({ ...form, service: e.target.value })
              }
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Amount
            <input
              type="number"
              required
              value={form.amount}
              onChange={(e) =>
                setForm({ ...form, amount: e.target.value })
              }
            />
          </label>

          <label>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) =>
                setForm({ ...form, date: e.target.value })
              }
            />
          </label>
        </div>

        <label>
          Notes
          <input
            value={form.note}
            onChange={(e) =>
              setForm({ ...form, note: e.target.value })
            }
            placeholder="Optional..."
          />
        </label>

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

      {/* TABLE */}
      <h2>Recent sales</h2>

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th>Amount</th>
              <th>Note</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>

          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.date).toLocaleDateString()}</td>

                <td>
                  <span
                    style={{
                      background: getColor(s.service) + "22",
                      color: getColor(s.service),
                      padding: "4px 8px",
                      borderRadius: 6,
                      fontWeight: 600,
                    }}
                  >
                    {services.find(x => x.id === s.service)?.name || s.service}
                  </span>
                </td>

                <td style={{ fontWeight: 600 }}>
                  {TZS(s.amount)}
                </td>

                <td>{s.note || "—"}</td>

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

            {sales.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="muted">
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