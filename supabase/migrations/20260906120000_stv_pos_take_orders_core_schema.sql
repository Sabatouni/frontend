-- Take Orders module: a restaurant/walk-in order-taking tool, fully
-- isolated from every other module. Additive only -- no existing table,
-- column, row, policy, or function is touched or dropped.
--
-- This is deliberately NOT the Sales module and NOT a customer CRM:
--   * Marking an order PAID never writes to public.sales. The two systems
--     don't reference each other at all (contrast with the Debt & Credit
--     module, which intentionally links back to sales/expenses via
--     source_type/source_id -- Take Orders has no such link by design).
--   * There is no customer table. `orders.customer_name` is a plain,
--     required-when-paid text field, not a foreign key to any profile.
--
-- Money: every amount column below is `integer` (whole Tanzanian
-- shillings, no cents in practice for this business) rather than
-- `numeric`/`float`, so there is no floating-point representation to
-- worry about at all, per the explicit instruction for this module.
--
-- NOTE: this migration is captured here for review only. Per instruction,
-- it is NOT applied to the live database from this session -- apply it
-- separately (e.g. via the Supabase MCP `apply_migration` tool or the
-- Supabase CLI) once reviewed.

create table if not exists public.order_menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  default_price integer not null check (default_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_menu_items_active_idx on public.order_menu_items (active);
create index if not exists order_menu_items_category_idx on public.order_menu_items (category);

drop trigger if exists order_menu_items_touch_updated_at on public.order_menu_items;
create trigger order_menu_items_touch_updated_at
  before update on public.order_menu_items
  for each row execute function public.stv_touch_updated_at();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  -- Nullable so a worker can start adding items before typing a name (see
  -- the module notes above); the check below is what actually enforces
  -- "every order has a name" -- just only once it's PAID, not before.
  customer_name text,
  status text not null default 'EDITING' check (status in ('EDITING', 'PAID')),
  total_amount integer not null default 0 check (total_amount >= 0),
  created_by uuid,
  created_by_name text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_customer_name_required_when_paid
    check (status <> 'PAID' or (customer_name is not null and length(trim(customer_name)) > 0))
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_by_idx on public.orders (created_by);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.stv_touch_updated_at();

-- Human-readable sequential order number, same sequence-plus-trigger
-- mechanism already used for invoices/Debt & Credit -- ORD-000001 style,
-- collision-free because it's driven by a single Postgres sequence.
create sequence if not exists public.stv_order_number_seq;

create or replace function public.stv_set_order_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'ORD-' || lpad(nextval('public.stv_order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_order_number on public.orders;
create trigger orders_set_order_number
  before insert on public.orders
  for each row execute function public.stv_set_order_number();

-- Stamp paid_at the moment (and only the moment) status first becomes
-- PAID. Not on every update -- re-saving an already-PAID row (which RLS
-- restricts to owner/admin anyway) must never move its paid_at forward.
create or replace function public.stv_set_order_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'PAID' and (old.status is distinct from 'PAID') and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_paid_at on public.orders;
create trigger orders_set_paid_at
  before update on public.orders
  for each row execute function public.stv_set_order_paid_at();

-- RLS (below) checks WHO can update a row and WHEN (own order, still
-- EDITING) but not WHICH columns they change -- so without this, a
-- worker's own client-side update could directly overwrite total_amount,
-- order_number, or created_by/created_by_name on their own order. This
-- forces those columns back to their real values on every update,
-- regardless of what the client sent: total_amount is always recomputed
-- from the current order_items (identical formula to
-- stv_recalc_order_total below, just also enforced here so it can never
-- be set directly), and the rest are simply immutable after creation.
-- paid_at is deliberately left untouched here -- stv_set_order_paid_at
-- above is solely responsible for it.
create or replace function public.stv_orders_guard_immutable_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  new.order_number := old.order_number;
  new.total_amount := coalesce((
    select sum(line_total) from public.order_items where order_id = new.id
  ), 0);
  return new;
end;
$$;

drop trigger if exists orders_guard_immutable_fields on public.orders;
create trigger orders_guard_immutable_fields
  before update on public.orders
  for each row execute function public.stv_orders_guard_immutable_fields();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Loose-ish reference, not a hard dependency: a historical order line
  -- must keep displaying correctly even if its menu item is later edited
  -- or deactivated, which is exactly why item_name_snapshot/
  -- default_unit_price/actual_unit_price are copied onto the row below
  -- rather than looked up live. Set null (never cascade-deleted) so a
  -- removed menu item doesn't corrupt past orders.
  menu_item_id uuid references public.order_menu_items(id) on delete set null,
  item_name_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  default_unit_price integer not null check (default_unit_price >= 0),
  -- What this line actually charges -- equals default_unit_price unless a
  -- worker manually overrides it for this one line. Overriding this value
  -- never writes back to order_menu_items.default_price.
  actual_unit_price integer not null check (actual_unit_price >= 0),
  line_total integer not null default 0 check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_menu_item_idx on public.order_items (menu_item_id) where menu_item_id is not null;

drop trigger if exists order_items_touch_updated_at on public.order_items;
create trigger order_items_touch_updated_at
  before update on public.order_items
  for each row execute function public.stv_touch_updated_at();

-- line_total is always derived, never trusted from the client -- computed
-- server-side on every insert/update so it can never drift from
-- quantity * actual_unit_price.
create or replace function public.stv_set_order_item_line_total()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.line_total := new.quantity * new.actual_unit_price;
  return new;
end;
$$;

drop trigger if exists order_items_set_line_total on public.order_items;
create trigger order_items_set_line_total
  before insert or update on public.order_items
  for each row execute function public.stv_set_order_item_line_total();

-- orders.total_amount is a stored, always-in-sync sum of its items' line
-- totals -- recalculated after any insert/update/delete on order_items so
-- the app never has to (and can't accidentally forget to) keep it in sync
-- itself. Same "derived, never drifts" idea as the Debt & Credit balance
-- view, just materialized onto the parent row since total_amount was
-- specified as a stored column here rather than a view.
create or replace function public.stv_recalc_order_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  affected_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
  set total_amount = coalesce((
    select sum(line_total) from public.order_items where order_id = affected_order_id
  ), 0)
  where id = affected_order_id;
  return null;
end;
$$;

drop trigger if exists order_items_recalc_order_total on public.order_items;
create trigger order_items_recalc_order_total
  after insert or update or delete on public.order_items
  for each row execute function public.stv_recalc_order_total();

-- ── RLS ──────────────────────────────────────────────────────────────
-- Menu management is owner/admin only; taking orders (reading the active
-- menu, creating orders/items, editing your own order while it's still
-- EDITING) is open to any authenticated stv-pos user, worker included --
-- same has_application_access()/has_minimum_role() functions already
-- enforcing every other module's permissions in this project, nothing new
-- invented here.
alter table public.order_menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy order_menu_items_admin_all on public.order_menu_items
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy order_menu_items_select on public.order_menu_items
  for select
  using (has_application_access('stv-pos'));

create policy orders_admin_all on public.orders
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy orders_select on public.orders
  for select
  using (has_application_access('stv-pos'));

create policy orders_insert_own on public.orders
  for insert
  with check (has_application_access('stv-pos') and created_by = auth.uid());

-- A worker may keep editing (add items to, rename, mark PAID) only their
-- own order, and only while it is still EDITING -- the `using` clause is
-- checked against the row as it stood BEFORE the update, so once a row's
-- status becomes PAID (whether a worker just set that, or it was already
-- PAID), no further worker update can ever match this policy again. This
-- is what makes PAID orders locked for workers without needing a
-- separate trigger-level guard.
create policy orders_update_own_editing on public.orders
  for update
  using (has_application_access('stv-pos') and created_by = auth.uid() and status = 'EDITING')
  with check (has_application_access('stv-pos') and created_by = auth.uid());

-- A worker may discard their own still-EDITING draft order (e.g. an
-- abandoned/empty one). PAID orders are never reachable here for the same
-- reason as the update policy above.
create policy orders_delete_own_editing on public.orders
  for delete
  using (has_application_access('stv-pos') and created_by = auth.uid() and status = 'EDITING');

create policy order_items_admin_all on public.order_items
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy order_items_select on public.order_items
  for select
  using (has_application_access('stv-pos'));

-- Order items inherit their "am I still editable" rule from the parent
-- order rather than duplicating status logic here: a worker may
-- insert/update/delete a line only on an order they created that is still
-- EDITING.
create policy order_items_insert_own_editing on public.order_items
  for insert
  with check (
    has_application_access('stv-pos')
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.created_by = auth.uid()
        and o.status = 'EDITING'
    )
  );

create policy order_items_update_own_editing on public.order_items
  for update
  using (
    has_application_access('stv-pos')
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.created_by = auth.uid()
        and o.status = 'EDITING'
    )
  )
  with check (
    has_application_access('stv-pos')
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.created_by = auth.uid()
        and o.status = 'EDITING'
    )
  );

create policy order_items_delete_own_editing on public.order_items
  for delete
  using (
    has_application_access('stv-pos')
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.created_by = auth.uid()
        and o.status = 'EDITING'
    )
  );
