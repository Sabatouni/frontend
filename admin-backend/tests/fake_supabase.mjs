// In-memory stand-in for @supabase/supabase-js used ONLY by the backend
// permission test harness. Records every mutation the server attempts.
export const state = {
  users: {},      // id -> { id, email }
  grants: [],     // { user_id, app, role, revoked_at }
  tokens: {},     // token -> user id
  calls: [],      // mutations attempted: { op, ...args }
}

function rowsFor(table) {
  if (table === "user_application_roles") {
    return state.grants.filter((g) => g.revoked_at === null).map((g) => ({
      user_id: g.user_id, revoked_at: null, roles: { slug: g.role }, applications: { slug: g.app },
    }))
  }
  if (table === "profiles") return Object.values(state.users).map((u) => ({ id: u.id, email: u.email }))
  return []
}

function get(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj) }

function query(table) {
  const filters = []
  const q = {
    select() { return q },
    eq(col, val) { filters.push((r) => get(r, col) === val); return q },
    is(col, val) { filters.push((r) => (get(r, col) ?? null) === val); return q },
    ilike(col, val) { filters.push((r) => String(get(r, col) || "").toLowerCase() === String(val).toLowerCase()); return q },
    run() { return rowsFor(table).filter((r) => filters.every((f) => f(r))) },
    maybeSingle() {
      const rows = q.run()
      if (rows.length > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } })
      return Promise.resolve({ data: rows[0] || null, error: null })
    },
    then(resolve, reject) { return Promise.resolve({ data: q.run(), error: null }).then(resolve, reject) },
  }
  return q
}

export function createClient() {
  return {
    from: (table) => query(table),
    rpc: async (fn, args) => {
      state.calls.push({ op: fn, ...args })
      if (fn === "grant_application_role") {
        state.grants.forEach((g) => { if (g.user_id === args.p_user_id && g.app === args.p_application_slug) g.revoked_at = "now" })
        state.grants.push({ user_id: args.p_user_id, app: args.p_application_slug, role: args.p_role_slug, revoked_at: null })
      }
      if (fn === "revoke_application_role") {
        state.grants.forEach((g) => { if (g.user_id === args.p_user_id && g.app === args.p_application_slug) g.revoked_at = "now" })
      }
      return { data: null, error: null }
    },
    auth: {
      getUser: async (token) => {
        const id = state.tokens[token]
        return id ? { data: { user: state.users[id] }, error: null } : { data: null, error: { message: "bad token" } }
      },
      resetPasswordForEmail: async (email) => { state.calls.push({ op: "resetPassword", email }); return { data: {}, error: null } },
      admin: {
        listUsers: async () => ({ data: { users: Object.values(state.users) }, error: null }),
        createUser: async ({ email }) => {
          const id = "new-" + email
          state.users[id] = { id, email }
          state.calls.push({ op: "createUser", email })
          return { data: { user: state.users[id] }, error: null }
        },
        updateUserById: async (id, attrs) => { state.calls.push({ op: "updateUser", id, ...attrs }); return { data: { id }, error: null } },
        deleteUser: async (id) => { state.calls.push({ op: "deleteUser", id }); return { data: {}, error: null } },
      },
    },
  }
}
