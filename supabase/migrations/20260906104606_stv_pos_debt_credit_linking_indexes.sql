-- Advisor follow-up: the sales.debt_credit_record_id / expenses.debt_credit_record_id
-- foreign keys added in the linking migration had no covering index, which
-- the performance advisor flagged (unindexed FKs slow down joins back from
-- a debt/credit record to its originating sale or expense, and can add lock
-- contention when a referenced debt_credit_records row is updated/deleted).
-- Purely additive -- no existing index, column, or query path touched.
create index if not exists sales_debt_credit_record_id_idx
  on public.sales (debt_credit_record_id)
  where debt_credit_record_id is not null;

create index if not exists expenses_debt_credit_record_id_idx
  on public.expenses (debt_credit_record_id)
  where debt_credit_record_id is not null;
