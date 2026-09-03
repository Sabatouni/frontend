import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { fetchMyPermissions, ROLE_LEVELS } from "../lib/permissions";

// Swahili Tent Village POS. Every permission check in this app is scoped to
// this slug and this slug only -- a Worker (or Admin, or Owner) here has
// zero standing anywhere else (stv-web, numa-web, ulphoria-web, alie-web),
// because loadPermissions() below only ever reads the grant matching this
// application, never anything project-wide.
const APP_SLUG = "stv-pos";

// Hard ceiling on how long we wait for Supabase to resolve the initial auth
// SESSION before giving up and treating the visitor as signed out. This is a
// failsafe only -- normally onAuthStateChange fires within milliseconds --
// but if session restore ever hangs (see the incident notes below), the app
// must still leave "checking" instead of hanging forever.
//
// Note: this timeout covers session restore ONLY, not the permission check
// that follows it. Those two used to be a single blocking chain (see the
// "PERMISSIONS_TIMEOUT_MS" note below for why they were split).
const AUTH_INIT_TIMEOUT_MS = 10000;

// Separate failsafe for the permission RPC (fetchMyPermissions), which is a
// network call and can therefore hang or stall independently of the (local,
// fast) session restore above. Before this change, the app waited for BOTH
// steps before rendering anything, so a single timeout covered both. Now
// that rendering no longer waits on the permission check (see "ready" vs
// "permissionsPending" below), that check needs its own bound so a stuck or
// very slow permissions request can't leave the app showing a loading state
// forever for a first-time/unknown-on-this-device user.
const PERMISSIONS_TIMEOUT_MS = 10000;

// Cached, NON-authoritative UI hint so a returning, already-authenticated
// user doesn't have to stare at a loading screen on every refresh while we
// re-verify their permissions over the network. This is intentionally
// namespaced (not just "auth" or "role") and intentionally minimal:
//
//   { userId, role, roleLevel, isOwner, hasAccess, displayName }
//
// No password, token, or session data ever goes in here -- accessToken
// always comes from the real Supabase session (see `session` below), never
// from this cache, and no protected API/database call ever reads it. It
// exists purely so App.jsx can paint the right shell (Owner nav vs Worker
// nav, dashboard vs "no access") on the very first render after a refresh,
// before the real permission check has had a chance to come back. The real
// check (loadPermissions, backed by the my_permissions() RPC -> Postgres
// RLS) always runs in the background and always wins: see hasAccess/role/
// isOwner below, which only ever trust this hint while permissionsLoaded is
// still false, and get overwritten the moment the real result arrives.
const AUTH_HINT_KEY = "stv-pos-auth-hint";

function readAuthHint() {
  try {
    const raw = localStorage.getItem(AUTH_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.userId) return null;
    return parsed;
  } catch {
    // Corrupted JSON, storage disabled (private browsing), quota issues,
    // etc. -- a missing hint just means "fall back to the loading state",
    // never a crash.
    return null;
  }
}

function writeAuthHint(hint) {
  try {
    localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage unavailable/full -- optimistic UI is a nice-to-have, not a
    // requirement, so silently skip caching rather than breaking auth.
  }
}

