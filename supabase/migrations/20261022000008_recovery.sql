-- HalaEvents 0008 — venue-cancellation recovery workflow (P8, event.md §23).
--
-- Everything here is a SIMULATION: incidents.is_simulated is CHECK-constrained to true, so a "real"
-- incident cannot be recorded by this workflow. Consequences of that rule:
--   * the venue booking itself is never changed by the simulation (cancelling it stays a separate,
--     approval-gated booking action);
--   * provider inquiries are only recorded as "sent_simulated" — no provider member is notified;
--   * attendee updates are normal drafts in `communications`, but they can only ever be delivered
--     through the mock transport (trigger below), and carry a [SIMULATION] label.
-- Flow: simulate (idempotent) → deterministic impact snapshot (SQL) → AI proposal validated in code
-- and stored here as a proposal → organizer picks changes → approval of the exact change list
-- (approvals gate, payload hash) → execution in one transaction. Nothing is applied before that.

-- AI pipeline 'recovery' ------------------------------------------------------------------------
alter table public.ai_runs drop constraint ai_runs_pipeline_check;
alter table public.ai_runs add constraint ai_runs_pipeline_check
  check (pipeline in ('interview', 'plan', 'revise_task', 'draft_message', 'recovery'));

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
  if p_pipeline in ('draft_message', 'recovery') then
    if auth.uid() is null then
      raise exception 'unauthenticated' using errcode = '28000';
    end if;
    if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if (select status from public.events where id = p_event_id) = 'archived'
       or (p_pipeline = 'recovery' and not public.event_workspace_open(p_event_id)) then
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

-- Tables ----------------------------------------------------------------------------------------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null default 'venue_cancellation' check (kind in ('venue_cancellation')),
  -- Only simulations can be recorded. A real incident would need a different, evidenced workflow.
  is_simulated boolean not null default true check (is_simulated),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  -- Repeated requests carrying the same key (double click, retry) return the same incident.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  status text not null default 'assessing' check (status in (
    'reported', 'assessing', 'replan_proposed', 'resolved', 'dismissed'
  )),
  simulated_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  -- Deterministic snapshot taken at simulation time (the "original plan" and what it touches).
  impact jsonb not null check (jsonb_typeof(impact) = 'object' and octet_length(impact::text) <= 400000),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, idempotency_key),
  constraint incidents_closed check ((status in ('resolved', 'dismissed')) = (closed_at is not null))
);
-- One active recovery per booking, whatever key was sent.
create unique index incidents_one_active on public.incidents (booking_id)
  where status in ('reported', 'assessing', 'replan_proposed');
create index incidents_event on public.incidents (event_id, created_at desc);
create trigger incidents_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();
create trigger incidents_audit after insert on public.incidents
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger incidents_audit_status after update of status on public.incidents
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

create table public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  is_mock boolean not null default false,
  -- The validated model proposal as shown to the organizer (options, timeline, risks, questions…).
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object' and octet_length(proposal::text) <= 100000),
  proposal_hash text not null check (proposal_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' check (status in (
    'proposed', 'approved', 'partially_approved', 'rejected', 'superseded'
  )),
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  applied_at timestamptz,
  applied_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint recovery_plans_applied check ((status in ('approved', 'partially_approved')) = (applied_at is not null))
);
create unique index recovery_plans_one_proposed on public.recovery_plans (incident_id) where status = 'proposed';
create unique index recovery_plans_one_applied on public.recovery_plans (incident_id)
  where status in ('approved', 'partially_approved');
create unique index recovery_plans_one_per_run on public.recovery_plans (ai_run_id) where ai_run_id is not null;
create trigger recovery_plans_audit after insert on public.recovery_plans
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger recovery_plans_audit_status after update of status on public.recovery_plans
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

create table public.recovery_changes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.recovery_plans (id) on delete cascade,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  seq integer not null check (seq >= 0),
  -- The ONLY things a recovery plan can do. There is deliberately no kind that cancels, rebooks or
  -- confirms a booking, or changes an attendee: those stay separate, approval-gated actions.
  kind text not null check (kind in ('reschedule_task', 'add_task', 'flag_review')),
  entity_type text check (entity_type in ('task', 'booking', 'compliance_check')),
  entity_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4000),
  selected boolean not null default true,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'skipped')),
  applied_at timestamptz,
  constraint recovery_changes_entity check ((kind = 'add_task') = (entity_id is null)),
  constraint recovery_changes_applied check ((status = 'applied') = (applied_at is not null))
);
create unique index recovery_changes_one_per_entity on public.recovery_changes (plan_id, kind, entity_id)
  where entity_id is not null;
create index recovery_changes_plan on public.recovery_changes (plan_id, seq);
create trigger recovery_changes_audit after update of status on public.recovery_changes
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

