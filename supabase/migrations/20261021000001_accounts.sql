-- HalaEvents 0001 — accounts: profiles, account roles, platform admins, audit log, shared helpers.
-- See event.md §3, §5 and §14. Every table has RLS enabled; API roles get only explicit grants.

-- ---------------------------------------------------------------------------------------------
-- Default privileges: Supabase grants ALL on new public objects to anon/authenticated. Revoke that
-- so nothing is exposed unless a migration grants it explicitly (column-level where it matters).
-- ---------------------------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- PUBLIC's EXECUTE on functions is a *global* default that a schema-scoped ALTER DEFAULT PRIVILEGES
-- cannot remove, so revoke it globally too, and re-revoke explicitly at the end of every migration.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- profiles — one per auth user, created by trigger. account_status is moderation state and is
-- independent of any provider's verification status.
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  phone text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  locale text not null default 'en' check (locale in ('en', 'ar')),
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'deactivated')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_onboarded_requires_name check (onboarded_at is null or display_name is not null)
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- platform_admins — granted only by the database owner (SQL editor / service role). There is no
-- insert/update/delete grant or policy for any API role, so no user can make themselves admin.
-- ---------------------------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- user_roles — self-declared account roles (what the member wants to do). They gate which
-- actions are offered (create event, create provider); they grant no authority over others.
-- Platform administrator is deliberately NOT a value here.
-- ---------------------------------------------------------------------------------------------
create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('organizer', 'venue_provider', 'service_provider')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------------------------
-- Helpers used by policies. SECURITY DEFINER so they can read membership tables without
-- recursive RLS; they only ever answer questions about auth.uid().
-- ---------------------------------------------------------------------------------------------
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create function public.is_active_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where user_id = auth.uid() and account_status = 'active'
  );
$$;

create function public.has_account_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role);
$$;

-- ---------------------------------------------------------------------------------------------
-- New auth user -> empty profile. Nothing from client-supplied user metadata is trusted.
-- ---------------------------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- audit_log — append-only. Written only by the SECURITY DEFINER trigger below; no API role has
-- insert/update/delete privileges. actor_user_id has no FK so history survives user deletion.
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'system', 'ai')),
  entity_type text not null,
  entity_id text not null,
  event_id uuid,
  action text not null check (action ~ '^[a-z_.]+$'),
  before jsonb,
  after jsonb
);

create index audit_log_event_idx on public.audit_log (event_id, at desc) where event_id is not null;
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, at desc);

-- Trigger args: TG_ARGV[0] = column holding the entity id, TG_ARGV[1] (optional) = event id column.
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_event_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  if tg_nargs > 1 then v_event_id := (v_row ->> tg_argv[1])::uuid; end if;

  insert into public.audit_log (actor_user_id, actor_kind, entity_type, entity_id, event_id, action, before, after)
  values (
    auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    tg_table_name,
    v_row ->> tg_argv[0],
    v_event_id,
    lower(tg_op),
    v_old,
    v_new
  );
  return null;
end $$;

create trigger profiles_audit_status after update of account_status on public.profiles
  for each row when (old.account_status is distinct from new.account_status)
  execute function public.audit_row_change('user_id');
create trigger platform_admins_audit after insert or delete on public.platform_admins
  for each row execute function public.audit_row_change('user_id');
create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function public.audit_row_change('user_id');

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Profile completion: sets the profile and the chosen roles atomically for the caller only.
create function public.complete_onboarding(
  p_display_name text,
  p_phone text,
  p_locale text,
  p_roles text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'roles_required' using errcode = '22023';
  end if;

  update public.profiles
     set display_name = btrim(p_display_name),
         phone = nullif(btrim(p_phone), ''),
         locale = coalesce(p_locale, locale),
         onboarded_at = coalesce(onboarded_at, now())
   where user_id = v_uid;

  -- The CHECK on user_roles.role rejects anything outside the three self-service roles.
  insert into public.user_roles (user_id, role)
  select v_uid, r from unnest(p_roles) as r
  on conflict do nothing;
end $$;

-- Moderation: only platform admins; never on themselves (avoids accidental lock-out).
create function public.set_account_status(p_user_id uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_moderate_self' using errcode = '42501';
  end if;
  if p_status <> 'active' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.profiles
     set account_status = p_status,
         status_reason = nullif(btrim(p_reason), '')
   where user_id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select_own_or_admin on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid() and public.is_active_account())
  with check (user_id = auth.uid());

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
create policy user_roles_insert_own on public.user_roles for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_account());
create policy user_roles_delete_own on public.user_roles for delete to authenticated
  using (user_id = auth.uid() and public.is_active_account());

create policy audit_log_select_admin on public.audit_log for select to authenticated
  using (public.is_platform_admin());

-- Column-level: members may edit only these profile fields. account_status, status_reason and
-- onboarded_at change only through the RPCs above.
grant select on public.profiles to authenticated;
grant update (display_name, phone, locale) on public.profiles to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant select on public.audit_log to authenticated;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_active_account() to authenticated;
grant execute on function public.has_account_role(text) to authenticated;
grant execute on function public.complete_onboarding(text, text, text, text[]) to authenticated;
grant execute on function public.set_account_status(uuid, text, text) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
