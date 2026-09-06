-- Advisor follow-up: pin search_path on the trigger function (matches the
-- other fix already applied to next_debt_statement_number), and stop the
-- anon/public role from being able to invoke the statement-number RPC at
-- all -- it already self-checks has_minimum_role and would just raise an
-- exception for anon, but there's no reason to let an unauthenticated
-- request reach it in the first place.
create or replace function public.stv_set_debt_credit_receipt_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.receipt_number is null or new.receipt_number = '' then
    new.receipt_number := 'PCR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.stv_dc_receipt_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

revoke execute on function public.next_debt_statement_number() from public;
revoke execute on function public.next_debt_statement_number() from anon;
grant execute on function public.next_debt_statement_number() to authenticated;
