-- Access verification for 20261119120000_smd_marine_invoicing_owner_only.sql.
--
-- Run AFTER the migration, inside one transaction; the block always ends by
-- raising an exception whose message is the report, so everything (including
-- the temporary Admin grant below) is rolled back. "FAIL" = failed check.
--
-- Set c_owner / c_worker to real stv-pos Owner / Worker user ids, and
-- c_admin_sim to a user with NO stv-pos grant: the test grants that user the
-- Admin role temporarily (rolled back) because no real Admin account exists.
do $test$
declare
  c_owner     constant uuid := '00000000-0000-0000-0000-000000000001'; -- replace: stv-pos OWNER
  c_worker    constant uuid := '00000000-0000-0000-0000-000000000002'; -- replace: stv-pos WORKER
  c_admin_sim constant uuid := '00000000-0000-0000-0000-000000000003'; -- replace: user WITHOUT any stv-pos grant
  r text := '';
  d public.marine_documents;
  q public.marine_documents;
  v_id uuid;
  n int;
  who text;
  items jsonb := '[{"description":"Buoy servicing","unit":"service","quantity":1,"unit_price":1000000}]';
begin
  -- Temporary Admin grant for the simulated admin (rolled back with the test).
  insert into public.user_application_roles (user_id, application_id, role_id)
  select c_admin_sim, a.id, ro.id from public.applications a, public.roles ro
   where a.slug = 'stv-pos' and ro.slug = 'admin';

  execute 'set local role authenticated';

  ------------------------------------------------------------------ owner
  perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
  d := public.save_marine_draft(null, gen_random_uuid(), '{"doc_type":"QUOTATION"}', items, '[]');
  q := public.issue_marine_document(d.id);
  r := r || format(E'\nO1 owner draft+issue -> %s -> %s', q.document_number, case when q.status = 'ISSUED' then 'PASS' else 'FAIL' end);
  v_id := public.convert_marine_document(q.id, 'PROFORMA');
  r := r || format(E'\nO2 owner convert -> %s', case when v_id is not null then 'PASS' else 'FAIL' end);
  select count(*) into n from public.marine_documents;
  r := r || format(E'\nO3 owner sees documents=%s -> %s', n, case when n >= 2 then 'PASS' else 'FAIL' end);
  select count(*) into n from public.marine_invoice_settings;
  r := r || format(E'\nO4 owner sees settings=%s -> %s', n, case when n = 1 then 'PASS' else 'FAIL' end);
  update public.marine_invoice_settings set default_notes = 'owner test' where id = 1;
  get diagnostics n = row_count;
  r := r || format(E'\nO5 owner updates settings rows=%s -> %s', n, case when n = 1 then 'PASS' else 'FAIL' end);
  insert into public.marine_catalog_items (name) values ('Owner test item');
  insert into public.marine_scope_templates (title) values ('Owner test template');
  insert into public.marine_document_events (document_id, event, actor_id) values (q.id, 'PDF_PRINTED', c_owner);
  r := r || E'\nO6 owner library + PDF log writes -> PASS';
  q := public.cancel_marine_document(q.id, 'Owner access test');
  r := r || format(E'\nO7 owner cancel -> %s', case when q.status = 'CANCELLED' then 'PASS' else 'FAIL' end);
  q := public.issue_marine_document((public.save_marine_draft(null, gen_random_uuid(), '{"doc_type":"INVOICE"}', items, '[]')).id);
  v_id := public.revise_marine_document(q.id);
  r := r || format(E'\nO8 owner revise -> %s', case when v_id is not null then 'PASS' else 'FAIL' end);

  ------------------------------------------------- admin (simulated) + worker
  foreach who in array array['admin', 'worker'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case who when 'admin' then c_admin_sim else c_worker end, 'role', 'authenticated')::text, true);
    if who = 'admin' then
      r := r || format(E'\nA0 simulated admin really is stv-pos admin=%s, owner=%s -> %s',
        has_minimum_role('stv-pos', 'admin'), has_minimum_role('stv-pos', 'owner'),
        case when has_minimum_role('stv-pos', 'admin') and not has_minimum_role('stv-pos', 'owner') then 'PASS' else 'FAIL' end);
    end if;
    select count(*) into n from public.marine_documents;
    r := r || format(E'\n%s1 %s sees documents=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    select count(*) into n from public.marine_document_items;
    r := r || format(E'\n%s2 %s sees items=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    select count(*) into n from public.marine_document_scope;
    select n + count(*) into n from public.marine_document_events;
    r := r || format(E'\n%s3 %s sees scope+events=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    select count(*) into n from public.marine_invoice_settings;
    r := r || format(E'\n%s4 %s sees settings=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    select count(*) into n from public.marine_catalog_items;
    select n + count(*) into n from public.marine_scope_templates;
    r := r || format(E'\n%s5 %s sees libraries=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    begin
      select count(*) into n from public.marine_document_counters;
      r := r || format(E'\n%s6 %s counters readable -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%s6 %s counters denied -> PASS', upper(left(who,1)), who);
    end;
    update public.marine_invoice_settings set footer_line = 'hijack';
    get diagnostics n = row_count;
    r := r || format(E'\n%s7 %s settings update rows=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
    begin
      perform public.save_marine_draft(null, gen_random_uuid(), '{"doc_type":"QUOTATION"}', items, '[]');
      r := r || format(E'\n%s8 %s save draft -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%s8 %s save draft denied -> PASS', upper(left(who,1)), who);
    end;
    -- SECURITY DEFINER RPCs against the owner's real documents (bypass RLS -> must self-check)
    begin
      perform public.cancel_marine_document(q.id, 'not allowed');
      r := r || format(E'\n%s9 %s cancel -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%s9 %s cancel denied -> PASS', upper(left(who,1)), who);
    end;
    begin
      perform public.revise_marine_document(q.id);
      r := r || format(E'\n%sa %s revise -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%sa %s revise denied -> PASS', upper(left(who,1)), who);
    end;
    begin
      perform public.convert_marine_document(q.id, 'INVOICE');
      r := r || format(E'\n%sb %s convert -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%sb %s convert denied -> PASS', upper(left(who,1)), who);
    end;
    begin
      perform public.issue_marine_document(v_id);
      r := r || format(E'\n%sc %s issue -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%sc %s issue denied -> PASS', upper(left(who,1)), who);
    end;
    begin
      insert into public.marine_catalog_items (name) values ('hijack');
      r := r || format(E'\n%sd %s library insert -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%sd %s library insert denied -> PASS', upper(left(who,1)), who);
    end;
    begin
      insert into public.marine_documents (doc_type) values ('QUOTATION');
      r := r || format(E'\n%se %s direct document insert -> FAIL', upper(left(who,1)), who);
    exception when others then r := r || format(E'\n%se %s direct document insert denied -> PASS', upper(left(who,1)), who);
    end;
    delete from public.marine_documents where id = v_id;
    get diagnostics n = row_count;
    r := r || format(E'\n%sf %s delete owner draft rows=%s -> %s', upper(left(who,1)), who, n, case when n = 0 then 'PASS' else 'FAIL' end);
  end loop;

  ------------------------------------------------------------------ anon
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.marine_documents;
    r := r || E'\nN1 anon select -> FAIL';
  exception when others then r := r || E'\nN1 anon select denied -> PASS';
  end;
  begin
    perform public.issue_marine_document(v_id);
    r := r || E'\nN2 anon rpc -> FAIL';
  exception when others then r := r || E'\nN2 anon rpc denied -> PASS';
  end;

  raise exception 'OWNER-ONLY TEST REPORT (rolled back):%', r;
end;
$test$;
