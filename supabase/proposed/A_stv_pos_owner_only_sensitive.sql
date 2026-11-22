-- PROPOSED -- NOT APPLIED. For review only.
-- Target: production project nceyjgayttsaozfqiwtj (stv-pos application).
--
-- Moves the most sensitive POS data to EXACT Owner-only, and makes the
-- remaining Owner+Admin rules on the same tables an explicit allowlist
-- (has_role(...) per slug) instead of a level comparison.
--
--   * Debt & Credit ledger (people, records, payments, statement numbers)
--                                         Owner+Admin  -> Owner only
--   * Weekly manager reports              Owner+Admin  -> Owner only
--   * Delete a sale / delete an expense   Owner+Admin  -> Owner only
--   * Read all / edit sales & expenses    Owner+Admin  -> unchanged (explicit allowlist)
--   * Workers' own sales/expenses (insert + read own) -> unchanged (not touched)
--
-- Today stv-pos has 2 Owners and 5 Workers and NO Admins, so no current user
-- loses or gains anything. No rows, columns, tables or numbering change.
-- (No explicit BEGIN/COMMIT: migrations already run in one transaction, and
-- an embedded COMMIT would defeat a rolled-back dry run.)


-- Debt & Credit ---------------------------------------------------------
drop policy if exists debt_credit_people_admin_all on public.debt_credit_people;
create policy debt_credit_people_owner_all on public.debt_credit_people
  for all to authenticated
  using (has_role('stv-pos', 'owner')) with check (has_role('stv-pos', 'owner'));

drop policy if exists debt_credit_records_admin_all on public.debt_credit_records;
create policy debt_credit_records_owner_all on public.debt_credit_records
  for all to authenticated
  using (has_role('stv-pos', 'owner')) with check (has_role('stv-pos', 'owner'));

drop policy if exists debt_credit_payments_admin_all on public.debt_credit_payments;
create policy debt_credit_payments_owner_all on public.debt_credit_payments
  for all to authenticated
  using (has_role('stv-pos', 'owner')) with check (has_role('stv-pos', 'owner'));

-- next_debt_statement_number(): SECURITY DEFINER -> must self-check too.
-- Rewrites ONLY the role check, asserting exactly one occurrence.
do $$
declare
  f   regprocedure := 'public.next_debt_statement_number()'::regprocedure;
  def text := pg_get_functiondef('public.next_debt_statement_number()'::regprocedure);
  old_check constant text := 'has_minimum_role(''stv-pos'', ''admin'')';
begin
  if (length(def) - length(replace(def, old_check, ''))) / length(old_check) <> 1 then
    raise exception 'Unexpected definition of %, aborting', f;
  end if;
  execute replace(def, old_check, 'has_role(''stv-pos'', ''owner'')');
end $$;

-- Weekly manager reports -------------------------------------------------
drop policy if exists weekly_reports_admin_all on public.weekly_reports;
create policy weekly_reports_owner_all on public.weekly_reports
  for all to authenticated
  using (has_role('stv-pos', 'owner')) with check (has_role('stv-pos', 'owner'));

-- Sales: split the Owner+Admin ALL policy; DELETE becomes Owner-only ------
drop policy if exists sales_stvpos_admin_all on public.sales;
create policy sales_stvpos_manage_select on public.sales
  for select to authenticated
  using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy sales_stvpos_manage_insert on public.sales
  for insert to authenticated
  with check (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy sales_stvpos_manage_update on public.sales
  for update to authenticated
  using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'))
  with check (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy sales_stvpos_owner_delete on public.sales
  for delete to authenticated
  using (has_role('stv-pos', 'owner'));
-- sales_stvpos_insert_own / sales_stvpos_select_own (workers): untouched.

-- Expenses: same split ----------------------------------------------------
drop policy if exists expenses_stvpos_admin_all on public.expenses;
create policy expenses_stvpos_manage_select on public.expenses
  for select to authenticated
  using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy expenses_stvpos_manage_insert on public.expenses
  for insert to authenticated
  with check (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy expenses_stvpos_manage_update on public.expenses
  for update to authenticated
  using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'))
  with check (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy expenses_stvpos_owner_delete on public.expenses
  for delete to authenticated
  using (has_role('stv-pos', 'owner'));
-- expenses_stvpos_insert_own / expenses_stvpos_select_own (workers): untouched.

