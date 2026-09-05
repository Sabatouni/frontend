-- New, isolated, private storage bucket for the itinerary module. Deliberately
-- NOT reusing stv-images or stv-documents: both of those already have
-- policies scoped only to bucket_id (any authenticated user in the whole
-- Supabase project can write to stv-images; any authenticated user can
-- read/write stv-documents) rather than to the stv-pos application or a
-- role, which does not meet this module's Owner/Admin-only requirement.
-- This bucket's objects are only ever served to the browser via short-lived
-- signed URLs (never a public URL), matching its private=true setting.
--
-- Path convention: media/... for library photos, documents/<itinerary_id>/
-- v<version>.pdf for generated PDFs.
insert into storage.buckets (id, name, public)
values ('stv-itinerary', 'stv-itinerary', false)
on conflict (id) do nothing;

create policy stv_itinerary_bucket_admin_all on storage.objects
  for all
  using (bucket_id = 'stv-itinerary' and has_minimum_role('stv-pos', 'admin'))
  with check (bucket_id = 'stv-itinerary' and has_minimum_role('stv-pos', 'admin'));
