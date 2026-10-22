-- HalaEvents 0005 — adaptive interview answers (P2, event.md §16).
-- Questions live in versioned TypeScript playbooks (src/playbooks/); the database stores answers.
-- The app validates each answer against its playbook question with Zod before calling
-- save_interview_answers(); this migration enforces membership, event state, key format and size.

create table public.interview_answers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  question_key text not null check (
    char_length(question_key) <= 64 and question_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  -- JSON null = the organizer skipped an optional question.
  answer jsonb not null check (
    jsonb_typeof(answer) in ('string', 'number', 'boolean', 'array', 'null')
    and octet_length(answer::text) <= 4000
  ),
  source text not null default 'organizer' check (source in ('organizer', 'ai_suggested_default')),
  playbook_id text not null check (
    char_length(playbook_id) <= 64 and playbook_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  playbook_version integer not null check (playbook_version between 1 and 10000),
  answered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_answers_one_per_key unique (event_id, question_key)
);

create trigger interview_answers_updated_at before update on public.interview_answers
  for each row execute function public.set_updated_at();

-- Upserts answers (object: question_key → JSON value) and deletes answers whose question no longer
-- applies, in one transaction. Only event owners/organizers with an active account, and only while
-- the event is still being planned (mirrors INTERVIEW_EDITABLE_STATUSES in interview-rules.ts).
create function public.save_interview_answers(
  p_event_id uuid,
  p_playbook_id text,
  p_playbook_version integer,
  p_answers jsonb,
  p_remove_keys text[] default '{}'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_item record;
  v_count integer := 0;
  v_remove text[] := coalesce(p_remove_keys, '{}');
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
  if v_status not in ('draft', 'planning', 'ready') then
    raise exception 'interview_locked: %', v_status using errcode = '23514';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers_not_object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) > 100 or cardinality(v_remove) > 100 then
    raise exception 'too_many_answers' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_answers) k where k = any (v_remove)) then
    raise exception 'answer_and_remove_overlap' using errcode = '22023';
  end if;

  for v_item in select key, value from jsonb_each(p_answers) loop
    insert into public.interview_answers (
      event_id, question_key, answer, source, playbook_id, playbook_version, answered_by
    ) values (
      p_event_id, v_item.key, v_item.value, 'organizer', p_playbook_id, p_playbook_version, auth.uid()
    )
    on conflict (event_id, question_key) do update
      set answer = excluded.answer,
          source = 'organizer',
          playbook_id = excluded.playbook_id,
          playbook_version = excluded.playbook_version,
          answered_by = excluded.answered_by;
    v_count := v_count + 1;
  end loop;

  delete from public.interview_answers where event_id = p_event_id and question_key = any (v_remove);
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants: every event member reads (viewers included); writes only through the RPC.
-- ---------------------------------------------------------------------------------------------
alter table public.interview_answers enable row level security;

create policy interview_answers_select_member on public.interview_answers for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());

grant select on public.interview_answers to authenticated;
grant execute on function public.save_interview_answers(uuid, text, integer, jsonb, text[]) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
