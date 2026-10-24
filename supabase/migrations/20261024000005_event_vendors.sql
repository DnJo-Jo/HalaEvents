-- HalaEvents 0022 — service selection and vendor shortlist (event.md §16.5).
-- events.services: which of venue / catering / transport the organizer needs (empty = none, so
-- existing events are unaffected). event_vendor_shortlist: candidate businesses the organizer kept
-- from a discovery search, as a snapshot of what the provider returned (never edited or invented
-- here) plus the organizer's own note. A shortlist entry is a candidate only: no quote, availability
-- or booking. Both are written only through the functions below (owner/organizer, active account).
alter table public.events add column services text[] not null default '{}'
  check (services <@ array['venue', 'catering', 'transport']::text[]);

create table public.event_vendor_shortlist (
  event_id uuid not null references public.events (id) on delete cascade,
  category text not null check (category in ('venue', 'catering', 'transport')),
  place_id text not null check (char_length(place_id) between 1 and 400),
  source text not null default 'geoapify' check (source = 'geoapify'),
  name text not null check (char_length(name) between 1 and 200),
  address text check (address is null or char_length(address) <= 400),
  phone text check (phone is null or char_length(phone) <= 60),
  website text check (website is null or (char_length(website) <= 500 and website ~ '^https?://')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (event_id, category, place_id)
);

alter table public.event_vendor_shortlist enable row level security;
create policy vendor_shortlist_select_member on public.event_vendor_shortlist for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
revoke all on public.event_vendor_shortlist from public, anon, authenticated;
grant select on public.event_vendor_shortlist to authenticated;

-- Shared guard: signed in, owner/organizer of the event, active account, event in an open status.
create function public.assert_vendor_editor(p_event_id uuid, p_statuses text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.events where id = p_event_id for update;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (v_status = any (p_statuses)) then
    raise exception 'interview_locked: %', v_status using errcode = '23514';
  end if;
end $$;

create function public.save_event_services(p_event_id uuid, p_services text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_services text[] := coalesce((select array_agg(distinct s order by s) from unnest(p_services) s), '{}');
begin
  perform public.assert_vendor_editor(p_event_id, array['draft', 'planning', 'ready']);
  update public.events set services = v_services where id = p_event_id;
end $$;

create function public.shortlist_vendor(
  p_event_id uuid, p_category text, p_place_id text, p_name text, p_address text,
  p_phone text, p_website text, p_latitude double precision, p_longitude double precision
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_vendor_editor(p_event_id, array['draft', 'planning', 'ready', 'live']);
  insert into public.event_vendor_shortlist
    (event_id, category, place_id, name, address, phone, website, latitude, longitude)
  values (p_event_id, p_category, p_place_id, p_name, p_address, p_phone, p_website, p_latitude, p_longitude)
  on conflict (event_id, category, place_id) do nothing;
end $$;

create function public.set_vendor_note(p_event_id uuid, p_category text, p_place_id text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_vendor_editor(p_event_id, array['draft', 'planning', 'ready', 'live']);
  update public.event_vendor_shortlist
     set note = nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '')
   where event_id = p_event_id and category = p_category and place_id = p_place_id;
end $$;

create function public.remove_shortlisted_vendor(p_event_id uuid, p_category text, p_place_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_vendor_editor(p_event_id, array['draft', 'planning', 'ready', 'live']);
  delete from public.event_vendor_shortlist
   where event_id = p_event_id and category = p_category and place_id = p_place_id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.save_event_services(uuid, text[]) to authenticated;
grant execute on function public.shortlist_vendor(uuid, text, text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.set_vendor_note(uuid, text, text, text) to authenticated;
grant execute on function public.remove_shortlisted_vendor(uuid, text, text) to authenticated;
grant execute on function public.save_event_details(uuid, text) to authenticated;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
