-- Database tests for migration 20261122090000_stv_pos_operational_documents.sql
--
-- Runs in ONE transaction that ends in ROLLBACK, so every fixture user,
-- role grant, document, kart, storage row and counter it creates disappears.
-- The first failed assertion raises and aborts the run (psql exits non-zero).
--
-- Where to run it (NEVER production):
--   * Local throwaway cluster:  supabase/tests/local/run_opsdocs_tests.sh
--     (loads supabase/tests/local/supabase_stub.sql, applies the migration,
--     runs this file)
--   * A Supabase branch / staging project that already has the migration
--     applied:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
-- Fixture users (fixed UUIDs, created and rolled back here):
--   O owner | A admin | W, W2 workers | M manager (level 60)
--   S role 'zz_test_super' (level 90, created here) -- proves the exact-role
--     checks: a level-based has_minimum_role('admin') would let S manage.
--   N stv-web owner with NO stv-pos access
\set ON_ERROR_STOP 1
begin;

-- ── helpers ─────────────────────────────────────────────────────────────
create function pg_temp.act(p_uid uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end $$;

create function pg_temp.pass(p_label text) returns void language plpgsql as $$
begin
  perform set_config('opsdoc_test.passed', (coalesce(nullif(current_setting('opsdoc_test.passed', true), ''), '0')::int + 1)::text, false);
  raise notice 'ok  %', p_label;
end $$;

create function pg_temp.ok(p_label text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise exception 'FAIL [%]: expected success, got: %', p_label, sqlerrm;
  end;
  perform pg_temp.pass(p_label);
end $$;

create function pg_temp.fails(p_label text, p_sql text, p_pattern text default null) returns void language plpgsql as $$
declare v_failed boolean := false; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_failed := true; v_msg := sqlerrm;
  end;
  if not v_failed then
    raise exception 'FAIL [%]: expected an error, statement succeeded', p_label;
  end if;
  if p_pattern is not null and v_msg !~* p_pattern then
    raise exception 'FAIL [%]: wrong error: %', p_label, v_msg;
  end if;
  perform pg_temp.pass(p_label || '  (' || left(v_msg, 70) || ')');
end $$;

create function pg_temp.eq(p_label text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  if v is distinct from p_expected then
    raise exception 'FAIL [%]: expected %, got %', p_label, coalesce(p_expected, 'NULL'), coalesce(v, 'NULL');
  end if;
  perform pg_temp.pass(p_label);
end $$;

create function pg_temp.rows(p_label text, p_sql text, p_expected int) returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> p_expected then
    raise exception 'FAIL [%]: expected % row(s) affected, got %', p_label, p_expected, n;
  end if;
  perform pg_temp.pass(p_label);
end $$;

-- ── fixtures (as the table owner) ──────────────────────────────────────
insert into public.roles (slug, name, level) values ('zz_test_super', 'Test-only super role', 90);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'opsdoc-owner@test.invalid',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'opsdoc-admin@test.invalid',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'opsdoc-worker@test.invalid',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'opsdoc-worker2@test.invalid', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'opsdoc-manager@test.invalid', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'opsdoc-super@test.invalid',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'opsdoc-noaccess@test.invalid','authenticated', 'authenticated');

-- Supabase creates profiles from an auth.users trigger; upsert either way.
insert into public.profiles (id, email, full_name)
select u.id, u.email, initcap(split_part(split_part(u.email, '@', 1), '-', 2)) || ' Test'
  from auth.users u where u.email like 'opsdoc-%@test.invalid'
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

insert into public.user_application_roles (user_id, application_id, role_id)
select u.id, a.id, r.id
  from (values
    ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'stv-pos', 'owner'),
    ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'stv-pos', 'admin'),
    ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'stv-pos', 'worker'),
    ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'stv-pos', 'worker'),
    ('aaaaaaaa-0000-4000-8000-000000000005'::uuid, 'stv-pos', 'manager'),
    ('aaaaaaaa-0000-4000-8000-000000000006'::uuid, 'stv-pos', 'zz_test_super'),
    ('aaaaaaaa-0000-4000-8000-000000000007'::uuid, 'stv-web', 'owner')
  ) as u(id, app, role)
  join public.applications a on a.slug = u.app
  join public.roles r on r.slug = u.role;

