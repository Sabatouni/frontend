-- Debt & Credit ledger module. Additive only -- no existing table, column,
-- row, or policy is touched. Direction convention:
--   RECEIVABLE = a person/account owes Swahili Tent Village money
--   PAYABLE    = Swahili Tent Village owes a person/account money
-- Balances are never stored as a mutable field: they are always
-- original_amount - sum(payments), computed in the views below, so a
-- balance can never drift out of sync with its payment history.

create table if not exists public.debt_credit_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  archived_at timestamptz,
  archived_by uuid
);

create index if not exists debt_credit_people_name_idx on public.debt_credit_people (lower(name));
create index if not exists debt_credit_people_active_idx on public.debt_credit_people (id) where archived_at is null;

drop trigger if exists debt_credit_people_touch_updated_at on public.debt_credit_people;
create trigger debt_credit_people_touch_updated_at
  before update on public.debt_credit_people
  for each row execute function public.stv_touch_updated_at();

create table if not exists public.debt_credit_records (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.debt_credit_people(id),
  direction text not null check (direction in ('RECEIVABLE', 'PAYABLE')),
  category text not null,
  description text,
  original_amount numeric not null check (original_amount > 0),
  -- Loose reference (no FK) since it can point at either sales or expenses --
  -- same pattern already used by stv_itinerary_library.image_ids.
  source_type text check (source_type in ('sale', 'expense')),
  source_id uuid,
  internal_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid
);

create index if not exists debt_credit_records_person_idx on public.debt_credit_records (person_id);
create index if not exists debt_credit_records_active_idx on public.debt_credit_records (direction) where archived_at is null;
create index if not exists debt_credit_records_source_idx on public.debt_credit_records (source_type, source_id) where source_id is not null;

drop trigger if exists debt_credit_records_touch_updated_at on public.debt_credit_records;
create trigger debt_credit_records_touch_updated_at
  before update on public.debt_credit_records
  for each row execute function public.stv_touch_updated_at();

-- Payments/settlements are append-only historical records -- no updated_at,
-- no edit path. A correction is made by recording a new payment or, if a
-- payment was recorded in error, archiving the record it belongs to; the
-- row itself is never mutated once created.
create table if not exists public.debt_credit_payments (
  id uuid primary key default gen_random_uuid(),
  debt_credit_record_id uuid not null references public.debt_credit_records(id),
  person_id uuid references public.debt_credit_people(id),
  amount numeric not null check (amount > 0),
  payment_date timestamptz not null default now(),
  note text,
  recorded_by uuid,
  recorded_by_name text,
  receipt_number text,
  created_at timestamptz not null default now()
);

create index if not exists debt_credit_payments_record_idx on public.debt_credit_payments (debt_credit_record_id);
create index if not exists debt_credit_payments_person_idx on public.debt_credit_payments (person_id);

-- Per-record balance: original amount minus every payment against it.
-- security_invoker means this view is checked against the QUERYING user's
-- own RLS grants (Postgres 15+), not the view owner's -- so it can never
-- expose a row the caller's own RLS policies would otherwise hide.
create or replace view public.debt_credit_record_balances
with (security_invoker = true) as
select
  r.*,
  coalesce(p.paid_total, 0) as paid_total,
  r.original_amount - coalesce(p.paid_total, 0) as remaining,
  case
    when coalesce(p.paid_total, 0) <= 0 then 'outstanding'
    when coalesce(p.paid_total, 0) < r.original_amount then 'partially_paid'
    when coalesce(p.paid_total, 0) = r.original_amount then 'paid'
    else 'overpaid'
  end as status
from public.debt_credit_records r
left join (
  select debt_credit_record_id, sum(amount) as paid_total
  from public.debt_credit_payments
  group by debt_credit_record_id
) p on p.debt_credit_record_id = r.id;

-- Per-person rollup: outstanding totals in each direction, active records only.
create or replace view public.debt_credit_person_balances
with (security_invoker = true) as
select
  pe.id as person_id,
  pe.name,
  pe.phone,
  pe.email,
  pe.notes,
  pe.archived_at,
  count(r.id) filter (where r.archived_at is null) as active_record_count,
  coalesce(sum(b.remaining) filter (where r.direction = 'RECEIVABLE' and r.archived_at is null), 0) as receivable_outstanding,
  coalesce(sum(b.remaining) filter (where r.direction = 'PAYABLE' and r.archived_at is null), 0) as payable_outstanding
from public.debt_credit_people pe
left join public.debt_credit_records r on r.person_id = pe.id
left join public.debt_credit_record_balances b on b.id = r.id
group by pe.id;
