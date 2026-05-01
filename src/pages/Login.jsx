import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await login(username, password); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h2>🏕️ Swahili Tent Village POS</h2>
        <div className="form-grid">
          <label>Username<input value={username} onChange={(e)=>setU(e.target.value)} autoFocus required /></label>
          <label>Password<input type="password" value={password} onChange={(e)=>setP(e.target.value)} required /></label>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 14 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}