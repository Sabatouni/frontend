-- Operational Document Generation System
--
-- Covers the four supplied source specifications:
--   * Stock Restock Request & Inventory Form        -> restock_request
--   * Kitchen & Restaurant Equipment List            -> kitchen_equipment, dining_equipment
--   * Inventory Checklist (8 sections)               -> inventory_checklist
--   * Go-Kart Damage Report & Maintenance Logbook    -> gokart_damage_report,
--                                                      gokart_maintenance_log,
--                                                      gokart_safety_inspection
--
-- Why a new table and not stv_documents: stv_documents belongs to the public
-- booking system (booking_id NOT NULL, storage-path-only). These are internal
-- POS operational records with structured form data, approvals and history.
--
-- Purely additive: creates new objects only. No existing table, policy,
-- trigger, function, bucket or row is altered.
--
-- Design rules enforced IN THE DATABASE (not only the UI):
--   1. History is never overwritten. Once a document is created its content
--      (payload, summary, type, date, department, kart, safety status,
--      reference number, author) is immutable. An "updated" equipment list or
--      a re-inspection is a NEW document; the old one stays.
--   2. No DELETE policy for anyone -> documents and their event trail persist.
--      anon has no privileges at all; authenticated cannot TRUNCATE.
--   3. Reference numbers are generated server-side, unique, per type + year
--      (Zanzibar local year), e.g. STV-RR-2026-0001, STV-GK-2026-0001.
--   4. Duplicate submissions (double-tap, retry after a network blip) are
--      rejected by a unique client_request_id generated per form session.
--   5. Status transitions are validated; reviewer identity/time is stamped by
--      the server from auth.uid() + profiles, never trusted from the client.
--   6. Go-kart fleet:
--      * Only Owner/Admin can register a kart (always as OPERATIONAL; the
--        registration is written to gokart_status_history).
--      * Every go-kart document must reference karts that are already
--        registered -- reports never create fleet records.
--      * A damage report / failed inspection can only make a kart's status
--        WORSE automatically. A safety inspection with any FAIL item cannot be
--        recorded as OPERATIONAL.
--      * Returning a kart to service is only possible through
--        verify_gokart_status(): Owner/Admin-only, written note required, any
--        linked repair record must be a maintenance log for that same kart,
--        and the change is logged permanently.
--   7. Restock requests never touch inventory. Stock still only changes via
--      the existing record_inventory_movement() Add Stock / Adjust workflow.
--
-- Roles are checked by EXACT slug via public.stv_pos_can_manage_opsdocs()
-- (owner or admin), never by level, matching the exact-role model used by
-- the frontend (src/lib/permissions.js / src/lib/access.js). A future role
-- placed above admin in public.roles does not inherit approval rights.
--
-- Permissions (mirrors the existing stv-pos role model):
--   * Worker  : create restock requests, inventory checklists and go-kart
--               documents for registered karts; read their own documents plus
--               all go-kart documents/fleet status (maintenance history is
--               shared operational safety information). Cannot approve, edit
--               or delete anything. Cannot create equipment lists. Cannot
--               register karts.
--   * Admin / Owner : everything above for all documents, plus equipment
--               lists, approve / reject / fulfil, kart registration and
--               verified kart status changes. Still cannot alter document
--               content or delete.

-- ── Reference number counters ────────────────────────────────────────────
create table if not exists public.operational_document_counters (
  prefix     text    not null,
  year       integer not null,
  last_value integer not null default 0,
  primary key (prefix, year)
);
alter table public.operational_document_counters enable row level security;
-- No policies on purpose: only the SECURITY DEFINER trigger below touches it.

