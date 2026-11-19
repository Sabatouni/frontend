-- MARINE INVOICING -- Swahili Marine & Diving (Marine Services Division of
-- GEC Limited). Quotations, proforma invoices and final invoices.
--
-- Purely additive: creates new objects only (all prefixed marine_). No
-- existing table, policy, function or row is touched. Independent of the
-- Swahili Tent Village invoices/invoice_items tables, which keep their own
-- STV-### numbering.
--
-- Rules enforced IN THE DATABASE, not only the UI:
--   1. Numbers (SMD-QTN-YYYY-001 / SMD-PI-YYYY-001 / SMD-INV-YYYY-001) are
--      allocated only when a document is ISSUED, server-side, from a
--      per-type + per-year counter row locked by INSERT ... ON CONFLICT DO
--      UPDATE. Concurrent issuers serialise on that row; a UNIQUE constraint
--      on document_number is a second backstop. Drafts never consume a
--      number, so abandoned drafts never leave gaps. Year = Zanzibar local
--      calendar year (UTC+3) at the moment of issue.
--   2. Only DRAFTS can be edited or deleted. Once ISSUED, the content, line
--      items, scope of work, banking snapshot and contact/footer snapshot are
--      frozen. Corrections go through revise (new numbered document that
--      supersedes and cancels the original when issued) or cancel (with a
--      reason). Nothing issued is ever deleted.
--   3. Conversion (QUOTATION -> PROFORMA -> INVOICE, or QUOTATION -> INVOICE)
--      copies into a NEW document linked by source_document_id. The source
--      is never modified except for its status flipping to CONVERTED when
--      the new document is issued.
--   4. Status, number, issue/cancel stamps and relationships cannot be set
--      by a client directly -- only by the SECURITY DEFINER RPCs below.
--   5. Totals are recomputed server-side from the stored line items on
--      every save and again at issue. Manual VAT / total overrides are kept
--      in separate columns, so the calculated values are always visible
--      next to the override.
--
-- Permissions (stv-pos application):
--   * Admin / Owner : read, draft, issue, convert, revise, cancel, manage
--                     libraries.
--   * Owner only    : change the global invoice settings (banking, contacts,
--                     footer, default VAT).
--   * Worker / anon : no access at all (documents carry customer tax IDs and
--                     company banking details).

-- ── Helpers ──────────────────────────────────────────────────────────────
create or replace function public.marine_actor_name()
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
revoke execute on function public.marine_actor_name() from public, anon;
grant execute on function public.marine_actor_name() to authenticated;

create or replace function public.marine_local_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Africa/Dar_es_Salaam')::date $$;

-- ── Global settings (singleton) ──────────────────────────────────────────
-- The permanent header (logo + SWAHILI MARINE & DIVING / MARINE SERVICES
-- DIVISION / A division of GEC LIMITED) is deliberately NOT stored here: it
-- is fixed in the PDF template and cannot be edited.
create table if not exists public.marine_invoice_settings (
  id                  smallint primary key default 1 check (id = 1),
  bank_name           text not null default 'NMB' check (char_length(bank_name) <= 120),
  bank_account_name   text not null default 'GOLDEN EMPIRE COMPANY LIMITED' check (char_length(bank_account_name) <= 160),
  bank_account_number text not null default '22910118721' check (char_length(bank_account_number) <= 60),
  bank_branch         text not null default 'Zanzibar (229)' check (char_length(bank_branch) <= 120),
  currency            text not null default 'TZS' check (char_length(currency) between 1 and 10),
  default_vat_percent numeric(5,2) not null default 15 check (default_vat_percent between 0 and 100),
  -- [{ "type": "email|phone|whatsapp|website|other", "label": "...", "value": "..." }]
  contacts            jsonb not null default '[
                        {"type":"email","label":"Email","value":"contact@mygoldenempire.com"},
                        {"type":"phone","label":"Additional contact","value":"+86 156 91833253"}
                      ]'::jsonb
                      check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 12),
  footer_line         text not null default 'SWAHILI MARINE & DIVING | GEC LIMITED' check (char_length(footer_line) <= 200),
  default_notes       text check (default_notes is null or char_length(default_notes) <= 2000),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_by_name     text
);
insert into public.marine_invoice_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.marine_settings_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := 1;
  if exists (
    select 1 from jsonb_array_elements(new.contacts) c
     where jsonb_typeof(c) <> 'object'
        or coalesce(trim(c ->> 'value'), '') = ''
        or char_length(c ->> 'value') > 160
        or char_length(coalesce(c ->> 'label', '')) > 60
  ) then
    raise exception 'Every contact needs a value (max 160 characters) and a label of at most 60 characters';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := public.marine_actor_name();
  return new;
end;
$$;
drop trigger if exists marine_invoice_settings_before_update on public.marine_invoice_settings;
create trigger marine_invoice_settings_before_update
  before update on public.marine_invoice_settings
  for each row execute function public.marine_settings_before_update();

