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

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} finally { await server.close() }
