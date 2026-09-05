-- Swahili Tent Itinerary: guest-facing Experience Proposal / Itinerary
-- Generator for the STV POS. Entirely additive -- does not alter any
-- existing table, column, function, policy, or bucket (sales/expenses/
-- invoices/inventory/stv_bookings/stv_tents/stv-images/stv-documents are
-- untouched). Follows the same conventions as stv_pos_invoices: uuid pk,
-- created_at/updated_at timestamptz defaults, the existing shared
-- stv_touch_updated_at() trigger function, and has_minimum_role()/
-- has_application_access() for RLS (added in a separate migration).
--
-- Accommodation content is NOT duplicated here -- stv_tents remains the
-- single source of truth for "Samawati Tent"/"Ulimwengu Tent"/etc. and is
-- referenced by uuid. stv_bookings is referenced (nullable) so an
-- itinerary can optionally originate from a real booking, but guest-facing
-- fields are snapshotted at creation time (guest_name/email/phone) rather
-- than re-read live, so a later booking edit never silently rewrites an
-- already-created guest proposal.

-- The document itself. `content` holds the fully editable day-by-day /
-- section tree (days[], sections{}) as JSON -- deliberately flexible so the
-- admin can add custom days/activities/sections without any schema change,
-- per the "never force a database edit for a one-off proposal" requirement.
create table public.stv_itineraries (
  id                      uuid primary key default gen_random_uuid(),

  booking_id              uuid references public.stv_bookings(id) on delete set null,
  accommodation_tent_id   uuid references public.stv_tents(id) on delete set null,

  -- Guest snapshot -- copied in at creation time (from the booking, or
  -- typed directly for a standalone proposal), and never re-synced.
  guest_name              text not null default '',
  guest_email             text not null default '',
  guest_phone             text not null default '',

  guest_type              text not null default 'custom'
                            check (guest_type in (
                              'couple','family','friends','solo','corporate',
                              'birthday','anniversary','honeymoon','wedding','custom'
                            )),
  occasion                text not null default '',

  check_in                date,
  check_out               date,
  adults                  int not null default 1,
  children                int not null default 0,

  title                   text not null default 'Swahili Tent Itinerary',
  subtitle                text not null default '',

  status                  text not null default 'draft'
                            check (status in ('draft','final','archived')),
  version                 int not null default 1,

  content                 jsonb not null default '{}'::jsonb,

  pdf_storage_path        text,
  pdf_generated_at        timestamptz,

  created_by              uuid references auth.users(id) on delete set null,
  created_by_name         text,
  updated_by              uuid references auth.users(id) on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.stv_itineraries is
  'Swahili Tent Itinerary: guest-facing experience proposal/itinerary documents. Owner/Admin only -- see has_minimum_role RLS policy. Isolated from, and never referenced by, the invoices/invoice_items tables.';

-- Lightweight revision history -- a snapshot is written whenever a PDF is
-- generated/finalized, so an already-sent proposal is never silently lost
-- when the draft keeps being edited afterwards.
create table public.stv_itinerary_versions (
  id                uuid primary key default gen_random_uuid(),
  itinerary_id      uuid not null references public.stv_itineraries(id) on delete cascade,
  version           int not null,
  content           jsonb not null,
  pdf_storage_path  text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.stv_itinerary_versions is
  'Snapshot revision history for stv_itineraries, written on each PDF generate/finalize. Owner/Admin only.';

-- Media library -- STV's own photography plus explicitly-added external
-- photos, organized for reuse across proposals. Isolated from stv-images
-- (the public marketing-site bucket/table) so this library's access stays
-- Owner/Admin only regardless of that bucket's broader policies.
create table public.stv_itinerary_media (
  id             uuid primary key default gen_random_uuid(),
  storage_path   text not null,
  category       text not null default 'Other',
  tags           text[] not null default '{}',
  title          text not null default '',
  alt_text       text not null default '',
  caption        text not null default '',
  source         text not null default 'stv',
  source_url     text,
  rights_status  text not null default 'stv_owned',
  is_active      boolean not null default true,
  is_hero        boolean not null default false,
  sort_order     int not null default 0,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.stv_itinerary_media is
  'Owner/Admin-only media library for itinerary proposals (STV photography + explicitly approved external photos with source/rights metadata). Separate from the public stv-images bucket/stv_gallery table.';

-- Reusable content library: excursions / transport / meals / generic
-- guest-facing blocks (welcome, what to bring, terms, etc.). Accommodation
-- is deliberately NOT included here -- stv_tents already owns that content.
create table public.stv_itinerary_library (
  id                          uuid primary key default gen_random_uuid(),
  kind                        text not null
                                check (kind in ('excursion','transport','meal','generic')),
  title                       text not null,
  short_description           text not null default '',
  long_description            text not null default '',
  guest_facing_description    text not null default '',
  internal_notes              text not null default '',
  default_duration_minutes    int,
  default_time                text,
  location                    text,
  is_active                   boolean not null default true,
  sort_order                  int not null default 0,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.stv_itinerary_library is
  'Owner/Admin-only reusable content library for itinerary proposals (excursions/transport/meals/generic guest-facing blocks). internal_notes is staff-only and must never be passed to the guest PDF renderer.';

create index stv_itineraries_booking_id_idx on public.stv_itineraries(booking_id);
create index stv_itineraries_status_idx on public.stv_itineraries(status);
create index stv_itineraries_created_at_idx on public.stv_itineraries(created_at desc);
create index stv_itinerary_versions_itinerary_id_idx on public.stv_itinerary_versions(itinerary_id);
create index stv_itinerary_media_category_idx on public.stv_itinerary_media(category);
create index stv_itinerary_media_active_idx on public.stv_itinerary_media(is_active);
create index stv_itinerary_library_kind_idx on public.stv_itinerary_library(kind);
create index stv_itinerary_library_active_idx on public.stv_itinerary_library(is_active);

-- Reuses the existing shared trigger function (already used by invoices) --
-- no new trigger function needed.
create trigger stv_itineraries_touch_updated_at
  before update on public.stv_itineraries
  for each row execute function public.stv_touch_updated_at();

create trigger stv_itinerary_library_touch_updated_at
  before update on public.stv_itinerary_library
  for each row execute function public.stv_touch_updated_at();
