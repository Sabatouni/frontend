-- Sales Description
--
-- Adds a proper, searchable free-text description to each sale
-- ("Two chicken biryani meals and two fresh juices", "Group session for five
-- participants", ...), mirroring the item/description field expenses
-- already have.
--
-- Safety:
--   * Purely additive. `add column if not exists` -> re-running is a no-op.
--   * Nullable with NO default -> no table rewrite, no existing row is
--     touched. Historical sales simply have description = NULL and every
--     existing read path keeps working.
--   * The existing `note` column is left exactly as it is (it stays the
--     optional short note it has always been).
--   * No RLS change: the existing sales policies are row-level and already
--     cover every column, including this one. Workers still cannot update
--     or delete any sale; Owner/Admin keep full access via
--     sales_stvpos_admin_all.
--   * Length bound (500 chars) is enforced in the database, not just the UI.
--     The constraint is validated instantly because every existing row is
--     NULL for a brand-new column.

alter table public.sales
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_description_length_chk'
      and conrelid = 'public.sales'::regclass
  ) then
    alter table public.sales
      add constraint sales_description_length_chk
      check (description is null or char_length(description) <= 500);
  end if;
end $$;

comment on column public.sales.description is
  'Free-text description of what was sold (e.g. "Two rides purchased by two guests"). NULL for historical sales recorded before this column existed.';
