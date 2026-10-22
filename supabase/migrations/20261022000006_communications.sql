-- HalaEvents 0010 — approvals, communications and delivery records (P7, event.md §21).
--
-- Approval gate (event.md §5.4):
--   * request_approval() snapshots the EXACT payload (built here from the target, never sent by the
--     client) and stores its sha256. Recipients are part of the payload.
--   * decide_approval() and claim_approval() rebuild the payload; if it differs from the reviewed
--     one (draft edited, recipients changed) the approval is superseded and a fresh one is needed.
--   * claim_approval() atomically moves approved → executing (a second caller gets a conflict), the
--     server sends through the email transport, and finish_communication() records per-recipient
--     results. An approval stuck in "executing" is never auto-resent.
-- Delivery status is a separate column per recipient; it never changes attendee status.

-- AI drafting of messages (pipeline 'draft_message').
alter table public.ai_runs drop constraint ai_runs_pipeline_check;
alter table public.ai_runs add constraint ai_runs_pipeline_check
  check (pipeline in ('interview', 'plan', 'revise_task', 'draft_message'));

-- Messages are drafted for live, completed and cancelled events too (reminders, thank-you notes,
-- cancellation notices), so draft_message only excludes archived events.
create or replace function public.start_ai_run(
  p_event_id uuid,
  p_pipeline text,
  p_provider text,
  p_model text,
  p_input_hash text,
  p_is_mock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_pipeline = 'draft_message' then
    if auth.uid() is null then
      raise exception 'unauthenticated' using errcode = '28000';
    end if;
    if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if (select status from public.events where id = p_event_id) = 'archived' then
      raise exception 'event_locked' using errcode = '23514';
    end if;
  else
    perform public.ai_assert_event_manager(p_event_id);
  end if;
  update public.ai_runs
     set status = 'failed', error_code = 'abandoned', finished_at = now()
   where event_id = p_event_id and pipeline = p_pipeline and status = 'running'
     and created_at < now() - interval '3 minutes';
  if (select count(*) from public.ai_runs
       where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'ai_rate_limited' using errcode = '53400';
  end if;
  begin
    insert into public.ai_runs (event_id, pipeline, provider, model, input_hash, is_mock, created_by)
    values (p_event_id, p_pipeline, p_provider, p_model, p_input_hash, coalesce(p_is_mock, false), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ai_run_in_progress' using errcode = '23505';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Communications (drafts → approval → sending → sent)
-- ---------------------------------------------------------------------------------------------
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in (
    'invitation', 'registration_confirmation', 'acceptance', 'waitlist', 'reminder', 'venue_update',
    'schedule_update', 'cancellation', 'recovery', 'thank_you'
  )),
  -- Recipients are chosen by code from attendee statuses, never by a model.
  audience text not null check (audience in (
    'invited', 'registered', 'accepted', 'waitlisted', 'confirmed', 'checked_in', 'all_places', 'single'
  )),
  attendee_id uuid references public.attendees (id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 3 and 200),
  body text not null check (char_length(btrim(body)) between 10 and 5000),
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_approval', 'approved', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled'
  )),
  drafted_by text not null default 'organizer' check (drafted_by in ('organizer', 'ai')),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  is_mock_draft boolean not null default false,
  version integer not null default 1 check (version between 1 and 10000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint communications_single check ((audience = 'single') = (attendee_id is not null)),
  constraint communications_ai check (drafted_by = 'organizer' or ai_run_id is not null)
);
create index communications_event on public.communications (event_id, created_at desc);
create trigger communications_updated_at before update on public.communications
  for each row execute function public.set_updated_at();
create trigger communications_audit after insert or delete on public.communications
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger communications_audit_update after update of status, version on public.communications
  for each row when (old.status is distinct from new.status or old.version is distinct from new.version)
  execute function public.audit_row_change('id', 'event_id');

create table public.communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references public.communications (id) on delete cascade,
  approval_id uuid not null,
  event_id uuid not null references public.events (id) on delete cascade,
  attendee_id uuid references public.attendees (id) on delete set null,
  email text not null check (char_length(email) <= 254),
  transport text not null check (transport in ('mock', 'resend')),
  -- simulated: mock transport, nothing left the server. accepted: the provider API accepted the
  -- message (NOT proof of delivery). failed: refused or errored. delivered/bounced need provider
  -- webhooks, which are not implemented, so nothing sets them yet.
  status text not null check (status in ('simulated', 'accepted', 'failed', 'delivered', 'bounced')),
  is_simulated boolean not null,
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  provider_response jsonb check (provider_response is null or octet_length(provider_response::text) <= 4000),
  error text check (error is null or char_length(error) <= 500),
  attempted_at timestamptz not null default now(),
  unique (approval_id, attendee_id),
  constraint deliveries_mock_is_simulated check ((transport = 'mock') = is_simulated),
  constraint deliveries_simulated_status check (is_simulated = (status = 'simulated') or status = 'failed')
);
create index communication_deliveries_comm on public.communication_deliveries (communication_id);

