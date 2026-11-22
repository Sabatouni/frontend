-- Minimal LOCAL stand-in for the Supabase platform pieces the stv-pos
-- migrations depend on. For running database tests in a throwaway local
-- PostgreSQL cluster ONLY -- never run this against a Supabase project.
--
-- Mirrors production (checked read-only on 2026-11-22):
--   * roles anon / authenticated / service_role
--   * auth.uid() from request.jwt.claims (same as Supabase)
--   * public default privileges: ALL on tables + EXECUTE on functions to
--     anon/authenticated/service_role (production pg_default_acl)
--   * RBAC tables + has_role / has_minimum_role / has_application_access,
--     function bodies copied verbatim from production
--   * role levels: owner 100, admin 80, developer 70, manager 60, editor 50,
--     moderator 40, support 40, worker 20, viewer 10
--   * storage.buckets / storage.objects (RLS on) / storage.foldername()
--
-- NOT reproduced: the real Storage API, GoTrue, PostgREST. Tests drive
-- storage.objects with SQL, the same way storage policies are evaluated.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  aud text,
  role text
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
    '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ── RBAC (shape of the production tables, columns used by the policies) ─
create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true
);
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  level integer not null
);
create table if not exists public.user_application_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  application_id uuid not null references public.applications(id),
  role_id uuid not null references public.roles(id),
  is_active boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.applications (slug, name) values ('stv-pos', 'Swahili Tent Village POS'), ('stv-web', 'Swahili Tent Village Web')
on conflict (slug) do nothing;
insert into public.roles (slug, name, level) values
  ('owner','Owner',100), ('admin','Admin',80), ('developer','Developer',70),
  ('manager','Manager',60), ('editor','Editor',50), ('moderator','Moderator',40),
  ('support','Support',40), ('worker','Worker',20), ('viewer','Viewer',10)
on conflict (slug) do nothing;

-- Verbatim from production.
CREATE OR REPLACE FUNCTION public.has_application_access(p_application_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.user_application_roles uar
    join public.applications a on a.id = uar.application_id
    where uar.user_id = auth.uid() and uar.is_active and a.slug = p_application_slug and a.is_active
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_minimum_role(p_application_slug text, p_role_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.user_application_roles uar
    join public.applications a on a.id = uar.application_id
    join public.roles r on r.id = uar.role_id
    cross join public.roles floor_role
    where uar.user_id = auth.uid() and uar.is_active and a.slug = p_application_slug and a.is_active
      and floor_role.slug = p_role_slug and r.level >= floor_role.level
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_role(p_application_slug text, p_role_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.user_application_roles uar
    join public.applications a on a.id = uar.application_id
    join public.roles r on r.id = uar.role_id
    where uar.user_id = auth.uid() and uar.is_active and a.slug = p_application_slug and a.is_active and r.slug = p_role_slug
  );
$function$;

-- ── storage ─────────────────────────────────────────────────────────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