create or replace function public.stv_next_opsdoc_reference(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  -- Zanzibar local calendar year (UTC+3), so a document created just after
  -- local midnight on 1 January gets the new year, not the previous one.
  v_year   integer := extract(year from (now() at time zone 'Africa/Dar_es_Salaam'))::integer;
  v_next   integer;
begin
  v_prefix := case p_doc_type
    when 'restock_request'          then 'STV-RR'
    when 'kitchen_equipment'        then 'STV-KCE'
    when 'dining_equipment'         then 'STV-RDE'
    when 'inventory_checklist'      then 'STV-IC'
    when 'gokart_damage_report'     then 'STV-GK'
    when 'gokart_maintenance_log'   then 'STV-GKM'
    when 'gokart_safety_inspection' then 'STV-GKS'
    else null
  end;
  if v_prefix is null then
    raise exception 'unknown document type: %', p_doc_type;
  end if;

  insert into public.operational_document_counters (prefix, year, last_value)
  values (v_prefix, v_year, 1)
  on conflict (prefix, year)
  do update set last_value = public.operational_document_counters.last_value + 1
  returning last_value into v_next;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke execute on function public.stv_next_opsdoc_reference(text) from public, anon, authenticated;

-- ── Documents ────────────────────────────────────────────────────────────
create table if not exists public.operational_documents (
  id                 uuid primary key default gen_random_uuid(),
  doc_type           text not null check (doc_type in (
                       'restock_request','kitchen_equipment','dining_equipment',
                       'inventory_checklist','gokart_damage_report',
                       'gokart_maintenance_log','gokart_safety_inspection')),
  reference_number   text not null unique,
  title              text not null check (char_length(title) between 1 and 200),
  department         text not null check (char_length(department) between 1 and 80),
  document_date      date not null,
  status             text not null default 'PENDING'
                       check (status in ('PENDING','APPROVED','REJECTED','FULFILLED')),
  payload            jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
  summary            jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(summary) = 'object'),
  kart_ids           text[] not null default '{}',
  safety_status      text check (safety_status in ('OPERATIONAL','RESTRICTED','OUT_OF_SERVICE')),
  client_request_id  uuid not null unique,
  created_by         uuid not null default auth.uid(),
  created_by_name    text,
  created_at         timestamptz not null default now(),
  reviewed_by        uuid,
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_note        text check (review_note is null or char_length(review_note) <= 1000),
  fulfilled_by       uuid,
  fulfilled_by_name  text,
  fulfilled_at       timestamptz,
  updated_at         timestamptz not null default now()
);

create index if not exists operational_documents_type_date_idx on public.operational_documents (doc_type, document_date desc);
create index if not exists operational_documents_created_by_idx on public.operational_documents (created_by);
create index if not exists operational_documents_status_idx on public.operational_documents (status);
create index if not exists operational_documents_kart_ids_idx on public.operational_documents using gin (kart_ids);
create index if not exists operational_documents_created_at_idx on public.operational_documents (created_at desc);

-- ── Event trail (append-only) ────────────────────────────────────────────
create table if not exists public.operational_document_events (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.operational_documents(id),
  event        text not null check (event in ('CREATED','STATUS_CHANGED')),
  from_status  text,
  to_status    text,
  note         text,
  actor_id     uuid,
  actor_name   text,
  created_at   timestamptz not null default now()
);
-- Leading column covers the document_id foreign key.
create index if not exists operational_document_events_doc_idx on public.operational_document_events (document_id, created_at);

-- ── Go-kart fleet status ─────────────────────────────────────────────────
create table if not exists public.gokart_units (
  kart_id                text primary key check (kart_id ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  label                  text check (label is null or char_length(label) <= 80),
  current_status         text not null default 'OPERATIONAL'
                           check (current_status in ('OPERATIONAL','RESTRICTED','OUT_OF_SERVICE')),
  status_reason          text,
  status_document_id     uuid references public.operational_documents(id),
  status_changed_at      timestamptz not null default now(),
  status_changed_by_name text,
  created_at             timestamptz not null default now()
);
-- Foreign-key index (was missing).
create index if not exists gokart_units_status_document_id_idx on public.gokart_units (status_document_id);

create table if not exists public.gokart_status_history (
  id           uuid primary key default gen_random_uuid(),
  kart_id      text not null references public.gokart_units(kart_id),
  from_status  text,
  to_status    text not null,
  change_type  text not null check (change_type in ('REPORT_ESCALATION','VERIFIED_CHANGE','REGISTERED')),
  reason       text,
  document_id  uuid references public.operational_documents(id),
  actor_id     uuid,
  actor_name   text,
  created_at   timestamptz not null default now()
);
-- Leading column covers the kart_id foreign key.
create index if not exists gokart_status_history_kart_idx on public.gokart_status_history (kart_id, created_at desc);
-- Foreign-key index (was missing).
create index if not exists gokart_status_history_document_id_idx on public.gokart_status_history (document_id);

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Exact-role management check: stv-pos Owner OR Admin, by slug.
create or replace function public.stv_pos_can_manage_opsdocs()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('stv-pos', 'owner') or public.has_role('stv-pos', 'admin')
$$;
revoke execute on function public.stv_pos_can_manage_opsdocs() from public, anon;
grant execute on function public.stv_pos_can_manage_opsdocs() to authenticated;

create or replace function public.stv_current_actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.full_name), ''), p.email)
  from public.profiles p
  where p.id = auth.uid()
