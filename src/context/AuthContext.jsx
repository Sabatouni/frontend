import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { fetchMyPermissions, ROLE_LEVELS } from "../lib/permissions";

// Swahili Tent Village POS. Every permission check in this app is scoped to
// this slug and this slug only -- a Worker (or Admin, or Owner) here has
// zero standing anywhere else (stv-web, numa-web, ulphoria-web, alie-web),
// because loadPermissions() below only ever reads the grant matching this
// application, never anything project-wide.
const APP_SLUG = "stv-pos";

// Hard ceiling on how long we wait for Supabase to resolve the initial auth
// state before giving up and treating the visitor as signed out. This is a
// failsafe only -- normally onAuthStateChange fires within milliseconds --
// but if session restore ever hangs (see the incident notes below), the app
// must still leave "Checking access..." instead of hanging forever.
const AUTH_INIT_TIMEOUT_MS = 10000;

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
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
    let settled = false;

    // Single source of truth for auth initialization.
    //
    // We deliberately do NOT also call supabase.auth.getSession() here.
    // onAuthStateChange() already fires once, immediately, with whatever
    // session currently exists (Supabase's documented initial-session
    // behavior) and then again on every subsequent sign-in/out/refresh --
    // calling getSession() as well just duplicates that first call.
    //
    // That duplication is what caused the "stuck on Checking access..."
    // incident this code fixes: two concurrent calls into the Supabase auth
    // client on mount both tried to acquire its internal navigator.locks-
    // based session lock (visible in the console as `Lock "lock:sb-...-
    // auth-token" was not released within 5000ms ... Forcefully acquiring
    // the lock to recover`). When a stale/expired token was already sitting
    // in localStorage, that contention left `ready` stuck at false forever
    // -- the app never left the loading screen, and never even issued the
    // permissions request, because the code never got past the stuck
    // session promise. Removing the redundant call removes the contention;
    // the timeout below is a backstop in case the single remaining call
    // ever hangs for an unrelated reason (network, corrupted token, etc).
    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange(async (_evt, nextSession) => {
        if (cancelled) return;
        const u = nextSession?.user || null;
        setSession(nextSession || null);
        setUser(u);
        if (u) {
          await loadPermissions();
        } else {
          setPermissions([]);
        }
        settled = true;
        if (!cancelled) setReady(true);
      });
      subscription = data?.subscription;
    } catch (err) {
      // Subscribing itself should never throw, but if it somehow does (or
      // the Supabase client failed to initialize -- see
      // api/supabaseClient.js), we still must not hang the UI.
      console.error("[Auth] failed to start auth listener:", err.message);
      settled = true;
      setUser(null);
      setSession(null);
      setPermissions([]);
      setReady(true);
    }

    // Failsafe: if the callback above never fires -- lock contention, a
    // hung network request during token refresh, or any other stuck
    // promise inside the Supabase client -- resolve into a safe signed-out
    // state instead of leaving `ready` false forever. This does not retry
    // or call getSession(); it just stops the app from hanging so the
    // visitor lands on the login screen and can try again.
    const timeoutId = setTimeout(() => {
      if (!settled && !cancelled) {
        console.error(
          `[Auth] session initialization did not resolve within ${AUTH_INIT_TIMEOUT_MS}ms -- falling back to signed-out state`
        );
        setUser(null);
        setSession(null);
        setPermissions([]);
        setReady(true);
      }
    }, AUTH_INIT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
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
    setSession(null);
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

  // Exposed so components that need to call the admin backend (UsersPage)
  // can read the current access token from context instead of independently
  // calling supabase.auth.getSession() themselves -- see adminFetch() in
  // App.jsx. Keeping session reads inside AuthProvider's single listener is
  // what avoids the auth-lock contention described above.
  const accessToken = session?.access_token || null;

  const value = useMemo(
    () => ({
      user,
      session,
      accessToken,
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
    [
      user,
      session,
      accessToken,
      role,
      roleLevel,
      isOwner,
      isWorker,
      hasAccess,
      permissions,
      ready,
      loadPermissions,
    ]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
