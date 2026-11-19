-- PROPOSED -- NOT APPLIED. For review only.
--
-- Website admin authentication (verified from Sabatouni/swahili-tent-village):
--   site/src/store/store.js -> supabase.auth.signInWithPassword(email, pw);
--   site/src/admin/index.jsx only checks isAuthenticated (no role check), so
--   authorization today is ENTIRELY these "authenticated USING (true)" RLS
--   policies. LAUNCH_SETUP.md: "every logged-in user currently has full admin
--   access".
-- Legitimate administrator (verified from production data): every human
--   booking-admin action on record (stv_booking_status_history.changed_by x3,
--   stv_bookings.cancelled_by x1) was made by account 6e16774f..., which holds
--   stv-web:owner and platform-admin:owner -> stv_is_booking_admin() = true,
--   so that administrator keeps full access after this migration.
-- Accounts that LOSE booking-admin access: POS workers (5), the POS owner
--   71fb16bf... (no stv-web grant; no booking actions on record) and the NUMA
--   owner 48457333... (no booking actions on record). Grant stv-web:admin to any
--   of them first if they genuinely need the website admin panel.
-- Not covered here (code, not SQL): the send-email edge function also treats
--   any signed-in user as admin -- see the review report.
--
-- Problem: 22 booking/website tables have policies like
--   "Authenticated all bookings"  FOR ALL TO authenticated USING (true)
-- so EVERY signed-in account in this project (POS workers, NUMA accounts)
-- can read, change and delete guests, bookings, refunds, payment
-- transactions, promo codes, prices, tents and the public website content.
-- Three RPCs also treat any signed-in user as a booking admin:
--   stv_cancel_booking (v_is_admin := auth.uid() is not null),
--   stv_admin_request_refund, stv_get_refund_summary.
--
-- Fix: authenticated write/read-all access only for
--   has_minimum_role('stv-web','admin') OR is_platform_admin()
-- Public read policies (anon website visitors) are NOT touched.
-- The POS Itinerary builder (Owner/Admin) keeps read access to stv_bookings
-- and stv_tents, which it uses to pre-fill itineraries.


create or replace function public.stv_is_booking_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select has_minimum_role('stv-web', 'admin') or is_platform_admin()
$$;
revoke execute on function public.stv_is_booking_admin() from public, anon;
grant execute on function public.stv_is_booking_admin() to authenticated;

do $$
declare
  t record;
begin
  -- Replace every "authenticated USING (true)" write/all policy on stv_* tables.
  for t in
    select tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public' and tablename like 'stv\_%'
       and 'authenticated' = any (roles)
       and cmd <> 'SELECT'
       and coalesce(qual, 'true') ~ '^\(?true\)?$'
       and coalesce(with_check, coalesce(qual, 'true')) ~ '^\(?true\)?$'
  loop
    execute format('drop policy %I on public.%I', t.policyname, t.tablename);
    -- INSERT allows only WITH CHECK; DELETE only USING; ALL/UPDATE take both.
    execute format(
      'create policy %I on public.%I for %s to authenticated %s',
      'booking_admin_' || lower(t.cmd) || '_' || t.tablename, t.tablename, t.cmd,
      case t.cmd
        when 'INSERT' then 'with check (public.stv_is_booking_admin())'
        when 'DELETE' then 'using (public.stv_is_booking_admin())'
        else 'using (public.stv_is_booking_admin()) with check (public.stv_is_booking_admin())'
      end);
  end loop;

  -- "Authenticated read" (SELECT true) policies on private booking data.
  for t in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public' and tablename in ('stv_booking_status_history', 'stv_tents')
       and cmd = 'SELECT' and 'authenticated' = any (roles) and coalesce(qual, 'true') ~ '^\(?true\)?$'
  loop
    execute format('drop policy %I on public.%I', t.policyname, t.tablename);
    execute format('create policy %I on public.%I for select to authenticated using (public.stv_is_booking_admin())',
                   'booking_admin_select_' || t.tablename, t.tablename);
  end loop;
end $$;

-- POS Itinerary builder (stv-pos Owner/Admin) keeps read access.
create policy stv_bookings_pos_itinerary_read on public.stv_bookings
  for select to authenticated using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));
create policy stv_tents_pos_itinerary_read on public.stv_tents
  for select to authenticated using (has_role('stv-pos', 'owner') or has_role('stv-pos', 'admin'));

-- RPCs: a signed-in account is no longer automatically a booking admin.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.stv_cancel_booking(uuid, uuid, text, boolean, boolean, numeric, text)'::regprocedure);
  if position('v_is_admin := auth.uid() is not null;' in def) = 0 then raise exception 'stv_cancel_booking changed, aborting'; end if;
  execute replace(def, 'v_is_admin := auth.uid() is not null;', 'v_is_admin := public.stv_is_booking_admin();');

  def := pg_get_functiondef('public.stv_admin_request_refund(uuid, numeric, text)'::regprocedure);
  if position('if auth.uid() is null then' in def) = 0 then raise exception 'stv_admin_request_refund changed, aborting'; end if;
  execute replace(def, 'if auth.uid() is null then', 'if not public.stv_is_booking_admin() then');

  def := pg_get_functiondef('public.stv_get_refund_summary(uuid)'::regprocedure);
  if position('if auth.uid() is null then' in def) = 0 then raise exception 'stv_get_refund_summary changed, aborting'; end if;
  execute replace(def, 'if auth.uid() is null then', 'if not public.stv_is_booking_admin() then');
end $$;

-- Storage: website images / booking documents no longer writable or (for
-- documents) readable by every signed-in account. Public image reads stay.
drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "Authenticated Update" on storage.objects;
drop policy if exists "Authenticated Delete" on storage.objects;
drop policy if exists "Authenticated read stv-documents" on storage.objects;
drop policy if exists "Authenticated write stv-documents" on storage.objects;
create policy stv_images_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'stv-images' and public.stv_is_booking_admin());
create policy stv_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'stv-images' and public.stv_is_booking_admin());
create policy stv_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'stv-images' and public.stv_is_booking_admin());
create policy stv_documents_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'stv-documents' and public.stv_is_booking_admin());
create policy stv_documents_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'stv-documents' and public.stv_is_booking_admin());

