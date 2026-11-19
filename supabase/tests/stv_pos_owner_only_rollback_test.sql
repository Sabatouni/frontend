-- Access verification for supabase/proposed/A_stv_pos_owner_only_sensitive.sql.
--
-- Run inside ONE transaction: `begin;` + this file's pg_temp function +
-- the BEFORE report + the draft A migration body + the AFTER report.
-- The final statement raises with the report, so everything (migration,
-- temporary role grants, test rows) is rolled back. Never call
-- next_debt_statement_number() as an Owner here: sequence increments are not
-- transactional and would skip a real statement number.
--
-- Replace the five ids. c_admin_sim / c_manager_sim must have NO stv-pos
-- grant (they get a temporary one); c_developer_sim is a Worker whose grant is
-- temporarily switched to developer. All of it is rolled back.
create or replace function pg_temp.access_report(p_label text, c_owner uuid, c_admin uuid, c_manager uuid, c_developer uuid, c_worker uuid)
returns text language plpgsql as $f$
declare
  r text := E'\n== ' || p_label;
  who text; uid uuid; n int; ok boolean;
  v_sale uuid; v_exp uuid; t_sales int; t_exp int; t_dc int; t_wr int;
begin
  -- Totals as the table owner, so "sees all" can be checked exactly.
  select count(*) into t_sales from public.sales;
  select count(*) into t_exp from public.expenses;
  select count(*) into t_dc from public.debt_credit_records;
  select count(*) into t_wr from public.weekly_reports;

  -- Owner-created throwaway rows to target (rolled back with the test).
  insert into public.sales (service, amount, user_id, description) values ('TEST', 1, c_owner, 'rollback test') returning id into v_sale;
  insert into public.expenses (category, item, cost, user_id) values ('TEST', 'rollback test', 1, c_owner) returning id into v_exp;

  foreach who in array array['owner', 'admin', 'manager', 'developer', 'worker'] loop
    uid := case who when 'owner' then c_owner when 'admin' then c_admin when 'manager' then c_manager when 'developer' then c_developer else c_worker end;
    select count(*) into t_sales from public.sales;   -- fresh totals (as table owner)
    select count(*) into t_exp from public.expenses;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);

    select count(*) into n from public.debt_credit_records;
    r := r || format(E'\n%s debt_credit_records visible=%s/%s', rpad(who, 9), n, t_dc);
    begin
      insert into public.debt_credit_people (name, phone) values ('rollback test', '000');
      r := r || ' | debt insert=ALLOWED';
    exception when others then r := r || ' | debt insert=denied';
    end;
    if who <> 'owner' then
      begin
        perform public.next_debt_statement_number();
        r := r || ' | statement no.=ALLOWED';
      exception when others then r := r || ' | statement no.=denied';
      end;
    end if;
    select count(*) into n from public.weekly_reports;
    r := r || format(' | weekly_reports visible=%s/%s', n, t_wr);

    select count(*) into n from public.sales;
    r := r || format(E'\n%s sales visible=%s/%s', rpad('', 9), n, t_sales);
    update public.sales set note = note where id = v_sale;
    get diagnostics n = row_count;
    r := r || format(' | edit sale=%s', case when n = 1 then 'ALLOWED' else 'denied' end);
    begin
      insert into public.sales (service, amount, user_id, description) values ('TEST', 1, uid, 'own sale');
      r := r || ' | record own sale=ALLOWED';
    exception when others then r := r || ' | record own sale=denied';
    end;
    select count(*) into n from public.expenses;
    r := r || format(' | expenses visible=%s/%s', n, t_exp);

    -- Deletes last; owner deletes the throwaway rows (proves Owner can).
    if who <> 'owner' then
      delete from public.sales where id = v_sale;
      get diagnostics n = row_count;
      r := r || format(E'\n%s delete sale=%s', rpad('', 9), case when n = 1 then 'ALLOWED' else 'denied' end);
      delete from public.expenses where id = v_exp;
      get diagnostics n = row_count;
      r := r || format(' | delete expense=%s', case when n = 1 then 'ALLOWED' else 'denied' end);
    end if;
    execute 'reset role';
    -- If a delete succeeded, recreate the throwaway rows so the next role
    -- is tested against a row that exists.
    if not exists (select 1 from public.sales where id = v_sale) then
      insert into public.sales (service, amount, user_id, description) values ('TEST', 1, c_owner, 'rollback test') returning id into v_sale;
    end if;
    if not exists (select 1 from public.expenses where id = v_exp) then
      insert into public.expenses (category, item, cost, user_id) values ('TEST', 'rollback test', 1, c_owner) returning id into v_exp;
    end if;
  end loop;

  -- Owner deletes last (so the rows existed for everyone else's attempts).
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
  delete from public.sales where id = v_sale;
  get diagnostics n = row_count;
  r := r || format(E'\nowner     delete sale=%s', case when n = 1 then 'ALLOWED' else 'denied' end);
  delete from public.expenses where id = v_exp;
  get diagnostics n = row_count;
  r := r || format(' | delete expense=%s', case when n = 1 then 'ALLOWED' else 'denied' end);
  execute 'reset role';

  select pg_get_functiondef('public.next_debt_statement_number()'::regprocedure) ~ 'has_role\(''stv-pos'', ''owner''\)' into ok;
  r := r || format(E'\nnext_debt_statement_number requires exact owner: %s', ok);
  return r;
end;
$f$;