-- "Mark for review or reconfirmation": a flag records that someone must look at the item again.
-- It never changes the item's own status (a booking stays as it is until its provider says otherwise).
create table public.recovery_flags (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  entity_type text not null check (entity_type in ('task', 'booking', 'compliance_check')),
  entity_id uuid not null,
  action text not null check (action in ('review', 'reconfirm', 'reassess')),
  reason text not null check (char_length(reason) between 3 and 400),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (incident_id, entity_type, entity_id),
  constraint recovery_flags_resolved check ((status = 'resolved') = (resolved_at is not null))
);
create index recovery_flags_event on public.recovery_flags (event_id, status);
create trigger recovery_flags_audit after insert on public.recovery_flags
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger recovery_flags_audit_status after update of status on public.recovery_flags
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

create table public.recovery_inquiries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  plan_id uuid not null references public.recovery_plans (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete set null,
  purpose text not null check (purpose in ('venue_cancellation_terms', 'replacement_venue_availability', 'service_reconfirmation')),
  subject text not null check (char_length(btrim(subject)) between 3 and 200),
  body text not null check (char_length(btrim(body)) between 10 and 3000),
  version integer not null default 1 check (version between 1 and 10000),
  -- sent_simulated: recorded as sent, but nobody was contacted (the incident is a simulation).
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_approval', 'approved', 'sent_simulated', 'cancelled'
  )),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_inquiries_sent check ((status = 'sent_simulated') = (sent_at is not null))
);
create index recovery_inquiries_plan on public.recovery_inquiries (plan_id);
create trigger recovery_inquiries_updated_at before update on public.recovery_inquiries
  for each row execute function public.set_updated_at();
create trigger recovery_inquiries_audit after insert on public.recovery_inquiries
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger recovery_inquiries_audit_status after update of status on public.recovery_inquiries
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

-- Attendee updates are ordinary communications, linked to the plan that produced them.
alter table public.communications
  add column recovery_plan_id uuid references public.recovery_plans (id) on delete set null;

-- Backstop: a message that belongs to a simulated recovery can only be "delivered" by the mock transport.
create function public.enforce_simulated_recovery_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.transport <> 'mock' and exists (
    select 1 from public.communications c where c.id = new.communication_id and c.recovery_plan_id is not null
  ) then
    raise exception 'simulated_only: messages of a simulated recovery are never sent for real' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger communication_deliveries_simulated_only before insert on public.communication_deliveries
  for each row execute function public.enforce_simulated_recovery_delivery();

-- Approvals: two new gated actions ----------------------------------------------------------------
alter table public.approvals drop constraint approvals_action_type_check;
alter table public.approvals add constraint approvals_action_type_check check (action_type in (
  'send_communication', 'request_booking', 'cancel_booking', 'apply_recovery', 'send_provider_inquiry'
));

