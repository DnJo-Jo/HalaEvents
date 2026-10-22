-- HalaEvents 0004 — provider marketplace: richer provider profiles, venue details, services,
-- credentials, separate moderation state, shortlists, service requests, questions and quotes.
-- A quote is never a booking (bookings arrive in P10). Listed availability is a statement by the
-- provider, never live availability.

-- ---------------------------------------------------------------------------------------------
-- Providers: moderation becomes its own state (verification no longer contains 'suspended').
-- ---------------------------------------------------------------------------------------------
alter table public.providers
  add column pricing_model text not null default 'quote_only'
    check (pricing_model in ('per_person', 'per_hour', 'per_day', 'per_event', 'quote_only')),
  add column capabilities text[] not null default '{}' check (cardinality(capabilities) <= 40),
  add column availability_note text check (availability_note is null or char_length(availability_note) <= 500),
  add column website text check (website is null or (website ~ '^https://[^\s]+$' and char_length(website) <= 200)),
  add column is_listed boolean not null default true,
  add column moderation_status text not null default 'active'
    check (moderation_status in ('active', 'hidden', 'suspended')),
  add column moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 1000),
  add column is_demo boolean not null default false;

-- Existing 'suspended' verification rows keep their verification and become moderation-suspended.
alter table public.providers drop constraint providers_verification_status_check;
alter table public.providers drop constraint providers_verified_has_timestamp;
update public.providers
   set verification_status = 'verified', moderation_status = 'suspended',
       moderation_reason = coalesce(verification_note, 'Suspended before moderation was split out')
 where verification_status = 'suspended';
alter table public.providers add constraint providers_verification_status_check
  check (verification_status in ('draft', 'submitted', 'verified', 'rejected'));
alter table public.providers add constraint providers_verified_has_timestamp
  check (verification_status <> 'verified' or verified_at is not null);

alter table public.providers drop constraint providers_category_check;
alter table public.providers add constraint providers_category_check check (
  category in ('venue', 'catering', 'av', 'security', 'photography', 'decor', 'transport', 'cleaning', 'other')
);

create index providers_public_idx on public.providers (category)
  where verification_status = 'verified' and moderation_status = 'active' and is_listed;

drop function public.provider_verification_admin_transition_allowed(text, text);
create function public.provider_verification_admin_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (('submitted', 'verified'), ('submitted', 'rejected'));
$$;

-- Moderation transitions (mirrors MODERATION_TRANSITIONS in src/modules/profiles/rules.ts).
create function public.provider_moderation_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('active', 'hidden'), ('active', 'suspended'),
    ('hidden', 'active'), ('hidden', 'suspended'),
    ('suspended', 'active')
  );
$$;

create or replace function public.set_provider_verification(p_provider_id uuid, p_status text, p_note text)
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
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.providers
     set verification_status = p_status,
         verification_note = nullif(btrim(p_note), ''),
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then auth.uid() else verified_by end
   where id = p_provider_id;
end $$;

create function public.set_provider_moderation(p_provider_id uuid, p_status text, p_reason text)
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
  select moderation_status into v_status from public.providers where id = p_provider_id for update;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.provider_moderation_transition_allowed(v_status, p_status) then
    raise exception 'invalid_transition: % -> %', v_status, p_status using errcode = '23514';
  end if;
  if p_status <> 'active' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.providers
     set moderation_status = p_status, moderation_reason = nullif(btrim(p_reason), '')
   where id = p_provider_id;
end $$;

create trigger providers_audit_moderation after update of moderation_status on public.providers
  for each row when (old.moderation_status is distinct from new.moderation_status)
  execute function public.audit_row_change('id');

-- Listed in the marketplace = verified by an admin, not moderated, and not paused by the owner.
create function public.provider_is_public(p_provider_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.providers
     where id = p_provider_id
       and verification_status = 'verified' and moderation_status = 'active' and is_listed
  );
$$;