$$;
revoke execute on function public.stv_current_actor_name() from public, anon;

create or replace function public.stv_safety_rank(p_status text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_status when 'OUT_OF_SERVICE' then 2 when 'RESTRICTED' then 1 else 0 end
$$;

-- Escalate-only: never improves a kart's status and never creates a kart.
-- The kart row is locked FOR UPDATE, so simultaneous reports for the same
-- kart are serialised instead of racing (the old "first report creates the
-- kart" path, which could hit a duplicate-key error, no longer exists).
create or replace function public.stv_gokart_escalate(p_kart_id text, p_status text, p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  select current_status into v_current from public.gokart_units where kart_id = p_kart_id for update;
  if not found then
    raise exception 'Kart % is not registered. Ask an Owner/Admin to register it first.', p_kart_id;
  end if;

  if public.stv_safety_rank(p_status) > public.stv_safety_rank(v_current) then
    update public.gokart_units
       set current_status = p_status,
           status_reason = p_reason,
           status_document_id = p_document_id,
           status_changed_at = now(),
           status_changed_by_name = public.stv_current_actor_name()
     where kart_id = p_kart_id;
    insert into public.gokart_status_history (kart_id, from_status, to_status, change_type, reason, document_id, actor_id, actor_name)
    values (p_kart_id, v_current, p_status, 'REPORT_ESCALATION', p_reason, p_document_id, auth.uid(), public.stv_current_actor_name());
  end if;
end;
$$;
revoke execute on function public.stv_gokart_escalate(text, text, uuid, text) from public, anon, authenticated;

-- ── Triggers on operational_documents ───────────────────────────────────
create or replace function public.stv_opsdoc_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unknown text;
begin
  -- Server-controlled fields: never trust the client for these.
  new.created_by       := auth.uid();
  new.created_by_name  := coalesce(public.stv_current_actor_name(), nullif(trim(new.created_by_name), ''));
  new.created_at       := now();
  new.updated_at       := now();
  new.status           := 'PENDING';
  new.reviewed_by := null; new.reviewed_by_name := null; new.reviewed_at := null; new.review_note := null;
  new.fulfilled_by := null; new.fulfilled_by_name := null; new.fulfilled_at := null;
  new.kart_ids := coalesce(
    (select array_agg(distinct upper(trim(k))) from unnest(new.kart_ids) k where trim(k) <> ''),
    '{}'
  );

  if new.doc_type like 'gokart\_%' then
    if cardinality(new.kart_ids) = 0 then
      raise exception 'A % must reference at least one registered kart', new.doc_type;
    end if;
    -- Reports never create fleet records: every kart must already exist.
    select k into v_unknown
      from unnest(new.kart_ids) k
     where not exists (select 1 from public.gokart_units u where u.kart_id = k)
     limit 1;
    if v_unknown is not null then
      raise exception 'Kart % is not registered. Ask an Owner/Admin to register it first.', v_unknown;
    end if;
  end if;

  if new.doc_type in ('gokart_damage_report','gokart_safety_inspection') then
    if cardinality(new.kart_ids) <> 1 then
      raise exception 'A % must reference exactly one kart', new.doc_type;
    end if;
    if new.safety_status is null then
      raise exception 'Safety status is required for %', new.doc_type;
    end if;
  elsif new.doc_type <> 'gokart_maintenance_log' then
    new.kart_ids := '{}';
    new.safety_status := null;
  else
    new.safety_status := null; -- a log entry never changes kart status
  end if;

  -- A safety inspection with any failed check can never be OPERATIONAL.
  if new.doc_type = 'gokart_safety_inspection' and new.safety_status = 'OPERATIONAL' then
    if jsonb_typeof(new.payload -> 'checks') = 'array' and exists (
      select 1 from jsonb_array_elements(new.payload -> 'checks') c
       where upper(coalesce(c ->> 'status', '')) = 'FAIL'
    ) then
      raise exception 'A safety inspection with a failed check cannot be recorded as OPERATIONAL';
    end if;
  end if;

  -- Allocated last, so a rejected insert doesn't even attempt a number
  -- (any allocation is rolled back with the failed transaction anyway).
  new.reference_number := public.stv_next_opsdoc_reference(new.doc_type);
  return new;
end;
$$;

create or replace function public.stv_opsdoc_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.doc_type          is distinct from old.doc_type
  or new.reference_number  is distinct from old.reference_number
  or new.title             is distinct from old.title
  or new.department        is distinct from old.department
  or new.document_date     is distinct from old.document_date
  or new.payload           is distinct from old.payload
  or new.summary           is distinct from old.summary
  or new.kart_ids          is distinct from old.kart_ids
  or new.safety_status     is distinct from old.safety_status
  or new.client_request_id is distinct from old.client_request_id
  or new.created_by        is distinct from old.created_by
  or new.created_by_name   is distinct from old.created_by_name
  or new.created_at        is distinct from old.created_at then
    raise exception 'Operational documents are immutable once created. Generate a new document instead.';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'PENDING'  and new.status in ('APPROVED','REJECTED'))
      or (old.status = 'APPROVED' and new.status = 'FULFILLED' and old.doc_type = 'restock_request')
    ) then
      raise exception 'Invalid status change % -> % for %', old.status, new.status, old.doc_type;
    end if;

    if new.status = 'FULFILLED' then
      new.fulfilled_by      := auth.uid();
      new.fulfilled_by_name := public.stv_current_actor_name();
      new.fulfilled_at      := now();
      -- keep the approval stamp as it was
      new.reviewed_by := old.reviewed_by; new.reviewed_by_name := old.reviewed_by_name;
      new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
    else
      new.reviewed_by      := auth.uid();
      new.reviewed_by_name := public.stv_current_actor_name();
      new.reviewed_at      := now();
      new.fulfilled_by := null; new.fulfilled_by_name := null; new.fulfilled_at := null;
    end if;
  else
    -- No status change: reviewer/fulfilment stamps cannot be edited either.
    new.reviewed_by := old.reviewed_by; new.reviewed_by_name := old.reviewed_by_name;
    new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
    new.fulfilled_by := old.fulfilled_by; new.fulfilled_by_name := old.fulfilled_by_name;
    new.fulfilled_at := old.fulfilled_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.stv_opsdoc_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.operational_document_events (document_id, event, to_status, actor_id, actor_name)
    values (new.id, 'CREATED', new.status, auth.uid(), new.created_by_name);

    if new.doc_type in ('gokart_damage_report','gokart_safety_inspection') then
      perform public.stv_gokart_escalate(
        new.kart_ids[1], new.safety_status, new.id,
        case new.doc_type
          when 'gokart_damage_report' then 'Damage report ' || new.reference_number
          else 'Safety inspection ' || new.reference_number
        end
      );
    end if;
  elsif new.status is distinct from old.status then
    insert into public.operational_document_events (document_id, event, from_status, to_status, note, actor_id, actor_name)
    values (
      new.id, 'STATUS_CHANGED', old.status, new.status,
      -- The approval note belongs to the approval event only; a fulfilment
      -- event carries no note (review_note still holds the approval note).
      case when new.status = 'FULFILLED' then null else new.review_note end,
      auth.uid(), public.stv_current_actor_name()
    );
  end if;
  return null;
end;
$$;

drop trigger if exists operational_documents_before_insert on public.operational_documents;
create trigger operational_documents_before_insert
  before insert on public.operational_documents
  for each row execute function public.stv_opsdoc_before_insert();

drop trigger if exists operational_documents_before_update on public.operational_documents;
create trigger operational_documents_before_update
  before update on public.operational_documents
  for each row execute function public.stv_opsdoc_before_update();

drop trigger if exists operational_documents_after_write on public.operational_documents;
create trigger operational_documents_after_write
  after insert or update on public.operational_documents
  for each row execute function public.stv_opsdoc_after_write();

-- ── Triggers on gokart_units (manual registration) ──────────────────────
-- Registration is always OPERATIONAL with server-stamped fields, and is
-- written to the permanent status history.
create or replace function public.stv_gokart_before_register()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.kart_id                := upper(trim(new.kart_id));
  new.label                  := nullif(trim(new.label), '');
  new.current_status         := 'OPERATIONAL';
  new.status_reason          := 'Registered';
  new.status_document_id     := null;
  new.status_changed_at      := now();
  new.status_changed_by_name := public.stv_current_actor_name();
  new.created_at             := now();
  return new;
end;
$$;

create or replace function public.stv_gokart_after_register()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gokart_status_history (kart_id, from_status, to_status, change_type, reason, actor_id, actor_name)
  values (new.kart_id, null, new.current_status, 'REGISTERED',
          'Registered' || coalesce(' (' || new.label || ')', ''),
          auth.uid(), public.stv_current_actor_name());
  return null;
end;
$$;

drop trigger if exists gokart_units_before_register on public.gokart_units;
create trigger gokart_units_before_register
  before insert on public.gokart_units
  for each row execute function public.stv_gokart_before_register();

drop trigger if exists gokart_units_after_register on public.gokart_units;
create trigger gokart_units_after_register
  after insert on public.gokart_units
  for each row execute function public.stv_gokart_after_register();

revoke execute on function public.stv_opsdoc_before_insert() from public, anon, authenticated;
revoke execute on function public.stv_opsdoc_before_update() from public, anon, authenticated;
revoke execute on function public.stv_opsdoc_after_write() from public, anon, authenticated;
revoke execute on function public.stv_gokart_before_register() from public, anon, authenticated;
revoke execute on function public.stv_gokart_after_register() from public, anon, authenticated;

-- ── Verified kart status change (the ONLY way back to service) ───────────
create or replace function public.verify_gokart_status(
  p_kart_id text,
  p_new_status text,
  p_note text,
  p_document_id uuid default null
)
returns public.gokart_units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kart    text := upper(trim(p_kart_id));
  v_current text;
  v_row     public.gokart_units;
begin
  if not public.stv_pos_can_manage_opsdocs() then
    raise exception 'Only an Owner/Admin can verify a go-kart status change';
  end if;
  if p_new_status not in ('OPERATIONAL','RESTRICTED','OUT_OF_SERVICE') then
    raise exception 'Invalid status %', p_new_status;
  end if;
  if p_note is null or char_length(trim(p_note)) < 10 then
    raise exception 'A verification note of at least 10 characters is required';
  end if;

  -- A linked repair record must be a (non-rejected) maintenance log entry
  -- for THIS kart.
  if p_document_id is not null and not exists (
    select 1 from public.operational_documents d
     where d.id = p_document_id
       and d.doc_type = 'gokart_maintenance_log'
       and d.status <> 'REJECTED'
       and v_kart = any (d.kart_ids)
  ) then
    raise exception 'The linked repair document must be a maintenance log entry for kart %', v_kart;
  end if;

  select current_status into v_current from public.gokart_units where kart_id = v_kart for update;
  if not found then
    raise exception 'Unknown kart %', v_kart;
  end if;
  if v_current = p_new_status then
    raise exception 'Kart % is already %', v_kart, p_new_status;
  end if;

  update public.gokart_units
     set current_status = p_new_status,
         status_reason = trim(p_note),
         status_document_id = coalesce(p_document_id, status_document_id),
         status_changed_at = now(),
         status_changed_by_name = public.stv_current_actor_name()
   where kart_id = v_kart
   returning * into v_row;

  insert into public.gokart_status_history (kart_id, from_status, to_status, change_type, reason, document_id, actor_id, actor_name)
  values (v_kart, v_current, p_new_status, 'VERIFIED_CHANGE', trim(p_note), p_document_id, auth.uid(), public.stv_current_actor_name());

  return v_row;
end;
$$;
revoke execute on function public.verify_gokart_status(text, text, text, uuid) from public, anon;
grant execute on function public.verify_gokart_status(text, text, text, uuid) to authenticated;

-- ── Table privileges ─────────────────────────────────────────────────────
-- This project's default privileges grant ALL (incl. TRUNCATE, which
-- bypasses RLS and row triggers) on every new public table to anon and
-- authenticated. Tighten that for the new tables only: anon gets nothing,
-- authenticated keeps only the DML that RLS then filters row by row.
revoke all on table
  public.operational_documents,
  public.operational_document_events,
  public.operational_document_counters,
  public.gokart_units,
  public.gokart_status_history