-- ── 0. Objects, grants, bucket ─────────────────────────────────────────
select pg_temp.eq('bucket stv-ops-documents is private, 5 MB, images only',
  $q$select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'stv-ops-documents'$q$,
  'false|5242880|image/jpeg,image/png,image/webp');
select pg_temp.eq('RLS enabled on all 5 tables',
  $q$select count(*)::text from pg_class where relrowsecurity and oid in ('public.operational_documents'::regclass, 'public.operational_document_events'::regclass, 'public.operational_document_counters'::regclass, 'public.gokart_units'::regclass, 'public.gokart_status_history'::regclass)$q$, '5');
select pg_temp.eq('no policy uses level-based has_minimum_role',
  $q$select count(*)::text from pg_policies where tablename in ('operational_documents','operational_document_events','gokart_units','gokart_status_history') and (coalesce(qual,'') || coalesce(with_check,'')) like '%has_minimum_role%'$q$, '0');
select pg_temp.eq('no DELETE policy on any ops table',
  $q$select count(*)::text from pg_policies where tablename in ('operational_documents','operational_document_events','operational_document_counters','gokart_units','gokart_status_history') and cmd in ('DELETE','ALL')$q$, '0');
select pg_temp.eq('anon has no table privileges',
  $q$select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_name in ('operational_documents','operational_document_events','operational_document_counters','gokart_units','gokart_status_history')$q$, '0');