-- Can receive service requests: publicly listed AND has at least one member to respond. Seeded demo
-- providers have no members, so they can be browsed and shortlisted but never sent a request.
create function public.provider_can_receive_requests(p_provider_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.provider_is_public(p_provider_id)
     and exists (select 1 from public.provider_members where provider_id = p_provider_id);
$$;

-- ---------------------------------------------------------------------------------------------
-- Venue details (only for kind = 'venue')
-- ---------------------------------------------------------------------------------------------
create table public.venue_profiles (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  setting text not null default 'indoor' check (setting in ('indoor', 'outdoor', 'mixed')),
  seated_capacity integer check (seated_capacity is null or seated_capacity > 0),
  standing_capacity integer check (standing_capacity is null or standing_capacity > 0),
  address_text text check (address_text is null or char_length(address_text) <= 300),
  area text check (area is null or char_length(area) <= 80),
  access_conditions text check (access_conditions is null or char_length(access_conditions) <= 1000),
  accessibility text[] not null default '{}' check (
    accessibility <@ array['step_free', 'accessible_toilets', 'lift', 'hearing_loop', 'accessible_parking']::text[]
  ),
  suitability text[] not null default '{}' check (
    suitability <@ array['hackathon', 'conference', 'workshop', 'exhibition', 'social', 'ceremony']::text[]
  ),
  updated_at timestamptz not null default now()
);

create trigger venue_profiles_updated_at before update on public.venue_profiles
  for each row execute function public.set_updated_at();

create function public.enforce_venue_profile_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.providers where id = new.provider_id and kind = 'venue') then
    raise exception 'venue_profile_requires_venue' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger venue_profiles_kind before insert or update on public.venue_profiles
  for each row execute function public.enforce_venue_profile_kind();

-- ---------------------------------------------------------------------------------------------
-- Service listings (flexible model for every category, including venue packages)
-- ---------------------------------------------------------------------------------------------
create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  category text not null check (
    category in ('venue', 'catering', 'av', 'security', 'photography', 'decor', 'transport', 'cleaning', 'other')
  ),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 2000),
  pricing_model text not null default 'quote_only'
    check (pricing_model in ('per_person', 'per_hour', 'per_day', 'per_event', 'quote_only')),
  price_from numeric(12, 2) check (price_from is null or price_from >= 0),
  price_to numeric(12, 2) check (price_to is null or price_to >= 0),
  currency char(3) not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  min_quantity integer check (min_quantity is null or min_quantity > 0),
  max_quantity integer check (max_quantity is null or max_quantity > 0),
  inclusions text[] not null default '{}' check (cardinality(inclusions) <= 30),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_services_price_range check (price_from is null or price_to is null or price_from <= price_to),
  constraint provider_services_quantity_range check (min_quantity is null or max_quantity is null or min_quantity <= max_quantity),
  constraint provider_services_quote_only_no_price check (pricing_model <> 'quote_only' or (price_from is null and price_to is null))
);

create index provider_services_provider_idx on public.provider_services (provider_id);
create index provider_services_category_idx on public.provider_services (category) where is_active;

