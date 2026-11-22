// Backend permission test: runs the REAL admin-backend/server.js (copied with
// three substitutions) against the in-memory fake Supabase. No real keys, no
// network except localhost. Usage (from admin-backend/): npm test
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

// Defaults to the admin-backend folder this test lives in; a different
// folder (e.g. a copy of an older server.js) can be passed as an argument.
const backendDir = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const src = fs.readFileSync(path.join(backendDir, "server.js"), "utf8")
const swaps = [
  ['import { createClient } from "@supabase/supabase-js";', 'import { createClient } from "./__harness_fake_supabase.mjs";'],
  ["dotenv.config();", "/* dotenv disabled in harness: never load real secrets */"],
  ["app.listen(PORT, () => console.log(`🚀 Admin backend running on port ${PORT}`));", "export const __server = app.listen(0);"],
]
let code = src
for (const [a, b] of swaps) {
  if (!code.includes(a)) throw new Error("harness substitution not found: " + a)
  code = code.replace(a, b)
}
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k]
const serverCopy = path.join(backendDir, "__harness_server.mjs")
const fakeCopy = path.join(backendDir, "__harness_fake_supabase.mjs")
fs.writeFileSync(serverCopy, code)
fs.copyFileSync(new URL("./fake_supabase.mjs", import.meta.url), fakeCopy)

let pass = 0, fail = 0
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name, extra) } }

try {
  const fake = await import(pathToFileURL(fakeCopy).href)
  const { state } = fake
  const people = {
    owner1:    { grants: [["stv-pos", "owner"], ["stv-web", "owner"], ["platform-admin", "owner"]] }, // like the real website admin
    owner2:    { grants: [["stv-pos", "owner"]] },
    admin:     { grants: [["stv-pos", "admin"]] },
    manager:   { grants: [["stv-pos", "manager"]] },
    developer: { grants: [["stv-pos", "developer"]] },
    worker:    { grants: [["stv-pos", "worker"]] },
    worker2:   { grants: [["stv-pos", "worker"]] },
    numaOwner: { grants: [["numa-web", "owner"]] },
  }
  for (const [id, p] of Object.entries(people)) {
    state.users[id] = { id, email: `${id}@example.test` }
    state.tokens["tok-" + id] = id
    for (const [app, role] of p.grants) state.grants.push({ user_id: id, app, role, revoked_at: null })
  }

  const { __server } = await import(pathToFileURL(serverCopy).href)
  await new Promise((r) => __server.listening ? r() : __server.once("listening", r))
  const base = `http://127.0.0.1:${__server.address().port}`
  const call = async (who, method, url, body) => {
    const before = state.calls.length
    const res = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer tok-${who}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, json, mutated: state.calls.length > before }
  }

  const endpoints = [
    ["GET", "/admin/users"],
    ["POST", "/admin/users", { email: "x@example.test", password: "Xx123456!", role: "worker" }],
    ["PATCH", "/admin/role", { userId: "worker", role: "admin" }],
    ["PATCH", "/admin/role", { userId: "admin", role: "owner" }],          // self-promotion attempt for admin
    ["DELETE", "/admin/role/worker"],
    ["PATCH", "/admin/active", { userId: "owner2", active: false }],
    ["POST", "/admin/reset-password", { email: "owner2@example.test" }],
    ["DELETE", "/admin/users/owner2"],
  ]

  console.log("Non-owners are refused on every user-management endpoint (and nothing is executed):")
  for (const who of ["admin", "manager", "developer", "worker", "numaOwner"]) {
    for (const [m, u, b] of endpoints) {
      const r = await call(who, m, u, b)
      check(`${who.padEnd(9)} ${m.padEnd(6)} ${u} -> 403, no mutation`, r.status === 403 && !r.mutated, JSON.stringify(r))
    }
  }
  for (const [m, u, b] of endpoints) {
    const r = await call(null, m, u, b)
    check(`no token  ${m.padEnd(6)} ${u} -> 401, no mutation`, r.status === 401 && !r.mutated, JSON.stringify(r))
  }

  console.log("Owner can manage ordinary POS accounts:")
  let r = await call("owner2", "GET", "/admin/users")
  check("owner lists users", r.status === 200 && Array.isArray(r.json))
  r = await call("owner2", "POST", "/admin/users", { email: "new@example.test", password: "Xx123456!", role: "worker" })
  check("owner creates a worker", r.status === 200 && r.mutated)
  r = await call("owner2", "PATCH", "/admin/role", { userId: "worker", role: "admin" })
  check("owner promotes worker -> admin", r.status === 200 && r.mutated)
  r = await call("owner2", "PATCH", "/admin/active", { userId: "worker2", active: false })
  check("owner disables a worker", r.status === 200 && r.mutated)
  r = await call("owner2", "POST", "/admin/reset-password", { email: "worker2@example.test" })
  check("owner resets a worker's password", r.status === 200 && r.mutated)
  r = await call("owner2", "DELETE", "/admin/role/developer")
  check("owner revokes a developer's POS access", r.status === 200 && r.mutated)

  console.log("Target protection (even for an Owner):")
  r = await call("owner2", "DELETE", "/admin/users/owner2")
  check("owner cannot delete own account", r.status === 403 && !r.mutated, JSON.stringify(r.json))
  r = await call("owner2", "PATCH", "/admin/role", { userId: "owner2", role: "worker" })
  check("owner cannot demote self", r.status === 403 && !r.mutated, JSON.stringify(r.json))
  r = await call("owner2", "PATCH", "/admin/active", { userId: "owner2", active: false })
  check("owner cannot ban self", r.status === 403 && !r.mutated)
  r = await call("owner2", "DELETE", "/admin/users/owner1")
  check("cannot delete an account that also runs the website/platform", r.status === 403 && !r.mutated, JSON.stringify(r.json))
  r = await call("owner2", "PATCH", "/admin/active", { userId: "owner1", active: false })
  check("cannot ban an account that also runs the website/platform", r.status === 403 && !r.mutated)
  r = await call("owner2", "POST", "/admin/reset-password", { email: "owner1@example.test" })
  check("cannot reset password of a cross-app account", r.status === 403 && !r.mutated)
  r = await call("owner2", "DELETE", "/admin/users/numaOwner")
  check("cannot delete a NUMA-only account from the POS", r.status === 403 && !r.mutated)
  r = await call("owner2", "POST", "/admin/reset-password", { email: "nobody@example.test" })
  check("reset for unknown email -> 404, nothing sent", r.status === 404 && !r.mutated)

  console.log("Itinerary AI stays Owner+Admin:")
  for (const [who, allowed] of [["owner2", true], ["admin", true], ["manager", false], ["developer", false], ["worker2", false]]) {
    r = await call(who, "POST", "/admin/itinerary/personalize", { facts: {} })
    check(`${who} personalize -> ${allowed ? "not 403" : "403"}`, allowed ? r.status !== 403 && r.status !== 401 : r.status === 403, `got ${r.status}`)
  }

  __server.close()
} finally {
  fs.rmSync(serverCopy, { force: true })
  fs.rmSync(fakeCopy, { force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
