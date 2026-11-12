/**
 * Single source of truth for what a sale's "Description" is.
 *
 * Historical sales (recorded before `sales.description` existed) already
 * carry their description in the long-standing `sales.note` field, e.g.
 * "Chips kuku", "2 rounds", "VIP tent". So the description shown in sales
 * history, receipts and EVERY report/export is:
 *
 *     sales.description (if filled)  ->  otherwise  sales.note
 *
 * No data is moved or rewritten -- this is display/report logic only.
 * Dependency-free on purpose so both the report builders and the PDF/export
 * code can import it.
 */

const clean = (v) => String(v ?? "").trim()

/** Description to display/report for a sale (description, else note). */
export function saleDescription(sale) {
  return clean(sale?.description) || clean(sale?.note)
}

/**
 * The note, but only when it adds information beyond what saleDescription()
 * already shows -- i.e. a NEW sale that has both a description and a
 * different note. For historical sales (note used as the description) this
 * is "", so the same text is never shown twice side by side.
 */
export function saleExtraNote(sale) {
  const description = clean(sale?.description)
  const note = clean(sale?.note)
  return description && note && note !== description ? note : ""
}