create trigger provider_services_updated_at before update on public.provider_services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Credentials (metadata + reference numbers; file storage is not wired yet — see event.md §15)
-- ---------------------------------------------------------------------------------------------
create table public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  kind text not null check (
    kind in ('trade_license', 'insurance', 'food_safety', 'security_license', 'venue_permit', 'other')
  ),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  reference_number text check (reference_number is null or char_length(reference_number) <= 80),
  issued_by text check (issued_by is null or char_length(issued_by) <= 120),
  expires_on date,
  review_status text not null default 'submitted' check (review_status in ('submitted', 'accepted', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index provider_documents_provider_idx on public.provider_documents (provider_id);

create trigger provider_documents_audit after update of review_status on public.provider_documents
  for each row when (old.review_status is distinct from new.review_status)
  execute function public.audit_row_change('id');

create function public.review_provider_document(p_document_id uuid, p_status text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_provider uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select provider_id into v_provider from public.provider_documents where id = p_document_id for update;
  if v_provider is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if public.is_provider_member(v_provider) then
    raise exception 'conflict_of_interest' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'rejected') then
    raise exception 'invalid_transition: -> %', p_status using errcode = '23514';
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.provider_documents
     set review_status = p_status, review_note = nullif(btrim(p_note), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_document_id;
end $$;

-- Owners may correct a document's details; any edit puts it back to 'submitted' for review.
create function public.reset_document_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.kind, new.title, new.reference_number, new.issued_by, new.expires_on)
     is distinct from (old.kind, old.title, old.reference_number, old.issued_by, old.expires_on) then
    new.review_status := 'submitted';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end $$;

create trigger provider_documents_reset_review before update on public.provider_documents
  for each row execute function public.reset_document_review();

-- ---------------------------------------------------------------------------------------------
-- Shortlists (event-scoped)
-- ---------------------------------------------------------------------------------------------
create table public.event_shortlists (
  event_id uuid not null references public.events (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  note text check (note is null or char_length(note) <= 500),
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (event_id, provider_id)
);

create index event_shortlists_provider_idx on public.event_shortlists (provider_id);

-- ---------------------------------------------------------------------------------------------
-- Service requests, invitations, question threads, quotes
-- ---------------------------------------------------------------------------------------------
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Snapshot shown to invited providers, who have no access to the organizer's events row.
  event_name text not null,
  event_city text,
  timezone text not null,
  created_by uuid references auth.users (id) on delete set null,
  category text not null check (
    category in ('venue', 'catering', 'av', 'security', 'photography', 'decor', 'transport', 'cleaning', 'other')
  ),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  requirements text not null check (char_length(btrim(requirements)) between 10 and 4000),
  needed_from timestamptz not null,
  needed_to timestamptz not null,
  expected_attendance integer not null check (expected_attendance between 1 and 100000),
  budget_max numeric(12, 2) check (budget_max is null or budget_max >= 0),
  currency char(3) not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  respond_by timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_requests_window check (needed_to > needed_from)
);

create index service_requests_event_idx on public.service_requests (event_id, created_at desc);

create trigger service_requests_updated_at before update on public.service_requests
  for each row execute function public.set_updated_at();

create table public.service_request_invites (
  request_id uuid not null references public.service_requests (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'declined')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (request_id, provider_id)
);

create index service_request_invites_provider_idx on public.service_request_invites (provider_id);

-- One thread per (request, provider): the organizer side and that provider only.
create table public.service_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  provider_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  author_side text not null check (author_side in ('organizer', 'provider')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (request_id, provider_id) references public.service_request_invites (request_id, provider_id) on delete cascade
);

create index service_request_messages_thread_idx on public.service_request_messages (request_id, provider_id, created_at);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  provider_id uuid not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency char(3) not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  inclusions text not null check (char_length(btrim(inclusions)) between 1 and 4000),
  exclusions text check (exclusions is null or char_length(exclusions) <= 4000),
  conditions text check (conditions is null or char_length(conditions) <= 4000),
  valid_until timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn', 'declined')),
  revision integer not null default 0 check (revision >= 0),
  submitted_at timestamptz,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, provider_id),
  foreign key (request_id, provider_id) references public.service_request_invites (request_id, provider_id) on delete cascade
);

create trigger quotes_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

create trigger service_requests_audit after insert or delete on public.service_requests
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger service_requests_audit_status after update of status on public.service_requests
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');
create trigger service_request_invites_audit after insert or update on public.service_request_invites
  for each row execute function public.audit_row_change('provider_id');
create trigger quotes_audit after insert or update of status, revision on public.quotes
  for each row execute function public.audit_row_change('id');

-- Transitions (mirror src/modules/marketplace/rules.ts; parity is tested).
create function public.service_request_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (('open', 'closed'), ('open', 'cancelled'), ('closed', 'open'), ('closed', 'cancelled'));
$$;

create function public.quote_transition_allowed(p_from text, p_to text, p_actor text)
returns boolean
language sql immutable set search_path = '' as $$
  select case p_actor
    when 'provider' then (p_from, p_to) in (
      ('draft', 'draft'), ('draft', 'submitted'), ('draft', 'withdrawn'),
      ('submitted', 'submitted'), ('submitted', 'withdrawn'),
      ('withdrawn', 'draft'), ('withdrawn', 'submitted')
    )
    when 'organizer' then (p_from, p_to) in (('submitted', 'declined'))
    else false
  end;
