-- HalaEvents 0002 — provider profiles (venues and service providers), private details, members.
-- Verification is a business state set only by platform admins via RPC; it is separate from the
-- members' account status (profiles.account_status).

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('venue', 'service')),
  category text not null check (
    category in ('venue', 'catering', 'av', 'security', 'photography', 'decor', 'transport', 'other')
  ),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (description is null or char_length(description) <= 2000),
  city text check (city is null or char_length(city) <= 80),
  country char(2) not null default 'AE' check (country ~ '^[A-Z]{2}$'),
  service_area text[] not null default '{}' check (cardinality(service_area) <= 50),
  min_capacity integer check (min_capacity is null or min_capacity > 0),
  max_capacity integer check (max_capacity is null or max_capacity > 0),
  price_min numeric(12, 2) check (price_min is null or price_min >= 0),
  price_max numeric(12, 2) check (price_max is null or price_max >= 0),
  currency char(3) not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  verification_status text not null default 'draft'
    check (verification_status in ('draft', 'submitted', 'verified', 'rejected', 'suspended')),
  verification_note text check (verification_note is null or char_length(verification_note) <= 1000),
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint providers_kind_matches_category check ((kind = 'venue') = (category = 'venue')),
  constraint providers_capacity_range check (
    min_capacity is null or max_capacity is null or min_capacity <= max_capacity
  ),
  constraint providers_price_range check (price_min is null or price_max is null or price_min <= price_max),
  constraint providers_verified_has_timestamp check (verification_status <> 'verified' or verified_at is not null)
);

create index providers_marketplace_idx on public.providers (category, verification_status);
create index providers_service_area_idx on public.providers using gin (service_area);

create trigger providers_updated_at before update on public.providers
  for each row execute function public.set_updated_at();

-- Private business/contact details: visible to the provider's own members and admins only.
create table public.provider_private (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  trade_license_number text check (trade_license_number is null or char_length(trade_license_number) <= 60),
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  updated_at timestamptz not null default now()
);

create trigger provider_private_updated_at before update on public.provider_private
  for each row execute function public.set_updated_at();

create table public.provider_members (
  provider_id uuid not null references public.providers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (provider_id, user_id)
);

create unique index provider_members_one_owner on public.provider_members (provider_id) where role = 'owner';
create index provider_members_user_idx on public.provider_members (user_id);

create function public.is_provider_member(p_provider_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.provider_members
     where provider_id = p_provider_id
       and user_id = auth.uid()
       and (p_roles is null or role = any (p_roles))
  );
$$;

-- Admin verification transitions (mirrors src/modules/profiles/rules.ts ADMIN_VERIFICATION_TRANSITIONS).
create function public.provider_verification_admin_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('submitted', 'verified'),
    ('submitted', 'rejected'),
    ('verified', 'suspended'),
    ('suspended', 'verified')
  );
$$;

create trigger providers_audit_insert after insert or delete on public.providers
  for each row execute function public.audit_row_change('id');
create trigger providers_audit_verification after update of verification_status on public.providers
  for each row when (old.verification_status is distinct from new.verification_status)
  execute function public.audit_row_change('id');
create trigger provider_members_audit after insert or update or delete on public.provider_members
  for each row execute function public.audit_row_change('provider_id');

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Creates provider + private details + owner membership atomically. Requires the matching account
-- role. New providers always start as 'draft' (verification columns are not parameters).
create function public.create_provider(
  p_kind text,
  p_category text,
  p_name text,
  p_description text default null,
  p_city text default null,
  p_service_area text[] default '{}',
  p_min_capacity integer default null,
  p_max_capacity integer default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_currency text default 'AED',
  p_contact_email text default null,
  p_contact_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if not public.has_account_role(case p_kind when 'venue' then 'venue_provider' else 'service_provider' end) then
    raise exception 'role_required' using errcode = '42501';
  end if;

  insert into public.providers (
    kind, category, name, description, city, service_area,
    min_capacity, max_capacity, price_min, price_max, currency, created_by
  ) values (
    p_kind, p_category, btrim(p_name), p_description, p_city, coalesce(p_service_area, '{}'),
    p_min_capacity, p_max_capacity, p_price_min, p_price_max, coalesce(p_currency, 'AED'), v_uid
  ) returning id into v_id;

  insert into public.provider_private (provider_id, contact_email, contact_phone)
  values (v_id, p_contact_email, p_contact_phone);

  insert into public.provider_members (provider_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

-- Owner submits for review: draft|rejected -> submitted. Requires a contact email.
create function public.submit_provider_for_verification(p_provider_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not public.is_provider_member(p_provider_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  select verification_status into v_status from public.providers where id = p_provider_id for update;
  if v_status not in ('draft', 'rejected') then
    raise exception 'invalid_transition: % -> submitted', v_status using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.provider_private where provider_id = p_provider_id and contact_email is not null
  ) then
    raise exception 'contact_email_required' using errcode = '22023';
  end if;
  update public.providers
     set verification_status = 'submitted', submitted_at = now(), verification_note = null
   where id = p_provider_id;
end $$;

-- Admin decision. Admins cannot verify a provider they are a member of (separation of duties).
create function public.set_provider_verification(p_provider_id uuid, p_status text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.is_provider_member(p_provider_id) then
    raise exception 'conflict_of_interest' using errcode = '42501';
  end if;
  select verification_status into v_status from public.providers where id = p_provider_id for update;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.provider_verification_admin_transition_allowed(v_status, p_status) then
    raise exception 'invalid_transition: % -> %', v_status, p_status using errcode = '23514';
  end if;
  if p_status in ('rejected', 'suspended') and coalesce(btrim(p_note), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.providers
     set verification_status = p_status,
         verification_note = nullif(btrim(p_note), ''),
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then auth.uid() else verified_by end
   where id = p_provider_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
alter table public.providers enable row level security;
alter table public.provider_private enable row level security;
alter table public.provider_members enable row level security;

-- Public marketplace data only for verified providers; members and admins see their own/all.
create policy providers_select on public.providers for select to authenticated
  using (
    verification_status = 'verified'
    or public.is_provider_member(id)
    or public.is_platform_admin()
  );
create policy providers_update_owner on public.providers for update to authenticated
  using (public.is_provider_member(id, array['owner']) and public.is_active_account())
  with check (public.is_provider_member(id, array['owner']));

create policy provider_private_select on public.provider_private for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_platform_admin());
create policy provider_private_update_owner on public.provider_private for update to authenticated
  using (public.is_provider_member(provider_id, array['owner']) and public.is_active_account())
  with check (public.is_provider_member(provider_id, array['owner']));

create policy provider_members_select on public.provider_members for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_platform_admin());

-- No insert grants: providers are created only through create_provider(). Verification columns,
-- kind and created_by are never updatable by API roles.
grant select on public.providers to authenticated;
grant update (
  category, name, description, city, country, service_area,
  min_capacity, max_capacity, price_min, price_max, currency
) on public.providers to authenticated;
grant select on public.provider_private to authenticated;
grant update (legal_name, trade_license_number, contact_email, contact_phone)
  on public.provider_private to authenticated;
grant select on public.provider_members to authenticated;

grant execute on function public.is_provider_member(uuid, text[]) to authenticated;
grant execute on function public.create_provider(
  text, text, text, text, text, text[], integer, integer, numeric, numeric, text, text, text
) to authenticated;
grant execute on function public.submit_provider_for_verification(uuid) to authenticated;
grant execute on function public.set_provider_verification(uuid, text, text) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
