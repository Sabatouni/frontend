-- Additive linking columns only. Every existing row defaults to
-- payment_status='paid' (unchanged behavior for anything already there or
-- inserted without knowing about this column), and debt_credit_record_id
-- is nullable so a normal cash sale/expense never touches Debt & Credit at
-- all. No existing column, row, calculation, or policy is altered.
alter table public.sales
  add column if not exists payment_status text not null default 'paid'
    check (payment_status in ('paid', 'credit')),
  add column if not exists debt_credit_record_id uuid references public.debt_credit_records(id);

alter table public.expenses
  add column if not exists payment_status text not null default 'paid'
    check (payment_status in ('paid', 'credit')),
  add column if not exists debt_credit_record_id uuid references public.debt_credit_records(id);
