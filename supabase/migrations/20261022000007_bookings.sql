-- HalaEvents 0011 — bookings (P10, event.md §22). A quote is not a booking; a listing is not
-- availability. A booking exists only as:
--   proposed                     organizer picked a submitted quote (terms snapshotted here)
--   awaiting_organizer_approval  an approval of the exact booking request is pending
--   awaiting_provider            the approved request was sent to the provider (in-app)
--   confirmed                    a member of the provider confirmed it (the only way to get here)
--   declined_by_provider | cancelled | completed | disputed
-- Cancelling a confirmed booking needs its own approval. Disputes are resolved by a platform admin.
-- No payments. Transitions mirror src/modules/bookings/booking-rules.ts (parity-tested).

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  request_id uuid not null references public.service_requests (id) on delete restrict,
  quote_id uuid not null references public.quotes (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  -- Snapshot of what the organizer approves and the provider confirms.
  provider_name text not null,
  quote_revision integer not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  inclusions text not null,
  conditions text,
  service_from timestamptz not null,
  service_to timestamptz not null,
  organizer_note text check (organizer_note is null or char_length(organizer_note) <= 1000),
  status text not null default 'proposed' check (status in (
    'proposed', 'awaiting_organizer_approval', 'awaiting_provider', 'confirmed', 'declined_by_provider',
    'cancelled', 'completed', 'disputed'
  )),
  status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  pending_cancellation_reason text check (pending_cancellation_reason is null or char_length(pending_cancellation_reason) between 5 and 1000),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_window check (service_to > service_from),
  constraint bookings_confirmed_by_provider check (status not in ('confirmed', 'completed') or confirmed_by is not null)
);

-- One live booking per quote and per service request (cancelled/declined ones don't count).
create unique index bookings_one_live_per_quote on public.bookings (quote_id)
  where status not in ('cancelled', 'declined_by_provider');
create unique index bookings_one_live_per_request on public.bookings (request_id)
  where status not in ('cancelled', 'declined_by_provider');
create index bookings_provider_window on public.bookings (provider_id, service_from) where status in ('confirmed', 'completed', 'disputed');
create index bookings_event on public.bookings (event_id);

create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger bookings_audit after insert on public.bookings
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger bookings_audit_status after update of status on public.bookings
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

-- (from, to, actor). Actors: organizer, provider, approval (approval execution), admin.
create function public.booking_transition_allowed(p_from text, p_to text, p_actor text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to, p_actor) in (
    ('proposed', 'awaiting_organizer_approval', 'approval'),
    ('proposed', 'cancelled', 'organizer'),
    ('awaiting_organizer_approval', 'proposed', 'approval'),
    ('awaiting_organizer_approval', 'awaiting_provider', 'approval'),
    ('awaiting_provider', 'confirmed', 'provider'),
    ('awaiting_provider', 'declined_by_provider', 'provider'),
    ('awaiting_provider', 'cancelled', 'organizer'),
    ('confirmed', 'cancelled', 'approval'),
    ('confirmed', 'cancelled', 'provider'),
    ('confirmed', 'completed', 'organizer'),
    ('confirmed', 'disputed', 'organizer'), ('confirmed', 'disputed', 'provider'),
    ('completed', 'disputed', 'organizer'), ('completed', 'disputed', 'provider'),
    ('disputed', 'confirmed', 'admin'), ('disputed', 'completed', 'admin'), ('disputed', 'cancelled', 'admin')
  );
$$;

-- Internal: applies a transition after checking the table. Callers authorize the actor.
create function public.booking_apply(p_booking_id uuid, p_to text, p_actor text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_from text;
begin
  select status into v_from from public.bookings where id = p_booking_id for update;
  if v_from is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.booking_transition_allowed(v_from, p_to, p_actor) then
    raise exception 'invalid_transition: booking % -> % (%)', v_from, p_to, p_actor using errcode = '23514';
  end if;
  update public.bookings
     set status = p_to,
         status_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), status_reason),
         pending_cancellation_reason = case when p_to = 'confirmed' then pending_cancellation_reason else null end
   where id = p_booking_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Approval integration: payload, event and target sync now cover bookings too.
