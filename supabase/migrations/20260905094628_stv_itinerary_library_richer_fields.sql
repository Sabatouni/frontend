-- Additive extension of stv_itinerary_library to support first-class
-- Excursion / Transport / Meal / Special-Touch catalog items (see the
-- itinerary refinement plan). No existing column, row, or policy is
-- touched; only new nullable/defaulted columns and a widened `kind` check.

alter table public.stv_itinerary_library
  add column if not exists pickup_time text,
  add column if not exists meeting_point text,
  add column if not exists transport_info text,
  add column if not exists meals_included text,
  add column if not exists activities_included text,
  add column if not exists what_to_bring text,
  add column if not exists whats_included text,
  add column if not exists whats_excluded text,
  add column if not exists selling_price numeric,
  add column if not exists internal_cost numeric,
  add column if not exists currency text default 'TZS',
  add column if not exists image_ids uuid[] default '{}',
  add column if not exists complimentary boolean default true,
  add column if not exists guest_type_tags text[] default '{}';

alter table public.stv_itinerary_library
  drop constraint if exists stv_itinerary_library_kind_check;

alter table public.stv_itinerary_library
  add constraint stv_itinerary_library_kind_check
  check (kind = any (array['excursion','transport','meal','special_touch','generic']));