-- ── Reusable libraries ───────────────────────────────────────────────────
create table if not exists public.marine_catalog_items (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(trim(name)) between 1 and 500),
  category           text not null default 'Service' check (category in ('Service','Material','Equipment','Labour','Transport','Other')),
  unit               text not null default 'service' check (char_length(unit) between 1 and 30),
  default_unit_price numeric(16,2) not null default 0 check (default_unit_price >= 0),
  notes              text check (notes is null or char_length(notes) <= 1000),
  is_active          boolean not null default true,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists marine_catalog_items_active_name_idx on public.marine_catalog_items (is_active, lower(name));

create table if not exists public.marine_scope_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  is_active   boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists marine_scope_templates_active_title_idx on public.marine_scope_templates (is_active, lower(title));

drop trigger if exists marine_catalog_items_touch_updated_at on public.marine_catalog_items;
create trigger marine_catalog_items_touch_updated_at
  before update on public.marine_catalog_items
  for each row execute function public.stv_touch_updated_at();
drop trigger if exists marine_scope_templates_touch_updated_at on public.marine_scope_templates;
create trigger marine_scope_templates_touch_updated_at
  before update on public.marine_scope_templates
  for each row execute function public.stv_touch_updated_at();

-- ── Numbering ────────────────────────────────────────────────────────────
create table if not exists public.marine_document_counters (
  doc_type   text    not null check (doc_type in ('QUOTATION','PROFORMA','INVOICE')),
  year       integer not null check (year between 2000 and 2999),
  last_value integer not null default 0,
  primary key (doc_type, year)
);
-- No policies on purpose: only marine_next_document_number() touches it.

