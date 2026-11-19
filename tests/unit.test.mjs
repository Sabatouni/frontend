// Unit tests for pure STV POS logic (sales reporting + operational documents).
// Run with:  npm test     (uses the project's own Vite to resolve modules; no extra deps)
import { pathToFileURL, fileURLToPath } from "node:url"
import path from "node:path"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { createServer } = await import(pathToFileURL(path.join(root, "node_modules/vite/dist/node/index.js")).href)
import assert from "node:assert/strict"
const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom",
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") } })
let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name) } catch (e) { fail++; console.log("  ✗", name, "-", e.message) } }
try {
  const ops = await server.ssrLoadModule("/src/lib/opsDocuments.js")
  const sr = await server.ssrLoadModule("/src/lib/salesReporting.js")
  const wr = await server.ssrLoadModule("/src/lib/weeklyReports.js")

  ok("checklist template has all 8 sections / 63 items", () => {
    assert.equal(ops.CHECKLIST_TEMPLATE.length, 8)
    assert.equal(ops.CHECKLIST_TEMPLATE.flatMap(s => s.items).length, 9+9+11+7+8+6+8+5)
  })
  ok("equipment templates match source PDF (16 kitchen / 15 dining, totals)", () => {
    assert.equal(ops.KITCHEN_EQUIPMENT_TEMPLATE.length, 16)
    assert.equal(ops.DINING_EQUIPMENT_TEMPLATE.length, 15)
    assert.equal(ops.KITCHEN_EQUIPMENT_TEMPLATE.reduce((a, [, q]) => a + q, 0), 121)
    assert.equal(ops.DINING_EQUIPMENT_TEMPLATE.reduce((a, [, q]) => a + q, 0), 885)
  })
  ok("restock template = 4 shisha + 5 beverage items", () => {
    assert.deepEqual(ops.RESTOCK_TEMPLATE.map(s => s.items.length), [4, 5])
  })
  ok("summarizeChecklist counts inspected/good/fair/repair/missing", () => {
    const s = ops.summarizeChecklist([{ items: [
      { quantity: 3, condition: "Good" }, { quantity: "", condition: "Fair" }, { quantity: 1, condition: "Damaged" },
      { quantity: 0, condition: "" }, { quantity: "", condition: "" }, { quantity: 2, condition: "Good" } ] }])
    assert.deepEqual(s, { total_items: 6, total_inspected: 5, good: 2, fair: 1, needing_repair: 1, missing: 1 })
  })
  ok("summarizeEquipment totals + shortfall", () => {
    const s = ops.summarizeEquipment([
      { suggested_qty: 6, actual_qty: 4, missing_qty: 2, damaged_qty: "" },
      { suggested_qty: 8, actual_qty: 8, missing_qty: "", damaged_qty: 1 },
      { suggested_qty: 5, actual_qty: "", missing_qty: "", damaged_qty: "" } ])
    assert.deepEqual(s, { item_count: 3, total_suggested: 19, total_actual: 12, total_missing: 2, total_damaged: 1, items_counted: 2, shortfall_items: 1 })
  })
  ok("summarizeSafety", () => {
    assert.deepEqual(ops.summarizeSafety([{ status: "PASS" }, { status: "FAIL" }, { status: "NA" }, { status: "" }]), { total_checks: 4, passed: 1, failed: 1, not_checked: 1 })
  })
  ok("kart id normalisation/validation", () => {
    assert.equal(ops.normalizeKartId(" gk 01 "), "GK-01")
    assert.equal(ops.normalizeKartId("gk_01!"), "GK01")
    assert.ok(ops.isValidKartId("GK-01")); assert.ok(!ops.isValidKartId("-GK")); assert.ok(!ops.isValidKartId(""))
  })
  ok("client request ids are unique UUIDs", () => {
    const a = ops.newClientRequestId(), b = ops.newClientRequestId()
    assert.match(a, /^[0-9a-f-]{36}$/); assert.notEqual(a, b)
  })
  ok("CSV escaping: commas, quotes, newlines, formula injection, numbers", () => {
    assert.equal(sr.csvCell('Two meals, two juices'), '"Two meals, two juices"')
    assert.equal(sr.csvCell('He said "hi"'), '"He said ""hi"""')
    assert.equal(sr.csvCell("line1\nline2"), '"line1\nline2"')
    assert.equal(sr.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
    assert.equal(sr.csvCell(-5000), "-5000")
    assert.equal(sr.csvCell(null), "")
    assert.ok(sr.toCsv([["a","b"],[1,2]]).startsWith("\uFEFFa,b\r\n1,2"))
  })
  ok("saleDescription: description first, then the historical note", () => {
    assert.equal(sr.saleDescription({ description: null }), "")
    assert.equal(sr.saleDescription({}), "")
    assert.equal(sr.saleDescription({ description: "  Two rides  " }), "Two rides")
    // historical sales keep their description in sales.note
    assert.equal(sr.saleDescription({ description: null, note: " Sample meal note " }), "Sample meal note")
    assert.equal(sr.saleDescription({ description: "", note: "Sample rounds note" }), "Sample rounds note")
    assert.equal(sr.saleDescription({ description: "   ", note: "Sample tent note" }), "Sample tent note")
    // a real description always wins over the note
    assert.equal(sr.saleDescription({ description: "Two rides for two guests", note: "paid cash" }), "Two rides for two guests")
    assert.equal(sr.saleDescription({ description: null, note: null }), "")
  })
  ok("saleExtraNote: never repeats the note already shown as the description", () => {
    assert.equal(sr.saleExtraNote({ description: null, note: "Sample meal note" }), "")          // historical: note IS the description
    assert.equal(sr.saleExtraNote({ description: "Two rides", note: "paid cash" }), "paid cash")
    assert.equal(sr.saleExtraNote({ description: "Two rides", note: "Two rides" }), "")
    assert.equal(sr.saleExtraNote({ description: "Two rides", note: "" }), "")
  })
  ok("transaction rows: Date|Service|Description|Amount|Recorded By, sorted", () => {
    const rows = sr.buildSalesTransactionRows([
      { id: 2, date: "2026-11-12T09:00:00+00:00", service: "Go Kart", description: "Two rides purchased by two guests", amount: "40000", user_id: "u1" },
      { id: 1, date: "2026-11-10T09:00:00+00:00", service: "Restaurant", description: null, amount: 15000, user_id: "u2", note: "old" } ], { u1: "Asha" })
    assert.deepEqual(rows.map(r => [r.date, r.service, r.description, r.amount, r.recordedBy, r.note]),
      [["2026-11-10", "Restaurant", "old", 15000, "", ""], ["2026-11-12", "Go Kart", "Two rides purchased by two guests", 40000, "Asha", ""]])
  })
  ok("transaction rows: historical notes populate Description; expense rows unchanged", () => {
    const rows = sr.buildSalesTransactionRows([
      { id: "a", date: "2030-01-17T09:00:00+00:00", service: "Tent", description: null, note: "Sample tent note", amount: 123000 },
      { id: "b", date: "2030-01-18T09:00:00+00:00", service: "Restaurant", description: null, note: null, amount: 1000 },
      { id: "c", date: "2030-01-19T09:00:00+00:00", service: "Go Kart", description: "Two rides", note: "group booking", amount: 20000 } ])
    assert.deepEqual(rows.map(r => [r.description, r.note]), [["Sample tent note", ""], ["", ""], ["Two rides", "group booking"]])
    assert.equal(rows.reduce((a, r) => a + r.amount, 0), 144000) // totals untouched
    const ex = sr.buildExpenseTransactionRows([{ id: 1, date: "2030-01-10T09:00:00Z", category: "Restaurant", item: "Sample supplies", cost: 30000, note: null }])
    assert.deepEqual([ex[0].item, ex[0].amount, ex[0].note], ["Sample supplies", 30000, ""])
  })
  ok("search matches description / service / note / recorder", () => {
    const s = { service: "Paintball", description: "Group session for five participants", note: "", user_id: "u1" }
    assert.ok(sr.saleMatchesSearch(s, "FIVE")); assert.ok(sr.saleMatchesSearch(s, "asha", { u1: "Asha" }))
    assert.ok(!sr.saleMatchesSearch(s, "biryani")); assert.ok(sr.saleMatchesSearch(s, ""))
  })
  ok("period presets: today / Mon–Sun week / full month", () => {
    const now = new Date(2026, 10, 12) // Thu 12 Nov 2026
    assert.deepEqual(sr.presetRange("today", now), { from: "2026-11-12", to: "2026-11-12" })
    assert.deepEqual(sr.presetRange("week", now), { from: "2026-11-09", to: "2026-11-15" })
    assert.deepEqual(sr.presetRange("month", now), { from: "2026-11-01", to: "2026-11-30" })
    assert.deepEqual(sr.presetRange("week", new Date(2026, 10, 15)), { from: "2026-11-09", to: "2026-11-15" }) // Sunday
  })
  ok("date filter convention (from <= date <= to+'T99') includes boundary days", () => {
    const sales = [{ date: "2026-11-09T09:00:00+00:00", amount: 1 }, { date: "2026-11-15T21:00:00+00:00", amount: 2 }, { date: "2026-11-16T00:00:00+00:00", amount: 4 }]
    const f = sales.filter(s => s.date >= "2026-11-09" && s.date <= "2026-11-15T99")
    assert.equal(f.reduce((a, s) => a + s.amount, 0), 3)
  })
  ok("weekly snapshot carries description + recorded_by; totals unchanged", () => {
    const snap = wr.buildSalesSnapshot([
      { date: "2026-11-10T09:00:00Z", service: "Park Entry", description: "Family entry tickets for four guests", amount: 20000, user_id: "u1" },
      { date: "2026-11-11T09:00:00Z", service: "Restaurant", amount: 5000 } ], "2026-11-09", "2026-11-15", { u1: "Juma" })
    assert.deepEqual(snap[0], { date: "2026-11-10", item: "Park Entry", description: "Family entry tickets for four guests", amount: 20000, recorded_by: "Juma" })
    assert.equal(snap[1].description, "")
    assert.equal(wr.sumAmounts(snap), 25000)
  })
  ok("weekly snapshot: historical sales.note auto-populates Description; expenses keep item mapping", () => {
    const sales = [
      { date: "2030-01-17T09:00:00Z", service: "Tent", description: null, note: "Sample tent note", amount: 123000, user_id: "u1" },
      { date: "2030-01-18T09:00:00Z", service: "Go Kart", description: null, note: " Sample kart note ", amount: 30000 },
      { date: "2030-01-19T09:00:00Z", service: "Restaurant", description: "Two biryani meals", note: "Sample table note", amount: 24000 },
    ]
    const snap = wr.buildSalesSnapshot(sales, "2030-01-13", "2030-01-19", { u1: "Juma" })
    assert.deepEqual(snap.map(r => r.description), ["Sample tent note", "Sample kart note", "Two biryani meals"])
    assert.equal(wr.sumAmounts(snap), 177000)
    const exp = wr.buildExpenseSnapshot([{ date: "2030-01-18T09:00:00Z", item: "Sample fuel expense", cost: 50000, note: null }], "2030-01-13", "2030-01-19")
    assert.deepEqual(exp, [{ date: "2030-01-18", note: "Sample fuel expense", amount: 50000 }])
    const draft = wr.draftReportFromPeriod({ from: "2030-01-13", to: "2030-01-19", sales, expenses: [], preparedBy: "M" })
    assert.deepEqual(draft.sales_breakdown.map(r => r.description), ["Sample tent note", "Sample kart note", "Two biryani meals"])
    assert.equal(draft.gross_sales, 177000)
  })
  // ── "Fill empty descriptions only" (saved Weekly Manager's Reports) ─
  {
    const posSales = [
      { date: "2030-01-17T09:00:00Z", service: "Tent", description: null, note: "Sample tent note", amount: 123000 },
      { date: "2030-01-17T09:00:00Z", service: "Go Kart", description: null, note: "Sample rounds note", amount: 20000 },
      { date: "2030-01-18T09:00:00Z", service: "Restaurant", description: "Two biryani meals", note: "Sample table note", amount: 24000 },
      // two identical (date, service, amount) sales with DIFFERENT notes -> ambiguous
      { date: "2030-01-18T09:00:00Z", service: "Restaurant", description: null, note: "Sample drink A", amount: 1000 },
      { date: "2030-01-18T09:00:00Z", service: "Restaurant", description: null, note: "Sample drink B", amount: 1000 },
      // two identical sales with the SAME note -> safe to fill
      { date: "2030-01-19T09:00:00Z", service: "Games", description: null, note: "Sample game note", amount: 2000 },
      { date: "2030-01-19T09:00:00Z", service: "Games", description: null, note: "Sample game note", amount: 2000 },
      // a sale with no note at all
      { date: "2030-01-19T09:00:00Z", service: "Restaurant", description: null, note: null, amount: 3000 },
    ]
    // A saved report (pre-fix snapshot: no description key) with manual edits.
    const saved = [
      { date: "2030-01-17", item: "Tent", amount: 123000 },                                        // blank -> fill
      { date: "2030-01-17", item: "Go Kart", amount: 20000, description: "Manager typed: group of 2" }, // manual -> keep
      { date: "2030-01-18", item: "Restaurant", amount: 24000, description: "" },                  // blank -> fill (description wins)
      { date: "2030-01-18", item: "Restaurant", amount: 1000 },                                    // ambiguous -> blank
      { date: "2030-01-19", item: "Games", amount: 2000, recorded_by: "Juma" },                    // same note twice -> fill
      { date: "2030-01-19", item: "Restaurant", amount: 3000, description: "   " },                // POS has no note -> blank
      { date: "2030-01-20", item: "Manual adjustment", amount: 5000 },                             // not in POS -> blank
      { date: "2030-01-17", item: "tent ", amount: "123000", description: "Kept: edited text" },   // manual, also matchable -> keep
    ]
    const before = JSON.parse(JSON.stringify(saved))
    const res = wr.fillEmptySaleDescriptions(saved, posSales, "2030-01-13", "2030-01-20")

    ok("fill-empty: fills only blank descriptions from POS note/description", () => {
      assert.deepEqual(res.rows.map(r => r.description ?? null),
        ["Sample tent note", "Manager typed: group of 2", "Two biryani meals", null, "Sample game note", "   ", null, "Kept: edited text"])
      assert.deepEqual({ filled: res.filled, preserved: res.preserved, ambiguous: res.ambiguous, unmatched: res.unmatched, noPosDescription: res.noPosDescription },
        { filled: 3, preserved: 2, ambiguous: 1, unmatched: 1, noPosDescription: 1 })
    })
    ok("fill-empty: every existing manual description is preserved exactly", () => {
      for (const [i, r] of before.entries()) {
        if (String(r.description ?? "").trim()) assert.equal(res.rows[i].description, r.description, `row ${i} changed`)
      }
    })
    ok("fill-empty: amounts, dates, services, other fields and totals are unchanged", () => {
      res.rows.forEach((r, i) => {
        const { description: _a, ...restAfter } = r
        const { description: _b, ...restBefore } = before[i]
        assert.deepEqual(restAfter, restBefore, `row ${i} non-description fields changed`)
      })
      assert.equal(wr.sumAmounts(res.rows), wr.sumAmounts(before))
      assert.equal(res.rows.length, before.length)
    })
    ok("fill-empty: input is not mutated and a second run changes nothing", () => {
      assert.deepEqual(saved, before)
      const again = wr.fillEmptySaleDescriptions(res.rows, posSales, "2030-01-13", "2030-01-20")
      assert.deepEqual(again.rows, res.rows)
      assert.equal(again.filled, 0)
    })
    ok("fill-empty: sales outside the report period are never used", () => {
      const r = wr.fillEmptySaleDescriptions([{ date: "2030-01-17", item: "Tent", amount: 123000 }], posSales, "2030-01-18", "2030-01-20")
      assert.equal(r.rows[0].description, undefined); assert.equal(r.unmatched, 1)
    })
  }

  // ── Corrections (review round 2) ──────────────────────────────────
  ok("effectiveSummary recomputes checklist totals and ignores a tampered stored summary", () => {
    const doc = { doc_type: "inventory_checklist", summary: { total_items: 99, good: 99, needing_repair: 0, missing: 0 },
      payload: { sections: [{ title: "A", items: [{ quantity: 2, condition: "Damaged" }, { quantity: 0, condition: "" }, { quantity: 1, condition: "Good" }] }] } }
    assert.deepEqual(ops.effectiveSummary(doc), { total_items: 3, total_inspected: 3, good: 1, fair: 0, needing_repair: 1, missing: 1 })
  })
  ok("effectiveSummary recomputes equipment, safety, restock, log and damage summaries", () => {
    assert.equal(ops.effectiveSummary({ doc_type: "kitchen_equipment", summary: { total_missing: 0 }, payload: { items: [{ suggested_qty: 6, actual_qty: 4, missing_qty: 2 }] } }).total_missing, 2)
    assert.equal(ops.effectiveSummary({ doc_type: "gokart_safety_inspection", summary: { failed: 0 }, payload: { checks: [{ status: "FAIL" }, { status: "PASS" }] } }).failed, 1)
    assert.equal(ops.effectiveSummary({ doc_type: "restock_request", payload: { sections: [{ items: [{ required_qty: 2 }, { required_qty: 1 }] }] } }).total_required, 3)
    assert.equal(ops.effectiveSummary({ doc_type: "gokart_maintenance_log", payload: { entries: [{}, {}] } }).entry_count, 2)
    assert.equal(ops.effectiveSummary({ doc_type: "gokart_damage_report", payload: { photos: [{}] } }).photo_count, 1)
  })
  ok("effectiveSummary tolerates malformed / missing payloads", () => {
    assert.deepEqual(ops.effectiveSummary({ doc_type: "inventory_checklist", payload: { sections: "x" } }), { total_items: 0, total_inspected: 0, good: 0, fair: 0, needing_repair: 0, missing: 0 })
    assert.equal(ops.effectiveSummary({ doc_type: "dining_equipment" }).item_count, 0)
    assert.deepEqual(ops.effectiveSummary(null), {})
  })
  ok("pagination: page ranges and page counts", () => {
    assert.deepEqual(ops.pageRange(0, 25), { from: 0, to: 24 })
    assert.deepEqual(ops.pageRange(2, 25), { from: 50, to: 74 })
    assert.deepEqual(ops.pageRange(-3, 25), { from: 0, to: 24 })
    assert.equal(ops.pageCount(0, 25), 1); assert.equal(ops.pageCount(25, 25), 1); assert.equal(ops.pageCount(26, 25), 2)
    assert.equal(ops.DOCUMENT_PAGE_SIZE, 25)
  })
  ok("go-kart: only registered karts are accepted", () => {
    const fleet = [{ kart_id: "GK-01" }, { kart_id: "GK-02" }]
    assert.deepEqual(ops.unregisteredKarts(["GK-01"], fleet), [])
    assert.deepEqual(ops.unregisteredKarts(["GK-01", "GK-99"], fleet), ["GK-99"])
    assert.deepEqual(ops.unregisteredKarts(["GK-03"], []), ["GK-03"])
  })

  // ── Environment guard (staging / production isolation) ────────────
  const eg = await server.ssrLoadModule("/src/config/envGuard.js")
  const PROD = eg.PRODUCTION_SUPABASE_REF
  const STG = "abcdefghijklmnopqrst"
  const jwt = (ref) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ iss: "supabase", ref, role: "anon" })).toString("base64url"), "sig"].join(".")
  const prodEnv = { MODE: "production", VITE_SUPABASE_URL: `https://${PROD}.supabase.co`, VITE_SUPABASE_ANON_KEY: jwt(PROD), VITE_API_URL: "https://pos-admin.example.com" }
  const stagingEnv = { MODE: "staging", VITE_APP_ENV: "staging", VITE_EXPECTED_SUPABASE_REF: STG, VITE_SUPABASE_URL: `https://${STG}.supabase.co`, VITE_SUPABASE_ANON_KEY: jwt(STG), VITE_API_URL: "http://localhost:3002" }
  const rejects = (env, pattern) => { const r = eg.validateEnvironment(env); assert.equal(r.ok, false, "expected rejection"); assert.equal(r.supabaseUrl, undefined); if (pattern) assert.ok(r.errors.some(e => pattern.test(e)), `no error matching ${pattern}: ${r.errors.join(" | ")}`) }

  ok("env: production config (current .env shape) is accepted", () => {
    const r = eg.validateEnvironment(prodEnv)
    assert.equal(r.ok, true, r.errors.join(" | ")); assert.equal(r.appEnv, "production"); assert.equal(r.supabaseRef, PROD)
    assert.equal(eg.validateEnvironment({ ...prodEnv, MODE: "development" }).ok, true) // npm run dev
    assert.equal(eg.validateEnvironment({ ...prodEnv, VITE_API_URL: "https://x.example.com///" }).apiUrl, "https://x.example.com")
  })
  ok("env: production refuses the staging database / staging key / staging flags", () => {
    rejects({ ...prodEnv, VITE_SUPABASE_URL: `https://${STG}.supabase.co` }, /non-production database/)
    rejects({ ...prodEnv, VITE_SUPABASE_ANON_KEY: jwt(STG) }, /not production/)
    rejects({ ...prodEnv, VITE_APP_ENV: "staging", MODE: "production" }, /build mode/)
    rejects({ ...prodEnv, VITE_EXPECTED_SUPABASE_REF: STG }, /leaked into production/)
    rejects({ ...prodEnv, VITE_SUPABASE_URL: "" }, /VITE_SUPABASE_URL is not set/)
  })
  ok("env: complete staging config is accepted", () => {
    const r = eg.validateEnvironment(stagingEnv)
    assert.equal(r.ok, true, r.errors.join(" | ")); assert.equal(r.appEnv, "staging"); assert.equal(r.supabaseRef, STG)
    assert.equal(eg.validateEnvironment({ ...stagingEnv, VITE_SUPABASE_ANON_KEY: "sb_publishable_abc123" }).ok, true)
    assert.equal(eg.validateEnvironment({ ...stagingEnv, VITE_API_URL: "https://admin-staging.example.com" }).ok, true)
  })
  ok("env: staging refuses to start without its expected project reference", () => {
    rejects({ ...stagingEnv, VITE_EXPECTED_SUPABASE_REF: "" }, /VITE_EXPECTED_SUPABASE_REF is missing/)
    rejects({ ...stagingEnv, VITE_EXPECTED_SUPABASE_REF: "not-a-ref" }, /20-character/)
  })
  ok("env: staging refuses the production database, URL and key", () => {
    rejects({ ...stagingEnv, VITE_SUPABASE_URL: `https://${PROD}.supabase.co` }, /PRODUCTION database/)
    rejects({ ...stagingEnv, VITE_EXPECTED_SUPABASE_REF: PROD, VITE_SUPABASE_URL: `https://${PROD}.supabase.co` }, /PRODUCTION project/)
    rejects({ ...stagingEnv, VITE_SUPABASE_ANON_KEY: jwt(PROD) }, /PRODUCTION project/)
    rejects({ ...stagingEnv, VITE_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }, /does not match/)
  })
  ok("env: staging refuses values silently inherited from the production .env", () => {
    // .env.staging containing only VITE_APP_ENV + expected ref: everything else falls back to production.
    rejects({ ...prodEnv, MODE: "staging", VITE_APP_ENV: "staging", VITE_EXPECTED_SUPABASE_REF: STG }, /PRODUCTION database/)
    rejects({ ...stagingEnv, VITE_API_URL: prodEnv.VITE_API_URL }, /not a local or staging admin backend/)
    // No .env.staging at all -> MODE staging but every value is production's.
    rejects({ ...prodEnv, MODE: "staging" }, /VITE_APP_ENV=staging/)
    for (const k of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_API_URL"]) rejects({ ...stagingEnv, [k]: "" }, new RegExp(`${k} is missing`))
  })
  ok("env: local Supabase staging (ref=local) must stay on localhost", () => {
    const local = { ...stagingEnv, VITE_EXPECTED_SUPABASE_REF: "local", VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "local-demo-key" }
    assert.equal(eg.validateEnvironment(local).ok, true)
    rejects({ ...local, VITE_SUPABASE_URL: "https://example.com" }, /localhost/)
  })
  ok("env: jwtProjectRef reads legacy keys and ignores others", () => {
    assert.equal(eg.jwtProjectRef(jwt(STG)), STG); assert.equal(eg.jwtProjectRef("sb_publishable_x"), null); assert.equal(eg.jwtProjectRef("a.b.c"), null)
  })

  // ── Release prep: logo trimming + feature flag ────────────────────
  const brand = await server.ssrLoadModule("/src/lib/pdfBrand.js")
  const rgba = (w, h, opaque) => { const d = new Uint8ClampedArray(w * h * 4); for (const [x, y] of opaque) d[(y * w + x) * 4 + 3] = 255; return d }
  ok("logo trim: crops transparent margins to the visible artwork (+padding)", () => {
    // 100x50 image, visible pixels only between (40,10) and (59,29)
    const pts = []; for (let y = 10; y < 30; y++) for (let x = 40; x < 60; x++) pts.push([x, y])
    assert.deepEqual(brand.visibleBounds(rgba(100, 50, pts), 100, 50, { padRatio: 0 }), { x: 40, y: 10, w: 20, h: 20 })
    assert.deepEqual(brand.visibleBounds(rgba(100, 50, pts), 100, 50, { padRatio: 0.1 }), { x: 38, y: 8, w: 24, h: 24 })
  })
  ok("logo trim: never makes the logo disappear or exceed the image", () => {
    assert.deepEqual(brand.visibleBounds(rgba(10, 10, []), 10, 10), { x: 0, y: 0, w: 10, h: 10 })       // fully transparent -> untouched
    assert.deepEqual(brand.visibleBounds(rgba(10, 10, [[0, 0], [9, 9]]), 10, 10, { padRatio: 0.5 }), { x: 0, y: 0, w: 10, h: 10 }) // padding clamped
  })
  const f = await server.ssrLoadModule("/src/config/features.js")
  ok("release flag: Operations Documents is hidden for this release", () => {
    assert.equal(f.FEATURES.operationsDocuments, false)
    assert.ok(Object.isFrozen(f.FEATURES))
  })

  // ── Marine Invoicing (Swahili Marine & Diving) ────────────────────
  const mi = await server.ssrLoadModule("/src/lib/marineInvoicing.js")
  ok("marine: exact decimal parsing (no float drift)", () => {
    assert.equal(mi.toCents("0.1"), 10n); assert.equal(mi.toCents("1,000.10"), 100010n)
    assert.equal(mi.toCents(0.1 + 0.2), 30n); assert.equal(mi.toCents("2.345"), 235n) // half up
    assert.equal(mi.toCents(""), null); assert.equal(mi.toCents("abc"), null); assert.equal(mi.toCents("."), null)
  })
  ok("marine: line amount = round(qty x price, 2), decimal quantities", () => {
    assert.equal(mi.lineAmount("2.5", "1000.10"), 2500.25)
    assert.equal(mi.lineAmount("0.333", "3"), 1)       // 0.999 -> 1.00
    assert.equal(mi.lineAmount("1.005", "1"), 1.01)    // half up like Postgres round()
    assert.equal(mi.lineAmount("3", "0.1"), 0.3)       // float would give 0.30000000000000004
  })
  const lines = [{ quantity: "2.5", unit_price: "1000.10" }, { quantity: "1", unit_price: "999.99" }]
  ok("marine: totals match the server (same figures as the DB test)", () => {
    const t = mi.computeMarineTotals({ items: lines, vat_enabled: true, vat_percent: "15", discount_amount: "100" })
    assert.equal(t.subtotal, 3500.24); assert.equal(t.taxable, 3400.24); assert.equal(t.vat, 510.04); assert.equal(t.totalDue, 3910.28)
    assert.equal(t.vatOverridden, false); assert.equal(t.totalOverridden, false); assert.equal(t.adjustment, 0)
  })
  ok("marine: VAT override, total override and adjustment", () => {
    const t = mi.computeMarineTotals({ items: lines, vat_enabled: true, vat_percent: 15, vat_amount_override: "500", total_override: "4000", extra_charge_amount: "10" })
    assert.equal(t.vatCalculated, 526.54); assert.equal(t.vat, 500); assert.equal(t.calculatedTotal, 4010.24)
    assert.equal(t.totalDue, 4000); assert.equal(t.adjustment, -10.24); assert.ok(t.vatOverridden && t.totalOverridden)
  })
  ok("marine: VAT disabled ignores VAT override; default VAT 15%", () => {
    const t = mi.computeMarineTotals({ items: lines, vat_enabled: false, vat_percent: 15, vat_amount_override: "500" })
    assert.equal(t.vat, 0); assert.equal(t.totalDue, 3500.24); assert.equal(t.vatOverridden, false)
    assert.equal(mi.DEFAULT_SETTINGS.default_vat_percent, 15)
    assert.equal(mi.emptyDocumentForm(mi.DEFAULT_SETTINGS).vat_percent, "15")
  })
  ok("marine: recalculates when lines change; manual total stays put", () => {
    const base = { vat_enabled: true, vat_percent: 15, total_override: "5000" }
    const a = mi.computeMarineTotals({ ...base, items: [{ quantity: 1, unit_price: 1000 }] })
    const b = mi.computeMarineTotals({ ...base, items: [{ quantity: 2, unit_price: 1000 }] })
    assert.equal(a.calculatedTotal, 1150); assert.equal(b.calculatedTotal, 2300)
    assert.equal(a.totalDue, 5000); assert.equal(b.totalDue, 5000)
  })
  ok("marine: oversize discount detected", () => {
    assert.ok(mi.computeMarineTotals({ items: lines, discount_amount: "99999" }).discountTooLarge)
    assert.ok(mi.validateDraft({ ...mi.emptyDocumentForm(), discount_amount: "99999" }, [{ description: "x", quantity: "1", unit_price: "10" }]).some(e => /discount/i.test(e)))
  })
  ok("marine: large TZS amounts stay exact", () => {
    const t = mi.computeMarineTotals({ items: [{ quantity: "1250.5", unit_price: "1234567.89" }], vat_enabled: true, vat_percent: 18 })
    // Expected values computed independently with Python decimal (ROUND_HALF_UP).
    assert.equal(t.subtotal, 1543827146.45); assert.equal(t.vat, 277888886.36); assert.equal(t.totalDue, 1821716032.81)
  })
  ok("marine: customer fields optional; PDF rows skip blanks", () => {
    const f = mi.emptyDocumentForm()
    assert.equal(mi.CUSTOMER_FIELDS.length, 11)
    assert.deepEqual(mi.validateDraft(f, [mi.emptyItem()]), [])
    assert.deepEqual(mi.customerRows({ customer_name: "Rubani Ltd", tin_number: " ", vrn_number: "40-0012" }), [["Customer / Company Name", "Rubani Ltd"], ["VRN Number", "40-0012"]])
  })
  ok("marine: issue validation needs a line and a positive total", () => {
    const f = mi.emptyDocumentForm()
    assert.ok(mi.validateForIssue(f, [mi.emptyItem()]).some(e => /at least one/i.test(e)))
    assert.deepEqual(mi.validateForIssue(f, [{ description: "Diver", quantity: "2", unit_price: "85000" }]), [])
    assert.ok(mi.validateForIssue({ ...f, total_override: "10" }, [{ description: "Diver", quantity: "2", unit_price: "1" }]).some(e => /reason/i.test(e)))
    assert.ok(mi.validateDraft(f, [{ description: "x", quantity: "0", unit_price: "1" }]).some(e => /quantity/i.test(e)))
  })
  ok("marine: payload drops blank rows, nulls empty fields, keeps order", () => {
    const form = { ...mi.emptyDocumentForm(), doc_type: "INVOICE", valid_until: "2026-12-01", due_date: "2026-12-15", customer_name: "  Acme  " }
    const p = mi.buildDraftPayload(form,
      [mi.emptyItem({ description: "B", quantity: "1", unit_price: "5" }), mi.emptyItem(), mi.emptyItem({ description: "A", quantity: "2.5", unit_price: "1,000" })],
      [mi.emptyScope({ title: "RUBANI BUOY", description: "Replace\nchain" }), mi.emptyScope()])
    assert.deepEqual(p.items.map(i => i.description), ["B", "A"]); assert.equal(p.items[1].unit_price, "1000")
    assert.equal(p.scope.length, 1); assert.equal(p.scope[0].description, "Replace\nchain")
    assert.equal(p.doc.customer_name, "Acme"); assert.equal(p.doc.taxpayer_name, null)
    assert.equal(p.doc.valid_until, null); assert.equal(p.doc.due_date, "2026-12-15") // invoice: due date only
    assert.equal(p.doc.vat_amount_override, null); assert.equal(p.doc.bank_details.account_number, "22910118721")
  })
  ok("marine: banking defaults + per-document edits don't touch defaults", () => {
    const f = mi.emptyDocumentForm(mi.DEFAULT_SETTINGS)
    assert.deepEqual(f.bank_details, { bank_name: "NMB", account_name: "GOLDEN EMPIRE COMPANY LIMITED", account_number: "22910118721", branch: "Zanzibar (229)", currency: "TZS" })
    f.bank_details.account_number = "999"
    assert.equal(mi.DEFAULT_SETTINGS.bank_account_number, "22910118721")
    assert.equal(mi.emptyDocumentForm(mi.DEFAULT_SETTINGS).bank_details.account_number, "22910118721")
  })
  ok("marine: footer defaults keep the original identity", () => {
    assert.deepEqual(mi.DEFAULT_SETTINGS.contacts.map(c => c.value), ["contact@mygoldenempire.com", "+86 156 91833253"])
    assert.equal(mi.DEFAULT_SETTINGS.footer_line, "SWAHILI MARINE & DIVING | GEC LIMITED")
  })
  ok("marine: permanent header is frozen", () => {
    assert.ok(Object.isFrozen(mi.MARINE_BRAND))
    assert.equal(mi.MARINE_BRAND.division, "SWAHILI MARINE & DIVING")
    assert.equal(mi.MARINE_BRAND.divisionLine, "MARINE SERVICES DIVISION")
    assert.equal(mi.MARINE_BRAND.parentLine, "A division of GEC LIMITED")
  })
  ok("marine: number format + forward-only conversions", () => {
    assert.equal(mi.documentNumberPattern("QUOTATION", 2026, 1), "SMD-QTN-2026-001")
    assert.equal(mi.documentNumberPattern("PROFORMA", 2026, 12), "SMD-PI-2026-012")
    assert.equal(mi.documentNumberPattern("INVOICE", 2027, 1000), "SMD-INV-2027-1000")
    assert.deepEqual(mi.CONVERSION_TARGETS.QUOTATION, ["PROFORMA", "INVOICE"])
    assert.deepEqual(mi.CONVERSION_TARGETS.INVOICE, [])
  })
  ok("marine: round-trip DB row -> form -> payload", () => {
    const row = { doc_type: "PROFORMA", document_date: "2026-11-19", vat_enabled: false, vat_percent: 15, discount_amount: 0, extra_charge_amount: 250,
      bank_details: { bank_name: "NMB", account_number: "1" }, customer_name: "Pungume", currency: "TZS" }
    const f = mi.formFromDocument(row, [{ description: "Chain", unit: "metres", quantity: 12.5, unit_price: 4000 }], [{ title: "PUNGUME BUOY", description: "Servicing" }])
    assert.equal(f.form.discount_amount, ""); assert.equal(f.form.extra_charge_amount, "250"); assert.equal(f.form.vat_enabled, false)
    const p = mi.buildDraftPayload(f.form, f.items, f.scope)
    assert.equal(p.items[0].quantity, "12.5"); assert.equal(p.doc.bank_details.account_number, "1"); assert.equal(p.scope[0].title, "PUNGUME BUOY")
  })
  ok("marine: list reorder + search sanitising", () => {
    assert.deepEqual(mi.moveInList([1, 2, 3], 0, 2), [2, 3, 1]); assert.deepEqual(mi.moveInList([1, 2], 0, -1), [1, 2])
    assert.equal(mi.sanitizeSearch("SMD-QTN,(x)*%"), "SMD-QTN  x")
  })
  ok("marine: PDF filenames", () => {
    assert.equal(mi.pdfFilename({ doc_type: "QUOTATION", document_number: "SMD-QTN-2026-001", customer_name: "Rubani Marine Ltd." }), "SMD-QTN-2026-001_Rubani_Marine_Ltd.pdf")
    assert.equal(mi.pdfFilename({ doc_type: "INVOICE" }), "DRAFT-INV.pdf")
  })
  const { createRequire } = await import("node:module")
  const req = createRequire(path.join(root, "package.json"))
  const { renderToString } = req("react-dom/server")
  const React = req("react")
  const ui = await server.ssrLoadModule("/src/MarineInvoicing.jsx")
  const h = React.createElement, noop = () => {}
  ok("marine access: strictly Owner-only (Admin and every other role denied)", () => {
    assert.equal(mi.canAccessMarine("owner"), true)
    for (const role of ["admin", "developer", "manager", "editor", "moderator", "support", "worker", "viewer", "cashier", "", null, undefined, "OWNER", " owner"]) {
      assert.equal(mi.canAccessMarine(role), false, String(role))
    }
  })
  ok("marine UI: page renders nothing for Admin, Worker or signed-out users", () => {
    // isOwner is deliberately passed as true for admin: the page must ignore it.
    assert.equal(renderToString(h(ui.default, { isOwner: true, role: "admin", showToast: noop })), "")
    assert.equal(renderToString(h(ui.default, { isOwner: false, role: "worker", showToast: noop })), "")
    assert.equal(renderToString(h(ui.default, { role: null, showToast: noop })), "")
  })
  ok("marine UI: sidebar entry and route gate both use canAccessMarine(role)", () => {
    const app = req("fs").readFileSync(path.join(root, "src/App.jsx"), "utf8")
    assert.ok(/FEATURES\.marineInvoicing && canAccessMarine\(role\) \? \[\{ id:"marine"/.test(app), "sidebar entry gated")
    assert.ok(/page === "marine" && FEATURES\.marineInvoicing && canAccessMarine\(role\) &&/.test(app), "route gated")
    assert.ok(!/page === "marine" && isOwner/.test(app), "old isOwner route gate removed")
  })
  ok("marine UI: page renders tabs for owner", () => {
    const html = renderToString(h(ui.default, { isOwner: true, role: "owner", showToast: noop }))
    for (const label of ["Overview", "Create Document", "Document History", "Services &amp; Materials", "Scope of Work Library", "Invoice Settings"]) assert.ok(html.includes(label), label)
  })
  ok("marine UI: editor renders all sections with default banking + 15% VAT", () => {
    const html = renderToString(h(ui.__testing.DocumentEditor, { initialType: "PROFORMA", settings: mi.DEFAULT_SETTINGS, showToast: noop, onDone: noop, onCancel: noop }))
    for (const s of ["Customer details", "Scope of work", "Services &amp; materials", "VAT &amp; totals", "Payment &amp; banking details", "22910118721", "SMD-PI-", "TOTAL DUE", "Due date"]) assert.ok(html.includes(s), s)
    assert.ok(html.includes('value="15"'))
    assert.ok(!html.includes("Valid until"))
  })
  ok("marine UI: totals breakdown flags manual values", () => {
    const form = { vat_enabled: true, vat_percent: 15, currency: "TZS", total_override_reason: "Rounded" }
    const t = mi.computeMarineTotals({ ...form, items: lines, vat_amount_override: "500", total_override: "4000" })
    const html = renderToString(h(ui.__testing.TotalsBreakdown, { form, totals: t }))
    assert.ok(html.includes("MANUAL") && html.includes("AUTO") && html.includes("Calculated VAT would be") && html.includes("4,000"))
  })
  ok("marine UI: settings read-only for admin, editable for owner", () => {
    const ro = renderToString(h(ui.__testing.SettingsPanel, { settings: mi.DEFAULT_SETTINGS, canEdit: false, showToast: noop, onSaved: noop }))
    const rw = renderToString(h(ui.__testing.SettingsPanel, { settings: mi.DEFAULT_SETTINGS, canEdit: true, showToast: noop, onSaved: noop }))
    assert.ok(ro.includes("Only the Owner") && !ro.includes("Save settings"))
    assert.ok(rw.includes("Save settings") && rw.includes("contact@mygoldenempire.com") && rw.includes("+86 156 91833253"))
  })
  ok("marine UI: document table + list views render", () => {
    const html = renderToString(h(ui.__testing.DocumentTable, { docs: [{ id: "1", doc_type: "QUOTATION", status: "ISSUED", document_number: "SMD-QTN-2026-001", document_date: "2026-11-19", customer_name: "Rubani", total_due: 1150, currency: "TZS" }], loading: false, onView: noop }))
    assert.ok(html.includes("SMD-QTN-2026-001") && html.includes("Issued") && html.includes("TZS 1,150"))
    for (const C of ["Overview", "DocumentHistory", "CatalogLibrary", "ScopeLibrary"]) renderToString(h(ui.__testing[C], { showToast: noop, onNew: noop, onView: noop }))
  })
  const pdfMod = await server.ssrLoadModule("/src/lib/marinePdf.js").catch(e => ({ __err: e }))
  ok("marine PDF: module loads", () => { assert.ok(!pdfMod.__err, pdfMod.__err?.message); assert.equal(typeof pdfMod.buildMarinePdf, "function") })
  ok("marine PDF: logo crop finds artwork on a white (opaque) background", () => {
    const w = 100, h = 60, d = new Uint8ClampedArray(w * h * 4).fill(255) // opaque white, like the JPEG
    for (let y = 20; y < 40; y++) for (let x = 30; x < 70; x++) { const i = (y * w + x) * 4; d[i] = 212; d[i + 1] = 167; d[i + 2] = 44 } // gold block
    assert.deepEqual(pdfMod.nonWhiteBounds(d, w, h, { padRatio: 0 }), { x: 30, y: 20, w: 40, h: 20 })
    assert.deepEqual(pdfMod.nonWhiteBounds(new Uint8ClampedArray(w * h * 4).fill(255), w, h), { x: 0, y: 0, w, h }) // all white -> untouched
  })
  ok("marine: official logo path points at a real file in public/", () => {
    assert.equal(mi.MARINE_BRAND.logoUrl, "/brand/gec-logo.jpg")
    const buf = req("fs").readFileSync(path.join(root, "public", mi.MARINE_BRAND.logoUrl))
    assert.ok(buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF, "file is a JPEG")
  })

  ok("release flag: Marine Invoicing enabled (migration 20261119090000 must be live)", () => {
    assert.equal(f.FEATURES.marineInvoicing, true)
  })

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} finally { await server.close() }
