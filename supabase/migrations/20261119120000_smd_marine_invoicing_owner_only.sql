-- MARINE INVOICING -- tighten access to STRICTLY OWNER-ONLY.
--
-- Follow-up to 20261119090000_smd_marine_invoicing.sql. Before this, Marine
-- Invoicing allowed the stv-pos Owner AND Admin roles (Invoice Settings were
-- already Owner-only). After this, every marine_* table and every Marine
-- Invoicing RPC requires has_minimum_role('stv-pos', 'owner'). Owner is the
-- highest role (level 100), so Admin (80) and every other role -- developer,
-- manager, editor, moderator, support, worker, viewer -- plus anon are denied.
--
-- What changes:
--   1. All RLS policies on marine_* tables are recreated with the Owner
--      threshold (and renamed *_owner_* so the name matches the rule).
--   2. The role check inside the five Marine RPCs is raised from 'admin' to
--      'owner'. This is essential, not cosmetic: issue / convert / revise /
--      cancel are SECURITY DEFINER and bypass RLS, so tightening only the
--      policies would still have let an Admin act on documents by id.
--
-- What does NOT change:
--   * No table, column, constraint, trigger, index, grant or row is altered.
--     No marine_* data (documents, numbers, counters, libraries, settings,
--     events) is touched.
--   * marine_document_counters keeps NO policies (deny-all to clients; only
--     the SECURITY DEFINER numbering function writes to it).
--   * Nothing outside marine_* is touched.
--
-- The RPC change rewrites ONLY the role check and its error message inside
-- each function's current definition (pg_get_functiondef), so every other
-- byte of the function bodies stays exactly as reviewed and tested. Each
-- rewrite asserts exactly one occurrence before and none after; any surprise
-- aborts the whole migration (it runs in one transaction).

-- ── 1. RLS policies ──────────────────────────────────────────────────────

-- Settings: read now Owner-only too (update was already Owner-only).
drop policy if exists marine_settings_select on public.marine_invoice_settings;
drop policy if exists marine_settings_owner_select on public.marine_invoice_settings;
create policy marine_settings_owner_select on public.marine_invoice_settings
  for select to authenticated using (has_minimum_role('stv-pos', 'owner'));
-- marine_settings_owner_update is unchanged (already has_minimum_role('stv-pos','owner')).

drop policy if exists marine_catalog_items_admin_all on public.marine_catalog_items;
drop policy if exists marine_catalog_items_owner_all on public.marine_catalog_items;
create policy marine_catalog_items_owner_all on public.marine_catalog_items
  for all to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_scope_templates_admin_all on public.marine_scope_templates;
drop policy if exists marine_scope_templates_owner_all on public.marine_scope_templates;
create policy marine_scope_templates_owner_all on public.marine_scope_templates
  for all to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_documents_admin_select on public.marine_documents;
