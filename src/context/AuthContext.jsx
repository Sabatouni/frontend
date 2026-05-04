import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../api/supabaseClient";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null);
  const [role, setRole]   = useState(null);
  const [ready, setReady] = useState(false);

  function extractRole(u) {
    const r = u?.user_metadata?.role || "";
    return r.toLowerCase();               // "admin" | "owner" | "worker" | ""
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user || null;
      setUser(u);
      setRole(extractRole(u));
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user || null;
      setUser(u);
      setRole(extractRole(u));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setUser(data.user);
    setRole(extractRole(data.user));
    return data.user;
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
  }

  // isOwner: true for "owner", "admin", "ADMIN", "OWNER"
  const isOwner = ["owner", "admin"].includes(role);

  const value = useMemo(
    () => ({ user, role, isOwner, login, logout, ready }),
    [user, role, ready]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