create or replace function public.marine_doc_prefix(p_doc_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_doc_type
    when 'QUOTATION' then 'SMD-QTN'
    when 'PROFORMA'  then 'SMD-PI'
    when 'INVOICE'   then 'SMD-INV'
  end
$$;

-- Atomic: the upsert takes a row lock on (doc_type, year), so concurrent
-- callers queue behind each other and each gets the next value. Numbers
-- reset per calendar year simply because each year is a new counter row.
create or replace function public.marine_next_document_number(p_doc_type text, p_year integer)
returns table (document_number text, number_seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := public.marine_doc_prefix(p_doc_type);
  v_next   integer;
begin
  if v_prefix is null then
    raise exception 'Unknown document type %', p_doc_type;
  end if;
  insert into public.marine_document_counters (doc_type, year, last_value)
  values (p_doc_type, p_year, 1)
  on conflict (doc_type, year)
  do update set last_value = public.marine_document_counters.last_value + 1
  returning last_value into v_next;

  document_number := v_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 3, '0');
  number_seq := v_next;
  return next;
end;
$$;
revoke execute on function public.marine_next_document_number(text, integer) from public, anon, authenticated;

-- ── Documents ────────────────────────────────────────────────────────────
create table if not exists public.marine_documents (
  id                   uuid primary key default gen_random_uuid(),
  doc_type             text not null check (doc_type in ('QUOTATION','PROFORMA','INVOICE')),
  status               text not null default 'DRAFT' check (status in ('DRAFT','ISSUED','CONVERTED','CANCELLED')),
  document_number      text unique check (document_number is null or document_number ~ '^SMD-(QTN|PI|INV)-[0-9]{4}-[0-9]{3,}$'),
  number_year          integer,
  number_seq           integer,
  document_date        date not null default public.marine_local_today(),
  valid_until          date,
  due_date             date,
  subject              text check (subject is null or char_length(subject) <= 300),
  customer_reference   text check (customer_reference is null or char_length(customer_reference) <= 120),

  -- Customer (all optional)
  customer_name        text check (customer_name is null or char_length(customer_name) <= 200),
  taxpayer_name        text check (taxpayer_name is null or char_length(taxpayer_name) <= 200),
  z_number             text check (z_number is null or char_length(z_number) <= 60),
  ztn_number           text check (ztn_number is null or char_length(ztn_number) <= 60),
  ztn_location         text check (ztn_location is null or char_length(ztn_location) <= 120),
  tin_number           text check (tin_number is null or char_length(tin_number) <= 60),
  vrn_number           text check (vrn_number is null or char_length(vrn_number) <= 60),
  street_address       text check (street_address is null or char_length(street_address) <= 300),
  tax_office           text check (tax_office is null or char_length(tax_office) <= 120),
  customer_phone       text check (customer_phone is null or char_length(customer_phone) <= 60),
  customer_email       text check (customer_email is null or char_length(customer_email) <= 160),

  -- Financial configuration (inputs)
  vat_enabled          boolean not null default true,
  vat_percent          numeric(5,2) not null default 15 check (vat_percent between 0 and 100),
  vat_amount_override  numeric(16,2) check (vat_amount_override is null or vat_amount_override >= 0),
  discount_label       text check (discount_label is null or char_length(discount_label) <= 120),
  discount_amount      numeric(16,2) not null default 0 check (discount_amount >= 0),
  extra_charge_label   text check (extra_charge_label is null or char_length(extra_charge_label) <= 120),
  extra_charge_amount  numeric(16,2) not null default 0 check (extra_charge_amount >= 0),
  total_override       numeric(16,2) check (total_override is null or total_override >= 0),
  total_override_reason text check (total_override_reason is null or char_length(total_override_reason) <= 300),

  -- Financial results (always computed server-side by marine_recalculate())
  subtotal             numeric(18,2) not null default 0,
  taxable_amount       numeric(18,2) not null default 0,
  vat_calculated       numeric(18,2) not null default 0,
  vat_amount           numeric(18,2) not null default 0,
  calculated_total     numeric(18,2) not null default 0,
  total_due            numeric(18,2) not null default 0,
  currency             text not null default 'TZS',

  -- Per-document banking (prefilled from settings, editable on the draft,
  -- frozen at issue) and the contact/footer snapshot taken at issue.
  bank_details         jsonb not null default '{}'::jsonb check (jsonb_typeof(bank_details) = 'object'),
  contact_snapshot     jsonb check (contact_snapshot is null or jsonb_typeof(contact_snapshot) = 'object'),
  notes                text check (notes is null or char_length(notes) <= 4000),

  -- Relationships
  source_document_id   uuid references public.marine_documents(id),
  revision_of_id       uuid references public.marine_documents(id),
  superseded_by_id     uuid references public.marine_documents(id),

  -- Audit
  client_request_id    uuid unique,
  created_by           uuid default auth.uid(),
  created_by_name      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  issued_at            timestamptz,
  issued_by            uuid,
  issued_by_name       text,
  cancelled_at         timestamptz,
  cancelled_by         uuid,
  cancelled_by_name    text,
  cancel_reason        text check (cancel_reason is null or char_length(cancel_reason) <= 500),

  constraint marine_documents_number_when_issued check (status = 'DRAFT' or (document_number is not null and issued_at is not null)),
  constraint marine_documents_type_seq_unique unique (doc_type, number_year, number_seq)
);

create index if not exists marine_documents_type_status_idx on public.marine_documents (doc_type, status);
create index if not exists marine_documents_date_idx on public.marine_documents (document_date desc, created_at desc);
create index if not exists marine_documents_customer_idx on public.marine_documents (lower(customer_name));
create index if not exists marine_documents_source_idx on public.marine_documents (source_document_id);
create index if not exists marine_documents_revision_of_idx on public.marine_documents (revision_of_id);
create index if not exists marine_documents_superseded_by_idx on public.marine_documents (superseded_by_id);

create table if not exists public.marine_document_items (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.marine_documents(id) on delete cascade,
  position         integer not null check (position >= 1),
  description      text not null check (char_length(trim(description)) between 1 and 2000),
  unit             text not null default 'service' check (char_length(unit) between 1 and 30),
  quantity         numeric(14,3) not null check (quantity > 0),
  unit_price       numeric(16,2) not null check (unit_price >= 0),
  amount           numeric(18,2) generated always as (round(quantity * unit_price, 2)) stored,
  catalog_item_id  uuid references public.marine_catalog_items(id),
  created_at       timestamptz not null default now()
);
create index if not exists marine_document_items_doc_idx on public.marine_document_items (document_id, position);
create index if not exists marine_document_items_catalog_idx on public.marine_document_items (catalog_item_id);

create table if not exists public.marine_document_scope (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.marine_documents(id) on delete cascade,
  position     integer not null check (position >= 1),
  title        text check (title is null or char_length(title) <= 200),
  description  text not null default '' check (char_length(description) <= 4000),
  template_id  uuid references public.marine_scope_templates(id),
  created_at   timestamptz not null default now(),
  constraint marine_document_scope_not_empty check (char_length(trim(coalesce(title, '') || description)) > 0)
);
create index if not exists marine_document_scope_doc_idx on public.marine_document_scope (document_id, position);
create index if not exists marine_document_scope_template_idx on public.marine_document_scope (template_id);

-- Append-only history: creation, issue, conversion, revision, cancellation,
-- PDF downloads/reprints.
create table if not exists public.marine_document_events (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.marine_documents(id) on delete cascade,
  event               text not null check (event in ('CREATED','ISSUED','CONVERTED','SUPERSEDED','CANCELLED','PDF_DOWNLOADED','PDF_PRINTED')),
  note                text check (note is null or char_length(note) <= 500),
  related_document_id uuid references public.marine_documents(id) on delete set null,
  actor_id            uuid default auth.uid(),
  actor_name          text,
  created_at          timestamptz not null default now()
);
create index if not exists marine_document_events_doc_idx on public.marine_document_events (document_id, created_at);
create index if not exists marine_document_events_related_idx on public.marine_document_events (related_document_id);

-- ── Guard triggers ───────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is 'authenticated' for a direct
-- client write and the function owner inside the SECURITY DEFINER RPCs,
-- which is how "set only by the RPCs" is enforced.
create or replace function public.marine_documents_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := 'DRAFT';
    new.document_number := null; new.number_year := null; new.number_seq := null;
    new.issued_at := null; new.issued_by := null; new.issued_by_name := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancelled_by_name := null; new.cancel_reason := null;
    new.source_document_id := null; new.revision_of_id := null; new.superseded_by_id := null;
    new.contact_snapshot := null;
    new.created_by := auth.uid();
  end if;
  new.created_by_name := coalesce(public.marine_actor_name(), new.created_by_name);
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.marine_documents_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Columns that may still change after a document has been issued.
  c_post_issue constant text[] := array['status','superseded_by_id','cancelled_at','cancelled_by',
                                        'cancelled_by_name','cancel_reason','updated_at'];
  -- Columns a client may never write directly, even on a draft.
  c_system constant text[] := array['status','document_number','number_year','number_seq',
                                    'issued_at','issued_by','issued_by_name','cancelled_at','cancelled_by',
                                    'cancelled_by_name','cancel_reason','source_document_id','revision_of_id',
                                    'superseded_by_id','contact_snapshot','created_by','created_by_name',
                                    'created_at','client_request_id'];
  k text;
begin
  if current_user in ('authenticated', 'anon') then
    foreach k in array c_system loop
      if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        raise exception 'Field % is managed by the system and cannot be changed directly', k;
      end if;
    end loop;
  end if;

  if old.status <> 'DRAFT'
     and (to_jsonb(new) - c_post_issue) is distinct from (to_jsonb(old) - c_post_issue) then
    raise exception 'Document % is % and can no longer be edited. Create a revision or cancel it instead.',
      old.document_number, old.status;
  end if;

  if new.doc_type is distinct from old.doc_type
     and (old.source_document_id is not null or old.revision_of_id is not null) then
    raise exception 'The type of a converted or revised document is fixed';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT'  and new.status = 'ISSUED')
    or (old.status = 'ISSUED' and new.status = 'CONVERTED' and old.doc_type <> 'INVOICE')
    or (old.status = 'ISSUED' and new.status = 'CANCELLED')
  ) then
    raise exception 'Invalid status change % -> %', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.marine_children_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Line entries cannot be moved between documents';
  end if;
  select d.status into v_status
    from public.marine_documents d
   where d.id = case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  -- v_status is null only while the parent draft itself is being deleted
  -- (ON DELETE CASCADE) -- allowed.
  if v_status is not null and v_status <> 'DRAFT' then
    raise exception 'Line items and scope of work are frozen once a document is issued';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.marine_documents_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.marine_document_events (document_id, event, note, related_document_id, actor_id, actor_name)
  values (
    new.id, 'CREATED',
    case
      when new.source_document_id is not null then 'Converted from ' ||
        (select coalesce(s.document_number, 'draft') from public.marine_documents s where s.id = new.source_document_id)
      when new.revision_of_id is not null then 'Revision of ' ||
        (select coalesce(s.document_number, 'draft') from public.marine_documents s where s.id = new.revision_of_id)
      else null
    end,
    coalesce(new.source_document_id, new.revision_of_id),
    auth.uid(), public.marine_actor_name()
  );
  return null;