$$;

-- Helpers (SECURITY DEFINER, about auth.uid() only).
create function public.request_event_id(p_request_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select event_id from public.service_requests where id = p_request_id;
$$;

create function public.is_request_manager(p_request_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_event_member(public.request_event_id(p_request_id), array['owner', 'organizer']);
$$;

create function public.is_invited_provider_member(p_request_id uuid, p_provider_id uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.service_request_invites i
      join public.provider_members m on m.provider_id = i.provider_id and m.user_id = auth.uid()
     where i.request_id = p_request_id and (p_provider_id is null or i.provider_id = p_provider_id)
  );
$$;

-- Organizers may see providers they invited (even if later hidden), to keep quotes readable.
create function public.provider_invited_by_me(p_provider_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.service_request_invites i
      join public.service_requests r on r.id = i.request_id
     where i.provider_id = p_provider_id
       and public.is_event_member(r.event_id, array['owner', 'organizer'])
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------
create function public.create_service_request(
  p_event_id uuid,
  p_category text,
  p_title text,
  p_requirements text,
  p_needed_from timestamptz,
  p_needed_to timestamptz,
  p_expected_attendance integer,
  p_budget_max numeric,
  p_currency text,
  p_respond_by timestamptz,
  p_provider_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_event public.events;
  v_pid uuid;
begin
  if not public.is_event_member(p_event_id, array['owner', 'organizer']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if v_event.status not in ('draft', 'planning', 'ready', 'live') then
    raise exception 'event_not_active' using errcode = '22023';
  end if;
  if p_provider_ids is null or cardinality(p_provider_ids) = 0 or cardinality(p_provider_ids) > 10 then
    raise exception 'providers_required_max_10' using errcode = '22023';
  end if;
  if p_respond_by is not null and p_respond_by <= now() then
    raise exception 'respond_by_in_past' using errcode = '22023';
  end if;

  insert into public.service_requests (
    event_id, event_name, event_city, timezone, created_by, category, title, requirements,
    needed_from, needed_to, expected_attendance, budget_max, currency, respond_by
  ) values (
    p_event_id, v_event.name, v_event.city, v_event.timezone, auth.uid(), p_category, btrim(p_title),
    btrim(p_requirements), p_needed_from, p_needed_to, p_expected_attendance, p_budget_max,
    coalesce(p_currency, 'AED'), p_respond_by
  ) returning id into v_id;

  foreach v_pid in array p_provider_ids loop
    if not public.provider_can_receive_requests(v_pid) then
      raise exception 'provider_not_available: %', v_pid using errcode = '22023';
    end if;
    insert into public.service_request_invites (request_id, provider_id) values (v_id, v_pid)
    on conflict do nothing;
  end loop;
  return v_id;
end $$;

create function public.invite_providers(p_request_id uuid, p_provider_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid;
  v_status text;
begin
  if not public.is_request_manager(p_request_id) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.service_requests where id = p_request_id for update;
  if v_status <> 'open' then
    raise exception 'request_not_open' using errcode = '23514';
  end if;
  if (select count(*) from public.service_request_invites where request_id = p_request_id)
     + cardinality(p_provider_ids) > 10 then
    raise exception 'providers_required_max_10' using errcode = '22023';
  end if;
  foreach v_pid in array p_provider_ids loop
    if not public.provider_can_receive_requests(v_pid) then
      raise exception 'provider_not_available: %', v_pid using errcode = '22023';
    end if;
    insert into public.service_request_invites (request_id, provider_id) values (p_request_id, v_pid)
    on conflict do nothing;
  end loop;
end $$;

create function public.set_service_request_status(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not public.is_request_manager(p_request_id) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.service_requests where id = p_request_id for update;
  if not public.service_request_transition_allowed(v_status, p_status) then
    raise exception 'invalid_transition: % -> %', v_status, p_status using errcode = '23514';
  end if;
  update public.service_requests set status = p_status where id = p_request_id;
end $$;

create function public.decline_service_request(p_request_id uuid, p_provider_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invite_status text;
begin
  if not public.is_provider_member(p_provider_id) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_invite_status from public.service_request_invites
   where request_id = p_request_id and provider_id = p_provider_id for update;
  if v_invite_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_invite_status <> 'invited' then
    raise exception 'invalid_transition: % -> declined', v_invite_status using errcode = '23514';
  end if;
  if exists (
    select 1 from public.quotes where request_id = p_request_id and provider_id = p_provider_id and status = 'submitted'
  ) then
    raise exception 'withdraw_quote_first' using errcode = '23514';
  end if;
  update public.service_request_invites
     set status = 'declined', decline_reason = nullif(btrim(p_reason), ''), responded_at = now()
   where request_id = p_request_id and provider_id = p_provider_id;
end $$;

create function public.post_request_message(p_request_id uuid, p_provider_id uuid, p_side text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.service_request_invites where request_id = p_request_id and provider_id = p_provider_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_side = 'provider' and not public.is_provider_member(p_provider_id) then
    raise exception 'forbidden' using errcode = '42501';
  elsif p_side = 'organizer' and not public.is_request_manager(p_request_id) then
    raise exception 'forbidden' using errcode = '42501';
  elsif p_side not in ('provider', 'organizer') then
    raise exception 'invalid_side' using errcode = '22023';
  end if;
  if (select status from public.service_requests where id = p_request_id) = 'cancelled' then
    raise exception 'request_cancelled' using errcode = '23514';
  end if;
  insert into public.service_request_messages (request_id, provider_id, author_id, author_side, body)
  values (p_request_id, p_provider_id, auth.uid(), p_side, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

-- Create or revise the caller's quote. p_submit = false keeps/makes it a draft.
create function public.save_quote(
  p_request_id uuid,
  p_provider_id uuid,
  p_amount numeric,
  p_currency text,
  p_inclusions text,
  p_exclusions text,
  p_conditions text,
  p_valid_until timestamptz,
  p_submit boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_quote public.quotes;
  v_target text := case when p_submit then 'submitted' else 'draft' end;
  v_request_status text;
  v_invite_status text;
begin
  if not public.is_provider_member(p_provider_id) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_invite_status from public.service_request_invites
   where request_id = p_request_id and provider_id = p_provider_id;
  if v_invite_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_invite_status = 'declined' then
    raise exception 'request_declined' using errcode = '23514';
  end if;
  select status into v_request_status from public.service_requests where id = p_request_id for update;
  if v_request_status <> 'open' then
    raise exception 'request_not_open' using errcode = '23514';
  end if;
  if p_valid_until <= now() then
    raise exception 'valid_until_in_past' using errcode = '22023';
  end if;

  select * into v_quote from public.quotes
   where request_id = p_request_id and provider_id = p_provider_id for update;

  if v_quote.id is null then
    if not public.quote_transition_allowed('draft', v_target, 'provider') then
      raise exception 'invalid_transition: new -> %', v_target using errcode = '23514';
    end if;
    insert into public.quotes (
      request_id, provider_id, amount, currency, inclusions, exclusions, conditions, valid_until,
      status, revision, submitted_at, created_by
    ) values (
      p_request_id, p_provider_id, p_amount, coalesce(p_currency, 'AED'), btrim(p_inclusions),
      nullif(btrim(p_exclusions), ''), nullif(btrim(p_conditions), ''), p_valid_until,
      v_target, case when p_submit then 1 else 0 end, case when p_submit then now() end, auth.uid()
    ) returning id into v_quote.id;
    return v_quote.id;
  end if;

  if not public.quote_transition_allowed(v_quote.status, v_target, 'provider') then
    raise exception 'invalid_transition: % -> %', v_quote.status, v_target using errcode = '23514';
  end if;
  update public.quotes
     set amount = p_amount, currency = coalesce(p_currency, 'AED'), inclusions = btrim(p_inclusions),
         exclusions = nullif(btrim(p_exclusions), ''), conditions = nullif(btrim(p_conditions), ''),
         valid_until = p_valid_until, status = v_target,
         revision = case when p_submit then v_quote.revision + 1 else v_quote.revision end,
         submitted_at = case when p_submit then now() else v_quote.submitted_at end,
         decline_reason = null
   where id = v_quote.id;
  return v_quote.id;
end $$;

create function public.withdraw_quote(p_quote_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if v_quote.id is null or not public.is_provider_member(v_quote.provider_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if not public.quote_transition_allowed(v_quote.status, 'withdrawn', 'provider') then
    raise exception 'invalid_transition: % -> withdrawn', v_quote.status using errcode = '23514';
  end if;
  update public.quotes set status = 'withdrawn' where id = p_quote_id;
end $$;

create function public.decline_quote(p_quote_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if v_quote.id is null or not public.is_request_manager(v_quote.request_id) or v_quote.status = 'draft' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_active_account() then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if not public.quote_transition_allowed(v_quote.status, 'declined', 'organizer') then
    raise exception 'invalid_transition: % -> declined', v_quote.status using errcode = '23514';
  end if;
  update public.quotes set status = 'declined', decline_reason = nullif(btrim(p_reason), '') where id = p_quote_id;
end $$;

-- Directory search. SECURITY INVOKER: RLS on providers decides visibility; the explicit public
-- filter additionally keeps a member's own unlisted providers out of marketplace results.
create function public.search_providers(
  p_query text default null,
  p_category text default null,
  p_city text default null,
  p_attendance integer default null,
  p_budget numeric default null,
  p_limit integer default 24,
  p_offset integer default 0
) returns setof public.providers
language sql stable security invoker set search_path = '' as $$
  select p.* from public.providers p
   where p.verification_status = 'verified' and p.moderation_status = 'active' and p.is_listed
     and (p_category is null or p.category = p_category or exists (
           select 1 from public.provider_services s
            where s.provider_id = p.id and s.is_active and s.category = p_category))
     and (p_city is null or lower(p.city) = lower(p_city)
          or exists (select 1 from unnest(p.service_area) a where lower(a) = lower(p_city)))
     and (p_attendance is null or (
           (p.min_capacity is null or p.min_capacity <= p_attendance)
           and (p.max_capacity is null or p.max_capacity >= p_attendance)))
     and (p_budget is null or p.price_min is null or p.price_min <= p_budget)
     and (p_query is null or p.name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or p.description ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by p.is_demo, p.name, p.id
   limit least(greatest(coalesce(p_limit, 24), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------
drop policy providers_select on public.providers;
create policy providers_select on public.providers for select to authenticated
  using (
    (verification_status = 'verified' and moderation_status = 'active' and is_listed)
    or public.is_provider_member(id)
    or public.provider_invited_by_me(id)
    or public.is_platform_admin()
  );

alter table public.venue_profiles enable row level security;
alter table public.provider_services enable row level security;
alter table public.provider_documents enable row level security;
alter table public.event_shortlists enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_request_invites enable row level security;
alter table public.service_request_messages enable row level security;
alter table public.quotes enable row level security;

-- Public listing details follow the provider's own visibility.
create policy venue_profiles_select on public.venue_profiles for select to authenticated
  using (exists (select 1 from public.providers p where p.id = provider_id));
create policy venue_profiles_insert_owner on public.venue_profiles for insert to authenticated
  with check (public.is_provider_member(provider_id, array['owner']) and public.is_active_account());
create policy venue_profiles_update_owner on public.venue_profiles for update to authenticated
  using (public.is_provider_member(provider_id, array['owner']) and public.is_active_account())
  with check (public.is_provider_member(provider_id, array['owner']));

create policy provider_services_select on public.provider_services for select to authenticated
  using (
    (is_active and exists (select 1 from public.providers p where p.id = provider_id))
    or public.is_provider_member(provider_id)
    or public.is_platform_admin()
  );
create policy provider_services_write_owner on public.provider_services for all to authenticated
  using (public.is_provider_member(provider_id, array['owner']) and public.is_active_account())
  with check (public.is_provider_member(provider_id, array['owner']) and public.is_active_account());

-- Credentials: provider members and admins only, never other members.
create policy provider_documents_select on public.provider_documents for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_platform_admin());
create policy provider_documents_insert_owner on public.provider_documents for insert to authenticated
  with check (
    public.is_provider_member(provider_id, array['owner']) and public.is_active_account()
    and review_status = 'submitted'
  );
create policy provider_documents_update_owner on public.provider_documents for update to authenticated
  using (public.is_provider_member(provider_id, array['owner']) and public.is_active_account())
  with check (public.is_provider_member(provider_id, array['owner']));
create policy provider_documents_delete_owner on public.provider_documents for delete to authenticated
  using (public.is_provider_member(provider_id, array['owner']) and public.is_active_account());

create policy event_shortlists_select on public.event_shortlists for select to authenticated
  using (public.is_event_member(event_id));
create policy event_shortlists_insert on public.event_shortlists for insert to authenticated
  with check (
    public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account()
    and public.provider_is_public(provider_id)
  );
create policy event_shortlists_update on public.event_shortlists for update to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account())
  with check (public.is_event_member(event_id, array['owner', 'organizer']));
create policy event_shortlists_delete on public.event_shortlists for delete to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account());

-- Requests: event managers see their requests; invited providers' members see the request.
create policy service_requests_select on public.service_requests for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_invited_provider_member(id));

-- Invites: managers see all invites of their request; a provider sees only its own invite row.
create policy service_request_invites_select on public.service_request_invites for select to authenticated
  using (public.is_request_manager(request_id) or public.is_provider_member(provider_id));

-- Threads: the organizer side and that one provider.
create policy service_request_messages_select on public.service_request_messages for select to authenticated
  using (public.is_request_manager(request_id) or public.is_provider_member(provider_id));

-- Quotes: the quoting provider's members; organizers (owner/organizer, not viewers) see non-draft
-- quotes of their requests — that is the authorized comparison view. Other providers see nothing.
create policy quotes_select on public.quotes for select to authenticated
  using (
    public.is_provider_member(provider_id)
    or (status <> 'draft' and public.is_request_manager(request_id))
  );

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
grant update (pricing_model, capabilities, availability_note, website, is_listed) on public.providers to authenticated;
grant select, insert, update on public.venue_profiles to authenticated;
grant select, insert, update, delete on public.provider_services to authenticated;
grant select, delete on public.provider_documents to authenticated;
grant insert (provider_id, kind, title, reference_number, issued_by, expires_on)
  on public.provider_documents to authenticated;
grant update (kind, title, reference_number, issued_by, expires_on) on public.provider_documents to authenticated;
grant select, insert (event_id, provider_id, note), update (note), delete on public.event_shortlists to authenticated;
grant select on public.service_requests, public.service_request_invites,
  public.service_request_messages, public.quotes to authenticated;

grant execute on function public.provider_is_public(uuid) to authenticated;
grant execute on function public.provider_can_receive_requests(uuid) to authenticated;
grant execute on function public.set_provider_moderation(uuid, text, text) to authenticated;
grant execute on function public.review_provider_document(uuid, text, text) to authenticated;
grant execute on function public.is_request_manager(uuid) to authenticated;
grant execute on function public.is_invited_provider_member(uuid, uuid) to authenticated;
grant execute on function public.provider_invited_by_me(uuid) to authenticated;
grant execute on function public.create_service_request(
  uuid, text, text, text, timestamptz, timestamptz, integer, numeric, text, timestamptz, uuid[]
) to authenticated;
grant execute on function public.invite_providers(uuid, uuid[]) to authenticated;
grant execute on function public.set_service_request_status(uuid, text) to authenticated;
grant execute on function public.decline_service_request(uuid, uuid, text) to authenticated;
grant execute on function public.post_request_message(uuid, uuid, text, text) to authenticated;
grant execute on function public.save_quote(uuid, uuid, numeric, text, text, text, text, timestamptz, boolean)
  to authenticated;
grant execute on function public.withdraw_quote(uuid) to authenticated;
grant execute on function public.decline_quote(uuid, text) to authenticated;
grant execute on function public.search_providers(text, text, text, integer, numeric, integer, integer)
  to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
