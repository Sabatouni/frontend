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

  function getColor(id) {
    return services.find((s) => s.id === id)?.color || "#999";
  }

  return (
    <div>
      {/* HEADER */}
      <h1 style={{ fontSize: 32, marginBottom: 10 }}>Sales</h1>
      <p style={{ color: "#777", marginBottom: 24 }}>
        Record and track all business sales
      </p>

      {/* ADD SERVICE BUTTON */}
      {isAdmin && (
        <button
          onClick={() =>
            window.dispatchEvent(new Event("openAddService"))
          }
          style={{
            marginBottom: 20,
            padding: "10px 16px",
            background: "#2A2D40",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ➕ Add Service
        </button>
      )}

      {/* FORM CARD */}
      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
          marginBottom: 30,
        }}
      >
        <h3 style={{ marginBottom: 16 }}>New Sale</h3>

        {/* SERVICE BUTTONS */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setForm({ ...form, service: s.id })}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "2px solid #eee",
                background:
                  form.service === s.id ? s.color : "#fff",
                color:
                  form.service === s.id ? "#fff" : "#333",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* INPUTS */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input
            type="number"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) =>
              setForm({ ...form, amount: e.target.value })
            }
            style={inputStyle}
          />

          <input
            type="date"
            value={form.date}
            onChange={(e) =>
              setForm({ ...form, date: e.target.value })
            }
            style={inputStyle}
          />
        </div>

        <input
          placeholder="Notes (optional)"
          value={form.note}
          onChange={(e) =>
            setForm({ ...form, note: e.target.value })
          }
          style={{ ...inputStyle, width: "100%" }}
        />

        {err && <p style={{ color: "red" }}>{err}</p>}

        <button
          onClick={submit}
          disabled={busy}
          style={{
            marginTop: 14,
            padding: "10px 18px",
            background: "#81B29A",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {busy ? "Saving..." : "Save Sale"}
        </button>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#F7F5F0" }}>
            <tr>
              <th style={th}>Date</th>
              <th style={th}>Service</th>
              <th style={th}>Amount</th>
              <th style={th}>Note</th>
              {isAdmin && <th style={th}></th>}
            </tr>
          </thead>

          <tbody>
            {sales.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={td}>
                  {new Date(s.date).toLocaleDateString()}
                </td>

                <td style={td}>
                  <span
                    style={{
                      background: getColor(s.service) + "22",
                      color: getColor(s.service),
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontWeight: 600,
                    }}
                  >
                    {services.find((x) => x.id === s.service)?.name || s.service}
                  </span>
                </td>

                <td style={{ ...td, fontWeight: 700 }}>
                  {TZS(s.amount)}
                </td>

                <td style={td}>{s.note || "—"}</td>

                {isAdmin && (
                  <td style={td}>
                    <button
                      onClick={() => remove(s.id)}
                      style={{
                        background: "#E07A5F",
                        color: "#fff",
                        border: "none",
                        padding: "6px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {sales.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#888" }}>
                  No sales yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* 🎨 STYLES */
const inputStyle = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  fontSize: 14,
};

const th = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 12,
  color: "#666",
};

const td = {
  padding: "12px 16px",
  fontSize: 14,
};