// Runs the operational-documents database tests in an ISOLATED, in-memory
// PostgreSQL 17 (PGlite -- real Postgres compiled to WASM). Never touches a
// Supabase project: nothing here reads .env or connects to the network.
//
//   1. fresh in-memory database
//   2. supabase/tests/local/supabase_stub.sql  (auth / storage / RBAC stand-ins
//      mirroring production definitions)
//   3. the migration under test, in one transaction -- then AGAIN, to prove
//      it is re-runnable
//   4. supabase/tests/stv_pos_operational_documents_rollback_test.sql
//
// PGlite is deliberately NOT a project dependency. Install it anywhere and
// point PGLITE_MODULE at it:
//   npm install --prefix <dir> @electric-sql/pglite@0.3.7
//   PGLITE_MODULE=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/tests/local/run_opsdocs_tests.mjs
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")
const MIGRATION = resolve(root, "supabase/migrations/20261122090000_stv_pos_operational_documents.sql")
const TEST = resolve(root, "supabase/tests/stv_pos_operational_documents_rollback_test.sql")

const mod = process.env.PGLITE_MODULE ? pathToFileURL(resolve(process.env.PGLITE_MODULE)).href : "@electric-sql/pglite"
const { PGlite } = await import(mod)

// psql meta-commands (\set, \echo) are not SQL; drop them for PGlite.
const sql = (file) => readFileSync(file, "utf8").split(/\r?\n/).filter(l => !l.startsWith("\\")).join("\n")

const db = new PGlite()
const step = async (label, text) => {
  process.stdout.write(`== ${label} ... `)
  await db.exec(text)
  console.log("ok")
}

try {
  console.log((await db.query("select version() as v")).rows[0].v)
  await step("load Supabase stub", sql(resolve(here, "supabase_stub.sql")))
  await step("apply migration (1 transaction)", `begin;\n${sql(MIGRATION)}\ncommit;`)
  await step("re-apply migration (idempotency)", `begin;\n${sql(MIGRATION)}\ncommit;`)
  process.stdout.write("== run tests ... ")
  const results = await db.exec(sql(TEST))
  const final = results.flatMap(r => r.rows).find(r => typeof r.result === "string")
  console.log("\n" + (final?.result ?? "no result row"))
  const after = (await db.query("select count(*)::int n from public.operational_documents")).rows[0].n
  console.log(`rows left in operational_documents after the test: ${after} (expect 0 -- rolled back)`)
  if (!final?.result?.startsWith("ALL ") || after !== 0) process.exitCode = 1
} catch (e) {
  console.log("FAILED")
  console.error(e.message)
  process.exitCode = 1
} finally {
  await db.close()
}