drop policy if exists marine_documents_owner_select on public.marine_documents;
create policy marine_documents_owner_select on public.marine_documents
  for select to authenticated using (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_documents_admin_insert on public.marine_documents;
drop policy if exists marine_documents_owner_insert on public.marine_documents;
create policy marine_documents_owner_insert on public.marine_documents
  for insert to authenticated with check (has_minimum_role('stv-pos', 'owner'));

-- Content immutability, system-managed fields and status transitions are
-- still enforced by marine_documents_before_update().
drop policy if exists marine_documents_admin_update on public.marine_documents;
drop policy if exists marine_documents_owner_update on public.marine_documents;
create policy marine_documents_owner_update on public.marine_documents
  for update to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

-- Only unissued drafts can ever be deleted.
drop policy if exists marine_documents_admin_delete_draft on public.marine_documents;
drop policy if exists marine_documents_owner_delete_draft on public.marine_documents;
create policy marine_documents_owner_delete_draft on public.marine_documents
  for delete to authenticated
  using (has_minimum_role('stv-pos', 'owner') and status = 'DRAFT' and document_number is null);

drop policy if exists marine_document_items_admin_all on public.marine_document_items;
drop policy if exists marine_document_items_owner_all on public.marine_document_items;
create policy marine_document_items_owner_all on public.marine_document_items
  for all to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_document_scope_admin_all on public.marine_document_scope;
drop policy if exists marine_document_scope_owner_all on public.marine_document_scope;
create policy marine_document_scope_owner_all on public.marine_document_scope
  for all to authenticated
  using (has_minimum_role('stv-pos', 'owner'))
  with check (has_minimum_role('stv-pos', 'owner'));

drop policy if exists marine_document_events_admin_select on public.marine_document_events;
drop policy if exists marine_document_events_owner_select on public.marine_document_events;
create policy marine_document_events_owner_select on public.marine_document_events
  for select to authenticated using (has_minimum_role('stv-pos', 'owner'));

-- Clients may only log PDF downloads/reprints, as themselves.
drop policy if exists marine_document_events_admin_log_pdf on public.marine_document_events;
drop policy if exists marine_document_events_owner_log_pdf on public.marine_document_events;
create policy marine_document_events_owner_log_pdf on public.marine_document_events
  for insert to authenticated
  with check (
    has_minimum_role('stv-pos', 'owner')
    and event in ('PDF_DOWNLOADED','PDF_PRINTED')
    and actor_id = (select auth.uid())
    and related_document_id is null
  );

-- ── 2. RPC role checks ───────────────────────────────────────────────────
do $owner_only$
declare
  c_old_check constant text := 'has_minimum_role(''stv-pos'', ''admin'')';
  c_new_check constant text := 'has_minimum_role(''stv-pos'', ''owner'')';
  c_old_msg   constant text := 'Only an Owner/Admin can ';
  c_new_msg   constant text := 'Only the Owner can ';
  f   regprocedure;
  def text;
  n   int;
begin
  foreach f in array array[
    'public.save_marine_draft(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure,
    'public.issue_marine_document(uuid)'::regprocedure,
    'public.convert_marine_document(uuid, text)'::regprocedure,
    'public.revise_marine_document(uuid)'::regprocedure,
    'public.cancel_marine_document(uuid, text)'::regprocedure
  ] loop
    def := pg_get_functiondef(f);

    n := (length(def) - length(replace(def, c_old_check, ''))) / length(c_old_check);
    if n <> 1 then
      raise exception 'Expected exactly 1 admin check in %, found %. Aborting.', f, n;
    end if;
    n := (length(def) - length(replace(def, c_old_msg, ''))) / length(c_old_msg);
    if n <> 1 then
      raise exception 'Expected exactly 1 Owner/Admin message in %, found %. Aborting.', f, n;
    end if;

    def := replace(replace(def, c_old_check, c_new_check), c_old_msg, c_new_msg);
    execute def; -- CREATE OR REPLACE FUNCTION: owner, grants and SECURITY mode are preserved

    def := pg_get_functiondef(f);
    if position(c_old_check in def) > 0 or position(c_new_check in def) = 0 then
      raise exception 'Owner-only rewrite of % did not take effect. Aborting.', f;
    end if;
  end loop;
end;
$owner_only$;

-- ── 3. Final assertions ──────────────────────────────────────────────────
do $verify$
declare
  v_bad text;
begin
  -- No marine policy may still use any threshold other than owner.
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename like 'marine\_%'
     and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'has_minimum_role\(''stv-pos''::text, ''owner''::text\)';
  if v_bad is not null then
    raise exception 'Policies without the owner check remain: %', v_bad;
  end if;

  -- No marine function may still contain the admin threshold.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%marine%'
     and pg_get_functiondef(p.oid) like '%has_minimum_role(''stv-pos'', ''admin'')%';
  if v_bad is not null then
    raise exception 'Functions still allowing admin: %', v_bad;
  end if;

  -- Every marine table must still have RLS enabled.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'marine\_%' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'RLS is not enabled on: %', v_bad;
  end if;
end;
$verify$;
