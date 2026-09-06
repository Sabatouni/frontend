-- Debt & Credit is sensitive financial data. Mirror the STRICTEST existing
-- pattern in this app (invoices/invoice_items): Owner/Admin get full access,
-- Workers get none at all -- not even their own rows, not even SELECT.
alter table public.debt_credit_people enable row level security;
alter table public.debt_credit_records enable row level security;
alter table public.debt_credit_payments enable row level security;

create policy debt_credit_people_admin_all on public.debt_credit_people
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy debt_credit_records_admin_all on public.debt_credit_records
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy debt_credit_payments_admin_all on public.debt_credit_payments
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));
