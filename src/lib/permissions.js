import { supabase } from "../api/supabaseClient"

/**
 * Client-side mirror of the `roles` catalog ordering (owner > admin >
 * worker). This exists purely so the UI can decide what to *show* without
 * an extra round trip per check. It is NOT the authorization boundary --
 * every real read/write is still enforced by Postgres RLS via
 * has_minimum_role()/has_role()/has_application_access() on the database
 * side, using the exact same user_application_roles rows this ordering is
 * derived from. Nothing here can grant access the database wouldn't also
 * grant.
 */
export const ROLE_LEVELS = { owner: 30, admin: 20, worker: 10 }

/**
 * EXACT role checks -- the only helpers UI code should use to decide what a
 * user may see or do. They compare the real stv-pos role slug, never a
 * numeric level: a level comparison let developer/manager/editor/moderator/
 * support (database levels 40-70) inherit Owner screens, because the
 * client-side ROLE_LEVELS above (admin = 20) was compared against database
 * levels for roles it doesn't list. Unknown or missing roles get nothing.
 *
 * The database remains the authorization boundary (RLS + RPC checks use the
 * matching has_role(...) allowlists); these only mirror it in the UI.
 */
export function isOwnerRole(role) {
  return role === "owner"
}

/** Owner OR Admin -- only for modules approved as Owner+Admin. */
export function isOwnerOrAdminRole(role) {
  return role === "owner" || role === "admin"
}

/**
 * Fetches every application + role grant the current authenticated user
 * holds, across every application in this Supabase project, in one call.
 * Backed by the `my_permissions()` SQL function (SECURITY DEFINER, scoped
 * to auth.uid() -- a user can only ever see their own grants).
 */
export async function fetchMyPermissions() {
  const { data, error } = await supabase.rpc("my_permissions")
  if (error) throw error
  // Guard against a malformed/non-array RPC response (not just null/undefined)
  // -- callers do permissions.find(...) on this, which throws on anything
  // that isn't an array. An uncaught throw during AuthProvider's render would
  // crash the whole React tree with no error boundary, so this normalizes at
  // the source instead of trusting the shape of what the network returned.
  return Array.isArray(data) ? data : []
}
