import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { fetchMyPermissions, ROLE_LEVELS } from "../lib/permissions";

// Swahili Tent Village POS. Every permission check in this app is scoped to
// this slug and this slug only -- a Worker (or Admin, or Owner) here has
// zero standing anywhere else (stv-web, numa-web, ulphoria-web, alie-web),
// because loadPermissions() below only ever reads the grant matching this
// application, never anything project-wide.
const APP_SLUG = "stv-pos";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [ready, setReady] = useState(false);

  const loadPermissions = useCallback(async () => {
    try {
      const perms = await fetchMyPermissions();
      setPermissions(perms);
    } catch (err) {
      console.error("[Auth] failed to load permissions:", err.message);
      setPermissions([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const u = data?.session?.user || null;
      if (cancelled) return;
      setUser(u);
      if (u) await loadPermissions();
      if (!cancelled) setReady(true);
    });

    // Covers sign-in, sign-out, and token refresh. Permissions are re-fetched
    // on every transition so a role change (grant/revoke) takes effect the
    // next time the session is touched, without requiring a hard reload.
    const { data: listener } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (cancelled) return;
      const u = session?.user || null;
      setUser(u);
      if (u) {
        await loadPermissions();
      } else {
        setPermissions([]);
      }
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadPermissions]);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setPermissions([]);
  }

  const grant = useMemo(
    () => permissions.find((p) => p.application_slug === APP_SLUG) || null,
    [permissions]
  );
  const role = grant?.role_slug || null;
  const roleLevel = role ? (ROLE_LEVELS[role] ?? grant.role_level) : null;

  // Kept as `isOwner` because every existing component already reads this
  // name (Sidebar, SalesPage, ExpensesPage, ...). It means "admin-or-above
  // on stv-pos", matching the app's existing two-tier UI: elevated
  // (owner/admin) vs Worker. There is currently no UI distinction between
  // Owner and Admin in this app -- `role`/`roleLevel` are exposed below for
  // any future screen that needs the finer-grained value.
  const isOwner = roleLevel !== null && roleLevel >= ROLE_LEVELS.admin;
  const isWorker = role === "worker";
  const hasAccess = !!grant;

  const value = useMemo(
    () => ({
      user,
      role,
      roleLevel,
      isOwner,
      isWorker,
      hasAccess,
      permissions,
      login,
      logout,
      ready,
      refresh: loadPermissions,
    }),
    [user, role, roleLevel, isOwner, isWorker, hasAccess, permissions, ready, loadPermissions]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