end;
$$;

drop trigger if exists marine_documents_before_insert on public.marine_documents;
create trigger marine_documents_before_insert
  before insert on public.marine_documents
  for each row execute function public.marine_documents_before_insert();
drop trigger if exists marine_documents_before_update on public.marine_documents;
create trigger marine_documents_before_update
  before update on public.marine_documents
  for each row execute function public.marine_documents_before_update();
drop trigger if exists marine_documents_after_insert on public.marine_documents;
create trigger marine_documents_after_insert
  after insert on public.marine_documents
  for each row execute function public.marine_documents_after_insert();

drop trigger if exists marine_document_items_guard on public.marine_document_items;
create trigger marine_document_items_guard
  before insert or update or delete on public.marine_document_items
  for each row execute function public.marine_children_guard();
drop trigger if exists marine_document_scope_guard on public.marine_document_scope;
create trigger marine_document_scope_guard
  before insert or update or delete on public.marine_document_scope
  for each row execute function public.marine_children_guard();

revoke execute on function public.marine_documents_before_insert() from public, anon, authenticated;
revoke execute on function public.marine_documents_before_update() from public, anon, authenticated;
revoke execute on function public.marine_documents_after_insert() from public, anon, authenticated;
revoke execute on function public.marine_children_guard() from public, anon, authenticated;
revoke execute on function public.marine_settings_before_update() from public, anon, authenticated;

-- ── Totals ───────────────────────────────────────────────────────────────
-- Mirrors computeMarineTotals() in src/lib/marineInvoicing.js exactly:
--   subtotal       = sum(round(qty * unit_price, 2))
--   taxable        = subtotal - discount + additional charges
--   vat_calculated = round(taxable * vat% / 100, 2)          (0 if VAT off)
--   vat_amount     = vat override if set, else vat_calculated (0 if VAT off)
--   calculated     = taxable + vat_amount
--   total_due      = total override if set, else calculated
create or replace function public.marine_recalculate(p_document_id uuid)
returns public.marine_documents
language plpgsql
set search_path = public
as $$
declare
  d public.marine_documents;
  v_subtotal numeric(18,2);
  v_taxable  numeric(18,2);
  v_vat_calc numeric(18,2);
  v_vat      numeric(18,2);