-- Deterministic impact analysis (SQL, stable). Every list is derived from recorded rows only:
--   affected_tasks  tasks in the venue category, plus every task that (transitively) depends on one
--   services        the event's live bookings with non-venue providers (never cancelled by the workflow)
--   compliance      checks that depend on the venue (permit / venue policy / safety categories, or a
--                   venue/access/fire/evacuation title) that are not closed, rejected or not applicable
--   candidates      verified, active, listed venues of the right size and city; "availability" is only
--                   ever 'conflict_recorded' (a confirmed booking overlaps) or 'unknown'
create function public.recovery_impact(p_event_id uuid, p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.events;
  v_b public.bookings;
  v_all jsonb;
  v_tasks jsonb;
  v_services jsonb;
  v_checks jsonb;
  v_cands jsonb;
begin
  select * into v_e from public.events where id = p_event_id;
  select * into v_b from public.bookings where id = p_booking_id and event_id = p_event_id;
  if v_e.id is null or v_b.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'category', t.category, 'status', t.status,
           'priority', t.priority, 'due_date', t.due_date
         ) order by t.due_date nulls last, t.title), '[]'::jsonb)
    into v_all from public.tasks t where t.event_id = p_event_id;

  with recursive dep as (
    select t.id, 'venue_task'::text as reason, 0 as depth
      from public.tasks t
     where t.event_id = p_event_id and t.category = 'venue' and t.status <> 'cancelled'
    union
    select d.task_id, 'depends_on_venue_work'::text, dep.depth + 1
      from public.task_dependencies d
      join dep on d.depends_on_task_id = dep.id
      join public.tasks t on t.id = d.task_id
     where t.status <> 'cancelled' and dep.depth < 20
  ), first_reason as (
    select distinct on (id) id, reason from dep order by id, depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'category', t.category, 'status', t.status,
           'priority', t.priority, 'due_date', t.due_date, 'reason', f.reason
         ) order by t.due_date nulls last, t.title), '[]'::jsonb)
    into v_tasks
    from first_reason f join public.tasks t on t.id = f.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'provider_id', b.provider_id, 'provider_name', b.provider_name,
           'category', p.category, 'status', b.status, 'amount', b.amount, 'currency', b.currency,
           'conditions', b.conditions, 'service_from', b.service_from, 'service_to', b.service_to
         ) order by p.category, b.provider_name), '[]'::jsonb)
    into v_services
    from public.bookings b join public.providers p on p.id = b.provider_id
   where b.event_id = p_event_id and p.kind = 'service'
     and b.status in ('proposed', 'awaiting_organizer_approval', 'awaiting_provider', 'confirmed');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'category', c.category, 'status', c.status, 'topic_key', c.topic_key,
           'reason', case when c.status = 'cleared'
                          then 'Was cleared for the previous venue; reassess it for the new one.'
                          else 'Unresolved and may depend on the venue.' end
         ) order by c.category, c.title), '[]'::jsonb)
    into v_checks
    from public.compliance_checks c
   where c.event_id = p_event_id
     and c.applicability <> 'does_not_apply'
     and c.status not in ('closed', 'rejected')
     and (c.category in ('permit', 'venue_policy', 'health_safety', 'food_safety', 'minors_safeguarding')
          or c.title ~* '(venue|access|fire|evacuat)');

  select coalesce(jsonb_agg(x.j order by x.name), '[]'::jsonb) into v_cands from (
    select p.name, jsonb_build_object(
             'provider_id', p.id, 'name', p.name, 'city', p.city,
             'min_capacity', p.min_capacity, 'max_capacity', p.max_capacity,
             'price_min', p.price_min, 'price_max', p.price_max, 'currency', p.currency,
             'quote', (select to_jsonb(q) from (
                         select qq.id as quote_id, qq.amount, qq.currency, qq.valid_until, qq.conditions
                           from public.quotes qq join public.service_requests r on r.id = qq.request_id
                          where r.event_id = p_event_id and r.category = 'venue' and r.status <> 'cancelled'
                            and qq.provider_id = p.id and qq.status = 'submitted' and qq.valid_until > now()
                          order by qq.amount limit 1) q),
             'availability', case when exists (
                                select 1 from public.bookings o
                                 where o.provider_id = p.id and o.status in ('confirmed', 'completed', 'disputed')
                                   and o.service_from < v_b.service_to and v_b.service_from < o.service_to
                              ) then 'conflict_recorded' else 'unknown' end
           ) as j
      from public.providers p
     where p.kind = 'venue' and p.id <> v_b.provider_id
       and p.verification_status = 'verified' and p.moderation_status = 'active' and p.is_listed
       and (p.min_capacity is null or p.min_capacity <= v_e.capacity)
       and (p.max_capacity is null or p.max_capacity >= v_e.capacity)
       and (v_e.city is null or p.city is null or lower(p.city) = lower(v_e.city)
            or exists (select 1 from unnest(p.service_area) a where lower(a) = lower(v_e.city)))
     order by p.name
     limit 10
  ) x;

  return jsonb_build_object(
    'version', 1,
    'event', jsonb_build_object(
      'name', v_e.name, 'status', v_e.status, 'starts_at', v_e.starts_at, 'ends_at', v_e.ends_at,
      'timezone', v_e.timezone, 'city', v_e.city, 'capacity', v_e.capacity,
      'budget_amount', v_e.budget_amount, 'currency', v_e.currency
    ),
    'venue', jsonb_build_object(
      'booking_id', v_b.id, 'provider_id', v_b.provider_id, 'provider_name', v_b.provider_name,
      'status', v_b.status, 'amount', v_b.amount, 'currency', v_b.currency, 'conditions', v_b.conditions,
      'service_from', v_b.service_from, 'service_to', v_b.service_to, 'confirmed_at', v_b.confirmed_at
    ),
    'plan_tasks', v_all,
    'affected_tasks', v_tasks,
    'services', v_services,
    'compliance', v_checks,
    'candidates', v_cands
  );
end $$;

