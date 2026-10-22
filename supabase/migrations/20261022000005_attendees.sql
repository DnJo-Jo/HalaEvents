-- HalaEvents 0009 — attendees: registration, application review, participation (P6, event.md §20).
-- Three independent status columns (communication delivery is a fourth, in 0010):
--   registration_status   invited | registered | withdrawn          (how the person relates to the event)
--   review_status         not_required | pending | needs_information | approved | rejected (application review)
--   participation_status  pending | accepted | waitlisted | rejected | confirmed | checked_in | cancelled
-- Capacity (accepted + confirmed + checked_in ≤ events.capacity) is enforced inside the functions below
-- under a row lock on the event, never with read-then-write code in the app.
-- Transition tables mirror src/modules/attendees/rules.ts (parity-tested).

alter table public.events add column requires_application boolean not null default false;
grant update (requires_application) on public.events to authenticated;

create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Minimal data: name, email, optional phone, optional short application note.
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null check (
    char_length(email) <= 254 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  phone text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  application_note text check (application_note is null or char_length(application_note) <= 1000),
  source text not null check (source in ('public_form', 'organizer')),
  registration_status text not null check (registration_status in ('invited', 'registered', 'withdrawn')),
  review_status text not null check (review_status in ('not_required', 'pending', 'needs_information', 'approved', 'rejected')),
  participation_status text not null default 'pending' check (participation_status in (
    'pending', 'accepted', 'waitlisted', 'rejected', 'confirmed', 'checked_in', 'cancelled'
  )),
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  consent_at timestamptz,
  registered_at timestamptz,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Registering through the public form requires the data-processing consent checkbox.
  constraint attendees_public_consent check (source <> 'public_form' or consent_at is not null),
  -- Only registered people can hold a place.
  constraint attendees_place_needs_registration check (
    participation_status in ('pending', 'rejected', 'cancelled') or registration_status = 'registered'
  )
);

-- Duplicate prevention: one live registration per email per event (withdrawn rows don't count).
create unique index attendees_one_per_email on public.attendees (event_id, email) where registration_status <> 'withdrawn';
create index attendees_event_status on public.attendees (event_id, participation_status);

create trigger attendees_updated_at before update on public.attendees
  for each row execute function public.set_updated_at();
create trigger attendees_audit after insert or delete on public.attendees
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger attendees_audit_status after update on public.attendees
  for each row when (
    old.registration_status is distinct from new.registration_status
    or old.review_status is distinct from new.review_status
    or old.participation_status is distinct from new.participation_status
  )
  execute function public.audit_row_change('id', 'event_id');

-- ---------------------------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------------------------
create function public.participation_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('pending', 'accepted'), ('pending', 'waitlisted'), ('pending', 'rejected'),
    ('waitlisted', 'accepted'), ('waitlisted', 'rejected'), ('waitlisted', 'cancelled'),
    ('accepted', 'confirmed'), ('accepted', 'cancelled'),
    ('confirmed', 'checked_in'), ('confirmed', 'cancelled'),
    ('rejected', 'pending')
  );
$$;

create function public.review_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('pending', 'approved'), ('pending', 'rejected'), ('pending', 'needs_information'),
    ('needs_information', 'pending'), ('needs_information', 'approved'), ('needs_information', 'rejected'),
    ('approved', 'pending'), ('rejected', 'pending')
  );
$$;