-- Recipients of a communication now: sorted, withdrawn people excluded. Part of the payload.
create function public.communication_recipients(p_communication_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('attendee_id', a.id, 'email', a.email, 'name', a.full_name) order by a.email, a.id), '[]'::jsonb)
    from public.communications c
    join public.attendees a on a.event_id = c.event_id
   where c.id = p_communication_id
     and a.registration_status <> 'withdrawn'
     and case c.audience
           when 'single' then a.id = c.attendee_id
           when 'invited' then a.registration_status = 'invited'
           when 'registered' then a.registration_status = 'registered'
           when 'all_places' then a.participation_status in ('accepted', 'confirmed', 'checked_in')
           else a.participation_status = c.audience
         end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  action_type text not null check (action_type in ('send_communication', 'request_booking', 'cancel_booking')),
  target_id uuid not null,
  recipient_summary text not null check (char_length(recipient_summary) between 1 and 300),
  payload jsonb not null check (octet_length(payload::text) <= 200000),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'superseded', 'executing', 'executed', 'execution_failed'
  )),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  executed_by uuid references auth.users (id) on delete set null,
  execution_started_at timestamptz,
  executed_at timestamptz,
  result jsonb check (result is null or octet_length(result::text) <= 8000),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500)
);
-- One live approval per target and action.
create unique index approvals_one_live on public.approvals (target_id, action_type)
  where status in ('pending', 'approved', 'executing');
create index approvals_event on public.approvals (event_id, requested_at desc);

create trigger approvals_audit after insert or update of status on public.approvals
  for each row execute function public.audit_row_change('id', 'event_id');

create function public.payload_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex');
$$;

