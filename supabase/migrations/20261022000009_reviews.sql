-- HalaEvents 0009 — post-event reviews (P10 reviews, event.md §24).
--
-- A review can only be created through create_review(), which requires a COMPLETED booking between
-- the reviewed provider and the reviewer's event. There is no column or parameter that says "this
-- was a verified transaction": every review has one by construction, and the "verified" indicator
-- shown to readers is recomputed from the booking (status 'completed') on every read.
--   * one review per booking and direction (unique), not editable after submission;
--   * organizer → provider is always enabled; provider → organizer only while the platform setting
--     'provider_reviews_of_organizers' is on (default: off, an administrator turns it on);
--   * a reviewer may not be on both sides of the booking (conflict of interest);
--   * reviews are public only through the listing/summary functions below, which apply provider
--     visibility; the table itself is readable by the two sides and by administrators;
--   * averages count published reviews of bookings that are still completed, nothing else;
--   * moderation (hide / restore), reports, disputes and one public response per review.

-- Platform policy ---------------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key check (key in ('provider_reviews_of_organizers')),
  enabled boolean not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, enabled) values ('provider_reviews_of_organizers', false);
create trigger platform_settings_audit after update on public.platform_settings
  for each row execute function public.audit_row_change('key');
alter table public.platform_settings enable row level security;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);
grant select on public.platform_settings to authenticated;

create function public.set_platform_setting(p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.platform_settings set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Tables ------------------------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete restrict,
  direction text not null check (direction in ('organizer_to_provider', 'provider_to_organizer')),
  reviewer_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- The organizer being reviewed (the event owner) when a provider reviews an organizer.
  target_user_id uuid references auth.users (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(btrim(body)) between 10 and 2000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 500),
  moderated_by uuid references auth.users (id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, direction),
  constraint reviews_hidden_is_moderated check (status <> 'hidden' or moderated_at is not null)
);
create index reviews_provider on public.reviews (provider_id, status);
create index reviews_target_user on public.reviews (target_user_id, status);
create index reviews_event on public.reviews (event_id);
create trigger reviews_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger reviews_audit after insert on public.reviews
  for each row execute function public.audit_row_change('id');
create trigger reviews_audit_status after update of status on public.reviews
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id');

create table public.review_responses (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  body text not null check (char_length(btrim(body)) between 10 and 1500),
  created_at timestamptz not null default now()
);
create trigger review_responses_audit after insert on public.review_responses
  for each row execute function public.audit_row_change('review_id');

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  reporter_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- 'dispute' = the reviewed party contests it; 'report' = anyone else flags it.
  kind text not null check (kind in ('report', 'dispute')),
  reason text not null check (reason in ('inaccurate', 'abusive', 'spam', 'conflict_of_interest', 'other')),
  details text not null check (char_length(btrim(details)) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_user_id, kind),
  constraint review_reports_resolved check ((status = 'open') = (resolved_at is null))
);
create index review_reports_open on public.review_reports (status, created_at);
create trigger review_reports_audit after insert on public.review_reports
  for each row execute function public.audit_row_change('id');
create trigger review_reports_audit_status after update of status on public.review_reports
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id');

