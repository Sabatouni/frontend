-- Swahili Tent Itinerary RLS: Owner/Admin (has_minimum_role('stv-pos','admin'))
-- only, for every command, on every itinerary table. Deliberately no
-- has_application_access('stv-pos') select policy like invoices/sales have
-- -- Workers must have ZERO access to this module, not read-only, per the
-- product spec. Both functions already exist (used by sales/expenses/
-- invoices/inventory) and are reused verbatim, unmodified.

alter table public.stv_itineraries enable row level security;
alter table public.stv_itinerary_versions enable row level security;
alter table public.stv_itinerary_media enable row level security;
alter table public.stv_itinerary_library enable row level security;

create policy stv_itineraries_admin_all on public.stv_itineraries
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy stv_itinerary_versions_admin_all on public.stv_itinerary_versions
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy stv_itinerary_media_admin_all on public.stv_itinerary_media
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));

create policy stv_itinerary_library_admin_all on public.stv_itinerary_library
  for all
  using (has_minimum_role('stv-pos', 'admin'))
  with check (has_minimum_role('stv-pos', 'admin'));
