-- Database verification for 20261119090000_smd_marine_invoicing.sql.
--
-- Usage: run the migration and then this block in ONE transaction, e.g.
--   begin;  \i supabase/migrations/20261119090000_smd_marine_invoicing.sql
--           \i supabase/tests/marine_invoicing_rollback_test.sql
-- The block always ends by raising an exception whose message is the test
-- report, so the whole transaction (migration included) is rolled back and
-- nothing is left behind. "FAIL" anywhere in the report = a failed check.
--
-- Set the two uuids below to a real stv-pos owner and worker.
do $test$
declare
  c_owner  constant text := '00000000-0000-0000-0000-000000000001' /* replace: an stv-pos OWNER user id */;
  c_worker constant text := '00000000-0000-0000-0000-000000000002' /* replace: an stv-pos WORKER user id */;
  v_year  int := extract(year from public.marine_local_today())::int;
  r text := '';
  d public.marine_documents;
  q public.marine_documents;
  pi public.marine_documents;
  inv public.marine_documents;
  v_id uuid; v_id2 uuid; v_req uuid := gen_random_uuid();
  n int; t text; ok boolean;
  v_items jsonb := '[{"description":"RUBANI BUOY: new buoy","unit":"pieces","quantity":2.5,"unit_price":1000.10},
                     {"description":"Chain","unit":"metres","quantity":1,"unit_price":999.99}]';
  v_scope jsonb := '[{"title":"RUBANI BUOY","description":"Replacement of existing buoy\nwith a new buoy and new chain."}]';
  procedure_check text;
