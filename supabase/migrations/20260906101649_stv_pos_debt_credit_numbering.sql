-- Document numbering for Debt & Credit, following the same
-- sequence-plus-trigger mechanism already used for invoices
-- (stv_invoice_number_seq / stv_set_invoice_number), just with a year
-- segment since the user wants "PCR-2026-000001" / "DC-2026-000001" style
-- numbers rather than the invoice's plain "STV-001".

create sequence if not exists public.stv_dc_receipt_number_seq;

create or replace function public.stv_set_debt_credit_receipt_number()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_number is null or new.receipt_number = '' then
    new.receipt_number := 'PCR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.stv_dc_receipt_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists debt_credit_payments_set_receipt_number on public.debt_credit_payments;
create trigger debt_credit_payments_set_receipt_number
  before insert on public.debt_credit_payments
  for each row execute function public.stv_set_debt_credit_receipt_number();

-- Account Statements aren't a stored row (a statement is a point-in-time
-- report over a person's whole history, not a discrete event like a
-- payment), so there's no natural table to trigger off. This RPC hands out
-- a unique, monotonic, year-stamped number atomically -- SECURITY DEFINER
-- so it can advance the sequence regardless of grants, but it independently
-- re-checks the admin role itself rather than trusting the caller, so it
-- carries no more privilege than the RLS policies above already grant.
create sequence if not exists public.stv_dc_statement_number_seq;

create or replace function public.next_debt_statement_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'not authorized';
  end if;
  return 'DC-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.stv_dc_statement_number_seq')::text, 6, '0');
end;
$$;