-- Which side of a review is the caller on? 'reviewer', 'reviewee' or 'none' (team-based: any owner or
-- organizer of the event, any member of the provider).
create function public.review_side(p_review_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_org boolean;
  v_prov boolean;
begin
  select * into v_r from public.reviews where id = p_review_id;
  if v_r.id is null then return 'none'; end if;
  v_org := public.is_event_member(v_r.event_id, array['owner', 'organizer']);
  v_prov := public.is_provider_member(v_r.provider_id);
  if v_r.direction = 'organizer_to_provider' then
    return case when v_org then 'reviewer' when v_prov then 'reviewee' else 'none' end;
  end if;
  return case when v_prov then 'reviewer' when v_org then 'reviewee' else 'none' end;
end $$;

-- Eligibility: returns NULL when the caller may review, otherwise the reason code. The single place
-- where the rules live; create_review() and the candidate list both use it.
create function public.review_check(p_booking_id uuid, p_direction text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  if auth.uid() is null then return 'unauthenticated'; end if;
  if p_direction not in ('organizer_to_provider', 'provider_to_organizer') then return 'invalid_direction'; end if;
  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.id is null then return 'not_found'; end if;
  if not public.is_active_account() then return 'not_authorized'; end if;
  if p_direction = 'organizer_to_provider' then
    if not public.is_event_member(v_b.event_id, array['owner', 'organizer']) then return 'not_authorized'; end if;
    if public.is_provider_member(v_b.provider_id) then return 'conflict_of_interest'; end if;
  else
    if not public.is_provider_member(v_b.provider_id) then return 'not_authorized'; end if;
    if public.is_event_member(v_b.event_id) then return 'conflict_of_interest'; end if;
    if not (select enabled from public.platform_settings where key = 'provider_reviews_of_organizers') then
      return 'disabled';
    end if;
  end if;
  if v_b.status <> 'completed' then return 'not_completed'; end if;
  if exists (select 1 from public.reviews where booking_id = p_booking_id and direction = p_direction) then
    return 'duplicate';
  end if;
  return null;
end $$;

create function public.create_review(p_booking_id uuid, p_direction text, p_rating integer, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_code text;
  v_id uuid;
begin
  perform 1 from public.bookings where id = p_booking_id for update;
  v_code := public.review_check(p_booking_id, p_direction);
  if v_code = 'unauthenticated' then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if v_code in ('not_found', 'invalid_direction') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_code = 'not_authorized' then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_code = 'not_completed' then
    raise exception 'not_eligible: only a completed booking can be reviewed' using errcode = '23514';
  end if;
  if v_code = 'disabled' then
    raise exception 'not_eligible: providers can''t review organizers on this platform yet' using errcode = '23514';
  end if;
  if v_code = 'conflict_of_interest' then
    raise exception 'conflict_of_interest: you are on both sides of this booking' using errcode = '23514';
  end if;
  if v_code = 'duplicate' then
    raise exception 'duplicate_review: this booking already has a review in that direction' using errcode = '23505';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;
  select * into v_b from public.bookings where id = p_booking_id;
  insert into public.reviews (booking_id, event_id, provider_id, direction, target_user_id, rating, body)
  values (
    v_b.id, v_b.event_id, v_b.provider_id, p_direction,
    case when p_direction = 'provider_to_organizer' then (select owner_id from public.events where id = v_b.event_id) end,
    p_rating, btrim(p_body)
  ) returning id into v_id;
  return v_id;
end $$;

-- Completed bookings the caller can review (or has reviewed), with the reason when they can't.
create function public.review_candidates() returns table (
  booking_id uuid, event_id uuid, event_name text, provider_id uuid, provider_name text,
  side text, service_to timestamptz, eligible boolean, reason text, review_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return query
    select x.booking_id, x.event_id, x.event_name, x.provider_id, x.provider_name, x.side, x.service_to,
           x.reason is null, x.reason, r.id
      from (
        select b.id as booking_id, b.event_id, e.name as event_name, b.provider_id, b.provider_name,
               'organizer'::text as side, b.service_to,
               public.review_check(b.id, 'organizer_to_provider') as reason, 'organizer_to_provider'::text as direction
          from public.bookings b join public.events e on e.id = b.event_id
         where b.status = 'completed' and public.is_event_member(b.event_id, array['owner', 'organizer'])
        union all
        select b.id, b.event_id, e.name, b.provider_id, b.provider_name,
               'provider', b.service_to,
               public.review_check(b.id, 'provider_to_organizer'), 'provider_to_organizer'
          from public.bookings b join public.events e on e.id = b.event_id
         where b.status = 'completed' and public.is_provider_member(b.provider_id)
      ) x
      left join public.reviews r on r.booking_id = x.booking_id and r.direction = x.direction
     order by x.service_to desc;
end $$;

-- Reviews the caller is on either side of, any status, with the caller's side, the response and the
-- kinds of reports the caller already filed (so the UI doesn't offer a duplicate).
create function public.my_reviews() returns table (
  id uuid, booking_id uuid, event_id uuid, event_name text, provider_id uuid, provider_name text,
  direction text, rating smallint, body text, status text, moderation_note text, created_at timestamptz,
  side text, response_body text, response_at timestamptz, my_report_kinds text[]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return query
    select r.id, r.booking_id, r.event_id, e.name, r.provider_id, p.name, r.direction, r.rating, r.body, r.status,
           r.moderation_note, r.created_at, public.review_side(r.id), rr.body, rr.created_at,
           coalesce((select array_agg(x.kind) from public.review_reports x
                      where x.review_id = r.id and x.reporter_user_id = auth.uid()), '{}')
      from public.reviews r
      join public.events e on e.id = r.event_id
      join public.providers p on p.id = r.provider_id
      left join public.review_responses rr on rr.review_id = r.id
     where public.review_side(r.id) in ('reviewer', 'reviewee')
     order by r.created_at desc
     limit 200;
end $$;

-- Responses, reports, disputes ------------------------------------------------------------------
create function public.respond_to_review(p_review_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_active_account() or public.review_side(p_review_id) <> 'reviewee' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    insert into public.review_responses (review_id, body) values (p_review_id, btrim(p_body));
  exception when unique_violation then
    raise exception 'duplicate_response: this review already has a response' using errcode = '23505';
  end;
end $$;

create function public.report_review(p_review_id uuid, p_kind text, p_reason text, p_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_side text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_active_account() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_r from public.reviews where id = p_review_id;
  if v_r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_side := public.review_side(p_review_id);
  if v_side = 'reviewer' then
    raise exception 'forbidden: you can''t report your own review' using errcode = '42501';
  end if;
  if p_kind = 'dispute' and v_side <> 'reviewee' then
    raise exception 'forbidden: only the reviewed party can dispute a review' using errcode = '42501';
  end if;
  -- Someone outside both sides can only see (and so report) a review that is public.
  if v_side = 'none' and (v_r.status <> 'published' or public.is_platform_admin() is not true and not exists (
    select 1 from public.providers p where p.id = v_r.provider_id
       and p.verification_status = 'verified' and p.moderation_status = 'active' and p.is_listed
  )) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  begin
    insert into public.review_reports (review_id, kind, reason, details)
    values (p_review_id, p_kind, p_reason, btrim(p_details))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_report: you already reported this review' using errcode = '23505';
  end;
  return v_id;
end $$;

-- Moderation (platform administrators) -----------------------------------------------------------
create function public.moderate_review(p_review_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('published', 'hidden') then raise exception 'invalid_transition' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  update public.reviews
     set status = p_status, moderation_note = left(btrim(p_note), 500), moderated_by = auth.uid(),
         moderated_at = now()
   where id = p_review_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create function public.resolve_review_report(p_report_id uuid, p_resolution text, p_note text, p_hide boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rep public.review_reports;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_resolution not in ('upheld', 'dismissed') then raise exception 'invalid_transition' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  select * into v_rep from public.review_reports where id = p_report_id for update;
  if v_rep.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_rep.status <> 'open' then
    raise exception 'invalid_transition: report is already %', v_rep.status using errcode = '23514';
  end if;
  update public.review_reports
     set status = p_resolution, resolution_note = left(btrim(p_note), 500), resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id;
  if p_resolution = 'upheld' and coalesce(p_hide, false) then
    update public.reviews
       set status = 'hidden', moderation_note = left(btrim(p_note), 500), moderated_by = auth.uid(), moderated_at = now()
     where id = v_rep.review_id;
  end if;
end $$;

-- Public reads ----------------------------------------------------------------------------------------
-- Eligible = published AND its booking is still completed. Everything else (hidden, or a booking that
-- was later disputed) is left out of lists and averages. A caller who may not see the provider gets no
-- rows at all (not a misleading "0 reviews").
create function public.review_provider_visible(p_provider_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.is_platform_admin() or public.is_provider_member(p_provider_id) or exists (
      select 1 from public.providers p where p.id = p_provider_id
         and p.verification_status = 'verified' and p.moderation_status = 'active' and p.is_listed
    )
  );
$$;

create function public.provider_rating_summary(p_provider_id uuid) returns table (
  review_count integer, average numeric, stars_1 integer, stars_2 integer, stars_3 integer, stars_4 integer, stars_5 integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.review_provider_visible(p_provider_id) then return; end if;
  return query
    select count(r.id)::integer,
           round(avg(r.rating)::numeric, 2),
           (count(*) filter (where r.rating = 1))::integer, (count(*) filter (where r.rating = 2))::integer,
           (count(*) filter (where r.rating = 3))::integer, (count(*) filter (where r.rating = 4))::integer,
           (count(*) filter (where r.rating = 5))::integer
      from public.reviews r join public.bookings b on b.id = r.booking_id
     where r.provider_id = p_provider_id and r.direction = 'organizer_to_provider'
       and r.status = 'published' and b.status = 'completed';
end $$;

create function public.provider_reviews(p_provider_id uuid) returns table (
  id uuid, rating smallint, body text, created_at timestamptz, reviewer_name text, verified boolean,
  response_body text, response_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.rating, r.body, r.created_at, coalesce(pr.display_name, 'Organizer'), true,
         rr.body, rr.created_at
    from public.reviews r
    join public.bookings b on b.id = r.booking_id and b.status = 'completed'
    left join public.profiles pr on pr.user_id = r.reviewer_user_id
    left join public.review_responses rr on rr.review_id = r.id
   where r.provider_id = p_provider_id and r.direction = 'organizer_to_provider' and r.status = 'published'
     and public.review_provider_visible(p_provider_id)
   order by r.created_at desc
   limit 100;
$$;

-- Organizer reputation among providers: only for the organizer themself, administrators, and members of
-- a provider (who decide whether to work with an organizer).
create function public.review_organizer_visible(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    auth.uid() = p_user_id or public.is_platform_admin()
    or exists (select 1 from public.provider_members m where m.user_id = auth.uid())
  );
$$;

create function public.organizer_rating_summary(p_user_id uuid) returns table (review_count integer, average numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.review_organizer_visible(p_user_id) then return; end if;
  return query
    select count(r.id)::integer, round(avg(r.rating)::numeric, 2)
      from public.reviews r join public.bookings b on b.id = r.booking_id
     where r.target_user_id = p_user_id and r.direction = 'provider_to_organizer'
       and r.status = 'published' and b.status = 'completed';
end $$;

create function public.organizer_reviews(p_user_id uuid) returns table (
  id uuid, rating smallint, body text, created_at timestamptz, provider_name text, verified boolean
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.rating, r.body, r.created_at, p.name, true
    from public.reviews r
    join public.bookings b on b.id = r.booking_id and b.status = 'completed'
    join public.providers p on p.id = r.provider_id
   where r.target_user_id = p_user_id and r.direction = 'provider_to_organizer' and r.status = 'published'
     and public.review_organizer_visible(p_user_id)
   order by r.created_at desc
   limit 100;
$$;

-- RLS + grants -----------------------------------------------------------------------------------
alter table public.reviews enable row level security;
alter table public.review_responses enable row level security;
alter table public.review_reports enable row level security;

-- The two sides and administrators see every status of their own reviews; the public uses the functions above.
create policy reviews_select on public.reviews for select to authenticated using (
  public.is_platform_admin()
  or public.is_event_member(event_id, array['owner', 'organizer'])
  or public.is_provider_member(provider_id)
);
create policy review_responses_select on public.review_responses for select to authenticated using (
  exists (select 1 from public.reviews r where r.id = review_id)
);
create policy review_reports_select on public.review_reports for select to authenticated using (
  public.is_platform_admin() or reporter_user_id = auth.uid()
);
grant select on public.reviews, public.review_responses, public.review_reports to authenticated;

grant execute on function public.set_platform_setting(text, boolean) to authenticated;
grant execute on function public.create_review(uuid, text, integer, text) to authenticated;
grant execute on function public.review_candidates() to authenticated;
grant execute on function public.my_reviews() to authenticated;
grant execute on function public.respond_to_review(uuid, text) to authenticated;
grant execute on function public.report_review(uuid, text, text, text) to authenticated;
grant execute on function public.moderate_review(uuid, text, text) to authenticated;
grant execute on function public.resolve_review_report(uuid, text, text, boolean) to authenticated;
grant execute on function public.provider_rating_summary(uuid) to authenticated;
grant execute on function public.provider_reviews(uuid) to authenticated;
grant execute on function public.organizer_rating_summary(uuid) to authenticated;
grant execute on function public.organizer_reviews(uuid) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