begin
  -- Fresh counters for this year, so expected numbers are deterministic.
  delete from public.marine_document_counters;

  ------------------------------------------------------------------ owner
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);

  -- 1. Draft with decimal quantities, discount, VAT 15%
  d := public.save_marine_draft(null, v_req,
        '{"doc_type":"QUOTATION","subject":"Buoy works","vat_enabled":true,"vat_percent":15,"discount_amount":100,"discount_label":"Loyalty"}',
        v_items, v_scope);
  r := r || format(E'\n1 draft totals sub=%s taxable=%s vat=%s total=%s status=%s num=%s -> %s',
        d.subtotal, d.taxable_amount, d.vat_amount, d.total_due, d.status, d.document_number,
        case when d.subtotal = 3500.24 and d.taxable_amount = 3400.24 and d.vat_amount = 510.04
              and d.total_due = 3910.28 and d.status = 'DRAFT' and d.document_number is null then 'PASS' else 'FAIL' end);

  -- 2. Retry with same client_request_id updates, no duplicate
  q := public.save_marine_draft(null, v_req,
        '{"doc_type":"QUOTATION","subject":"Buoy works","vat_enabled":true,"vat_percent":15,"discount_amount":100}',
        v_items, v_scope);
  select count(*) into n from public.marine_documents where client_request_id = v_req;
  select count(*) into n from public.marine_document_items where document_id = d.id;
  r := r || format(E'\n2 idempotent retry same_id=%s items=%s -> %s', q.id = d.id, n,
        case when q.id = d.id and n = 2 then 'PASS' else 'FAIL' end);

  -- 3. Client cannot set status / number directly
  begin
    update public.marine_documents set status = 'ISSUED' where id = d.id;
    r := r || E'\n3 direct status change -> FAIL (allowed)';
  exception when others then r := r || E'\n3 direct status change blocked -> PASS';
  end;
  begin
    update public.marine_documents set document_number = 'SMD-QTN-2026-999' where id = d.id;
    r := r || E'\n3b direct number change -> FAIL (allowed)';
  exception when others then r := r || E'\n3b direct number change blocked -> PASS';
  end;

  -- 3c. Direct insert claiming ISSUED is forced back to DRAFT
  insert into public.marine_documents (doc_type, status, document_number)
  values ('INVOICE', 'ISSUED', 'SMD-INV-2026-500') returning id into v_id2;
  select status, document_number into t, procedure_check from public.marine_documents where id = v_id2;
  r := r || format(E'\n3c forged insert -> status=%s num=%s -> %s', t, procedure_check,
        case when t = 'DRAFT' and procedure_check is null then 'PASS' else 'FAIL' end);
  delete from public.marine_documents where id = v_id2;

  -- 4. Issue
  q := public.issue_marine_document(d.id);
  r := r || format(E'\n4 issue -> %s bank=%s footer=%s -> %s', q.document_number, q.bank_details ->> 'account_number',
        q.contact_snapshot ->> 'footer_line',
        case when q.document_number = format('SMD-QTN-%s-001', v_year) and q.status = 'ISSUED'
              and q.bank_details ->> 'account_number' = '22910118721'
              and q.contact_snapshot ->> 'footer_line' = 'SWAHILI MARINE & DIVING | GEC LIMITED' then 'PASS' else 'FAIL' end);

  -- 4b. Issuing twice fails
  begin
    perform public.issue_marine_document(d.id);
    r := r || E'\n4b double issue -> FAIL';
  exception when others then r := r || E'\n4b double issue blocked -> PASS';
  end;

  -- 5. Issued doc is frozen
  begin
    update public.marine_documents set subject = 'tampered' where id = q.id;
    r := r || E'\n5 edit issued -> FAIL';
  exception when others then r := r || E'\n5 edit issued blocked -> PASS';
  end;
  begin
    insert into public.marine_document_items (document_id, position, description, quantity, unit_price) values (q.id, 9, 'x', 1, 1);
    r := r || E'\n5b add item to issued -> FAIL';
  exception when others then r := r || E'\n5b add item to issued blocked -> PASS';
  end;
  begin
    perform public.save_marine_draft(q.id, null, '{"doc_type":"QUOTATION"}', '[]', '[]');
    r := r || E'\n5c save over issued -> FAIL';
  exception when others then r := r || E'\n5c save over issued blocked -> PASS';
  end;
  delete from public.marine_documents where id = q.id;
  get diagnostics n = row_count;
  r := r || format(E'\n5d delete issued rows=%s -> %s', n, case when n = 0 then 'PASS' else 'FAIL' end);

  -- 6. Global settings change does not touch issued snapshot
  update public.marine_invoice_settings set footer_line = 'CHANGED FOOTER', bank_account_number = '000' where id = 1;
  get diagnostics n = row_count;
  select contact_snapshot ->> 'footer_line', bank_details ->> 'account_number' into t, procedure_check
    from public.marine_documents where id = q.id;
  r := r || format(E'\n6 owner settings update rows=%s; issued still footer=%s acct=%s -> %s', n, t, procedure_check,
        case when n = 1 and t = 'SWAHILI MARINE & DIVING | GEC LIMITED' and procedure_check = '22910118721' then 'PASS' else 'FAIL' end);

  -- 7. Convert QTN -> PI (idempotent while draft), issue, source CONVERTED
  v_id := public.convert_marine_document(q.id, 'PROFORMA');
  v_id2 := public.convert_marine_document(q.id, 'PROFORMA');
  select count(*) into n from public.marine_document_items where document_id = v_id;
  begin
    update public.marine_documents set doc_type = 'QUOTATION' where id = v_id;
    r := r || E'\n7a change type of conversion draft -> FAIL';
  exception when others then r := r || E'\n7a change type of conversion draft blocked -> PASS';
  end;
  pi := public.issue_marine_document(v_id);
  select status into t from public.marine_documents where id = q.id;
  r := r || format(E'\n7 convert -> %s src_status=%s items_copied=%s same_draft=%s total=%s -> %s',
        pi.document_number, t, n, v_id = v_id2, pi.total_due,
        case when pi.document_number = format('SMD-PI-%s-001', v_year) and t = 'CONVERTED' and n = 2
              and v_id = v_id2 and pi.total_due = 3910.28 and pi.source_document_id = q.id
              -- new doc took the NEW global settings at issue, the source kept the old ones
              and pi.contact_snapshot ->> 'footer_line' = 'CHANGED FOOTER' then 'PASS' else 'FAIL' end);

  -- 7b. Cannot convert a converted doc again / cannot go backwards
  begin
    perform public.convert_marine_document(q.id, 'INVOICE');
    r := r || E'\n7b re-convert converted -> FAIL';
  exception when others then r := r || E'\n7b re-convert converted blocked -> PASS';
  end;

  -- 8. PI -> INVOICE
  inv := public.issue_marine_document(public.convert_marine_document(pi.id, 'INVOICE'));
  r := r || format(E'\n8 PI->INV %s -> %s', inv.document_number,
        case when inv.document_number = format('SMD-INV-%s-001', v_year) then 'PASS' else 'FAIL' end);
  begin
    perform public.convert_marine_document(inv.id, 'PROFORMA');
    r := r || E'\n8b INV->PI -> FAIL';
  exception when others then r := r || E'\n8b invalid direction blocked -> PASS';
  end;

  -- 9. Revise invoice: new number, original cancelled + linked
  d := public.issue_marine_document(public.revise_marine_document(inv.id));
  select status, superseded_by_id::text into t, procedure_check from public.marine_documents where id = inv.id;
  r := r || format(E'\n9 revision %s orig_status=%s -> %s', d.document_number, t,
        case when d.document_number = format('SMD-INV-%s-002', v_year) and t = 'CANCELLED'
              and procedure_check = d.id::text and d.revision_of_id = inv.id then 'PASS' else 'FAIL' end);

  -- 10. Cancel workflow
  begin
    perform public.cancel_marine_document(d.id, 'no');
    r := r || E'\n10a short reason -> FAIL';
  exception when others then r := r || E'\n10a short reason blocked -> PASS';
  end;
  d := public.cancel_marine_document(d.id, 'Customer withdrew');
  r := r || format(E'\n10 cancel -> %s by=%s -> %s', d.status, coalesce(d.cancelled_by_name, '?'),
        case when d.status = 'CANCELLED' and d.cancel_reason = 'Customer withdrew' then 'PASS' else 'FAIL' end);

  -- 11. Overrides
  d := public.save_marine_draft(null, gen_random_uuid(),
        '{"doc_type":"INVOICE","vat_enabled":true,"vat_percent":15,"vat_amount_override":500,"total_override":4000,"extra_charge_amount":10}',
        v_items, '[]');
  r := r || format(E'\n11 overrides vat_calc=%s vat=%s calc_total=%s due=%s -> %s', d.vat_calculated, d.vat_amount, d.calculated_total, d.total_due,
        case when d.vat_calculated = 526.54 and d.vat_amount = 500 and d.calculated_total = 4010.24 and d.total_due = 4000 then 'PASS' else 'FAIL' end);
  d := public.save_marine_draft(d.id, null, '{"doc_type":"INVOICE","vat_enabled":false,"vat_percent":15,"vat_amount_override":500}', v_items, '[]');
  r := r || format(E'\n11b VAT off vat=%s due=%s -> %s', d.vat_amount, d.total_due,
        case when d.vat_amount = 0 and d.total_due = 3500.24 then 'PASS' else 'FAIL' end);

  -- 12. Discount larger than subtotal
  begin
    perform public.save_marine_draft(d.id, null, '{"doc_type":"INVOICE","discount_amount":999999}', v_items, '[]');
    r := r || E'\n12 oversize discount -> FAIL';
  exception when others then r := r || E'\n12 oversize discount blocked -> PASS';
  end;

  -- 13. Empty draft cannot be issued; draft deletable
  v_id := (public.save_marine_draft(null, gen_random_uuid(), '{"doc_type":"QUOTATION"}', '[]', '[]')).id;
  begin
    perform public.issue_marine_document(v_id);
    r := r || E'\n13 issue empty -> FAIL';
  exception when others then r := r || E'\n13 issue empty blocked -> PASS';
  end;
  delete from public.marine_documents where id = v_id;
  get diagnostics n = row_count;
  r := r || format(E'\n13b delete draft rows=%s -> %s', n, case when n = 1 then 'PASS' else 'FAIL' end);

  -- 14. Events trail + PDF log
  insert into public.marine_document_events (document_id, event, actor_id) values (q.id, 'PDF_PRINTED', c_owner::uuid);
  begin
    insert into public.marine_document_events (document_id, event, actor_id) values (q.id, 'ISSUED', c_owner::uuid);
    r := r || E'\n14a forged event -> FAIL';
  exception when others then r := r || E'\n14a forged event blocked -> PASS';
  end;
  select string_agg(event, ',' order by created_at, event) into t from public.marine_document_events where document_id = q.id;
  r := r || format(E'\n14 events(q)=%s -> %s', t,
        case when t like '%CREATED%' and t like '%ISSUED%' and t like '%CONVERTED%' and t like '%PDF_PRINTED%' then 'PASS' else 'FAIL' end);

  -- 15. Library CRUD
  insert into public.marine_catalog_items (name, unit, default_unit_price) values ('Diver hour', 'hours', 85000);
  insert into public.marine_scope_templates (title, description) values ('BUOY SERVICING', 'Servicing of existing buoy only.');
  select count(*) into n from public.marine_catalog_items;
  r := r || format(E'\n15 library insert catalog=%s -> %s', n, case when n >= 1 then 'PASS' else 'FAIL' end);

  ------------------------------------------------------------------ worker
  perform set_config('request.jwt.claims', json_build_object('sub', c_worker, 'role', 'authenticated')::text, true);
  select count(*) into n from public.marine_documents;
  r := r || format(E'\n16 worker sees docs=%s -> %s', n, case when n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into n from public.marine_invoice_settings;
  r := r || format(E'\n16b worker sees settings=%s -> %s', n, case when n = 0 then 'PASS' else 'FAIL' end);
  select count(*) into n from public.marine_catalog_items;
  r := r || format(E'\n16c worker sees catalog=%s -> %s', n, case when n = 0 then 'PASS' else 'FAIL' end);
  begin
    perform public.save_marine_draft(null, gen_random_uuid(), '{"doc_type":"QUOTATION"}', '[]', '[]');
    r := r || E'\n16d worker draft -> FAIL';
  exception when others then r := r || E'\n16d worker draft blocked -> PASS';
  end;
  begin
    perform public.cancel_marine_document(q.id, 'worker attempt');
    r := r || E'\n16e worker cancel -> FAIL';
  exception when others then r := r || E'\n16e worker cancel blocked -> PASS';
  end;
  update public.marine_invoice_settings set footer_line = 'x';
  get diagnostics n = row_count;
  r := r || format(E'\n16f worker settings update rows=%s -> %s', n, case when n = 0 then 'PASS' else 'FAIL' end);
  begin
    perform * from public.marine_next_document_number('QUOTATION', 2026);
    r := r || E'\n16g worker calls counter -> FAIL';
  exception when others then r := r || E'\n16g worker counter call blocked -> PASS';
  end;

  ------------------------------------------------------------------ anon
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.marine_documents;
    r := r || E'\n17 anon select -> FAIL';
  exception when others then r := r || E'\n17 anon select denied -> PASS';
  end;
  begin
    perform public.issue_marine_document(q.id);
    r := r || E'\n17b anon rpc -> FAIL';
  exception when others then r := r || E'\n17b anon rpc denied -> PASS';
  end;

  ------------------------------------------------------------------ year reset
  execute 'reset role';
  select document_number into t from public.marine_next_document_number('QUOTATION', v_year + 1);
  select document_number into procedure_check from public.marine_next_document_number('QUOTATION', v_year);
  r := r || format(E'\n18 year reset next-year=%s this-year=%s -> %s', t, procedure_check,
        case when t = format('SMD-QTN-%s-001', v_year + 1) and procedure_check = format('SMD-QTN-%s-002', v_year) then 'PASS' else 'FAIL' end);

  -- 19. Unique number backstop
  begin
    insert into public.marine_documents (doc_type, status, document_number, issued_at)
    values ('PROFORMA', 'ISSUED', pi.document_number, now());
    r := r || E'\n19 duplicate number -> FAIL';
  exception when others then r := r || E'\n19 duplicate number rejected -> PASS';
  end;

  raise exception 'MARINE TEST REPORT (rolled back):%', r;
end;
$test$;
