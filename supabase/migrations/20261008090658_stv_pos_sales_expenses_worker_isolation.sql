-- Worker isolation for sales/expenses: a Worker may only READ the rows they
-- personally recorded. Owner/Admin stay business-wide.
--
-- Before this migration the SELECT policy on both tables was
--   using (has_application_access('stv-pos'))
-- i.e. any stv-pos Worker could read every other Worker's sales/expenses
-- (the frontend's supabase.from("sales").select("*") downloaded all of them).
--
-- Ownership column is the EXISTING `user_id uuid` on both tables -- it has
-- held auth.uid() of the recorder since fix_sales_rls_and_backfill_user_ids,
-- and the existing *_stvpos_insert_own policies already force
-- `user_id = auth.uid()` on every Worker insert, so it cannot be spoofed.
-- No new column is added (expenses.created_by is a display-only email text
-- and is deliberately NOT used for authorization).
--
-- What is intentionally left untouched:
--   * sales_stvpos_admin_all / expenses_stvpos_admin_all (FOR ALL,
--     has_minimum_role('stv-pos','admin')) -- this is what keeps Owner/Admin
--     reading, updating and deleting every row, including historical rows
--     whose user_id belongs to an account that no longer exists.
--   * sales_stvpos_insert_own / expenses_stvpos_insert_own.
--   * Workers still have NO update and NO delete policy on either table --
--     they could not modify or delete any row before this migration and
--     still cannot, their own included.
--
-- No row is updated: historical rows keep whatever user_id they already
-- have and are never reassigned to anyone.

drop policy if exists sales_stvpos_select on public.sales;
drop policy if exists sales_stvpos_select_own on public.sales;
create policy sales_stvpos_select_own on public.sales
  for select
  to authenticated
  using (has_application_access('stv-pos') and user_id = (select auth.uid()));

drop policy if exists expenses_stvpos_select on public.expenses;
drop policy if exists expenses_stvpos_select_own on public.expenses;
create policy expenses_stvpos_select_own on public.expenses
  for select
  to authenticated
  using (has_application_access('stv-pos') and user_id = (select auth.uid()));

-- The new policies filter on user_id for every Worker read.
create index if not exists sales_user_id_idx on public.sales (user_id);
create index if not exists expenses_user_id_idx on public.expenses (user_id);
