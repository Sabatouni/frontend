import { useEffect, useState } from "react";
import { ADMIN_API } from "../api";
import { supabase } from "../api/supabaseClient";

const ROLES = ["WORKER", "ADMIN"];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    try {
      const token = await getToken();

      const res = await fetch(`${ADMIN_API}/users`, {
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

  async function changeRole(id, role) {
    const token = await getToken();

    await fetch(`${ADMIN_API}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: id, role }),
    });

    load();
  }

  async function toggleActive(id, active) {
    const token = await getToken();

    await fetch(`${ADMIN_API}/active`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: id, active }),
    });

    load();
  }

  return (
    <>
      <h2>Users</h2>
      {err && <div className="error">{err}</div>}

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
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

              <td>{u.banned ? "Disabled" : "Active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}