from anon;

revoke truncate, trigger, references on table
  public.operational_documents,
  public.operational_document_events,
  public.operational_document_counters,
  public.gokart_units,
  public.gokart_status_history
from authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.operational_documents enable row level security;
alter table public.operational_document_events enable row level security;
alter table public.gokart_units enable row level security;
alter table public.gokart_status_history enable row level security;

drop policy if exists operational_documents_select on public.operational_documents;
create policy operational_documents_select on public.operational_documents
  for select to authenticated
  using (
    public.stv_pos_can_manage_opsdocs()
    or (
      has_application_access('stv-pos')
      and (created_by = (select auth.uid()) or doc_type like 'gokart\_%')
    )
  );

drop policy if exists operational_documents_insert on public.operational_documents;
create policy operational_documents_insert on public.operational_documents
  for insert to authenticated
  with check (
    has_application_access('stv-pos')
    and created_by = (select auth.uid())
    and (
      doc_type not in ('kitchen_equipment','dining_equipment')
      or public.stv_pos_can_manage_opsdocs()
    )
  );

-- Only status review (approve / reject / fulfil); content immutability and
-- valid transitions are enforced by stv_opsdoc_before_update().
drop policy if exists operational_documents_admin_update on public.operational_documents;
create policy operational_documents_admin_update on public.operational_documents
  for update to authenticated
  using (public.stv_pos_can_manage_opsdocs())
  with check (public.stv_pos_can_manage_opsdocs());

