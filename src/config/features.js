/**
 * Release feature flags.
 *
 * operationsDocuments: the Operations Documents centre (restock requests,
 * equipment lists, inventory checklists, go-kart reports). Fully implemented
 * but hidden for this release -- it needs migration
 * 20261112090100_stv_pos_operational_documents.sql, which is not applied yet.
 * Flip to true only after that migration is live.
 *
 * marineInvoicing: Swahili Marine & Diving quotations / proforma / final
 * invoices (Owner/Admin only -- enforced by the sidebar, the route gate in
 * App.jsx, the page's own isOwner check and the marine_* RLS policies).
 * Enabled with the release that applies migration
 * 20261119090000_smd_marine_invoicing.sql -- that migration must be live
 * before this code is deployed.
 */
export const FEATURES = Object.freeze({
  operationsDocuments: false,
  marineInvoicing: true,
})
