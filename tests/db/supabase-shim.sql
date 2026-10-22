-- LOCAL TEST SHIM — NOT a Supabase database.
-- Recreates the parts of Supabase's platform schema that our migrations and RLS policies depend
-- on, so they can run inside PGlite (Postgres compiled to WASM) without Docker:
--   * API roles anon / authenticated / service_role (service_role bypasses RLS, as in Supabase)
--   * auth.users (minimal columns), auth.jwt(), auth.uid(), auth.role() reading request.jwt.claims
--     exactly the way PostgREST sets it per request
--   * Supabase's default privileges (ALL to API roles on new public objects), so the migrations'
--     revoke statements are exercised as they would be on the real platform.
-- Differences from real Supabase are listed in event.md §14.6.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