select pg_temp.eq('authenticated has no TRUNCATE',
  $q$select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated' and privilege_type = 'TRUNCATE' and table_name in ('operational_documents','operational_document_events','operational_document_counters','gokart_units','gokart_status_history')$q$, '0');
select pg_temp.eq('internal functions not executable by authenticated',
  $q$select (has_function_privilege('authenticated', 'public.stv_next_opsdoc_reference(text)', 'execute')
          or has_function_privilege('authenticated', 'public.stv_gokart_escalate(text,text,uuid,text)', 'execute')
          or has_function_privilege('authenticated', 'public.stv_opsdoc_before_insert()', 'execute'))::text$q$, 'false');
select pg_temp.eq('verify_gokart_status not executable by anon',
  $q$select has_function_privilege('anon', 'public.verify_gokart_status(text,text,text,uuid)', 'execute')::text$q$, 'false');

-- ── 1. Kart registration: Owner/Admin only (exact roles) ──────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.ok('owner registers GK-01', $q$insert into public.gokart_units (kart_id, label) values ('GK-01', 'Red')$q$);
select pg_temp.ok('owner registers " gk-02 " (normalised)', $q$insert into public.gokart_units (kart_id, label) values (' gk-02 ', ' ')$q$);
select pg_temp.eq('id upper-cased/trimmed, blank label -> null', $q$select kart_id || '|' || coalesce(label, 'null') from public.gokart_units where kart_id = 'GK-02'$q$, 'GK-02|null');
select pg_temp.ok('registration asking for OUT_OF_SERVICE...', $q$insert into public.gokart_units (kart_id, current_status, status_reason) values ('GK-09', 'OUT_OF_SERVICE', 'spoof')$q$);
select pg_temp.eq('...is forced to OPERATIONAL by the server', $q$select current_status || '|' || status_reason from public.gokart_units where kart_id = 'GK-09'$q$, 'OPERATIONAL|Registered');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.ok('admin registers GK-03', $q$insert into public.gokart_units (kart_id) values ('GK-03')$q$);
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.fails('worker cannot register a kart', $q$insert into public.gokart_units (kart_id) values ('GK-W')$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.fails('manager cannot register a kart', $q$insert into public.gokart_units (kart_id) values ('GK-M')$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.fails('level-90 non-admin role cannot register (exact role)', $q$insert into public.gokart_units (kart_id) values ('GK-S')$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000007');
select pg_temp.eq('no-stv-pos user sees no karts', $q$select count(*)::text from public.gokart_units$q$, '0');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.eq('worker sees the 4 karts, all OPERATIONAL', $q$select count(*) filter (where current_status = 'OPERATIONAL')::text from public.gokart_units$q$, '4');
select pg_temp.eq('registration logged with actor name', $q$select count(*)::text from public.gokart_status_history where change_type = 'REGISTERED' and actor_name is not null$q$, '4');
select pg_temp.rows('worker cannot update a kart directly', $q$update public.gokart_units set current_status = 'OUT_OF_SERVICE' where kart_id = 'GK-01'$q$, 0);
select pg_temp.fails('worker cannot write kart history', $q$insert into public.gokart_status_history (kart_id, to_status, change_type) values ('GK-01', 'OPERATIONAL', 'VERIFIED_CHANGE')$q$);

-- ── 2. Restock request: server-controlled fields ───────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.ok('worker creates restock with spoofed fields',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, payload, client_request_id,
       status, created_by, created_by_name, reference_number, reviewed_by, fulfilled_by, kart_ids, safety_status)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'restock_request', 'Restock', 'Inventory & Stock', '2026-11-22',
       '{"sections":[{"title":"Drinks","items":[{"name":"Coca Cola","required_qty":1}]}]}',
       'cccccccc-0000-4000-8000-000000000001', 'FULFILLED', 'aaaaaaaa-0000-4000-8000-000000000001', 'The Owner',
       'FAKE-1', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', '{GK-01}', 'OUT_OF_SERVICE')$q$);
select pg_temp.eq('spoofed fields overwritten by server',
  $q$select status || '|' || (created_by = 'aaaaaaaa-0000-4000-8000-000000000003')::text || '|' || created_by_name || '|' ||
            (reference_number ~ '^STV-RR-\d{4}-0001$')::text || '|' || (reviewed_by is null and fulfilled_by is null)::text || '|' ||
            cardinality(kart_ids) || '|' || coalesce(safety_status, 'null')
       from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$,
  'PENDING|true|Worker Test|true|true|0|null');
select pg_temp.eq('CREATED event written', $q$select count(*)::text from public.operational_document_events where document_id = 'bbbbbbbb-0000-4000-8000-000000000001' and event = 'CREATED'$q$, '1');
select pg_temp.fails('duplicate client_request_id rejected',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('restock_request', 'Restock', 'Inventory & Stock', '2026-11-22', 'cccccccc-0000-4000-8000-000000000001')$q$, 'client_request_id');
select pg_temp.ok('worker creates second restock',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id)
     values ('bbbbbbbb-0000-4000-8000-000000000002', 'restock_request', 'Restock', 'Inventory & Stock', '2026-11-22', 'cccccccc-0000-4000-8000-000000000002')$q$);
select pg_temp.eq('reference numbers sequential per type', $q$select (reference_number ~ '-0002$')::text from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000002'$q$, 'true');
select pg_temp.ok('worker creates inventory checklist',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id)
     values ('bbbbbbbb-0000-4000-8000-000000000003', 'inventory_checklist', 'Inventory Checklist', 'Operations', '2026-11-22', 'cccccccc-0000-4000-8000-000000000003')$q$);
select pg_temp.eq('checklist uses STV-IC prefix', $q$select (reference_number ~ '^STV-IC-\d{4}-0001$')::text from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000003'$q$, 'true');
select pg_temp.fails('worker cannot create kitchen equipment list',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('kitchen_equipment', 'Kitchen', 'Kitchen & Restaurant', '2026-11-22', gen_random_uuid())$q$, 'row-level security');
select pg_temp.fails('worker cannot read the counters', $q$select public.stv_next_opsdoc_reference('restock_request')$q$, 'permission denied');
select pg_temp.eq('counters table invisible to worker', $q$select count(*)::text from public.operational_document_counters$q$, '0');
select pg_temp.rows('worker cannot approve own request', $q$update public.operational_documents set status = 'APPROVED' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 0);
select pg_temp.rows('worker cannot delete own request', $q$delete from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 0);
select pg_temp.fails('worker cannot truncate', $q$truncate public.operational_documents$q$, 'permission denied');
select pg_temp.fails('worker cannot forge events', $q$insert into public.operational_document_events (document_id, event) values ('bbbbbbbb-0000-4000-8000-000000000001', 'CREATED')$q$);

select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.fails('manager cannot create dining equipment list',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('dining_equipment', 'Dining', 'Kitchen & Restaurant', '2026-11-22', gen_random_uuid())$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.fails('level-90 non-admin role cannot create equipment list (exact role)',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('kitchen_equipment', 'Kitchen', 'Kitchen & Restaurant', '2026-11-22', gen_random_uuid())$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000007');
select pg_temp.fails('no-stv-pos user cannot create documents',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('restock_request', 'Restock', 'Inventory & Stock', '2026-11-22', gen_random_uuid())$q$, 'row-level security');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.ok('admin creates kitchen equipment list',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id, payload)
     values ('bbbbbbbb-0000-4000-8000-000000000004', 'kitchen_equipment', 'Kitchen', 'Kitchen & Restaurant', '2026-11-22', 'cccccccc-0000-4000-8000-000000000004', '{"items":[]}')$q$);
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.ok('worker2 creates a restock',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id)
     values ('bbbbbbbb-0000-4000-8000-000000000005', 'restock_request', 'Restock', 'Inventory & Stock', '2026-11-22', 'cccccccc-0000-4000-8000-000000000005')$q$);

-- ── 3. Visibility ───────────────────────────────────────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.eq('worker sees only own non-kart documents', $q$select count(*)::text from public.operational_documents$q$, '3');
select pg_temp.eq('worker cannot see events of others'' documents', $q$select count(*)::text from public.operational_document_events where document_id in ('bbbbbbbb-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000005')$q$, '0');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.eq('level-90 non-admin role sees nothing it did not create (exact role)', $q$select count(*)::text from public.operational_documents$q$, '0');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.eq('manager sees nothing it did not create', $q$select count(*)::text from public.operational_documents$q$, '0');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.eq('admin sees all documents', $q$select count(*)::text from public.operational_documents$q$, '5');
select pg_temp.act(null, 'anon');
select pg_temp.fails('anon cannot read documents', $q$select count(*) from public.operational_documents$q$, 'permission denied');
select pg_temp.fails('anon cannot read karts', $q$select count(*) from public.gokart_units$q$, 'permission denied');

-- ── 4. Approval / fulfilment workflow ──────────────────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.rows('manager cannot approve', $q$update public.operational_documents set status = 'APPROVED' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 0);
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.rows('level-90 non-admin role cannot approve (exact role)', $q$update public.operational_documents set status = 'APPROVED' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 0);
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.fails('PENDING -> FULFILLED not allowed', $q$update public.operational_documents set status = 'FULFILLED' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'Invalid status change');
select pg_temp.rows('owner approves restock with note',
  $q$update public.operational_documents set status = 'APPROVED', review_note = 'Order Friday', reviewed_by = 'aaaaaaaa-0000-4000-8000-000000000003', reviewed_by_name = 'Fake' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 1);
select pg_temp.eq('reviewer stamped by server, not client',
  $q$select (reviewed_by = 'aaaaaaaa-0000-4000-8000-000000000001')::text || '|' || reviewed_by_name || '|' || review_note || '|' || (reviewed_at is not null)::text
       from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'true|Owner Test|Order Friday|true');
select pg_temp.fails('content is immutable after creation', $q$update public.operational_documents set payload = '{"sections":[]}' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'immutable');
select pg_temp.fails('reference number is immutable', $q$update public.operational_documents set reference_number = 'X' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'immutable');
select pg_temp.ok('stamps cannot be edited without a status change',
  $q$update public.operational_documents set review_note = 'changed', reviewed_by_name = 'Fake' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);
select pg_temp.eq('...and are silently kept', $q$select review_note || '|' || reviewed_by_name from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'Order Friday|Owner Test');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.rows('admin marks restock FULFILLED', $q$update public.operational_documents set status = 'FULFILLED', review_note = 'overwrite?' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 1);
select pg_temp.eq('fulfilment stamped; approval stamp + note preserved',
  $q$select (fulfilled_by = 'aaaaaaaa-0000-4000-8000-000000000002')::text || '|' || fulfilled_by_name || '|' || reviewed_by_name || '|' || review_note
       from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'true|Admin Test|Owner Test|Order Friday');
select pg_temp.fails('FULFILLED is final', $q$update public.operational_documents set status = 'PENDING' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$, 'Invalid status change');
select pg_temp.eq('status events: approve (with note) + fulfil (no note)',
  $q$select string_agg(from_status || '>' || to_status || ':' || coalesce(note, '-'), ',' order by created_at, to_status)
       from public.operational_document_events where document_id = 'bbbbbbbb-0000-4000-8000-000000000001' and event = 'STATUS_CHANGED'$q$,
  'PENDING>APPROVED:Order Friday,APPROVED>FULFILLED:-');
select pg_temp.rows('admin approves checklist', $q$update public.operational_documents set status = 'APPROVED' where id = 'bbbbbbbb-0000-4000-8000-000000000003'$q$, 1);
select pg_temp.fails('only restock requests can be FULFILLED', $q$update public.operational_documents set status = 'FULFILLED' where id = 'bbbbbbbb-0000-4000-8000-000000000003'$q$, 'Invalid status change');
select pg_temp.rows('admin rejects worker2 restock', $q$update public.operational_documents set status = 'REJECTED', review_note = 'Not needed' where id = 'bbbbbbbb-0000-4000-8000-000000000005'$q$, 1);
select pg_temp.fails('REJECTED is final', $q$update public.operational_documents set status = 'APPROVED' where id = 'bbbbbbbb-0000-4000-8000-000000000005'$q$, 'Invalid status change');
select pg_temp.rows('admin cannot delete', $q$delete from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000005'$q$, 0);

-- ── 5. Restock never touches inventory ─────────────────────────────────
select pg_temp.eq('no ops function references inventory tables',
  $q$select count(*)::text from pg_proc where proname like any (array['stv_opsdoc%','stv_gokart%','verify_gokart_status','stv_next_opsdoc_reference'])
       and (prosrc ilike '%inventory_items%' or prosrc ilike '%inventory_movements%' or prosrc ilike '%record_inventory_movement%')$q$, '0');

-- ── 6. Go-kart reports, inspections, maintenance ───────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.fails('report for unregistered kart rejected',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids, safety_status)
     values ('gokart_damage_report', 'Damage', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-99}', 'RESTRICTED')$q$, 'not registered');
select pg_temp.fails('go-kart document with no kart rejected',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id)
     values ('gokart_maintenance_log', 'Log', 'Maintenance & Activities', '2026-11-22', gen_random_uuid())$q$, 'at least one');
select pg_temp.fails('damage report with two karts rejected',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids, safety_status)
     values ('gokart_damage_report', 'Damage', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-01,GK-02}', 'RESTRICTED')$q$, 'exactly one');
select pg_temp.fails('damage report without safety status rejected',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids)
     values ('gokart_damage_report', 'Damage', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-01}')$q$, 'Safety status is required');
select pg_temp.ok('damage report GK-01 RESTRICTED (lower-case id normalised)',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id, kart_ids, safety_status, payload)
     values ('bbbbbbbb-0000-4000-8000-000000000010', 'gokart_damage_report', 'Damage', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{" gk-01 "}', 'RESTRICTED',
       '{"photos":[{"path":"evidence/aaaaaaaa-0000-4000-8000-000000000003/x.jpg"}]}')$q$);
select pg_temp.eq('kart escalated to RESTRICTED + history', $q$select current_status || '|' || (select count(*) from public.gokart_status_history where kart_id = 'GK-01' and change_type = 'REPORT_ESCALATION') from public.gokart_units where kart_id = 'GK-01'$q$, 'RESTRICTED|1');
select pg_temp.ok('passing inspection recorded OPERATIONAL',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids, safety_status, payload)
     values ('gokart_safety_inspection', 'Inspection', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-01}', 'OPERATIONAL',
       '{"checks":[{"item":"Brakes","status":"PASS"}]}')$q$);
select pg_temp.eq('...does NOT return the kart to service (escalate-only)', $q$select current_status from public.gokart_units where kart_id = 'GK-01'$q$, 'RESTRICTED');
select pg_temp.fails('inspection with a FAIL cannot be OPERATIONAL',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids, safety_status, payload)
     values ('gokart_safety_inspection', 'Inspection', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-02}', 'OPERATIONAL',
       '{"checks":[{"item":"Brakes","status":"PASS"},{"item":"Steering","status":"fail"}]}')$q$, 'failed check');
