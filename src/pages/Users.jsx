import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";

const API = "http://localhost:3001/admin";
const ROLES = ["WORKER", "ADMIN"];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");

  // 🔑 Get access token
  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  // 🔄 Load users
  async function load() {
    try {
      const token = await getToken();

      const res = await fetch(`${API}/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");

      setUsers(data);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 🔄 Change role
  async function changeRole(id, role) {
    try {
      const token = await getToken();

      const res = await fetch(`${API}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: id, role }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  // 🔄 Enable / disable
  async function toggleActive(id, active) {
    try {
      const token = await getToken();

      const res = await fetch(`${API}/active`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: id, active }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  // 🔄 Reset password
  async function reset(email) {
    try {
      const token = await getToken();

      const res = await fetch(`${API}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert("Password reset email sent");
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Users</h2>

      {err && <div className="error">{err}</div>}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>

                <td>
                  <select
                    value={u.user_metadata?.role || "WORKER"}
                    onChange={(e) =>
                      changeRole(u.id, e.target.value)
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>

                <td>{u.banned ? "no" : "yes"}</td>

                <td>
                  {u.created_at
                    ? new Date(u.created_at).toLocaleDateString()
                    : ""}
                </td>

                <td className="row">
                  <button
                    onClick={() => toggleActive(u.id, !u.banned)}
                  >
                    {u.banned ? "Enable" : "Disable"}
                  </button>

                  <button onClick={() => reset(u.email)}>
                    Reset Password
                  </button>
                </td>
              </tr>
            ))}

            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 18 }}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}