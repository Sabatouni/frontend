import { supabase } from "../api/supabaseClient"

/**
 * Data-access + calculation layer for the Weekly Manager's Report module.
 * Kept out of App.jsx for the same reason src/lib/takeOrders.js is: the
 * page component should be about rendering, not query-building.
 *
 * IMPORTANT: once a report is created, this module never reads live
 * sales/expenses again for that report -- report_sales.js's job is to
 * copy the relevant rows into the report's own jsonb snapshot columns at
 * creation/regeneration time. After that, the report is just a row like
 * any other; editing or deleting a sale/expense in the POS afterward can
 * never silently change an already-saved report.
 */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]

/** "1st", "2nd", "3rd", "4th", ..., "21st", "22nd", "23rd", "31st", etc. */
export function ordinal(n) {
  const v = Number(n)
  const rem100 = v % 100
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`
  switch (v % 10) {
    case 1: return `${v}st`
    case 2: return `${v}nd`
    case 3: return `${v}rd`
    default: return `${v}th`
  }
}

/** Parses a "YYYY-MM-DD" (or any date-prefixed) string as a plain calendar
 * date, ignoring time-of-day/timezone entirely -- a report's reporting
 * period is a date range, not a set of instants, so this must never shift
 * by a day depending on the browser's timezone (the exact bug fixed
 * elsewhere in this app's itinerary module's addDays()). */
function parseDateOnly(dateStr) {
  const s = String(dateStr || "").slice(0, 10)
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) return null
  return { y, m, d }
}

/** "17th August 2026", or "17th August" when withYear is false. */
export function formatOrdinalDate(dateStr, { withYear = true } = {}) {
  const parsed = parseDateOnly(dateStr)
  if (!parsed) return ""
  const { y, m, d } = parsed
  return withYear ? `${ordinal(d)} ${MONTHS[m - 1]} ${y}` : `${ordinal(d)} ${MONTHS[m - 1]}`
}

/**
 * Builds the human-readable report title from the two reporting-period
 * dates, e.g. "17th – 30th August 2026 STV Sales Report" or, spanning a
 * month/year boundary, "31st August – 6th September 2026 STV Sales
 * Report". Never hard-codes a month -- both dates drive the text.
 */
export function generateReportTitle(fromDate, toDate) {
  const from = parseDateOnly(fromDate)
  const to = parseDateOnly(toDate)
  if (!from || !to) return "STV Sales Report"

  const sameYear = from.y === to.y
  const sameMonth = sameYear && from.m === to.m

  const fromText = sameMonth
    ? ordinal(from.d) // "17th – 30th August 2026" -- from side has no month/year of its own
    : sameYear
      ? `${ordinal(from.d)} ${MONTHS[from.m - 1]}` // "31st August – 6th September 2026"
      : `${ordinal(from.d)} ${MONTHS[from.m - 1]} ${from.y}` // crosses a year boundary
  const toText = `${ordinal(to.d)} ${MONTHS[to.m - 1]} ${to.y}`

  return `${fromText} – ${toText} STV Sales Report`
}

// ── POS data -> report snapshot ─────────────────────────────────────────

/** Same inclusive-range convention already used throughout this app's
 * Sales/Expenses/Reports pages (`date >= from` and `date <= to + "T99"`). */
function inRange(dateStr, from, to) {
  if (!dateStr) return false
  if (from && dateStr < from) return false
  if (to && dateStr > `${to}T99`) return false
  return true
}

/** Sales rows for the period, shaped for the report's sales_breakdown
 * snapshot: { date, item, amount }. `item` here is the sale's `service`
 * (e.g. "Restaurant", "Go Kart") -- the actual existing POS service
 * names, not anything invented for this report. */
export function buildSalesSnapshot(sales, from, to) {
  return (sales || [])
    .filter(s => inRange(s.date, from, to))
    .map(s => ({ date: (s.date || "").slice(0, 10), item: s.service || "", amount: Number(s.amount || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Expense rows for the period, shaped for expense_breakdown: { date,
 * note, amount }. `note` is the expense's own `item` description field
 * (e.g. "Alphard fuel", "ZRA Tax") per the brief -- category/"who
 * recorded it" are deliberately left out. */
export function buildExpenseSnapshot(expenses, from, to) {
  return (expenses || [])
    .filter(e => inRange(e.date, from, to))
    .map(e => ({ date: (e.date || "").slice(0, 10), note: e.item || "", amount: Number(e.cost || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function sumAmounts(rows) {
  return (rows || []).reduce((acc, r) => acc + Number(r.amount || 0), 0)
}

/** Net Profit is always Gross Sales - Operating Expenses -- never an
 * independently stored/overridable figure, so it can never silently drift
 * out of sync with the two numbers it's made of. Editing "the figures" is
 * done by editing gross_sales/operating_expenses; net_profit updates
 * itself. */
export function computeNetProfit(grossSales, operatingExpenses) {
  return Number(grossSales || 0) - Number(operatingExpenses || 0)
}

/** Opening Cash + Capital Added + Sales - Expenses +/- Other Cash
 * Movements = Closing Cash Position. Capital added and other cash
 * movements are NOT part of Gross Sales/Net Profit -- this is a separate
 * cash-reconciliation figure, per the brief's explicit distinction. */
export function computeClosingCash({ openingCashBalance, capitalMovements, grossSales, operatingExpenses, otherCashMovements }) {
  return (
    Number(openingCashBalance || 0)
    + sumAmounts(capitalMovements)
    + Number(grossSales || 0)
    - Number(operatingExpenses || 0)
    + sumAmounts(otherCashMovements)
  )
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function fetchReportHistory({ status, search } = {}) {
  let q = supabase.from("weekly_reports").select("*").order("report_from", { ascending: false })
  if (status && status !== "All") q = q.eq("status", status)
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  if (!search) return rows
  const needle = search.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(r => (r.title || "").toLowerCase().includes(needle) || (r.prepared_by || "").toLowerCase().includes(needle))
}

export async function fetchReportById(id) {
  const { data, error } = await supabase.from("weekly_reports").select("*").eq("id", id).single()
  if (error) throw error
  return data
}

export async function createReport(payload) {
  const { data, error } = await supabase.from("weekly_reports").insert([payload]).select().single()
  if (error) throw error
  return data
}

export async function updateReport(id, patch) {
  const { data, error } = await supabase.from("weekly_reports").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data
}

export async function deleteReport(id) {
  const { error } = await supabase.from("weekly_reports").delete().eq("id", id)
  if (error) throw error
}

/** Builds the initial payload for a brand-new report from the chosen
 * reporting period and the already-fetched POS sales/expenses arrays
 * (see step-by-step auto-population order in the module's brief). Nothing
 * here is written to Supabase yet -- the caller reviews/edits, then saves. */
export function draftReportFromPeriod({ from, to, sales, expenses, preparedBy }) {
  const salesBreakdown = buildSalesSnapshot(sales, from, to)
  const expenseBreakdown = buildExpenseSnapshot(expenses, from, to)
  const grossSales = sumAmounts(salesBreakdown)
  const operatingExpenses = sumAmounts(expenseBreakdown)
  return {
    report_from: from,
    report_to: to,
    title: generateReportTitle(from, to),
    prepared_by: preparedBy || "",
    date_submitted: new Date().toISOString().slice(0, 10),
    status: "DRAFT",
    gross_sales_source: grossSales,
    gross_sales: grossSales,
    operating_expenses_source: operatingExpenses,
    operating_expenses: operatingExpenses,
    net_profit: computeNetProfit(grossSales, operatingExpenses),
    opening_cash_balance: 0,
    closing_cash_position: computeNetProfit(grossSales, operatingExpenses), // opening=0, no movements yet
    executive_summary: "",
    memo_text: "",
    marketing_social_media: "",
    compliance: "",
    challenges: "",
    manager_comments: "",
    sales_breakdown: salesBreakdown,
    expense_breakdown: expenseBreakdown,
    capital_movements: [],
    other_cash_movements: [],
    operations_update: [],
    compliance_items: [],
    action_plan: [],
    manager_approved_by: "",
    managing_director_approved_by: "",
  }
}