select pg_temp.ok('failed inspection OUT_OF_SERVICE',
  $q$insert into public.operational_documents (doc_type, title, department, document_date, client_request_id, kart_ids, safety_status, payload)
     values ('gokart_safety_inspection', 'Inspection', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-01}', 'OUT_OF_SERVICE',
       '{"checks":[{"item":"Steering","status":"FAIL"}]}')$q$);
select pg_temp.eq('kart now OUT_OF_SERVICE', $q$select current_status from public.gokart_units where kart_id = 'GK-01'$q$, 'OUT_OF_SERVICE');
select pg_temp.ok('maintenance log for GK-01 (status input ignored)',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id, kart_ids, safety_status, payload)
     values ('bbbbbbbb-0000-4000-8000-000000000011', 'gokart_maintenance_log', 'Log', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-01}', 'OPERATIONAL',
       '{"entries":[{"work":"Replaced steering rod"}]}')$q$);
select pg_temp.eq('log stored without safety status; kart unchanged',
  $q$select coalesce((select safety_status from public.operational_documents where id = 'bbbbbbbb-0000-4000-8000-000000000011'), 'null') || '|' || current_status from public.gokart_units where kart_id = 'GK-01'$q$, 'null|OUT_OF_SERVICE');
select pg_temp.ok('maintenance log for GK-02',
  $q$insert into public.operational_documents (id, doc_type, title, department, document_date, client_request_id, kart_ids)
     values ('bbbbbbbb-0000-4000-8000-000000000012', 'gokart_maintenance_log', 'Log', 'Maintenance & Activities', '2026-11-22', gen_random_uuid(), '{GK-02}')$q$);
