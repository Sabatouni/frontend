import { isOwnerRole, isOwnerOrAdminRole } from "./permissions"

/**
 * Who may open each POS page -- the single source of truth used by BOTH the
 * Sidebar (what is listed) and App()'s route gates (what renders). Exact
 * role slugs only (see lib/permissions.js); no numeric levels, so
 * developer / manager / editor / moderator / support / viewer get nothing
 * beyond ordinary member pages.
 *
 *   "member" -- any account with stv-pos access (worker workflows)
 *   "manage" -- exactly owner or admin   (approved Owner+Admin modules)
 *   "owner"  -- exactly owner            (approved Owner-only modules)
 *
 * The database (RLS + RPC checks) enforces the same rules independently;
 * this only decides what the UI offers. Unknown pages are denied.
 */
export const PAGE_ACCESS = Object.freeze({
  dashboard:  "member", // Owner sees the Owner dashboard; everyone else the Home view
  sales:      "member",
  takeOrders: "member",
  expenses:   "member",
  inventory:  "member",
  documents:  "member",
  invoices:   "member",
  itinerary:  "manage",
  debtCredit: "owner",
  marine:     "owner",
  reports:    "owner",
  users:      "owner",
})

export function canOpenPage(page, role) {
  switch (PAGE_ACCESS[page]) {
    case "member": return typeof role === "string" && role.length > 0
    case "manage": return isOwnerOrAdminRole(role)
    case "owner":  return isOwnerRole(role)
    default:       return false
  }
}

/**
 * Sensitive actions inside member pages. Buttons AND their handlers use
 * these; RLS enforces the same rule server-side.
 */
export const ACTION_ACCESS = Object.freeze({
  editSale:          "manage",
  manageServices:    "manage",
  deleteSale:        "owner",
  deleteExpense:     "owner",
  manageInventory:   "manage", // add item / adjust stock (workers may still add stock)
  settleDrinkWeek:   "manage",
  manageMenu:        "manage", // Take Orders menu
  manageInvoices:    "manage", // STV invoices create / edit / delete (workers view + download)
  viewOwnerDashboard:"owner",
})

export function canDo(action, role) {
  switch (ACTION_ACCESS[action]) {
    case "manage": return isOwnerOrAdminRole(role)
    case "owner":  return isOwnerRole(role)
    default:       return false
  }
}