function clearAuthHint() {
  try {
    localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // Nothing to do if storage itself is unavailable.
  }
}

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [ready, setReady] = useState(false);

  // Has the REAL permission check (fetchMyPermissions, or its timeout/error
  // fallback) settled at least once for the current signed-in user? While
  // this is false, hasAccess/role/isOwner below fall back to the cached
  // hint (if it matches the current user) purely for optimistic rendering.
  // The moment it flips true, the real result takes over unconditionally --
  // this is what makes the hint non-authoritative.
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  // Read once, synchronously, at mount -- this is what lets the very first
  // render after a refresh already know "this browser was previously an
  // authenticated, permitted user" without waiting on anything async.
  const [hint] = useState(() => readAuthHint());

  // Tracks the most recently seen signed-in user id so a same-user token
  // refresh doesn't reset permissionsLoaded (which would otherwise flicker
  // the UI back into a pending state on every silent refresh), while a
  // genuine switch to a *different* user id (in principle possible without
  // an intervening signed-out event) still gets treated as unverified until
  // the real check runs for them -- this app's own UI can't reach that
  // path (LoginPage only renders when signed out), but AuthProvider
  // shouldn't rely on that to stay safe on a shared device.
  const lastUserIdRef = useRef(null);

  const loadPermissions = useCallback(async (currentUser) => {
    let permSettled = false;
    const timeoutId = setTimeout(() => {
      if (permSettled) return;
      permSettled = true;
      console.error(
        `[Auth] permission check did not resolve within ${PERMISSIONS_TIMEOUT_MS}ms -- failing closed until it does`
      );
      setPermissions([]);
      setPermissionsLoaded(true);
    }, PERMISSIONS_TIMEOUT_MS);

    try {
      const perms = await fetchMyPermissions();
      clearTimeout(timeoutId);
      permSettled = true;
      setPermissions(perms);

      // Refresh the cached hint from the REAL result -- keeps it accurate
      // for next time, and makes sure a revoked user's stale "had access"
      // hint can never outlive the check that revoked it.
      const grant = perms.find((p) => p.application_slug === APP_SLUG) || null;
      if (currentUser && grant) {
        const grantRole = grant.role_slug || null;
        const grantRoleLevel = grantRole ? (ROLE_LEVELS[grantRole] ?? grant.role_level) : null;
        writeAuthHint({
          userId: currentUser.id,
          role: grantRole,
          roleLevel: grantRoleLevel,
          isOwner: grantRoleLevel !== null && grantRoleLevel >= ROLE_LEVELS.admin,
          hasAccess: true,
          displayName: currentUser.user_metadata?.name || currentUser.email?.split("@")[0] || null,
        });
      } else {
        clearAuthHint();
      }
    } catch (err) {
      // Transient/network failure -- this is the same fail-closed fallback
      // that already existed before this change (permissions -> []); it's
      // deliberately left as-is rather than redesigned. The important
      // behavior change is only that it no longer blocks the entire app
      // from rendering while it's in flight (see `ready` below).
      if (!permSettled) {
        clearTimeout(timeoutId);
        permSettled = true;
        console.error("[Auth] failed to load permissions:", err.message);
        setPermissions([]);
      }
    } finally {
      setPermissionsLoaded(true);
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
    //
    // What changed for the "Checking access..." FLASH (as opposed to the
    // hang, which was already fixed): `ready` now flips true as soon as
    // THIS callback fires -- i.e. as soon as the session itself is known --
    // instead of also waiting for loadPermissions() to finish. The
    // permission check still starts here, still runs every time this event
    // fires (exactly as before), it just does so in the background instead
    // of blocking the first paint. See permissionsLoaded/permissionsPending
    // for how the UI stays safe while that's in flight.
    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange((_evt, nextSession) => {
        if (cancelled) return;
        const u = nextSession?.user || null;
        setSession(nextSession || null);
        setUser(u);
        settled = true;
        if (!cancelled) setReady(true);

        if (u) {
          if (lastUserIdRef.current !== u.id) {
            // First user we've seen this mount, or a genuine switch to a
            // different user -- don't let a previous user's resolved
            // permissions/hint-match state leak into this one while the
            // real check for THIS user is in flight.
            lastUserIdRef.current = u.id;
            setPermissions([]);
            setPermissionsLoaded(false);
          }
          loadPermissions(u);
        } else {
          lastUserIdRef.current = null;
          setPermissions([]);
          setPermissionsLoaded(true);
          // No session -- any cached "was authenticated" hint is now
          // stale. Clearing it here (in addition to logout() below) covers
          // sign-outs that don't go through our own logout button: an
          // expired/invalidated token, or a sign-out from another tab.
          clearAuthHint();
        }
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
      setPermissionsLoaded(true);
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
        setPermissionsLoaded(true);
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
    // Clear the cached hint synchronously, up front -- don't wait on the
    // signOut() round trip or the onAuthStateChange event it triggers. On a
    // shared device, the next person to open the POS must never see this
    // user's cached Owner/Admin UI, even for a moment.
    clearAuthHint();
    lastUserIdRef.current = null;
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setPermissions([]);
    setPermissionsLoaded(true);
  }

  const grant = useMemo(
    () => permissions.find((p) => p.application_slug === APP_SLUG) || null,
    [permissions]
  );
  const realRole = grant?.role_slug || null;
  const realRoleLevel = realRole ? (ROLE_LEVELS[realRole] ?? grant.role_level) : null;
  const realHasAccess = !!grant;

  // Does the cached hint apply to the CURRENTLY signed-in user? A hint from
  // a different user (or no hint at all) is never used -- this is the
  // namespacing that keeps a shared-device hint from leaking between
  // accounts.
  const hintMatchesUser = !!(hint && user && hint.userId === user.id);

  // True only when we have neither a real result NOR a usable hint to fall
  // back on -- i.e. a genuinely first-time/unknown-on-this-device session.
  // App.jsx shows a brief branded loading state for exactly this case, and
  // only this case; a returning user with a matching hint never sees it.
  const permissionsPending = !permissionsLoaded && !hintMatchesUser;

  // The real permission result always wins once it's in. Until then, an
  // optimistic UI hint (never authoritative, never used for API/database
  // calls) is used purely to avoid a loading flash for a returning user.
  const role = permissionsLoaded ? realRole : (hintMatchesUser ? hint.role : null);
  const roleLevel = permissionsLoaded ? realRoleLevel : (hintMatchesUser ? hint.roleLevel : null);
  const isOwner = permissionsLoaded ? (roleLevel !== null && roleLevel >= ROLE_LEVELS.admin) : (hintMatchesUser ? !!hint.isOwner : false);
  const isWorker = role === "worker";
  const hasAccess = permissionsLoaded ? realHasAccess : (hintMatchesUser ? !!hint.hasAccess : false);

  // Exposed so components that need to call the admin backend (UsersPage)
  // can read the current access token from context instead of independently
  // calling supabase.auth.getSession() themselves -- see adminFetch() in
  // App.jsx. Keeping session reads inside AuthProvider's single listener is
  // what avoids the auth-lock contention described above. Note this is
  // ALWAYS the real token from the real session -- never derived from the
  // cached hint, which holds no token/session data at all.
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
      permissionsPending,
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
      permissionsPending,
      ready,
      loadPermissions,
    ]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