begin
  select * into d from public.marine_documents where id = p_document_id;
  if not found then raise exception 'Document not found'; end if;
  if d.status <> 'DRAFT' then return d; end if;

  select coalesce(sum(i.amount), 0) into v_subtotal
    from public.marine_document_items i where i.document_id = p_document_id;
  v_taxable := v_subtotal - d.discount_amount + d.extra_charge_amount;
  if v_taxable < 0 then
    raise exception 'The discount (%) cannot be larger than the subtotal plus additional charges (%)',
      d.discount_amount, v_subtotal + d.extra_charge_amount;
  end if;
  v_vat_calc := case when d.vat_enabled then round(v_taxable * d.vat_percent / 100, 2) else 0 end;
  v_vat := case when d.vat_enabled then coalesce(d.vat_amount_override, v_vat_calc) else 0 end;

  update public.marine_documents
     set subtotal = v_subtotal,
         taxable_amount = v_taxable,
         vat_calculated = v_vat_calc,
         vat_amount = v_vat,
         calculated_total = v_taxable + v_vat,
         total_due = coalesce(d.total_override, v_taxable + v_vat)
   where id = p_document_id
   returning * into d;
  return d;
end;
$$;
revoke execute on function public.marine_recalculate(uuid) from public, anon, authenticated;

-- ── RPC: save a draft (create or update) atomically ─────────────────────
-- SECURITY INVOKER: runs under the caller's RLS, so it grants nothing the
-- table policies don't. Header, line items and scope are written in ONE
-- transaction; a retry with the same client_request_id updates the draft it
-- already created instead of making a duplicate.
create or replace function public.save_marine_draft(
  p_document_id uuid,
  p_client_request_id uuid,
  p_doc jsonb,
  p_items jsonb,
  p_scope jsonb
)
returns public.marine_documents
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_document_id;
  v_doc public.marine_documents;
  v_rec public.marine_documents;
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'Only an Owner/Admin can prepare marine documents';
  end if;
  if jsonb_typeof(coalesce(p_doc, 'null')) <> 'object'
     or jsonb_typeof(coalesce(p_items, 'null')) <> 'array'
     or jsonb_typeof(coalesce(p_scope, 'null')) <> 'array' then
    raise exception 'Invalid document payload';
  end if;

  v_rec := jsonb_populate_record(null::public.marine_documents, p_doc);

  if v_id is null and p_client_request_id is not null then
    select id into v_id from public.marine_documents where client_request_id = p_client_request_id;
  end if;

  if v_id is null then
    insert into public.marine_documents (
      doc_type, document_date, valid_until, due_date, subject, customer_reference,
      customer_name, taxpayer_name, z_number, ztn_number, ztn_location, tin_number, vrn_number,
      street_address, tax_office, customer_phone, customer_email,
      vat_enabled, vat_percent, vat_amount_override, discount_label, discount_amount,
      extra_charge_label, extra_charge_amount, total_override, total_override_reason,
      currency, bank_details, notes, client_request_id
    ) values (
      v_rec.doc_type, coalesce(v_rec.document_date, public.marine_local_today()), v_rec.valid_until, v_rec.due_date,
      v_rec.subject, v_rec.customer_reference,
      v_rec.customer_name, v_rec.taxpayer_name, v_rec.z_number, v_rec.ztn_number, v_rec.ztn_location,
      v_rec.tin_number, v_rec.vrn_number, v_rec.street_address, v_rec.tax_office, v_rec.customer_phone,
      v_rec.customer_email,
      coalesce(v_rec.vat_enabled, true), coalesce(v_rec.vat_percent, 15), v_rec.vat_amount_override,
      v_rec.discount_label, coalesce(v_rec.discount_amount, 0),
      v_rec.extra_charge_label, coalesce(v_rec.extra_charge_amount, 0), v_rec.total_override,
      v_rec.total_override_reason, coalesce(v_rec.currency, 'TZS'), coalesce(v_rec.bank_details, '{}'::jsonb),
      v_rec.notes, p_client_request_id
    )
    returning id into v_id;
  else
    update public.marine_documents set
      doc_type = v_rec.doc_type,
      document_date = coalesce(v_rec.document_date, document_date),
      valid_until = v_rec.valid_until, due_date = v_rec.due_date,
      subject = v_rec.subject, customer_reference = v_rec.customer_reference,
      customer_name = v_rec.customer_name, taxpayer_name = v_rec.taxpayer_name,
      z_number = v_rec.z_number, ztn_number = v_rec.ztn_number, ztn_location = v_rec.ztn_location,
      tin_number = v_rec.tin_number, vrn_number = v_rec.vrn_number, street_address = v_rec.street_address,
      tax_office = v_rec.tax_office, customer_phone = v_rec.customer_phone, customer_email = v_rec.customer_email,
      vat_enabled = coalesce(v_rec.vat_enabled, true), vat_percent = coalesce(v_rec.vat_percent, 15),
      vat_amount_override = v_rec.vat_amount_override,
      discount_label = v_rec.discount_label, discount_amount = coalesce(v_rec.discount_amount, 0),
      extra_charge_label = v_rec.extra_charge_label, extra_charge_amount = coalesce(v_rec.extra_charge_amount, 0),
      total_override = v_rec.total_override, total_override_reason = v_rec.total_override_reason,
      currency = coalesce(v_rec.currency, currency),
      bank_details = coalesce(v_rec.bank_details, '{}'::jsonb),
      notes = v_rec.notes
    where id = v_id
    returning * into v_doc;
    if not found then raise exception 'Document not found'; end if;
    if v_doc.status <> 'DRAFT' then raise exception 'Only drafts can be edited'; end if;
  end if;

  delete from public.marine_document_items where document_id = v_id;
  insert into public.marine_document_items (document_id, position, description, unit, quantity, unit_price, catalog_item_id)
  select v_id, ord::integer, trim(e ->> 'description'), coalesce(nullif(trim(e ->> 'unit'), ''), 'service'),
         (e ->> 'quantity')::numeric, (e ->> 'unit_price')::numeric, nullif(e ->> 'catalog_item_id', '')::uuid
    from jsonb_array_elements(p_items) with ordinality as t(e, ord);

  delete from public.marine_document_scope where document_id = v_id;
  insert into public.marine_document_scope (document_id, position, title, description, template_id)
  select v_id, ord::integer, nullif(trim(e ->> 'title'), ''), coalesce(e ->> 'description', ''),
         nullif(e ->> 'template_id', '')::uuid
    from jsonb_array_elements(p_scope) with ordinality as t(e, ord);

  return public.marine_recalculate(v_id);
