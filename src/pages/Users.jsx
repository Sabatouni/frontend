import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const ROLES = ["WORKER", "ADMIN"];

export default function Users() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", role: "WORKER" });
  const [err, setErr] = useState("");

  async function load() { try { setItems(await api.listUsers()); } catch (e) { setErr(e.message); } }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault(); setErr("");
    try { await api.register(form); setForm({ username: "", password: "", fullName: "", role: "WORKER" }); load(); }
    catch (e) { setErr(e.message); }
  }

  async function toggleActive(u)  { try { await api.setUserActive(u.id, !u.active); load(); } catch (e) { setErr(e.message); } }
  async function changeRole(u, r) { try { await api.setUserRole(u.id, r); load(); } catch (e) { setErr(e.message); } }
  async function resetPw(u) {
    const pw = prompt(`New password for ${u.username} (min 6 chars):`);
    if (!pw) return;
    try { await api.resetUserPassword(u.id, pw); alert("Password reset."); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Create user</h2>
      <form className="panel" onSubmit={submit}>
        <div className="form-grid">
          <label>Username<input required minLength={3} value={form.username} onChange={(e)=>setForm({...form, username: e.target.value})}/></label>
          <label>Password<input type="password" required minLength={6} value={form.password} onChange={(e)=>setForm({...form, password: e.target.value})}/></label>
          <label>Full name<input value={form.fullName} onChange={(e)=>setForm({...form, fullName: e.target.value})}/></label>
          <label>Role<select value={form.role} onChange={(e)=>setForm({...form, role: e.target.value})}>{ROLES.map(r=><option key={r}>{r}</option>)}</select></label>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" style={{ marginTop: 12 }}>Create</button>
      </form>

      <h2>All users</h2>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Active</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td><td>{u.fullName}</td>
                <td>
                  <select value={u.role} onChange={(e)=>changeRole(u, e.target.value)}>
                    {ROLES.map(r=><option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>{u.active ? "yes" : "no"}</td>
                <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ""}</td>
                <td className="row">
                  <button onClick={()=>toggleActive(u)}>{u.active ? "Disable" : "Enable"}</button>
                  <button onClick={()=>resetPw(u)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}