-- No DELETE policy: documents are permanent records.

drop policy if exists operational_document_events_select on public.operational_document_events;
create policy operational_document_events_select on public.operational_document_events
  for select to authenticated
  using (exists (select 1 from public.operational_documents d where d.id = document_id));
  -- ^ evaluated with the caller's RLS on operational_documents, so events
  --   are visible exactly when their document is.

drop policy if exists gokart_units_select on public.gokart_units;
create policy gokart_units_select on public.gokart_units
  for select to authenticated
  using (has_application_access('stv-pos'));

-- Owner/Admin only. The registration trigger forces OPERATIONAL and stamps
-- the server-side fields; every later status change goes through the
-- escalation trigger or verify_gokart_status(). No UPDATE/DELETE policy.
drop policy if exists gokart_units_admin_insert on public.gokart_units;
create policy gokart_units_admin_insert on public.gokart_units
  for insert to authenticated
  with check (public.stv_pos_can_manage_opsdocs() and current_status = 'OPERATIONAL');

drop policy if exists gokart_status_history_select on public.gokart_status_history;
create policy gokart_status_history_select on public.gokart_status_history
  for select to authenticated
  using (has_application_access('stv-pos'));

-- ── Private storage for photographic evidence ────────────────────────────
-- New bucket rather than stv-documents/stv-images, whose policies are not
-- scoped to the stv-pos application (see the itinerary storage migration).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stv-ops-documents', 'stv-ops-documents', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists stv_ops_documents_select on storage.objects;
create policy stv_ops_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'stv-ops-documents' and has_application_access('stv-pos'));

-- Members may upload evidence (only under evidence/<their uid>/...) but never
-- overwrite or delete it -> evidence attached to a report cannot be swapped.
drop policy if exists stv_ops_documents_insert on storage.objects;
create policy stv_ops_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stv-ops-documents'
    and has_application_access('stv-pos')
    and (storage.foldername(name))[1] = 'evidence'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
