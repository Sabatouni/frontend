import { supabase } from "../api/supabaseClient"

/**
 * Data-access layer for the "Take Orders" module (a restaurant/walk-in
 * order-taking tool). Kept out of App.jsx on purpose so the page component
 * stays about rendering, not query-building.
 *
 * This module is deliberately isolated:
 *   - It never reads or writes `sales`, `expenses`, `debt_credit_*`,
 *     `invoices`, or any itinerary table.
 *   - Marking an order PAID (markOrderPaid below) does exactly one thing:
 *     flips `orders.status`. It does not create a Sales record, a Debt &
 *     Credit record, or anything else -- Take Orders is not the Sales
 *     module and not a customer CRM.
 *
 * Money: every amount here is a plain integer number of whole Tanzanian
 * shillings (no cents, no floating point) -- matching the `integer`
 * columns in the migration this module talks to.
 */

// ── Menu ──────────────────────────────────────────────────────────────

/** Active menu items only -- what workers see while taking an order. */
export async function fetchActiveMenuItems() {
  const { data, error } = await supabase
    .from("order_menu_items")
    .select("*")
    .eq("active", true)
    .order("category", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
  if (error) throw error
  return data || []
}

/** Every menu item, active or not -- for the owner/admin management view. */
export async function fetchAllMenuItems() {
  const { data, error } = await supabase
    .from("order_menu_items")
    .select("*")
    .order("category", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
  if (error) throw error
  return data || []
}

export async function createMenuItem({ name, category, default_price }) {
  const { data, error } = await supabase
    .from("order_menu_items")
    .insert([{
      name: String(name || "").trim(),
      category: category ? String(category).trim() : null,
      default_price: Math.max(0, Math.round(Number(default_price) || 0)),
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMenuItem(id, { name, category, default_price }) {
  const patch = {}
  if (name !== undefined) patch.name = String(name || "").trim()
  if (category !== undefined) patch.category = category ? String(category).trim() : null
  if (default_price !== undefined) patch.default_price = Math.max(0, Math.round(Number(default_price) || 0))
  const { data, error } = await supabase
    .from("order_menu_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Deactivate/reactivate rather than delete -- keeps every past order's
 * item rows pointing at a real menu_item_id (see item_name_snapshot /
 * default_unit_price on order_items for why that reference being loose is
 * still safe even so). */
export async function setMenuItemActive(id, active) {
  const { data, error } = await supabase
    .from("order_menu_items")
    .update({ active: !!active })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Orders ────────────────────────────────────────────────────────────

/** Every order still being built (any worker's), newest first. */
export async function fetchOpenOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "EDITING")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data || []
}

/** Paid/historical orders. `from`/`to` are optional YYYY-MM-DD strings. */
export async function fetchOrderHistory({ from, to } = {}) {
  let q = supabase.from("orders").select("*").eq("status", "PAID")
  if (from) q = q.gte("paid_at", `${from}T00:00:00`)
  if (to) q = q.lte("paid_at", `${to}T23:59:59`)
  const { data, error } = await q.order("paid_at", { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchOrderWithItems(orderId) {
  const [{ data: order, error: oErr }, { data: items, error: iErr }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).single(),
    supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true }),
  ])
  if (oErr) throw oErr
  if (iErr) throw iErr
  return { order, items: items || [] }
}

/** Starts a brand-new draft order. Customer name is intentionally
 * optional here -- a worker can start adding items before typing a name
 * (see the DB check constraint that only requires it once PAID). */
export async function createOrder({ userId, displayName, customerName }) {
  const { data, error } = await supabase
    .from("orders")
    .insert([{
      customer_name: customerName ? String(customerName).trim() : null,
      status: "EDITING",
      created_by: userId,
      created_by_name: displayName || null,
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateOrderCustomerName(orderId, customerName) {
  const { data, error } = await supabase
    .from("orders")
    .update({ customer_name: String(customerName || "").trim() || null })
    .eq("id", orderId)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Discards an unfinished draft order entirely (only ever reachable via
 * RLS while it's still EDITING and owned by the caller -- a PAID order can
 * never be deleted this way, by design). */
export async function discardOrder(orderId) {
  const { error } = await supabase.from("orders").delete().eq("id", orderId)
  if (error) throw error
}

/** Locks the order in. This is the ONLY thing this function does --
 * flips `orders.status` to PAID. It never touches `sales`, never inserts
 * anywhere else. Requires a non-empty customer name (also enforced by the
 * DB check constraint, so this is a friendlier client-side pre-check, not
 * the real guarantee). */
export async function markOrderPaid(orderId, customerName) {
  const trimmed = String(customerName || "").trim()
  if (!trimmed) throw new Error("Enter a customer/identifier name before marking this order paid.")
  const { data, error } = await supabase
    .from("orders")
    .update({ customer_name: trimmed, status: "PAID" })
    .eq("id", orderId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Order items ───────────────────────────────────────────────────────

/**
 * Adds a menu item to an order. If a line for the same menu item already
 * exists on this order at the same unit price, its quantity is
 * incremented instead of creating a new line (business rule: prefer
 * incrementing over duplicate lines). A manual price override that
 * differs from an existing line's price intentionally creates a separate
 * line, since the two lines no longer represent the same charge.
 */
export async function addMenuItemToOrder(orderId, menuItem, { unitPriceOverride } = {}) {
  const unitPrice = unitPriceOverride === undefined || unitPriceOverride === null || unitPriceOverride === ""
    ? Math.round(Number(menuItem.default_price) || 0)
    : Math.max(0, Math.round(Number(unitPriceOverride) || 0))

  const { data: existingRows, error: findErr } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("menu_item_id", menuItem.id)
    .eq("actual_unit_price", unitPrice)
    .limit(1)
  if (findErr) throw findErr

  if (existingRows && existingRows[0]) {
    return updateOrderItemQuantity(existingRows[0].id, existingRows[0].quantity + 1)
  }

  const { data, error } = await supabase
    .from("order_items")
    .insert([{
      order_id: orderId,
      menu_item_id: menuItem.id,
      item_name_snapshot: menuItem.name,
      quantity: 1,
      default_unit_price: Math.round(Number(menuItem.default_price) || 0),
      actual_unit_price: unitPrice,
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

/** A free-text/custom line with no backing menu item (e.g. a one-off item
 * not worth adding to the permanent menu). */
export async function addCustomItemToOrder(orderId, { name, unitPrice, quantity = 1 }) {
  const price = Math.max(0, Math.round(Number(unitPrice) || 0))
  const { data, error } = await supabase
    .from("order_items")
    .insert([{
      order_id: orderId,
      menu_item_id: null,
      item_name_snapshot: String(name || "").trim() || "Custom item",
      quantity: Math.max(1, Math.round(Number(quantity) || 1)),
      default_unit_price: price,
      actual_unit_price: price,
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateOrderItemQuantity(orderItemId, quantity) {
  const q = Math.max(1, Math.round(Number(quantity) || 1))
  const { data, error } = await supabase
    .from("order_items")
    .update({ quantity: q })
    .eq("id", orderItemId)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Overrides the price for THIS line only -- never touches the menu
 * item's default_price. */
export async function updateOrderItemPrice(orderItemId, actualUnitPrice) {
  const price = Math.max(0, Math.round(Number(actualUnitPrice) || 0))
  const { data, error } = await supabase
    .from("order_items")
    .update({ actual_unit_price: price })
    .eq("id", orderItemId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removeOrderItem(orderItemId) {
  const { error } = await supabase.from("order_items").delete().eq("id", orderItemId)
  if (error) throw error
}