-- Simulation (idempotent) -------------------------------------------------------------------------
-- Same key → same incident (created = false). Another key for a booking that already has an active
-- recovery → that incident too. Never touches the booking.
create function public.simulate_venue_cancellation(
  p_event_id uuid, p_booking_id uuid, p_idempotency_key text, p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_kind text;
  v_existing public.incidents;
  v_id uuid;
begin
  perform public.approval_assert_manager(p_event_id);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  -- Serializes concurrent requests for the same event.
  perform 1 from public.events where id = p_event_id for update;
  select * into v_existing from public.incidents where event_id = p_event_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.booking_id <> p_booking_id then
      raise exception 'idempotency_conflict: that key was used for another booking' using errcode = '23505';
    end if;
    return jsonb_build_object('id', v_existing.id, 'created', false);
  end if;
  if not public.event_workspace_open(p_event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  select * into v_b from public.bookings where id = p_booking_id and event_id = p_event_id;
  if v_b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select kind into v_kind from public.providers where id = v_b.provider_id;
  if v_kind <> 'venue' then
    raise exception 'not_a_venue_booking: only a venue booking can be simulated as cancelled' using errcode = '23514';
  end if;
  if v_b.status not in ('awaiting_provider', 'confirmed') then
    raise exception 'booking_not_simulatable: the venue booking must be sent to the venue or confirmed' using errcode = '23514';
  end if;
  select * into v_existing from public.incidents
   where booking_id = p_booking_id and status in ('reported', 'assessing', 'replan_proposed');
  if found then
    return jsonb_build_object('id', v_existing.id, 'created', false);
  end if;
  insert into public.incidents (event_id, booking_id, idempotency_key, note, impact)
  values (p_event_id, p_booking_id, p_idempotency_key, nullif(btrim(coalesce(p_note, '')), ''),
          public.recovery_impact(p_event_id, p_booking_id))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
end $$;

-- Venue bookings an organizer may simulate a cancellation for (no active recovery yet).
create function public.simulatable_venue_bookings(p_event_id uuid) returns table (
  booking_id uuid, provider_name text, status text, amount numeric, currency char(3),
  service_from timestamptz, service_to timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.approval_assert_manager(p_event_id);
  return query
    select b.id, b.provider_name, b.status, b.amount, b.currency, b.service_from, b.service_to
      from public.bookings b join public.providers p on p.id = b.provider_id
     where b.event_id = p_event_id and p.kind = 'venue' and b.status in ('awaiting_provider', 'confirmed')
       and not exists (
         select 1 from public.incidents i
          where i.booking_id = b.id and i.status in ('reported', 'assessing', 'replan_proposed')
       )
     order by b.service_from;
end $$;

-- Internal: withdraws everything a plan produced that has not been used yet.
create function public.recovery_withdraw_plan(p_plan_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.approvals set status = 'superseded', failure_reason = p_reason
   where status in ('pending', 'approved')
     and ((action_type = 'apply_recovery' and target_id = p_plan_id)
          or (action_type = 'send_provider_inquiry'
              and target_id in (select id from public.recovery_inquiries where plan_id = p_plan_id))
          or (action_type = 'send_communication'
              and target_id in (select id from public.communications where recovery_plan_id = p_plan_id)));
  update public.recovery_inquiries set status = 'cancelled'
   where plan_id = p_plan_id and status in ('draft', 'awaiting_approval', 'approved');
  update public.communications set status = 'cancelled'
   where recovery_plan_id = p_plan_id and status in ('draft', 'awaiting_approval', 'approved');
end $$;

create function public.recovery_assert_incident(p_incident_id uuid) returns public.incidents
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.incidents;
begin
  select * into v_i from public.incidents where id = p_incident_id for update;
  if v_i.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_i.event_id);
  return v_i;
end $$;

-- Stores a proposal that the server already validated with Zod and the deterministic rules. The
-- database repeats the checks that protect the organizer's data: every referenced task, booking,
-- check and provider must be part of THIS incident's impact snapshot, and the AI run must be a
-- successful 'recovery' run of the caller that was not used before.
create function public.save_recovery_plan(
  p_incident_id uuid, p_ai_run_id uuid, p_proposal jsonb, p_changes jsonb, p_inquiries jsonb, p_attendee_draft jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.incidents := public.recovery_assert_incident(p_incident_id);
  v_plan uuid;
  v_old uuid;
  v_c jsonb;
  v_n integer := 0;
  v_ent uuid;
  v_type text;
  v_kind text;
  v_provider uuid;
  v_booking uuid;
  v_ok boolean;
  v_run_mock boolean;
  v_prefix constant text := 'SIMULATED DEMO — this message belongs to a practice scenario; no real venue cancellation has occurred.';
begin
  if v_i.status not in ('assessing', 'replan_proposed') then
    raise exception 'invalid_transition: incident is %', v_i.status using errcode = '23514';
  end if;
  if not public.event_workspace_open(v_i.event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  select is_mock into v_run_mock from public.ai_runs
   where id = p_ai_run_id and event_id = v_i.event_id and pipeline = 'recovery'
     and status = 'succeeded' and created_by = auth.uid();
  if not found then raise exception 'run_not_usable' using errcode = '22023'; end if;
  if exists (select 1 from public.recovery_plans where ai_run_id = p_ai_run_id) then
    raise exception 'run_already_used' using errcode = '23505';
  end if;
  if jsonb_typeof(p_proposal) <> 'object' or jsonb_typeof(p_changes) <> 'array' or jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_typeof(p_attendee_draft) <> 'object'
     or jsonb_array_length(p_changes) > 200 or jsonb_array_length(p_inquiries) > 12 then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  for v_c in select value from jsonb_array_elements(p_changes) loop
    v_kind := v_c ->> 'kind';
    v_type := v_c ->> 'entity_type';
    v_ent := nullif(v_c ->> 'entity_id', '')::uuid;
    if v_kind = 'reschedule_task' then
      v_ok := v_type = 'task' and ((v_c -> 'payload') ->> 'due_date') is not null and exists (
        select 1 from jsonb_array_elements(v_i.impact -> 'affected_tasks') x
         where x ->> 'id' = v_ent::text
      ) and exists (
        select 1 from public.tasks where id = v_ent and event_id = v_i.event_id and status in ('todo', 'in_progress')
      );
      perform ((v_c -> 'payload') ->> 'due_date')::date;
    elsif v_kind = 'add_task' then
      v_ok := v_ent is null and v_type is null
        and char_length(btrim(coalesce((v_c -> 'payload') ->> 'title', ''))) between 3 and 120
        and ((v_c -> 'payload') ->> 'due_date') is not null;
      perform ((v_c -> 'payload') ->> 'due_date')::date;
    elsif v_kind = 'flag_review' then
      v_ok := case v_type
        when 'task' then exists (select 1 from jsonb_array_elements(v_i.impact -> 'affected_tasks') x where x ->> 'id' = v_ent::text)
        when 'booking' then exists (select 1 from jsonb_array_elements(v_i.impact -> 'services') x where x ->> 'booking_id' = v_ent::text)
        when 'compliance_check' then exists (select 1 from jsonb_array_elements(v_i.impact -> 'compliance') x where x ->> 'id' = v_ent::text)
        else false end;
    else
      v_ok := false;
    end if;
    if not coalesce(v_ok, false) then
      raise exception 'invalid_plan: change % is not part of this incident', v_n + 1 using errcode = '22023';
    end if;
    v_n := v_n + 1;
  end loop;

  for v_c in select value from jsonb_array_elements(p_inquiries) loop
    v_provider := (v_c ->> 'provider_id')::uuid;
    v_booking := nullif(v_c ->> 'booking_id', '')::uuid;
    v_ok := v_provider::text = (v_i.impact -> 'venue' ->> 'provider_id')
         or exists (select 1 from jsonb_array_elements(v_i.impact -> 'services') x where x ->> 'provider_id' = v_provider::text)
         or exists (select 1 from jsonb_array_elements(v_i.impact -> 'candidates') x where x ->> 'provider_id' = v_provider::text);
    if v_ok and v_booking is not null then
      v_ok := exists (select 1 from public.bookings where id = v_booking and event_id = v_i.event_id and provider_id = v_provider);
    end if;
    if not coalesce(v_ok, false) then
      raise exception 'invalid_plan: inquiry to a provider outside this incident' using errcode = '22023';
    end if;
  end loop;

  -- A new proposal replaces the previous unapplied one (and withdraws what that one produced).
  for v_old in select id from public.recovery_plans where incident_id = p_incident_id and status = 'proposed' loop
    perform public.recovery_withdraw_plan(v_old, 'plan_superseded');
    update public.recovery_plans set status = 'superseded' where id = v_old;
  end loop;

  insert into public.recovery_plans (incident_id, event_id, ai_run_id, is_mock, proposal, proposal_hash)
  values (p_incident_id, v_i.event_id, p_ai_run_id, coalesce(v_run_mock, false), p_proposal, public.payload_hash(p_proposal))
  returning id into v_plan;

  insert into public.recovery_changes (plan_id, incident_id, event_id, seq, kind, entity_type, entity_id, payload)
  select v_plan, p_incident_id, v_i.event_id, (t.ord - 1)::integer, t.value ->> 'kind', nullif(t.value ->> 'entity_type', ''),
         nullif(t.value ->> 'entity_id', '')::uuid, t.value -> 'payload'
    from jsonb_array_elements(p_changes) with ordinality as t(value, ord);

  insert into public.recovery_inquiries (incident_id, plan_id, event_id, provider_id, booking_id, purpose, subject, body)
  select p_incident_id, v_plan, v_i.event_id, (t.value ->> 'provider_id')::uuid, nullif(t.value ->> 'booking_id', '')::uuid,
         t.value ->> 'purpose', left('[SIMULATION] ' || btrim(t.value ->> 'subject'), 200),
         left(v_prefix || E'\n\n' || btrim(t.value ->> 'body'), 3000)
    from jsonb_array_elements(p_inquiries) as t(value);

  insert into public.communications (event_id, kind, audience, subject, body, drafted_by, ai_run_id, is_mock_draft, recovery_plan_id)
  values (v_i.event_id, 'venue_update', 'all_places', left('[SIMULATION] ' || btrim(p_attendee_draft ->> 'subject'), 200),
          left(v_prefix || E'\n\n' || btrim(p_attendee_draft ->> 'body'), 5000), 'ai', p_ai_run_id, coalesce(v_run_mock, false), v_plan);

  update public.incidents set status = 'replan_proposed' where id = p_incident_id;
  return v_plan;
end $$;

-- Selection: which proposed changes the organizer wants applied. Changing it invalidates any open approval.
create function public.set_recovery_selection(p_plan_id uuid, p_change_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.recovery_plans;
begin
  select * into v_p from public.recovery_plans where id = p_plan_id for update;
  if v_p.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_p.event_id);
  if v_p.status <> 'proposed' then
    raise exception 'invalid_transition: plan is %', v_p.status using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_change_ids, '{}')) i where not exists (
      select 1 from public.recovery_changes c where c.id = i and c.plan_id = p_plan_id
    )
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'selection_changed'
   where action_type = 'apply_recovery' and target_id = p_plan_id and status in ('pending', 'approved');
  update public.recovery_changes set selected = (id = any (coalesce(p_change_ids, '{}'))) where plan_id = p_plan_id;
end $$;

create function public.reject_recovery_plan(p_plan_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.recovery_plans;
begin
  select * into v_p from public.recovery_plans where id = p_plan_id for update;
  if v_p.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_p.event_id);
  if v_p.status <> 'proposed' then
    raise exception 'invalid_transition: plan is %', v_p.status using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  perform public.recovery_withdraw_plan(p_plan_id, 'plan_rejected');
  update public.recovery_plans set status = 'rejected', status_reason = left(btrim(p_reason), 500) where id = p_plan_id;
  update public.incidents set status = 'assessing' where id = v_p.incident_id;
end $$;

create function public.close_incident(p_incident_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.incidents := public.recovery_assert_incident(p_incident_id);
  v_plan uuid;
begin
  if p_outcome not in ('resolved', 'dismissed') then raise exception 'invalid_transition' using errcode = '23514'; end if;
  if v_i.status in ('resolved', 'dismissed') then
    raise exception 'invalid_transition: incident is %', v_i.status using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  if p_outcome = 'resolved' and not exists (
    select 1 from public.recovery_plans where incident_id = p_incident_id and status in ('approved', 'partially_approved')
  ) then
    raise exception 'plan_not_applied: apply an approved plan before resolving' using errcode = '23514';
  end if;
  for v_plan in select id from public.recovery_plans where incident_id = p_incident_id and status = 'proposed' loop
    perform public.recovery_withdraw_plan(v_plan, 'incident_closed');
    update public.recovery_plans set status = 'superseded' where id = v_plan;
  end loop;
  update public.incidents
     set status = p_outcome, resolution_note = left(btrim(p_note), 500), closed_by = auth.uid(), closed_at = now()
   where id = p_incident_id;
end $$;

create function public.resolve_recovery_flag(p_flag_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.recovery_flags;
begin
  select * into v_f from public.recovery_flags where id = p_flag_id for update;
  if v_f.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_f.event_id);
  if v_f.status <> 'open' then raise exception 'invalid_transition: flag is %', v_f.status using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'reason_required' using errcode = '23514'; end if;
  update public.recovery_flags
     set status = 'resolved', resolution_note = left(btrim(p_note), 500), resolved_by = auth.uid(), resolved_at = now()
   where id = p_flag_id;
end $$;

-- Inquiry drafts: editable until sent; editing withdraws the open approval.
create function public.update_recovery_inquiry(p_id uuid, p_subject text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.recovery_inquiries;
begin
  select * into v_q from public.recovery_inquiries where id = p_id for update;
  if v_q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_q.event_id);
  if v_q.status not in ('draft', 'awaiting_approval', 'approved') then
    raise exception 'invalid_transition: inquiry is %', v_q.status using errcode = '23514';
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'draft_edited'
   where action_type = 'send_provider_inquiry' and target_id = p_id and status in ('pending', 'approved');
  update public.recovery_inquiries
     set subject = btrim(p_subject), body = btrim(p_body), version = version + 1, status = 'draft'
   where id = p_id;
end $$;

create function public.discard_recovery_inquiry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.recovery_inquiries;
begin
  select * into v_q from public.recovery_inquiries where id = p_id for update;
  if v_q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.approval_assert_manager(v_q.event_id);
  if v_q.status not in ('draft', 'awaiting_approval', 'approved') then
    raise exception 'invalid_transition: inquiry is %', v_q.status using errcode = '23514';
  end if;
  update public.approvals set status = 'superseded', failure_reason = 'inquiry_discarded'
   where action_type = 'send_provider_inquiry' and target_id = p_id and status in ('pending', 'approved');
  update public.recovery_inquiries set status = 'cancelled' where id = p_id;
end $$;

-- Approval integration ---------------------------------------------------------------------------
create or replace function public.approval_payload(p_action_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.communications;
  v_b public.bookings;
  v_p public.recovery_plans;
  v_q public.recovery_inquiries;
  v_changes jsonb;
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
  if p_action_type = 'apply_recovery' then
    select * into v_p from public.recovery_plans where id = p_target_id;
    if v_p.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    -- Each selected change with the CURRENT state of what it touches: if a task, booking or check
    -- changed after the review, the payload differs and the approval is superseded.
    select coalesce(jsonb_agg(jsonb_build_object(
             'change_id', c.id, 'kind', c.kind, 'entity_type', c.entity_type, 'entity_id', c.entity_id,
             'payload', c.payload,
             'current', case c.entity_type
               when 'task' then (select jsonb_build_object('title', t.title, 'status', t.status, 'due_date', t.due_date)
                                   from public.tasks t where t.id = c.entity_id)
               when 'booking' then (select jsonb_build_object('provider', b.provider_name, 'status', b.status)
                                      from public.bookings b where b.id = c.entity_id)
               when 'compliance_check' then (select jsonb_build_object('title', k.title, 'status', k.status)
                                               from public.compliance_checks k where k.id = c.entity_id)
               else null end
           ) order by c.seq), '[]'::jsonb)
      into v_changes from public.recovery_changes c where c.plan_id = p_target_id and c.selected;
    return jsonb_build_object(
      'plan_id', v_p.id, 'incident_id', v_p.incident_id, 'proposal_hash', v_p.proposal_hash,
      'changes', v_changes,
      'recipient_summary', jsonb_array_length(v_changes) || ' recovery change(s) for a simulated venue cancellation'
    );
  end if;
  if p_action_type = 'send_provider_inquiry' then
    select * into v_q from public.recovery_inquiries where id = p_target_id;
    if v_q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object(
      'inquiry_id', v_q.id, 'version', v_q.version, 'provider_id', v_q.provider_id,
      'provider_name', (select name from public.providers where id = v_q.provider_id),
      'booking_id', v_q.booking_id, 'purpose', v_q.purpose, 'subject', v_q.subject, 'body', v_q.body,
      'recipient_summary', 'Simulated inquiry to ' || (select name from public.providers where id = v_q.provider_id)
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
  if p_action_type = 'apply_recovery' then
    return (select event_id from public.recovery_plans where id = p_target_id);
  end if;
  if p_action_type = 'send_provider_inquiry' then
    return (select event_id from public.recovery_inquiries where id = p_target_id);
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
  elsif p_action_type = 'send_provider_inquiry' then
    update public.recovery_inquiries
       set status = case p_status when 'pending' then 'awaiting_approval' when 'approved' then 'approved' else 'draft' end
     where id = p_target_id and status in ('draft', 'awaiting_approval', 'approved');
  end if;
  -- apply_recovery: the plan stays 'proposed' until execution; nothing to sync.
end $$;

-- request_approval with preconditions for the two new actions (everything else as in 0010/0011).
create or replace function public.request_approval(p_action_type text, p_target_id uuid) returns uuid
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
    if (select status from public.bookings where id = p_target_id) <> 'proposed' then
      raise exception 'invalid_transition: only proposed bookings can be submitted for approval' using errcode = '23514';
    end if;
  elsif p_action_type = 'cancel_booking' then
    if not exists (
      select 1 from public.bookings where id = p_target_id and status = 'confirmed' and pending_cancellation_reason is not null
    ) then
      raise exception 'invalid_transition: use request_booking_cancellation with a reason' using errcode = '23514';
    end if;
  elsif p_action_type = 'apply_recovery' then
    if (select status from public.recovery_plans where id = p_target_id) <> 'proposed' then
      raise exception 'invalid_transition: only proposed recovery plans can be submitted for approval' using errcode = '23514';
    end if;
    if not exists (select 1 from public.recovery_changes where plan_id = p_target_id and selected) then
      raise exception 'nothing_selected: select at least one change' using errcode = '23514';
    end if;
    if not public.event_workspace_open(v_event) then
      raise exception 'event_locked' using errcode = '23514';
    end if;
  elsif p_action_type = 'send_provider_inquiry' then
    if (select status from public.recovery_inquiries where id = p_target_id) <> 'draft' then
      raise exception 'invalid_transition: only drafts can be submitted for approval' using errcode = '23514';
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

-- Executes an approved change list in ONE transaction: claim → re-check the reviewed payload → apply.
create function public.execute_recovery_approval(p_approval_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
  v_p public.recovery_plans;
  v_c jsonb;
  v_applied integer := 0;
  v_skipped integer;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null or v_a.action_type <> 'apply_recovery' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.status in ('executing', 'executed', 'execution_failed') then
    raise exception 'already_executed' using errcode = '23505';
  end if;
  if v_a.status <> 'approved' then raise exception 'not_approved' using errcode = '23514'; end if;
  if not public.approval_payload_unchanged(v_a) then return 'superseded'; end if;
  select * into v_p from public.recovery_plans where id = v_a.target_id for update;
  if v_p.status <> 'proposed' then
    raise exception 'invalid_transition: plan is %', v_p.status using errcode = '23514';
  end if;
  if not public.event_workspace_open(v_a.event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  for v_c in select value from jsonb_array_elements(v_a.payload -> 'changes') loop
    if v_c ->> 'kind' = 'reschedule_task' then
      update public.tasks set due_date = ((v_c -> 'payload') ->> 'due_date')::date
       where id = (v_c ->> 'entity_id')::uuid and event_id = v_a.event_id;
    elsif v_c ->> 'kind' = 'add_task' then
      insert into public.tasks (event_id, title, description, category, priority, due_date)
      values (v_a.event_id, btrim((v_c -> 'payload') ->> 'title'),
              left(coalesce((v_c -> 'payload') ->> 'description', ''), 1000),
              coalesce((v_c -> 'payload') ->> 'category', 'venue'),
              coalesce((v_c -> 'payload') ->> 'priority', 'high'),
              ((v_c -> 'payload') ->> 'due_date')::date);
    else
      insert into public.recovery_flags (incident_id, event_id, entity_type, entity_id, action, reason)
      values (v_p.incident_id, v_a.event_id, v_c ->> 'entity_type', (v_c ->> 'entity_id')::uuid,
              coalesce((v_c -> 'payload') ->> 'action', 'review'), left((v_c -> 'payload') ->> 'reason', 400))
      on conflict (incident_id, entity_type, entity_id) do nothing;
    end if;
    update public.recovery_changes set status = 'applied', applied_at = now() where id = (v_c ->> 'change_id')::uuid;
    v_applied := v_applied + 1;
  end loop;
  update public.recovery_changes set status = 'skipped' where plan_id = v_p.id and status = 'proposed';
  get diagnostics v_skipped = row_count;
  update public.recovery_plans
     set status = case when v_skipped = 0 then 'approved' else 'partially_approved' end,
         applied_at = now(), applied_by = auth.uid()
   where id = v_p.id;
  update public.approvals
     set status = 'executed', executed_by = auth.uid(), execution_started_at = now(), executed_at = now(),
         result = jsonb_build_object('applied', v_applied, 'skipped', v_skipped)
   where id = p_approval_id;
  return 'executed';
end $$;

-- Provider inquiries of a simulated incident are RECORDED as sent, nobody is contacted.
create function public.execute_inquiry_approval(p_approval_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.approvals;
begin
  select * into v_a from public.approvals where id = p_approval_id for update;
  if v_a.id is null or v_a.action_type <> 'send_provider_inquiry' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.approval_assert_manager(v_a.event_id);
  if v_a.status in ('executing', 'executed', 'execution_failed') then
    raise exception 'already_executed' using errcode = '23505';
  end if;
  if v_a.status <> 'approved' then raise exception 'not_approved' using errcode = '23514'; end if;
  if not public.approval_payload_unchanged(v_a) then return 'superseded'; end if;
  update public.recovery_inquiries set status = 'sent_simulated', sent_at = now() where id = v_a.target_id;
  update public.approvals
     set status = 'executed', executed_by = auth.uid(), execution_started_at = now(), executed_at = now(),
         result = jsonb_build_object('simulated', true, 'contacted', false)
   where id = p_approval_id;
  return 'executed';
end $$;

-- RLS + grants -----------------------------------------------------------------------------------
alter table public.incidents enable row level security;
alter table public.recovery_plans enable row level security;
alter table public.recovery_changes enable row level security;
alter table public.recovery_flags enable row level security;
alter table public.recovery_inquiries enable row level security;

create policy incidents_select on public.incidents for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy recovery_plans_select on public.recovery_plans for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy recovery_changes_select on public.recovery_changes for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy recovery_flags_select on public.recovery_flags for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy recovery_inquiries_select on public.recovery_inquiries for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());

grant select on public.incidents, public.recovery_plans, public.recovery_changes,
  public.recovery_flags, public.recovery_inquiries to authenticated;

grant execute on function public.simulate_venue_cancellation(uuid, uuid, text, text) to authenticated;
grant execute on function public.simulatable_venue_bookings(uuid) to authenticated;
grant execute on function public.save_recovery_plan(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.set_recovery_selection(uuid, uuid[]) to authenticated;
grant execute on function public.reject_recovery_plan(uuid, text) to authenticated;
grant execute on function public.close_incident(uuid, text, text) to authenticated;
grant execute on function public.resolve_recovery_flag(uuid, text) to authenticated;
grant execute on function public.update_recovery_inquiry(uuid, text, text) to authenticated;
grant execute on function public.discard_recovery_inquiry(uuid) to authenticated;
grant execute on function public.execute_recovery_approval(uuid) to authenticated;
grant execute on function public.execute_inquiry_approval(uuid) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
