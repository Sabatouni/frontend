/**
 * Release feature flags.
 *
 * operationsDocuments: the Operations Documents centre (restock requests,
 * equipment lists, inventory checklists, go-kart reports). Fully implemented
 * but hidden for this release -- it needs migration
 * 20261112090100_stv_pos_operational_documents.sql, which is not applied yet.
 * Flip to true only after that migration is live.
 */
export const FEATURES = Object.freeze({
  operationsDocuments: false,
})
