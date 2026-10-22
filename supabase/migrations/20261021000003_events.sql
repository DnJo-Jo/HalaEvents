-- HalaEvents 0003 — events and event-scoped memberships (owner / organizer / viewer).

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 3 and 120),
  event_type text not null default 'university_hackathon' check (event_type in ('university_hackathon')),
  status text not null default 'draft'
    check (status in ('draft', 'planning', 'ready', 'live', 'completed', 'archived', 'cancelled')),
  venue_type text check (venue_type is null or venue_type in ('indoor', 'outdoor', 'hybrid', 'online')),
  location_text text check (location_text is null or char_length(location_text) <= 200),
  city text check (city is null or char_length(city) <= 80),
  country char(2) not null default 'AE' check (country ~ '^[A-Z]{2}$'),
  timezone text not null default 'Asia/Dubai' check (char_length(timezone) between 1 and 64),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 100000),
  budget_amount numeric(12, 2) check (budget_amount is null or budget_amount >= 0),
  currency char(3) not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  registration_open boolean not null default false,
  published_slug text unique check (
    published_slug is null or (published_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(published_slug) <= 80)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_order check (ends_at > starts_at)
);

create index events_owner_idx on public.events (owner_id);
create index events_status_idx on public.events (status, starts_at);

create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create table public.event_members (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'organizer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create unique index event_members_one_owner on public.event_members (event_id) where role = 'owner';
create index event_members_user_idx on public.event_members (user_id);

create function public.is_event_member(p_event_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_members
     where event_id = p_event_id
       and user_id = auth.uid()
       and (p_roles is null or role = any (p_roles))
  );
$$;

-- Lifecycle (mirrors src/modules/events/rules.ts EVENT_TRANSITIONS; event.md §4).
create function public.event_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('draft', 'planning'), ('draft', 'cancelled'),
    ('planning', 'ready'), ('planning', 'cancelled'),
    ('ready', 'live'), ('ready', 'planning'), ('ready', 'cancelled'),
    ('live', 'completed'),
    ('completed', 'archived')
  );
$$;

create function public.enforce_event_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
      raise exception 'invalid_timezone: %', new.timezone using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_immutable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not public.event_status_transition_allowed(old.status, new.status) then
      raise exception 'invalid_transition: % -> %', old.status, new.status using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger events_enforce_rules before insert or update on public.events
  for each row execute function public.enforce_event_rules();

-- The creator becomes the single owner, in the same transaction as the insert.
create function public.add_event_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_members (event_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return null;
end $$;

create trigger events_add_owner after insert on public.events
  for each row execute function public.add_event_owner();

create trigger events_audit after insert or delete on public.events
  for each row execute function public.audit_row_change('id', 'id');
create trigger events_audit_status after update of status on public.events
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'id');
create trigger event_members_audit after insert or update or delete on public.event_members
  for each row execute function public.audit_row_change('user_id', 'event_id');

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_members enable row level security;

-- owner_id = auth.uid() covers INSERT ... RETURNING, which is checked before the AFTER trigger
-- has added the owner membership row.
create policy events_select_member on public.events for select to authenticated
  using (owner_id = auth.uid() or public.is_event_member(id) or public.is_platform_admin());
create policy events_insert_organizer on public.events for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.has_account_role('organizer')
    and public.is_active_account()
  );
create policy events_update_manager on public.events for update to authenticated
  using (public.is_event_member(id, array['owner', 'organizer']) and public.is_active_account())
  with check (public.is_event_member(id, array['owner', 'organizer']));
create policy events_delete_owner_draft on public.events for delete to authenticated
  using (public.is_event_member(id, array['owner']) and status = 'draft' and public.is_active_account());

-- Members see the roster of events they belong to. Only the owner manages non-owner rows; the
-- owner row itself is never insertable/updatable/deletable through the API.
create policy event_members_select on public.event_members for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy event_members_insert_owner on public.event_members for insert to authenticated
  with check (role <> 'owner' and public.is_event_member(event_id, array['owner']) and public.is_active_account());
create policy event_members_update_owner on public.event_members for update to authenticated
  using (role <> 'owner' and public.is_event_member(event_id, array['owner']) and public.is_active_account())
  with check (role <> 'owner');
create policy event_members_delete_owner on public.event_members for delete to authenticated
  using (role <> 'owner' and public.is_event_member(event_id, array['owner']) and public.is_active_account());

-- Event managers can read the audit trail of their events.
create policy audit_log_select_event_manager on public.audit_log for select to authenticated
  using (event_id is not null and public.is_event_member(event_id, array['owner', 'organizer']));

-- New events are always 'draft' (status is not insertable); owner_id and event_type never change.
grant select, delete on public.events to authenticated;
grant insert (
  owner_id, name, event_type, venue_type, location_text, city, country, timezone,
  starts_at, ends_at, capacity, budget_amount, currency
) on public.events to authenticated;
grant update (
  name, status, venue_type, location_text, city, country, timezone,
  starts_at, ends_at, capacity, budget_amount, currency, registration_open, published_slug
) on public.events to authenticated;
grant select, insert, update (role), delete on public.event_members to authenticated;

grant execute on function public.is_event_member(uuid, text[]) to authenticated;
-- Called by the (invoker-rights) events trigger.
grant execute on function public.event_status_transition_allowed(text, text) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