-- Places in use: accepted, confirmed and checked-in attendees.
create function public.event_places_taken(p_event_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.attendees
   where event_id = p_event_id and participation_status in ('accepted', 'confirmed', 'checked_in');
$$;

create function public.attendee_assert_manager(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.event_workspace_open(p_event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public registration (anon). Validates the slug, the open window and capacity under an event lock.
-- Without application review: accepted while places remain, otherwise waitlisted.
-- With application review: review pending, participation pending (an organizer decides).
-- A duplicate email returns 'already_registered' and changes nothing.
-- ---------------------------------------------------------------------------------------------
create function public.register_attendee(
  p_slug text, p_full_name text, p_email text, p_phone text, p_application_note text, p_consent boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_status text;
begin
  if not coalesce(p_consent, false) then
    raise exception 'consent_required' using errcode = '23514';
  end if;
  select * into v_event from public.events where published_slug = p_slug for update;
  if v_event.id is null or not v_event.registration_open or v_event.status not in ('planning', 'ready') then
    raise exception 'registration_closed' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.attendees where event_id = v_event.id and email = v_email and registration_status <> 'withdrawn'
  ) then
    -- An invited person registering through the form completes their registration.
    update public.attendees
       set registration_status = 'registered', registered_at = now(), consent_at = now(),
           full_name = btrim(p_full_name), phone = nullif(btrim(coalesce(p_phone, '')), ''),
           application_note = nullif(btrim(coalesce(p_application_note, '')), '')
     where event_id = v_event.id and email = v_email and registration_status = 'invited';
    if not found then
      return 'already_registered';
    end if;
    return 'registered';
  end if;

  if v_event.requires_application then
    v_status := 'pending';
  elsif public.event_places_taken(v_event.id) < v_event.capacity then
    v_status := 'accepted';
  else
    v_status := 'waitlisted';
  end if;
  insert into public.attendees (
    event_id, full_name, email, phone, application_note, source, registration_status, review_status,
    participation_status, consent_at, registered_at
  ) values (
    v_event.id, btrim(p_full_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_application_note, '')), ''), 'public_form', 'registered',
    case when v_event.requires_application then 'pending' else 'not_required' end, v_status, now(), now()
  );
  return v_status;
end $$;

-- What the public registration page shows: non-personal event facts, only while registration is open.
create function public.public_event_by_slug(p_slug text)
returns table (
  name text, starts_at timestamptz, ends_at timestamptz, timezone text, city text, venue_type text,
  requires_application boolean, places_left integer
)
language sql stable security definer set search_path = '' as $$
  select e.name, e.starts_at, e.ends_at, e.timezone, e.city, e.venue_type, e.requires_application,
         greatest(e.capacity - public.event_places_taken(e.id), 0)
    from public.events e
   where e.published_slug = p_slug and e.registration_open and e.status in ('planning', 'ready');
$$;

-- Organizer adds someone: invited (to send an invitation) or registered on their behalf.
create function public.add_attendee(
  p_event_id uuid, p_full_name text, p_email text, p_phone text, p_registered boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_requires boolean;
begin
  perform public.attendee_assert_manager(p_event_id);
  select requires_application into v_requires from public.events where id = p_event_id;
  insert into public.attendees (
    event_id, full_name, email, phone, source, registration_status, review_status, registered_at
  ) values (
    p_event_id, btrim(p_full_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''), 'organizer',
    case when p_registered then 'registered' else 'invited' end,
    case when v_requires then 'pending' else 'not_required' end,
    case when p_registered then now() end
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'duplicate_registration' using errcode = '23505';
end $$;

create function public.set_attendee_review(p_attendee_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.attendees;
begin
  select * into v_a from public.attendees where id = p_attendee_id for update;
  if v_a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.attendee_assert_manager(v_a.event_id);
  if not public.review_transition_allowed(v_a.review_status, p_status) then
    raise exception 'invalid_transition: review % -> %', v_a.review_status, p_status using errcode = '23514';
  end if;
  update public.attendees set review_status = p_status, decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_attendee_id;
end $$;

-- Participation decision. Entering a place is capacity-checked under the event lock; with review
-- required, only approved applications can be accepted. Returns the resulting status.
create function public.set_attendee_participation(p_attendee_id uuid, p_status text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.attendees;
  v_capacity integer;
begin
  select event_id into v_a.event_id from public.attendees where id = p_attendee_id;
  if v_a.event_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.attendee_assert_manager(v_a.event_id);
  -- Lock order: event, then attendee (same as register_attendee) so concurrent decisions serialize.
  select capacity into v_capacity from public.events where id = v_a.event_id for update;
  select * into v_a from public.attendees where id = p_attendee_id for update;
  if not public.participation_transition_allowed(v_a.participation_status, p_status) then
    raise exception 'invalid_transition: participation % -> %', v_a.participation_status, p_status using errcode = '23514';
  end if;
  if p_status = 'accepted' then
    if v_a.registration_status <> 'registered' then
      raise exception 'not_registered' using errcode = '23514';
    end if;
    if v_a.review_status not in ('not_required', 'approved') then
      raise exception 'review_not_approved' using errcode = '23514';
    end if;
    if public.event_places_taken(v_a.event_id) >= v_capacity then
      raise exception 'capacity_full' using errcode = '23514';
    end if;
  end if;
  if p_status = 'waitlisted' and v_a.registration_status <> 'registered' then
    raise exception 'not_registered' using errcode = '23514';
  end if;
  update public.attendees
     set participation_status = p_status,
         decision_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), decision_reason),
         confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
         checked_in_at = case when p_status = 'checked_in' then now() else checked_in_at end
   where id = p_attendee_id;
  return p_status;
end $$;

-- Withdrawal (on the attendee's request): frees the place; the row stays for history.
create function public.withdraw_attendee(p_attendee_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.attendees;
begin
  select * into v_a from public.attendees where id = p_attendee_id for update;
  if v_a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.attendee_assert_manager(v_a.event_id);
  if v_a.registration_status = 'withdrawn' or v_a.participation_status = 'checked_in' then
    raise exception 'invalid_transition: % cannot withdraw', v_a.participation_status using errcode = '23514';
  end if;
  update public.attendees
     set registration_status = 'withdrawn',
         participation_status = case when participation_status in ('rejected', 'cancelled') then participation_status else 'cancelled' end,
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_attendee_id;
end $$;

-- Capacity summary for every event member (counts only, no personal data).
create function public.event_attendance_summary(p_event_id uuid)
returns table (capacity integer, taken integer, waitlisted integer, pending integer, checked_in integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_event_member(p_event_id) or public.is_platform_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select e.capacity,
         public.event_places_taken(e.id),
         (select count(*)::integer from public.attendees a where a.event_id = e.id and a.participation_status = 'waitlisted'),
         (select count(*)::integer from public.attendees a where a.event_id = e.id and a.participation_status = 'pending' and a.registration_status = 'registered'),
         (select count(*)::integer from public.attendees a where a.event_id = e.id and a.participation_status = 'checked_in')
    from public.events e where e.id = p_event_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants. Attendee personal data: event owner/organizers only (not viewers, not providers).
-- ---------------------------------------------------------------------------------------------
alter table public.attendees enable row level security;
create policy attendees_select_manager on public.attendees for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
grant select on public.attendees to authenticated;

grant execute on function public.event_places_taken(uuid) to authenticated;
grant execute on function public.participation_transition_allowed(text, text) to authenticated;
grant execute on function public.review_transition_allowed(text, text) to authenticated;
grant execute on function public.add_attendee(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_attendee_review(uuid, text, text) to authenticated;
grant execute on function public.set_attendee_participation(uuid, text, text) to authenticated;
grant execute on function public.withdraw_attendee(uuid, text) to authenticated;
grant execute on function public.event_attendance_summary(uuid) to authenticated;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
-- The anon entry points (event.md §5.2, §20). Every later migration must repeat these lines after its
-- own trailing revoke; tests/db/schema.test.ts pins the exact list.
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
