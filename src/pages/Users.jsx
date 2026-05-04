import { useEffect, useState } from "react";
import { ADMIN_API } from "../api";
import { supabase } from "../api/supabaseClient";

const ROLES = ["WORKER", "ADMIN"];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");

  // 🔑 Get token safely
  async function getToken() {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data?.session?.access_token) {
      throw new Error("Not logged in");
    }

    return data.session.access_token;
  }

  // 🔄 Load users
  async function load() {
    try {
      setErr("");

      const token = await getToken();

      const url = `${ADMIN_API}/users`;
      console.log("Fetching:", url);

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // 👇 SAFE parsing
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("RAW RESPONSE:", text);
        throw new Error("Server returned HTML instead of JSON → wrong API URL");
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to load users");
      }

      setUsers(data);
    } catch (e) {
      setErr(e.message);
      console.error(e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 🔄 Change role
  async function changeRole(id, role) {
    try {
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
    } catch (e) {
      setErr(e.message);
    }
  }

  // 🔄 Toggle active
  async function toggleActive(id, active) {
    try {
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
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <h2>Users</h2>

      {err && (
        <div className="error" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

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

          {users.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: "center", padding: 20 }}>
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}