end;
$$;
revoke execute on function public.save_marine_draft(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_marine_draft(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
-- marine_recalculate is invoker + revoked from clients; save_marine_draft
-- calls it as the caller, so the caller needs execute on it. Grant it but
-- it only ever touches DRAFT rows the caller's RLS already lets them update.
grant execute on function public.marine_recalculate(uuid) to authenticated;

-- ── RPC: issue ───────────────────────────────────────────────────────────
create or replace function public.issue_marine_document(p_document_id uuid)
returns public.marine_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d   public.marine_documents;
  s   public.marine_invoice_settings;
  src public.marine_documents;
  v_year integer := extract(year from public.marine_local_today())::integer;
  v_num  text;
  v_seq  integer;
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'Only an Owner/Admin can issue marine documents';
  end if;

  select * into d from public.marine_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if d.status <> 'DRAFT' then
    raise exception 'Document % is already %', coalesce(d.document_number, ''), d.status;
  end if;
  if not exists (select 1 from public.marine_document_items where document_id = d.id) then
    raise exception 'Add at least one service or material line before issuing';
  end if;

  d := public.marine_recalculate(d.id);
  if d.total_due <= 0 then
    raise exception 'The total due must be greater than zero';
  end if;

  -- Relationship checks before a number is consumed.
  if d.source_document_id is not null then
    select * into src from public.marine_documents where id = d.source_document_id for update;
    if src.status <> 'ISSUED' then
      raise exception 'Source document % is % and can no longer be converted', src.document_number, src.status;
    end if;
  end if;
  if d.revision_of_id is not null then
    select * into src from public.marine_documents where id = d.revision_of_id for update;
    if src.status <> 'ISSUED' then
      raise exception 'The original document % is % and can no longer be revised', src.document_number, src.status;
    end if;
  end if;

  select * into s from public.marine_invoice_settings where id = 1;
  select n.document_number, n.number_seq into v_num, v_seq
    from public.marine_next_document_number(d.doc_type, v_year) n;

  update public.marine_documents set
    status = 'ISSUED',
    document_number = v_num,
    number_year = v_year,
    number_seq = v_seq,
    issued_at = now(),
    issued_by = auth.uid(),
    issued_by_name = public.marine_actor_name(),
    bank_details = case when bank_details = '{}'::jsonb then jsonb_build_object(
                     'bank_name', s.bank_name, 'account_name', s.bank_account_name,
                     'account_number', s.bank_account_number, 'branch', s.bank_branch,
                     'currency', s.currency) else bank_details end,
    contact_snapshot = jsonb_build_object('contacts', s.contacts, 'footer_line', s.footer_line,
                                          'captured_at', now())
  where id = d.id
  returning * into d;

  insert into public.marine_document_events (document_id, event, note, actor_id, actor_name)
  values (d.id, 'ISSUED', d.document_number, auth.uid(), d.issued_by_name);

  if d.source_document_id is not null then
    update public.marine_documents set status = 'CONVERTED' where id = d.source_document_id;
    insert into public.marine_document_events (document_id, event, note, related_document_id, actor_id, actor_name)
    values (d.source_document_id, 'CONVERTED', 'Converted to ' || d.document_number, d.id, auth.uid(), d.issued_by_name);
  end if;

  if d.revision_of_id is not null then
    update public.marine_documents set
      status = 'CANCELLED',
      superseded_by_id = d.id,
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancelled_by_name = d.issued_by_name,
      cancel_reason = 'Superseded by revision ' || d.document_number
    where id = d.revision_of_id;
    insert into public.marine_document_events (document_id, event, note, related_document_id, actor_id, actor_name)
    values (d.revision_of_id, 'SUPERSEDED', 'Superseded by revision ' || d.document_number, d.id, auth.uid(), d.issued_by_name);
  end if;

  return d;
end;
$$;
revoke execute on function public.issue_marine_document(uuid) from public, anon;
grant execute on function public.issue_marine_document(uuid) to authenticated;

-- ── RPC: copy into a new draft (used by convert and revise) ─────────────
create or replace function public.marine_copy_to_draft(p_source uuid, p_doc_type text, p_mode text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
begin
  insert into public.marine_documents (
    doc_type, document_date, valid_until, due_date, subject, customer_reference,
    customer_name, taxpayer_name, z_number, ztn_number, ztn_location, tin_number, vrn_number,
    street_address, tax_office, customer_phone, customer_email,
    vat_enabled, vat_percent, vat_amount_override, discount_label, discount_amount,
    extra_charge_label, extra_charge_amount, total_override, total_override_reason,
    currency, bank_details, notes, source_document_id, revision_of_id, created_by
  )
  select
    p_doc_type, public.marine_local_today(),
    case when p_mode = 'revise' then s.valid_until end,
    case when p_mode = 'revise' then s.due_date end,
    s.subject, s.customer_reference,
    s.customer_name, s.taxpayer_name, s.z_number, s.ztn_number, s.ztn_location, s.tin_number, s.vrn_number,
    s.street_address, s.tax_office, s.customer_phone, s.customer_email,
    s.vat_enabled, s.vat_percent, s.vat_amount_override, s.discount_label, s.discount_amount,
    s.extra_charge_label, s.extra_charge_amount, s.total_override, s.total_override_reason,
    s.currency, s.bank_details, s.notes,
    case when p_mode = 'convert' then s.id end,
    case when p_mode = 'revise'  then s.id end,
    auth.uid()
  from public.marine_documents s
  where s.id = p_source
  returning id into v_new;

  insert into public.marine_document_items (document_id, position, description, unit, quantity, unit_price, catalog_item_id)
  select v_new, position, description, unit, quantity, unit_price, catalog_item_id
    from public.marine_document_items where document_id = p_source;

  insert into public.marine_document_scope (document_id, position, title, description, template_id)
  select v_new, position, title, description, template_id
    from public.marine_document_scope where document_id = p_source;

  perform public.marine_recalculate(v_new);
  return v_new;
end;
$$;
revoke execute on function public.marine_copy_to_draft(uuid, text, text) from public, anon, authenticated;

create or replace function public.convert_marine_document(p_document_id uuid, p_target_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.marine_documents;
  v_existing uuid;
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'Only an Owner/Admin can convert marine documents';
  end if;
  select * into s from public.marine_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if s.status <> 'ISSUED' then
    raise exception 'Only an issued document can be converted (this one is %)', s.status;
  end if;
  if not ((s.doc_type = 'QUOTATION' and p_target_type in ('PROFORMA','INVOICE'))
       or (s.doc_type = 'PROFORMA'  and p_target_type = 'INVOICE')) then
    raise exception 'A % cannot be converted to a %', s.doc_type, p_target_type;
  end if;

  -- One open conversion draft at a time: hand back the existing one.
  select id into v_existing from public.marine_documents
   where source_document_id = s.id and doc_type = p_target_type and status = 'DRAFT'
   order by created_at limit 1;
  if v_existing is not null then return v_existing; end if;

  return public.marine_copy_to_draft(s.id, p_target_type, 'convert');
end;
$$;
revoke execute on function public.convert_marine_document(uuid, text) from public, anon;
grant execute on function public.convert_marine_document(uuid, text) to authenticated;

create or replace function public.revise_marine_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.marine_documents;
  v_existing uuid;
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'Only an Owner/Admin can revise marine documents';
  end if;
  select * into s from public.marine_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if s.status <> 'ISSUED' then
    raise exception 'Only an issued document can be revised (this one is %)', s.status;
  end if;

  select id into v_existing from public.marine_documents
   where revision_of_id = s.id and status = 'DRAFT'
   order by created_at limit 1;
  if v_existing is not null then return v_existing; end if;

  return public.marine_copy_to_draft(s.id, s.doc_type, 'revise');
end;
$$;
revoke execute on function public.revise_marine_document(uuid) from public, anon;
grant execute on function public.revise_marine_document(uuid) to authenticated;

create or replace function public.cancel_marine_document(p_document_id uuid, p_reason text)
returns public.marine_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.marine_documents;
begin
  if not has_minimum_role('stv-pos', 'admin') then
    raise exception 'Only an Owner/Admin can cancel marine documents';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'A cancellation reason of at least 5 characters is required';
  end if;
  select * into d from public.marine_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if d.status <> 'ISSUED' then
    raise exception 'Only an issued document can be cancelled (this one is %). Drafts can simply be deleted.', d.status;
  end if;

  update public.marine_documents set
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancelled_by_name = public.marine_actor_name(),
    cancel_reason = trim(p_reason)
  where id = d.id
  returning * into d;

  insert into public.marine_document_events (document_id, event, note, actor_id, actor_name)
  values (d.id, 'CANCELLED', d.cancel_reason, auth.uid(), d.cancelled_by_name);
  return d;
end;
$$;
revoke execute on function public.cancel_marine_document(uuid, text) from public, anon;
grant execute on function public.cancel_marine_document(uuid, text) to authenticated;

-- ── Table privileges ─────────────────────────────────────────────────────
-- Project default privileges grant ALL (incl. TRUNCATE, which bypasses RLS
-- and row triggers) to anon/authenticated on new tables. Tighten for these.
revoke all on table
  public.marine_invoice_settings, public.marine_catalog_items, public.marine_scope_templates,
  public.marine_document_counters, public.marine_documents, public.marine_document_items,
  public.marine_document_scope, public.marine_document_events
from anon;
revoke truncate, trigger, references on table
  public.marine_invoice_settings, public.marine_catalog_items, public.marine_scope_templates,
  public.marine_document_counters, public.marine_documents, public.marine_document_items,
  public.marine_document_scope, public.marine_document_events
from authenticated;
revoke all on table public.marine_document_counters from authenticated;
revoke insert, delete on table public.marine_invoice_settings from authenticated;
revoke update, delete on table public.marine_document_events from authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.marine_invoice_settings  enable row level security;
alter table public.marine_catalog_items     enable row level security;
alter table public.marine_scope_templates   enable row level security;
alter table public.marine_document_counters enable row level security;
alter table public.marine_documents         enable row level security;
alter table public.marine_document_items    enable row level security;
alter table public.marine_document_scope    enable row level security;
alter table public.marine_document_events   enable row level security;

drop policy if exists marine_settings_select on public.marine_invoice_settings;
create policy marine_settings_select on public.marine_invoice_settings
  for select to authenticated using (has_minimum_role('stv-pos', 'admin'));
drop policy if exists marine_settings_owner_update on public.marine_invoice_settings;
create policy marine_settings_owner_update on public.marine_invoice_settings
  for update to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_catalog_items_admin_all on public.marine_catalog_items;
create policy marine_catalog_items_admin_all on public.marine_catalog_items
  for all to authenticated
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

drop policy if exists marine_scope_templates_admin_all on public.marine_scope_templates;
create policy marine_scope_templates_admin_all on public.marine_scope_templates
  for all to authenticated
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

drop policy if exists marine_documents_admin_select on public.marine_documents;
create policy marine_documents_admin_select on public.marine_documents
  for select to authenticated using (has_minimum_role('stv-pos', 'admin'));
drop policy if exists marine_documents_admin_insert on public.marine_documents;
create policy marine_documents_admin_insert on public.marine_documents
  for insert to authenticated with check (has_minimum_role('stv-pos', 'admin'));
-- Content immutability, system-managed fields and status transitions are
-- enforced by marine_documents_before_update().
drop policy if exists marine_documents_admin_update on public.marine_documents;
create policy marine_documents_admin_update on public.marine_documents
  for update to authenticated
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));
-- Only unissued drafts can ever be deleted.
drop policy if exists marine_documents_admin_delete_draft on public.marine_documents;
create policy marine_documents_admin_delete_draft on public.marine_documents
  for delete to authenticated
  using (has_minimum_role('stv-pos', 'admin') and status = 'DRAFT' and document_number is null);

drop policy if exists marine_document_items_admin_all on public.marine_document_items;
create policy marine_document_items_admin_all on public.marine_document_items
  for all to authenticated
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

drop policy if exists marine_document_scope_admin_all on public.marine_document_scope;
create policy marine_document_scope_admin_all on public.marine_document_scope
  for all to authenticated
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

drop policy if exists marine_document_events_admin_select on public.marine_document_events;
create policy marine_document_events_admin_select on public.marine_document_events
  for select to authenticated using (has_minimum_role('stv-pos', 'admin'));
-- Clients may only log PDF downloads/reprints, as themselves. Every other
-- event is written by the triggers/RPCs above.
drop policy if exists marine_document_events_admin_log_pdf on public.marine_document_events;
create policy marine_document_events_admin_log_pdf on public.marine_document_events
  for insert to authenticated
  with check (
    has_minimum_role('stv-pos', 'admin')
    and event in ('PDF_DOWNLOADED','PDF_PRINTED')
    and actor_id = (select auth.uid())
    and related_document_id is null
  );
