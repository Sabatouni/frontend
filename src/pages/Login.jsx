import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr]           = useState("");
  const [busy, setBusy]         = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#F8FAFC",
    }}>
      <div style={{
        width: 380,
        background: "#fff",
        border: "1px solid #E2E8F0",
        borderRadius: 16,
        padding: "36px 32px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "#6366F1",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>
            ⛺
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1E293B" }}>Swahili Tent Village</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>POS System</div>
          </div>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1E293B", marginBottom: 6 }}>
          Sign in
        </h2>
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
          Enter your credentials to continue
        </p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{
              display: "block",
              fontSize: 11, fontWeight: 600, color: "#64748B",
              textTransform: "uppercase", letterSpacing: "0.05em",
              marginBottom: 6,
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              placeholder="you@example.com"
              style={{
                width: "100%", padding: "9px 12px",
                borderRadius: 8, border: "1px solid #E2E8F0",
                background: "#F8FAFC", fontSize: 13, color: "#1E293B",
                outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = "#6366F1"}
              onBlur={e => e.target.style.borderColor = "#E2E8F0"}
            />
          </div>

          <div>
            <label style={{
              display: "block",
              fontSize: 11, fontWeight: 600, color: "#64748B",
              textTransform: "uppercase", letterSpacing: "0.05em",
              marginBottom: 6,
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: "100%", padding: "9px 12px",
                borderRadius: 8, border: "1px solid #E2E8F0",
                background: "#F8FAFC", fontSize: 13, color: "#1E293B",
                outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = "#6366F1"}
              onBlur={e => e.target.style.borderColor = "#E2E8F0"}
            />
          </div>

          {err && (
            <div style={{
              fontSize: 12, color: "#EF4444",
              background: "#FEF2F2", padding: "8px 12px",
              borderRadius: 7, border: "1px solid #FECACA",
            }}>
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 4,
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "#6366F1",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}