-- HalaEvents 0006 — AI runs, plan proposals and suggestions (P3, event.md §17).
-- AI output is stored only as proposals: nothing here creates tasks, sends messages or changes any
-- status outside these tables. Model output is validated with Zod before it reaches these RPCs;
-- the database enforces membership, event state, run ownership, sizes and single-flight runs.

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  pipeline text not null check (pipeline in ('interview', 'plan', 'revise_task')),
  provider text not null check (provider in ('gemini', 'mock')),
  model text not null check (char_length(model) between 1 and 80),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (
    status in ('running', 'succeeded', 'invalid_output', 'failed', 'rate_limited', 'timeout', 'model_unavailable')
  ),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 600000),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  is_mock boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_runs_finished check ((status = 'running') = (finished_at is null))
);

-- Single flight: one running call per event and pipeline (duplicate clicks / concurrent requests).
create unique index ai_runs_one_running on public.ai_runs (event_id, pipeline) where status = 'running';
create index ai_runs_user_recent on public.ai_runs (created_by, created_at);
create index ai_runs_event_lookup on public.ai_runs (event_id, pipeline, input_hash, status);

create table public.ai_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  source text not null check (source in ('ai', 'playbook')),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  playbook_id text not null check (char_length(playbook_id) <= 64 and playbook_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  playbook_version integer not null check (playbook_version between 1 and 10000),
  assumptions jsonb not null default '[]' check (
    jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) <= 8 and octet_length(assumptions::text) <= 4000
  ),
  status text not null default 'current' check (status in ('current', 'superseded')),
  is_mock boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index ai_plans_one_current on public.ai_plans (event_id) where status = 'current';

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  plan_id uuid references public.ai_plans (id) on delete cascade,
  kind text not null check (kind in ('question', 'task')),
  source text not null check (source in ('ai', 'playbook')),
  item_key text not null check (char_length(item_key) <= 64 and item_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'superseded')),
  revision smallint not null default 1 check (revision between 1 and 100),
  is_mock boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_suggestions_task_in_plan check ((kind = 'task') = (plan_id is not null)),
  constraint ai_suggestions_question_key check (kind <> 'question' or item_key like 'custom.%')
);

create unique index ai_suggestions_one_live_question on public.ai_suggestions (event_id, item_key)
  where kind = 'question' and status in ('proposed', 'accepted');
create unique index ai_suggestions_one_live_task on public.ai_suggestions (plan_id, item_key)
  where kind = 'task' and status in ('proposed', 'accepted');
create index ai_suggestions_event on public.ai_suggestions (event_id, kind, status);

create trigger ai_suggestions_updated_at before update on public.ai_suggestions
  for each row execute function public.set_updated_at();

-- Audit: plan creation/supersession and every suggestion decision (event.md §5.5).
create trigger ai_plans_audit after insert or update of status on public.ai_plans
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger ai_suggestions_audit_status after update of status on public.ai_suggestions
  for each row when (old.status is distinct from new.status)
  execute function public.audit_row_change('id', 'event_id');

-- ---------------------------------------------------------------------------------------------
-- Internal guard (not granted: only callable from the SECURITY DEFINER functions below).
-- Mirrors INTERVIEW_EDITABLE_STATUSES: AI planning only while the event is being planned.
-- ---------------------------------------------------------------------------------------------
create function public.ai_assert_event_manager(p_event_id uuid) returns void
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
  select status into v_status from public.events where id = p_event_id;
  if v_status not in ('draft', 'planning', 'ready') then
    raise exception 'event_locked: %', v_status using errcode = '23514';
  end if;
end $$;

-- A finished, successful run of the caller for this event/pipeline whose output hasn't been saved yet.
create function public.ai_assert_usable_run(p_run_id uuid, p_event_id uuid, p_pipeline text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.ai_runs
     where id = p_run_id and event_id = p_event_id and pipeline = p_pipeline
       and status = 'succeeded' and created_by = auth.uid()
  ) then
    raise exception 'run_not_usable' using errcode = '22023';
  end if;
  if exists (select 1 from public.ai_suggestions where ai_run_id = p_run_id)
     or exists (select 1 from public.ai_plans where ai_run_id = p_run_id) then
    raise exception 'run_already_used' using errcode = '23505';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Starts a model call. Refuses a second concurrent call for the same event/pipeline and more than
