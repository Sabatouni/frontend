/**
 * Release feature flags.
 *
 * operationsDocuments: the Operations Documents centre (restock requests,
 * equipment lists, inventory checklists, go-kart reports). Enabled with the
 * release that applies migration
 * 20261122090000_stv_pos_operational_documents.sql -- that migration must be
 * live BEFORE this code is deployed, otherwise the page loads but every
 * request fails (tables missing).
 *
 * marineInvoicing: Swahili Marine & Diving quotations / proforma / final
 * invoices (Owner/Admin only -- enforced by the sidebar, the route gate in
 * App.jsx, the page's own isOwner check and the marine_* RLS policies).
 * Enabled with the release that applies migration
 * 20261119090000_smd_marine_invoicing.sql -- that migration must be live
 * before this code is deployed.
 */
export const FEATURES = Object.freeze({
  operationsDocuments: true,
  marineInvoicing: true,
})
