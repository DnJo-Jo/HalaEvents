-- HalaEvents 0020 — generated plan drafts (event.md §17.7): 'cloudflare' as a run provider and the
-- prompt version on each run, for usage tracking (provider, model, prompt version, latency, tokens).
-- Additive: older provider names stay allowed for history; existing runs keep prompt_version null.
alter table public.ai_runs drop constraint ai_runs_provider_check;
alter table public.ai_runs add constraint ai_runs_provider_check
  check (provider in ('gemini', 'groq', 'xai', 'mock', 'playbook', 'cloudflare'));

alter table public.ai_runs add column prompt_version text
  check (prompt_version is null or prompt_version ~ '^[a-z][a-z0-9_.-]{0,39}@[0-9]{1,4}$');

-- Same checks as 0008 (membership, event lock, abandoned-run cleanup, 20 runs/user/hour, one running
-- call per event and pipeline), plus the optional prompt version. Existing 6-argument callers keep
-- working through the default.
drop function public.start_ai_run(uuid, text, text, text, text, boolean);
create function public.start_ai_run(
  p_event_id uuid,
  p_pipeline text,
  p_provider text,
  p_model text,
  p_input_hash text,
  p_is_mock boolean,
  p_prompt_version text default null
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
    insert into public.ai_runs (event_id, pipeline, provider, model, input_hash, is_mock, created_by, prompt_version)
    values (p_event_id, p_pipeline, p_provider, p_model, p_input_hash, coalesce(p_is_mock, false), auth.uid(),
            p_prompt_version)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ai_run_in_progress' using errcode = '23505';
  end;
  return v_id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.start_ai_run(uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