-- The exact payload a person reviews. Redefined by 0011 to add booking actions.
create function public.approval_payload(p_action_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.communications;
begin
  if p_action_type = 'send_communication' then
    select * into v_c from public.communications where id = p_target_id;
    if v_c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object(
      'communication_id', v_c.id, 'version', v_c.version, 'kind', v_c.kind, 'audience', v_c.audience,
      'subject', v_c.subject, 'body', v_c.body, 'recipients', public.communication_recipients(v_c.id)
    );
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

create function public.approval_target_event(p_action_type text, p_target_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_action_type = 'send_communication' then
    return (select event_id from public.communications where id = p_target_id);
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

create function public.approval_assert_manager(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_event_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- Target-side effects of approval state changes (communications; bookings added in 0011).
create function public.approval_sync_target(p_action_type text, p_target_id uuid, p_status text) returns void
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
  end if;
end $$;

create function public.request_approval(p_action_type text, p_target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid := public.approval_target_event(p_action_type, p_target_id);
  v_payload jsonb;
  v_summary text;
  v_id uuid;
begin
  perform public.approval_assert_manager(v_event);
  perform 1 from public.events where id = v_event for update;
  if p_action_type = 'send_communication' then
    if (select status from public.communications where id = p_target_id) <> 'draft' then
      raise exception 'invalid_transition: only drafts can be submitted for approval' using errcode = '23514';
    end if;
  elsif p_action_type = 'request_booking' then
    -- bookings is created by 0011; plpgsql resolves the table at run time.
    if (select status from public.bookings where id = p_target_id) <> 'proposed' then
      raise exception 'invalid_transition: only proposed bookings can be submitted for approval' using errcode = '23514';
    end if;
  elsif p_action_type = 'cancel_booking' then
    if not exists (
      select 1 from public.bookings where id = p_target_id and status = 'confirmed' and pending_cancellation_reason is not null
    ) then
      raise exception 'invalid_transition: use request_booking_cancellation with a reason' using errcode = '23514';
    end if;
  end if;
  v_payload := public.approval_payload(p_action_type, p_target_id);
  if p_action_type = 'send_communication' then
    if jsonb_array_length(v_payload -> 'recipients') = 0 then
      raise exception 'no_recipients' using errcode = '23514';
    end if;
    if jsonb_array_length(v_payload -> 'recipients') > 500 then
      raise exception 'too_many_recipients' using errcode = '23514';
    end if;
    v_summary := jsonb_array_length(v_payload -> 'recipients') || ' recipient(s), audience ' || (v_payload ->> 'audience');
  else
    v_summary := coalesce(v_payload ->> 'recipient_summary', p_action_type);
  end if;
  begin
    insert into public.approvals (event_id, action_type, target_id, recipient_summary, payload, payload_hash, requested_by)
    values (v_event, p_action_type, p_target_id, left(v_summary, 300), v_payload, public.payload_hash(v_payload), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'approval_already_open' using errcode = '23505';
  end;
  perform public.approval_sync_target(p_action_type, p_target_id, 'pending');
  return v_id;
end $$;

-- Internal: compares the stored payload with the target's current state; supersedes on change.
create function public.approval_payload_unchanged(p_a public.approvals) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if public.payload_hash(public.approval_payload(p_a.action_type, p_a.target_id)) = p_a.payload_hash then
    return true;
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'payload_changed' where id = p_a.id;
  perform public.approval_sync_target(p_a.action_type, p_a.target_id, 'superseded');
  return false;
end $$;

-- Approve or reject the exact payload. Returns the resulting status ('superseded' if the payload
-- changed since it was requested: nothing is approved and a fresh request is needed).
create function public.decide_approval(p_approval_id uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.status <> 'pending' then
    raise exception 'invalid_transition: approval % -> decided', v_a.status using errcode = '23514';
  end if;
  if not public.approval_payload_unchanged(v_a) then
    return 'superseded';
  end if;
  update public.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_approval_id;
  perform public.approval_sync_target(v_a.action_type, v_a.target_id, case when p_approve then 'approved' else 'rejected' end);
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- Phase 1 of execution: approved → executing, exactly once, only for the reviewed payload.
create function public.claim_approval(p_approval_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.action_type <> 'send_communication' then
    -- DB-only actions execute in one transaction through their own function (0011).
    raise exception 'invalid_transition: use execute_booking_approval' using errcode = '23514';
  end if;
  if v_a.status in ('executing', 'executed', 'execution_failed') then
    raise exception 'already_executed' using errcode = '23505';
  end if;
  if v_a.status <> 'approved' then
    raise exception 'not_approved' using errcode = '23514';
  end if;
  if not public.approval_payload_unchanged(v_a) then
    return jsonb_build_object('status', 'superseded');
  end if;
  update public.approvals set status = 'executing', executed_by = auth.uid(), execution_started_at = now()
   where id = p_approval_id;
  perform public.approval_sync_target(v_a.action_type, v_a.target_id, 'executing');
  return jsonb_build_object('status', 'executing', 'payload', v_a.payload, 'payload_hash', v_a.payload_hash);
end $$;

-- Phase 2 for communications: records what the transport reported for each recipient.
-- p_results: [{attendee_id, status: simulated|accepted|failed, provider_message_id?, provider_response?, error?}]
create function public.finish_communication(p_approval_id uuid, p_transport text, p_results jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
  v_r jsonb;
  v_recipient jsonb;
  v_ok integer := 0;
  v_failed integer := 0;
  v_final text;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null or v_a.action_type <> 'send_communication' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.status <> 'executing' or v_a.executed_by is distinct from auth.uid() then
    raise exception 'invalid_transition: approval % -> executed', v_a.status using errcode = '23514';
  end if;
  if p_transport not in ('mock', 'resend') or jsonb_typeof(p_results) <> 'array'
     or jsonb_array_length(p_results) <> jsonb_array_length(v_a.payload -> 'recipients') then
    raise exception 'invalid_results' using errcode = '22023';
  end if;
  for v_r in select value from jsonb_array_elements(p_results) loop
    -- Results may only cover recipients of the approved payload.
    select value into v_recipient from jsonb_array_elements(v_a.payload -> 'recipients')
     where value ->> 'attendee_id' = v_r ->> 'attendee_id';
    if v_recipient is null then
      raise exception 'invalid_results: unknown recipient' using errcode = '22023';
    end if;
    if (v_r ->> 'status') not in ('simulated', 'accepted', 'failed')
       or (p_transport = 'mock' and (v_r ->> 'status') = 'accepted')
       or (p_transport = 'resend' and (v_r ->> 'status') = 'simulated') then
      raise exception 'invalid_results: status' using errcode = '22023';
    end if;
    insert into public.communication_deliveries (
      communication_id, approval_id, event_id, attendee_id, email, transport, status, is_simulated,
      provider_message_id, provider_response, error
    ) values (
      v_a.target_id, v_a.id, v_a.event_id, (v_r ->> 'attendee_id')::uuid, v_recipient ->> 'email', p_transport,
      v_r ->> 'status', p_transport = 'mock', left(v_r ->> 'provider_message_id', 200), v_r -> 'provider_response',
      left(v_r ->> 'error', 500)
    );
    if (v_r ->> 'status') = 'failed' then v_failed := v_failed + 1; else v_ok := v_ok + 1; end if;
    v_recipient := null;
  end loop;
  v_final := case when v_failed = 0 then 'sent' when v_ok = 0 then 'failed' else 'partially_failed' end;
  update public.communications set status = v_final, sent_at = case when v_ok > 0 then now() end
   where id = v_a.target_id;
  update public.approvals
     set status = case when v_ok = 0 then 'execution_failed' else 'executed' end,
         executed_at = now(),
         result = jsonb_build_object('transport', p_transport, 'ok', v_ok, 'failed', v_failed, 'simulated', p_transport = 'mock'),
         failure_reason = case when v_ok = 0 then 'every recipient failed' end
   where id = p_approval_id;
  return v_final;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------------------------
-- Creates or edits a draft. Editing a message that is awaiting approval or approved returns it to
-- draft (version + 1) and supersedes the open approval: the reviewed payload no longer exists.
create function public.save_communication(
  p_id uuid, p_event_id uuid, p_kind text, p_audience text, p_attendee_id uuid, p_subject text, p_body text,
  p_ai_run_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.communications;
  v_id uuid;
begin
  perform public.approval_assert_manager(p_event_id);
  if p_attendee_id is not null and not exists (
    select 1 from public.attendees where id = p_attendee_id and event_id = p_event_id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_ai_run_id is not null and not exists (
    select 1 from public.ai_runs where id = p_ai_run_id and event_id = p_event_id and pipeline = 'draft_message'
       and status = 'succeeded' and created_by = auth.uid()
  ) then
    raise exception 'run_not_usable' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.communications (event_id, kind, audience, attendee_id, subject, body, drafted_by, ai_run_id, is_mock_draft)
    values (p_event_id, p_kind, p_audience, p_attendee_id, btrim(p_subject), btrim(p_body),
            case when p_ai_run_id is null then 'organizer' else 'ai' end, p_ai_run_id,
            coalesce((select is_mock from public.ai_runs where id = p_ai_run_id), false))
    returning id into v_id;
    return v_id;
  end if;
  select * into v_c from public.communications where id = p_id for update;
  if v_c.id is null or v_c.event_id <> p_event_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- A failed send can be corrected and re-approved; nothing is resent without a new approval.
  if v_c.status not in ('draft', 'awaiting_approval', 'approved', 'failed') then
    raise exception 'invalid_transition: % messages can''t be edited', v_c.status using errcode = '23514';
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'draft_edited'
   where target_id = p_id and action_type = 'send_communication' and status in ('pending', 'approved');
  update public.communications
     set kind = p_kind, audience = p_audience, attendee_id = p_attendee_id, subject = btrim(p_subject), body = btrim(p_body),
         status = 'draft', version = version + 1,
         drafted_by = case when p_ai_run_id is null then drafted_by else 'ai' end,
         ai_run_id = coalesce(p_ai_run_id, ai_run_id),
         is_mock_draft = case when p_ai_run_id is null then is_mock_draft else coalesce((select is_mock from public.ai_runs where id = p_ai_run_id), false) end
   where id = p_id;
  return p_id;
end $$;

create function public.cancel_communication(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.communications;
begin
  select * into v_c from public.communications where id = p_id for update;
  if v_c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_c.event_id);
  if v_c.status not in ('draft', 'awaiting_approval', 'approved') then
    raise exception 'invalid_transition: % -> cancelled', v_c.status using errcode = '23514';
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'message_cancelled'
   where target_id = p_id and action_type = 'send_communication' and status in ('pending', 'approved');
  update public.communications set status = 'cancelled' where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants. Messages contain attendee data: event owner/organizers only.
-- ---------------------------------------------------------------------------------------------
alter table public.communications enable row level security;
alter table public.communication_deliveries enable row level security;
alter table public.approvals enable row level security;

create policy communications_select on public.communications for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy communication_deliveries_select on public.communication_deliveries for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy approvals_select on public.approvals for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());

grant select on public.communications, public.communication_deliveries, public.approvals to authenticated;

grant execute on function public.communication_recipients(uuid) to authenticated;
grant execute on function public.payload_hash(jsonb) to authenticated;
grant execute on function public.request_approval(text, uuid) to authenticated;
grant execute on function public.decide_approval(uuid, boolean, text) to authenticated;
grant execute on function public.claim_approval(uuid) to authenticated;
grant execute on function public.finish_communication(uuid, text, jsonb) to authenticated;
grant execute on function public.save_communication(uuid, uuid, text, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.cancel_communication(uuid) to authenticated;
grant execute on function public.start_ai_run(uuid, text, text, text, text, boolean) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