-- 20 calls per user per hour (an app-side cap, independent of the provider's own quota).
create function public.start_ai_run(
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
  perform public.ai_assert_event_manager(p_event_id);
  -- A run left 'running' by a crashed request is closed after 3 minutes (client timeouts are shorter).
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

create function public.finish_ai_run(
  p_run_id uuid,
  p_status text,
  p_error_code text,
  p_attempts integer,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_model text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status = 'running' then
    raise exception 'invalid_transition: running -> running' using errcode = '23514';
  end if;
  update public.ai_runs
     set status = p_status, error_code = p_error_code, attempts = p_attempts, latency_ms = p_latency_ms,
         input_tokens = p_input_tokens, output_tokens = p_output_tokens,
         model = coalesce(nullif(p_model, ''), model), finished_at = now()
   where id = p_run_id and created_by = auth.uid() and status = 'running';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $$;

-- Saves validated follow-up questions from a successful interview run. Existing live keys are skipped.
create function public.save_ai_followups(p_run_id uuid, p_event_id uuid, p_questions jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_mock boolean;
begin
  perform public.ai_assert_event_manager(p_event_id);
  perform public.ai_assert_usable_run(p_run_id, p_event_id, 'interview');
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 3 then
    raise exception 'invalid_questions' using errcode = '22023';
  end if;
  if (select count(*) from public.ai_suggestions
       where event_id = p_event_id and kind = 'question' and status in ('proposed', 'accepted'))
     + jsonb_array_length(p_questions) > 15 then
    raise exception 'too_many_followups' using errcode = '22023';
  end if;
  select is_mock into v_mock from public.ai_runs where id = p_run_id;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    insert into public.ai_suggestions (event_id, ai_run_id, kind, source, item_key, payload, is_mock, created_by)
    values (p_event_id, p_run_id, 'question', 'ai', v_item ->> 'key', v_item -> 'payload', v_mock, auth.uid())
    on conflict do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- Replaces the current plan with a new one (AI run output, or the playbook fallback without a run).
create function public.save_ai_plan(
  p_event_id uuid,
  p_run_id uuid,
  p_source text,
  p_input_hash text,
  p_playbook_id text,
  p_playbook_version integer,
  p_assumptions jsonb,
  p_tasks jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan uuid;
  v_old uuid;
  v_mock boolean := false;
  v_item jsonb;
begin
  perform public.ai_assert_event_manager(p_event_id);
  if p_source = 'ai' then
    perform public.ai_assert_usable_run(p_run_id, p_event_id, 'plan');
    select is_mock into v_mock from public.ai_runs where id = p_run_id;
  elsif p_source = 'playbook' then
    if p_run_id is not null then
      raise exception 'playbook_plan_has_no_run' using errcode = '22023';
    end if;
  else
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) not between 1 and 40 then
    raise exception 'invalid_tasks' using errcode = '22023';
  end if;

  perform 1 from public.events where id = p_event_id for update;  -- serialize plan replacement
  select id into v_old from public.ai_plans where event_id = p_event_id and status = 'current';
  if v_old is not null then
    update public.ai_suggestions set status = 'superseded'
     where plan_id = v_old and status = 'proposed';
    update public.ai_plans set status = 'superseded' where id = v_old;
  end if;

  insert into public.ai_plans (
    event_id, ai_run_id, source, input_hash, playbook_id, playbook_version, assumptions, is_mock, created_by
  ) values (
    p_event_id, p_run_id, p_source, p_input_hash, p_playbook_id, p_playbook_version,
    coalesce(p_assumptions, '[]'), v_mock, auth.uid()
  ) returning id into v_plan;

  for v_item in select value from jsonb_array_elements(p_tasks) loop
    insert into public.ai_suggestions (event_id, ai_run_id, plan_id, kind, source, item_key, payload, is_mock, created_by)
    values (p_event_id, p_run_id, v_plan, 'task', p_source, v_item ->> 'key', v_item -> 'payload', v_mock, auth.uid());
  end loop;
  return v_plan;
end $$;

-- Targeted revision of one task of the current plan: the old row is superseded, the new one keeps
-- the same key and plan, with revision + 1.
create function public.revise_ai_task(p_suggestion_id uuid, p_run_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.ai_suggestions;
  v_id uuid;
begin
  select * into v_old from public.ai_suggestions where id = p_suggestion_id for update;
  if v_old.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.ai_assert_event_manager(v_old.event_id);
  perform public.ai_assert_usable_run(p_run_id, v_old.event_id, 'revise_task');
  if v_old.kind <> 'task' or v_old.status <> 'proposed'
     or not exists (select 1 from public.ai_plans where id = v_old.plan_id and status = 'current') then
    raise exception 'invalid_transition: % -> superseded', v_old.status using errcode = '23514';
  end if;
  update public.ai_suggestions set status = 'superseded', decided_by = auth.uid(), decided_at = now()
   where id = v_old.id;
  insert into public.ai_suggestions (
    event_id, ai_run_id, plan_id, kind, source, item_key, payload, revision, is_mock, created_by
  ) values (
    v_old.event_id, p_run_id, v_old.plan_id, 'task', 'ai', v_old.item_key, p_payload, v_old.revision + 1,
    (select is_mock from public.ai_runs where id = p_run_id), auth.uid()
  ) returning id into v_id;
  return v_id;
end $$;

-- The organizer dismisses a proposed suggestion (task or follow-up question).
create function public.dismiss_ai_suggestion(p_suggestion_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.ai_suggestions;
begin
  select * into v_row from public.ai_suggestions where id = p_suggestion_id for update;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.ai_assert_event_manager(v_row.event_id);
  if v_row.status <> 'proposed' then
    raise exception 'invalid_transition: % -> rejected', v_row.status using errcode = '23514';
  end if;
  update public.ai_suggestions set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = v_row.id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants. Runs (usage, errors) are visible to event managers; plans and suggestions to every
-- event member. No direct writes for any API role.
-- ---------------------------------------------------------------------------------------------
alter table public.ai_runs enable row level security;
alter table public.ai_plans enable row level security;
alter table public.ai_suggestions enable row level security;

create policy ai_runs_select_manager on public.ai_runs for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) or public.is_platform_admin());
create policy ai_plans_select_member on public.ai_plans for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy ai_suggestions_select_member on public.ai_suggestions for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());

grant select on public.ai_runs, public.ai_plans, public.ai_suggestions to authenticated;

grant execute on function public.start_ai_run(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.finish_ai_run(uuid, text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.save_ai_followups(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_ai_plan(uuid, uuid, text, text, text, integer, jsonb, jsonb) to authenticated;
grant execute on function public.revise_ai_task(uuid, uuid, jsonb) to authenticated;
grant execute on function public.dismiss_ai_suggestion(uuid) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