select pg_temp.fails('worker cannot call the escalation function', $q$select public.stv_gokart_escalate('GK-02', 'OPERATIONAL', null, 'x')$q$, 'permission denied');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.eq('worker2 sees all go-kart documents (shared safety info)', $q$select count(*)::text from public.operational_documents where doc_type like 'gokart\_%'$q$, '5');

-- ── 7. Verified return to service ──────────────────────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.fails('worker cannot verify a kart', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested')$q$, 'Owner/Admin');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.fails('manager cannot verify a kart', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested')$q$, 'Owner/Admin');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000006');
select pg_temp.fails('level-90 non-admin role cannot verify (exact role)', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested')$q$, 'Owner/Admin');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.fails('short note rejected', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'fixed')$q$, '10 characters');
select pg_temp.fails('invalid status rejected', $q$select public.verify_gokart_status('GK-01', 'BROKEN', 'Steering fixed and tested')$q$, 'Invalid status');
select pg_temp.fails('linked doc must be a maintenance log', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested', 'bbbbbbbb-0000-4000-8000-000000000010')$q$, 'maintenance log');
select pg_temp.fails('linked log must be for the same kart', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested', 'bbbbbbbb-0000-4000-8000-000000000012')$q$, 'maintenance log');
select pg_temp.fails('unknown kart rejected', $q$select public.verify_gokart_status('GK-77', 'OPERATIONAL', 'Steering fixed and tested')$q$, 'Unknown kart');
select pg_temp.ok('owner returns GK-01 to service with linked repair log', $q$select public.verify_gokart_status('gk-01', 'OPERATIONAL', 'Steering fixed and tested', 'bbbbbbbb-0000-4000-8000-000000000011')$q$);
select pg_temp.eq('kart OPERATIONAL, verified change logged with note + log link',
  $q$select u.current_status || '|' || h.reason || '|' || (h.document_id = 'bbbbbbbb-0000-4000-8000-000000000011')::text || '|' || h.actor_name
       from public.gokart_units u join public.gokart_status_history h on h.kart_id = u.kart_id and h.change_type = 'VERIFIED_CHANGE'
      where u.kart_id = 'GK-01'$q$, 'OPERATIONAL|Steering fixed and tested|true|Owner Test');
select pg_temp.fails('no-op status change rejected', $q$select public.verify_gokart_status('GK-01', 'OPERATIONAL', 'Steering fixed and tested')$q$, 'already');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.ok('admin can also verify (restrict GK-03)', $q$select public.verify_gokart_status('GK-03', 'RESTRICTED', 'Loose seat, kids only')$q$);

-- ── 8. Evidence storage ────────────────────────────────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000003');
select pg_temp.ok('worker uploads to evidence/<own uid>/', $q$insert into storage.objects (bucket_id, name) values ('stv-ops-documents', 'evidence/aaaaaaaa-0000-4000-8000-000000000003/x.jpg')$q$);
select pg_temp.fails('worker cannot upload into another user''s folder', $q$insert into storage.objects (bucket_id, name) values ('stv-ops-documents', 'evidence/aaaaaaaa-0000-4000-8000-000000000004/y.jpg')$q$, 'row-level security');
select pg_temp.fails('worker cannot upload outside evidence/', $q$insert into storage.objects (bucket_id, name) values ('stv-ops-documents', 'other/aaaaaaaa-0000-4000-8000-000000000003/z.jpg')$q$, 'row-level security');
select pg_temp.rows('worker cannot overwrite evidence', $q$update storage.objects set name = name || '.swap' where bucket_id = 'stv-ops-documents'$q$, 0);
select pg_temp.rows('worker cannot delete evidence', $q$delete from storage.objects where bucket_id = 'stv-ops-documents'$q$, 0);
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.eq('other POS members can view evidence', $q$select count(*)::text from storage.objects where bucket_id = 'stv-ops-documents'$q$, '1');
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000007');
select pg_temp.eq('non-POS user cannot view evidence', $q$select count(*)::text from storage.objects where bucket_id = 'stv-ops-documents'$q$, '0');
select pg_temp.fails('non-POS user cannot upload evidence', $q$insert into storage.objects (bucket_id, name) values ('stv-ops-documents', 'evidence/aaaaaaaa-0000-4000-8000-000000000007/n.jpg')$q$, 'row-level security');

-- ── done ────────────────────────────────────────────────────────────────
select pg_temp.act('aaaaaaaa-0000-4000-8000-000000000001');
reset role;
\echo
select 'ALL ' || current_setting('opsdoc_test.passed') || ' CHECKS PASSED (rolling back)' as result;
rollback;