-- ---------------------------------------------------------------------------------------------
create or replace function public.approval_payload(p_action_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.communications;
  v_b public.bookings;
begin
  if p_action_type = 'send_communication' then
    select * into v_c from public.communications where id = p_target_id;
    if v_c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object(
      'communication_id', v_c.id, 'version', v_c.version, 'kind', v_c.kind, 'audience', v_c.audience,
      'subject', v_c.subject, 'body', v_c.body, 'recipients', public.communication_recipients(v_c.id)
    );
  end if;
  if p_action_type in ('request_booking', 'cancel_booking') then
    select * into v_b from public.bookings where id = p_target_id;
    if v_b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object(
      'booking_id', v_b.id, 'provider_id', v_b.provider_id, 'provider_name', v_b.provider_name,
      'quote_id', v_b.quote_id, 'quote_revision', v_b.quote_revision,
      'amount', v_b.amount, 'currency', v_b.currency, 'inclusions', v_b.inclusions, 'conditions', v_b.conditions,
      'service_from', v_b.service_from, 'service_to', v_b.service_to, 'organizer_note', v_b.organizer_note,
      'cancellation_reason', case when p_action_type = 'cancel_booking' then v_b.pending_cancellation_reason end,
      'recipient_summary', case when p_action_type = 'request_booking' then 'Booking request to ' else 'Cancellation to ' end || v_b.provider_name
    );
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

create or replace function public.approval_target_event(p_action_type text, p_target_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_action_type = 'send_communication' then
    return (select event_id from public.communications where id = p_target_id);
  end if;
  if p_action_type in ('request_booking', 'cancel_booking') then
    return (select event_id from public.bookings where id = p_target_id);
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

create or replace function public.approval_sync_target(p_action_type text, p_target_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action_type = 'send_communication' then
    update public.communications
       set status = case p_status
                      when 'pending' then 'awaiting_approval'
                      when 'approved' then 'approved'
                      when 'executing' then 'sending'
                      else 'draft'
                    end
     where id = p_target_id and status in ('draft', 'awaiting_approval', 'approved', 'sending');
  elsif p_action_type = 'request_booking' then
    if p_status = 'pending' then
      perform public.booking_apply(p_target_id, 'awaiting_organizer_approval', 'approval', null);
    elsif p_status in ('rejected', 'superseded') then
      perform public.booking_apply(p_target_id, 'proposed', 'approval', null);
    end if;
  elsif p_action_type = 'cancel_booking' and p_status in ('rejected', 'superseded') then
    update public.bookings set pending_cancellation_reason = null where id = p_target_id;
  end if;
end $$;

-- Extra preconditions for booking approvals are checked by request_approval's callers below.
create function public.booking_assert_manager(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_b.event_id);
  return v_b;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Organizer RPCs
-- ---------------------------------------------------------------------------------------------
create function public.propose_booking(p_quote_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_r public.service_requests;
  v_p public.providers;
  v_id uuid;
begin
  select * into v_q from public.quotes where id = p_quote_id for update;
  if v_q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into v_r from public.service_requests where id = v_q.request_id;
  perform public.approval_assert_manager(v_r.event_id);
  if not public.event_workspace_open(v_r.event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  if v_q.status <> 'submitted' or v_q.valid_until <= now() then
    raise exception 'quote_not_bookable: only submitted, unexpired quotes can be booked' using errcode = '23514';
  end if;
  if v_r.status = 'cancelled' then
    raise exception 'quote_not_bookable: the request is cancelled' using errcode = '23514';
  end if;
  select * into v_p from public.providers where id = v_q.provider_id;
  if v_p.moderation_status <> 'active' then
    raise exception 'quote_not_bookable: the provider is not active' using errcode = '23514';
  end if;
  begin
    insert into public.bookings (
      event_id, request_id, quote_id, provider_id, provider_name, quote_revision, amount, currency, inclusions,
      conditions, service_from, service_to, organizer_note
    ) values (
      v_r.event_id, v_r.id, v_q.id, v_q.provider_id, v_p.name, v_q.revision, v_q.amount, v_q.currency, v_q.inclusions,
      v_q.conditions, v_r.needed_from, v_r.needed_to, nullif(btrim(coalesce(p_note, '')), '')
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'booking_exists: this request already has a booking in progress' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.request_booking_approval(p_booking_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings := public.booking_assert_manager(p_booking_id);
begin
  if v_b.status <> 'proposed' then
    raise exception 'invalid_transition: booking % -> awaiting_organizer_approval', v_b.status using errcode = '23514';
  end if;
  return public.request_approval('request_booking', p_booking_id);
end $$;

create function public.request_booking_cancellation(p_booking_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings := public.booking_assert_manager(p_booking_id);
begin
  if v_b.status <> 'confirmed' then
    raise exception 'invalid_transition: only confirmed bookings need a cancellation approval' using errcode = '23514';
  end if;
  update public.bookings set pending_cancellation_reason = btrim(p_reason) where id = p_booking_id;
  return public.request_approval('cancel_booking', p_booking_id);
end $$;

-- DB-only execution (§5.4): claim, re-check the reviewed payload and apply in one transaction.
create function public.execute_booking_approval(p_approval_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
  v_reason text;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null or v_a.action_type not in ('request_booking', 'cancel_booking') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.status in ('executing', 'executed', 'execution_failed') then
    raise exception 'already_executed' using errcode = '23505';
  end if;
  if v_a.status <> 'approved' then
    raise exception 'not_approved' using errcode = '23514';
  end if;
  if not public.approval_payload_unchanged(v_a) then
    return 'superseded';
  end if;
  if v_a.action_type = 'request_booking' then
    perform public.booking_apply(v_a.target_id, 'awaiting_provider', 'approval', null);
    perform public.notify_provider_members(
      (v_a.payload ->> 'provider_id')::uuid, v_a.event_id, 'decision_required',
      'Booking request: ' || (select event_name from public.service_requests r join public.bookings b on b.request_id = r.id where b.id = v_a.target_id),
      'An organizer asked you to confirm a booking at the quoted terms. It is not confirmed until you confirm it.',
      '/app/provider/bookings', 'booking-request:' || v_a.target_id
    );
  else
    v_reason := v_a.payload ->> 'cancellation_reason';
    perform public.booking_apply(v_a.target_id, 'cancelled', 'approval', v_reason);
    perform public.notify_provider_members(
      (v_a.payload ->> 'provider_id')::uuid, v_a.event_id, 'booking_update',
      'Booking cancelled by the organizer', left('Reason: ' || coalesce(v_reason, 'not given'), 600),
      '/app/provider/bookings', 'booking-cancel:' || v_a.target_id
    );
  end if;
  update public.approvals
     set status = 'executed', executed_by = auth.uid(), execution_started_at = now(), executed_at = now(),
         result = jsonb_build_object('booking_status', (select status from public.bookings where id = v_a.target_id))
   where id = p_approval_id;
  return 'executed';
end $$;

create function public.organizer_booking_action(p_booking_id uuid, p_to text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings := public.booking_assert_manager(p_booking_id);
begin
  if p_to not in ('cancelled', 'completed', 'disputed') then
    raise exception 'invalid_transition: organizers can''t set %', p_to using errcode = '23514';
  end if;
  if p_to = 'cancelled' and v_b.status = 'confirmed' then
    raise exception 'approval_required: cancelling a confirmed booking needs an approval' using errcode = '23514';
  end if;
  if p_to = 'completed' and v_b.service_to > now() then
    raise exception 'not_finished: the service period hasn''t ended' using errcode = '23514';
  end if;
  if p_to in ('cancelled', 'disputed') and char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  -- An open booking-request approval is withdrawn with the booking.
  update public.approvals set status = 'superseded', failure_reason = 'booking_withdrawn'
   where target_id = p_booking_id and status in ('pending', 'approved');
  perform public.booking_apply(p_booking_id, p_to, 'organizer', p_reason);
  perform public.notify_provider_members(
    v_b.provider_id, v_b.event_id, 'booking_update', 'Booking ' || replace(p_to, '_', ' ') || ' by the organizer',
    left(coalesce('Reason: ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), 600), '/app/provider/bookings', null
  );
end $$;

-- ---------------------------------------------------------------------------------------------
-- Provider RPCs (a member of the booked provider)
-- ---------------------------------------------------------------------------------------------
create function public.provider_booking_action(p_booking_id uuid, p_to text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_kind text;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.is_provider_member(v_b.provider_id) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_to in ('declined_by_provider', 'cancelled', 'disputed') and char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  if p_to = 'confirmed' then
    -- Venues can't be in two places at once: refuse overlapping confirmed bookings, serialized by a
    -- lock on the provider row. Service providers (catering, AV…) may serve several events.
    select kind into v_kind from public.providers where id = v_b.provider_id for update;
    if v_kind = 'venue' and exists (
      select 1 from public.bookings o
       where o.provider_id = v_b.provider_id and o.id <> v_b.id
         and o.status in ('confirmed', 'completed', 'disputed')
         and o.service_from < v_b.service_to and v_b.service_from < o.service_to
    ) then
      raise exception 'provider_conflict: this venue already has a confirmed booking at that time' using errcode = '23514';
    end if;
  end if;
  if p_to = 'confirmed' then
    -- Recorded first so the status change satisfies bookings_confirmed_by_provider.
    update public.bookings set confirmed_by = auth.uid(), confirmed_at = now() where id = p_booking_id;
  end if;
  perform public.booking_apply(p_booking_id, p_to, 'provider', p_reason);
  perform public.notify_event_managers(
    v_b.event_id, 'booking_update', v_b.provider_name || ' ' ||
      case p_to when 'confirmed' then 'confirmed the booking' when 'declined_by_provider' then 'declined the booking'
                when 'cancelled' then 'cancelled the booking' else 'raised a dispute' end,
    left(coalesce('Reason: ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), 600),
    '/app/events/' || v_b.event_id || '/bookings', null, null
  );
end $$;

-- Platform admins resolve disputes.
create function public.resolve_booking_dispute(p_booking_id uuid, p_to text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  perform public.booking_apply(p_booking_id, p_to, 'admin', p_reason);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Notifications: new kind for booking updates; helper for provider members.
-- ---------------------------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'missing_information', 'compliance_concern', 'deadline_approaching', 'decision_required',
  'compliance_status_changed', 'booking_update'
));

create function public.notify_provider_members(
  p_provider uuid, p_event uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_count integer := 0;
begin
  for v_user in select user_id from public.provider_members where provider_id = p_provider loop
    v_count := v_count + public.notify_user(v_user, p_event, p_kind, p_title, p_body, p_link, p_dedupe);
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants: event owner/organizers and the booked provider's members.
-- ---------------------------------------------------------------------------------------------
alter table public.bookings enable row level security;
create policy bookings_select on public.bookings for select to authenticated
  using (
    public.is_event_member(event_id, array['owner', 'organizer'])
    or public.is_provider_member(provider_id)
    or public.is_platform_admin()
  );
grant select on public.bookings to authenticated;

grant execute on function public.booking_transition_allowed(text, text, text) to authenticated;
grant execute on function public.propose_booking(uuid, text) to authenticated;
grant execute on function public.request_booking_approval(uuid) to authenticated;
grant execute on function public.request_booking_cancellation(uuid, text) to authenticated;
grant execute on function public.execute_booking_approval(uuid) to authenticated;
grant execute on function public.organizer_booking_action(uuid, text, text) to authenticated;
grant execute on function public.provider_booking_action(uuid, text, text) to authenticated;
grant execute on function public.resolve_booking_dispute(uuid, text, text) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
