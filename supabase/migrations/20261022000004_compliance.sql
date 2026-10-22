-- HalaEvents 0008 — compliance workflow: curated official-source registry, compliance checks with
-- explicit review states, source references, evidence, simulated official submissions (P5 + Phase 6,
-- event.md §19). Status rules mirror src/modules/compliance/rules.ts.
--
-- Honesty rules enforced here:
-- - "source_supported" needs a referenced source that a platform admin has verified (last_verified_at).
-- - "cleared" needs non-simulated evidence and a decision by the assigned reviewer (or a platform admin).
-- - "awaiting_official_response" needs a recorded submission reference or a simulated submission.
-- - Official submissions can only be simulated (CHECK is_simulated): no government integration exists.
-- - Nothing here is ever set by a model: there is no AI write path into these tables.

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  url text not null check (url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^[:space:]]*)?$' and char_length(url) <= 500),
  title text not null check (char_length(title) between 3 and 200),
  authority text not null check (char_length(authority) between 2 and 160),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z]{2,3})?$'),
  scope text not null default '' check (char_length(scope) <= 400),
  source_type text not null check (source_type in ('official_gov', 'official_free_zone', 'venue_policy', 'organizer_rule', 'other')),
  summary text not null default '' check (char_length(summary) <= 1200),
  -- Where the summary came from. A search-result summary is not the page itself.
  summary_kind text not null default 'none' check (summary_kind in ('none', 'search_result_summary', 'page_excerpt', 'team_paraphrase')),
  retrieval_status text not null default 'not_retrieved' check (retrieval_status in ('not_retrieved', 'retrieved', 'blocked', 'not_found')),
  retrieved_at timestamptz,
  retrieval_note text not null default '' check (char_length(retrieval_note) <= 400),
  last_verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  verification_note text check (verification_note is null or char_length(verification_note) between 10 and 400),
  is_curated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_verified check ((last_verified_at is null) = (verification_note is null))
);

create trigger knowledge_sources_updated_at before update on public.knowledge_sources
  for each row execute function public.set_updated_at();
create trigger knowledge_sources_audit after insert or update on public.knowledge_sources
  for each row execute function public.audit_row_change('id');

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  topic_key text not null check (char_length(topic_key) <= 64 and topic_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  category text not null check (category in (
    'permit', 'venue_policy', 'minors_safeguarding', 'food_safety', 'privacy_media', 'prizes_finance', 'health_safety', 'other'
  )),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  -- Why HalaEvents flagged this, in plain language (which answers/rules triggered it).
  reason text not null check (char_length(reason) between 3 and 600),
  origin text not null check (origin in ('rule', 'organizer')),
  severity text not null default 'info' check (severity in ('info', 'concern')),
  applicability text not null default 'unknown' check (applicability in ('unknown', 'likely_applies', 'applies', 'does_not_apply')),
  status text not null default 'not_assessed' check (status in (
    'not_assessed', 'needs_information', 'conditional', 'source_supported', 'under_review',
    'awaiting_official_response', 'cleared', 'action_required', 'rejected', 'closed'
  )),
  status_reason text check (status_reason is null or char_length(status_reason) <= 600),
  -- Null while only the rules have set the status; set once a person changes it.
  status_set_by uuid references auth.users (id) on delete set null,
  status_changed_at timestamptz,
  reviewer_user_id uuid references auth.users (id) on delete set null,
  next_action text check (next_action is null or char_length(next_action) <= 300),
  official_channel_id uuid references public.knowledge_sources (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, topic_key),
  constraint compliance_checks_custom_key check (origin = 'rule' or topic_key like 'custom.%')
);
create index compliance_checks_event on public.compliance_checks (event_id, status);

create trigger compliance_checks_updated_at before update on public.compliance_checks
  for each row execute function public.set_updated_at();

create table public.compliance_references (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.compliance_checks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  source_id uuid not null references public.knowledge_sources (id) on delete restrict,
  relevance_note text not null default '' check (char_length(relevance_note) <= 400),
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (check_id, source_id)
);

create table public.compliance_evidence (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.compliance_checks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in (
    'note', 'document_reference', 'reference_number', 'link', 'submission_reference', 'official_response'
  )),
  value text not null check (char_length(btrim(value)) between 3 and 1000),
  is_simulated boolean not null default false,
  recorded_by uuid references auth.users (id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  constraint compliance_evidence_link check (kind <> 'link' or value ~ '^https://[^[:space:]]+$')
);
create index compliance_evidence_check on public.compliance_evidence (check_id, recorded_at);

create table public.official_submissions (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.compliance_checks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  authority text not null check (char_length(authority) between 2 and 160),
  channel_source_id uuid references public.knowledge_sources (id) on delete set null,
  reference text not null unique check (reference ~ '^DEMO-[A-F0-9]{8}$'),
  status text not null default 'submitted' check (status in ('submitted', 'response_recorded')),
  -- MVP: no government integration exists, so every submission is a labelled simulation.
  is_simulated boolean not null default true check (is_simulated),
  response_summary text check (response_summary is null or char_length(response_summary) between 3 and 600),
  submitted_by uuid references auth.users (id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint official_submissions_response check ((status = 'response_recorded') = (responded_at is not null and response_summary is not null))
);

create trigger compliance_checks_audit after insert or delete on public.compliance_checks
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger compliance_checks_audit_update after update on public.compliance_checks
  for each row when (
    old.status is distinct from new.status or old.reviewer_user_id is distinct from new.reviewer_user_id
    or old.applicability is distinct from new.applicability or old.next_action is distinct from new.next_action
  )
  execute function public.audit_row_change('id', 'event_id');
create trigger compliance_references_audit after insert or delete on public.compliance_references
  for each row execute function public.audit_row_change('check_id', 'event_id');
create trigger compliance_evidence_audit after insert on public.compliance_evidence
  for each row execute function public.audit_row_change('check_id', 'event_id');
create trigger official_submissions_audit after insert or update on public.official_submissions
  for each row execute function public.audit_row_change('check_id', 'event_id');

-- ---------------------------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------------------------
create function public.compliance_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('not_assessed', 'needs_information'), ('not_assessed', 'conditional'), ('not_assessed', 'source_supported'),
    ('not_assessed', 'under_review'), ('not_assessed', 'action_required'), ('not_assessed', 'closed'),
    ('needs_information', 'conditional'), ('needs_information', 'source_supported'), ('needs_information', 'under_review'),
    ('needs_information', 'action_required'), ('needs_information', 'closed'),
    ('conditional', 'needs_information'), ('conditional', 'source_supported'), ('conditional', 'under_review'),
    ('conditional', 'action_required'), ('conditional', 'closed'),
    ('source_supported', 'needs_information'), ('source_supported', 'under_review'), ('source_supported', 'action_required'),
    ('action_required', 'needs_information'), ('action_required', 'under_review'), ('action_required', 'awaiting_official_response'),
    ('under_review', 'needs_information'), ('under_review', 'action_required'), ('under_review', 'awaiting_official_response'),
    ('under_review', 'cleared'), ('under_review', 'rejected'),
    ('awaiting_official_response', 'under_review'), ('awaiting_official_response', 'action_required'),
    ('cleared', 'under_review'),
    ('rejected', 'under_review'),
    ('closed', 'under_review')
  );
$$;

-- Internal: the caller manages the event (owner/organizer, active) and the event isn't finished.
create function public.compliance_assert_manager(p_event_id uuid) returns void
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

-- Notifications on compliance changes (concerns, status changes, review requests).
create function public.notify_compliance_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/app/events/' || new.event_id || '/compliance/' || new.id;
begin
  if tg_op = 'INSERT' then
    if new.severity = 'concern' then
      perform public.notify_event_managers(
        new.event_id, 'compliance_concern', 'Possible compliance concern: ' || new.title,
        'Flagged because: ' || left(new.reason, 400) || ' This is a prompt to check, not a finding.',
        v_link, 'concern:' || new.id, null
      );
    elsif new.status = 'needs_information' then
      perform public.notify_event_managers(
        new.event_id, 'missing_information', 'Compliance check needs information: ' || new.title,
        left(new.reason, 500), v_link, 'check-info:' || new.id, null
      );
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    perform public.notify_event_managers(
      new.event_id, 'compliance_status_changed', 'Compliance status changed: ' || new.title,
      replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' ')
        || coalesce('. Reason: ' || left(new.status_reason, 300), ''),
      v_link, 'status:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint, auth.uid()
    );
    if new.status = 'under_review' and new.reviewer_user_id is not null then
      perform public.notify_user(
        new.reviewer_user_id, new.event_id, 'decision_required', 'Review requested: ' || new.title,
        'You are the reviewer. Clear it only on recorded evidence, or mark action required.',
        v_link, 'review:' || new.id || ':' || extract(epoch from now())::bigint
      );
    end if;
  elsif new.reviewer_user_id is distinct from old.reviewer_user_id and new.reviewer_user_id is not null
        and new.reviewer_user_id is distinct from auth.uid() then
    perform public.notify_user(
      new.reviewer_user_id, new.event_id, 'decision_required', 'You were asked to review: ' || new.title,
      'Open the check to see the reason, sources and evidence.', v_link,
      'reviewer:' || new.id || ':' || new.reviewer_user_id
    );
  end if;
  return null;
end $$;

create trigger compliance_checks_notify after insert or update on public.compliance_checks
  for each row execute function public.notify_compliance_change();

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Inserts deterministic rule results. Existing checks are only updated while no person has set
-- their status yet and they're still in an automatic state; human decisions are never overwritten.
create function public.sync_compliance_checks(p_event_id uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_channel uuid;
begin
  perform public.compliance_assert_manager(p_event_id);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  perform 1 from public.events where id = p_event_id for update;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item ->> 'status', '') not in ('not_assessed', 'needs_information', 'conditional') then
      raise exception 'invalid_items: rules may only set not_assessed, needs_information or conditional' using errcode = '22023';
    end if;
    select id into v_channel from public.knowledge_sources where key = v_item ->> 'channelSourceKey';
    insert into public.compliance_checks (
      event_id, topic_key, category, title, description, reason, origin, severity, applicability, status,
      next_action, official_channel_id
    ) values (
      p_event_id, v_item ->> 'topicKey', v_item ->> 'category', v_item ->> 'title',
      coalesce(v_item ->> 'description', ''), v_item ->> 'reason', 'rule', coalesce(v_item ->> 'severity', 'info'),
      coalesce(v_item ->> 'applicability', 'unknown'), v_item ->> 'status', v_item ->> 'nextAction', v_channel
    )
    on conflict (event_id, topic_key) do update
      set reason = excluded.reason, severity = excluded.severity, applicability = excluded.applicability,
          status = excluded.status, next_action = excluded.next_action,
          official_channel_id = coalesce(excluded.official_channel_id, public.compliance_checks.official_channel_id)
      where public.compliance_checks.origin = 'rule'
        and public.compliance_checks.status_set_by is null
        and public.compliance_checks.status in ('not_assessed', 'needs_information', 'conditional')
        and (public.compliance_checks.status, public.compliance_checks.reason, public.compliance_checks.severity)
            is distinct from (excluded.status, excluded.reason, excluded.severity);
    if found then v_count := v_count + 1; end if;
    -- Curated sources for the topic are attached as references (data, not verification).
    insert into public.compliance_references (check_id, event_id, source_id, relevance_note)
    select c.id, p_event_id, s.id, 'Curated starting point for this topic. Check applicability.'
      from public.compliance_checks c
      join public.knowledge_sources s on s.key in (select jsonb_array_elements_text(coalesce(v_item -> 'sourceKeys', '[]')))
     where c.event_id = p_event_id and c.topic_key = v_item ->> 'topicKey'
    on conflict do nothing;
  end loop;
  return v_count;
end $$;

create function public.create_compliance_check(
  p_event_id uuid, p_topic_key text, p_category text, p_title text, p_description text, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.compliance_assert_manager(p_event_id);
  insert into public.compliance_checks (event_id, topic_key, category, title, description, reason, origin)
  values (p_event_id, p_topic_key, p_category, p_title, coalesce(p_description, ''), p_reason, 'organizer')
  returning id into v_id;
  return v_id;
end $$;

create function public.update_compliance_check(p_check_id uuid, p_applicability text, p_next_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.compliance_checks where id = p_check_id;
  if v_event is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_event);
  update public.compliance_checks
     set applicability = p_applicability, next_action = nullif(btrim(p_next_action), '')
   where id = p_check_id;
end $$;

create function public.assign_compliance_reviewer(p_check_id uuid, p_reviewer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.compliance_checks where id = p_check_id for update;
  if v_event is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_event);
  if p_reviewer is not null and not exists (
    select 1 from public.event_members where event_id = v_event and user_id = p_reviewer and role in ('owner', 'organizer')
  ) then
    raise exception 'reviewer_not_event_manager' using errcode = '23514';
  end if;
  update public.compliance_checks set reviewer_user_id = p_reviewer where id = p_check_id;
end $$;

create function public.add_compliance_reference(p_check_id uuid, p_source_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.compliance_checks where id = p_check_id;
  if v_event is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_event);
  insert into public.compliance_references (check_id, event_id, source_id, relevance_note)
  values (p_check_id, v_event, p_source_id, coalesce(p_note, ''));
end $$;

-- Evidence a person records (never simulated through this function).
create function public.add_compliance_evidence(p_check_id uuid, p_kind text, p_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_id uuid;
begin
  select event_id into v_event from public.compliance_checks where id = p_check_id;
  if v_event is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_event);
  insert into public.compliance_evidence (check_id, event_id, kind, value, is_simulated)
  values (p_check_id, v_event, p_kind, btrim(p_value), false)
  returning id into v_id;
  return v_id;
end $$;

create function public.set_compliance_status(p_check_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.compliance_checks;
  v_is_admin boolean := public.is_platform_admin();
begin
  select * into v_c from public.compliance_checks where id = p_check_id for update;
  if v_c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_is_admin and public.is_active_account() then
    if not public.event_workspace_open(v_c.event_id) then
      raise exception 'event_locked' using errcode = '23514';
    end if;
  else
    perform public.compliance_assert_manager(v_c.event_id);
  end if;
  if not public.compliance_transition_allowed(v_c.status, p_status) then
    raise exception 'invalid_transition: % -> %', v_c.status, p_status using errcode = '23514';
  end if;
  p_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if p_status = 'source_supported' and not exists (
    select 1 from public.compliance_references r join public.knowledge_sources s on s.id = r.source_id
     where r.check_id = p_check_id and s.last_verified_at is not null
  ) then
    raise exception 'source_not_verified: reference a source that a person has verified first' using errcode = '23514';
  end if;
  if p_status = 'under_review' and v_c.reviewer_user_id is null then
    raise exception 'reviewer_required: assign a reviewer first' using errcode = '23514';
  end if;
  if p_status in ('cleared', 'rejected') and auth.uid() is distinct from v_c.reviewer_user_id and not v_is_admin then
    raise exception 'reviewer_only: only the assigned reviewer or a platform admin can decide' using errcode = '42501';
  end if;
  if p_status = 'cleared' and not exists (
    select 1 from public.compliance_evidence where check_id = p_check_id and not is_simulated
  ) then
    raise exception 'evidence_required: record real evidence before clearing' using errcode = '23514';
  end if;
  if p_status = 'awaiting_official_response'
     and not exists (select 1 from public.compliance_evidence where check_id = p_check_id and kind = 'submission_reference')
     and not exists (select 1 from public.official_submissions where check_id = p_check_id) then
    raise exception 'submission_required: record the submission reference first' using errcode = '23514';
  end if;
  if p_status in ('rejected', 'closed', 'action_required', 'cleared') and (p_reason is null or char_length(p_reason) < 5) then
    raise exception 'reason_required' using errcode = '23514';
  end if;

  update public.compliance_checks
     set status = p_status, status_reason = left(p_reason, 600), status_set_by = auth.uid(), status_changed_at = now()
   where id = p_check_id;
end $$;

-- DEMONSTRATION ONLY: records a simulated submission to the check's official channel. Nothing is
-- transmitted anywhere; the reference is generated here and starts with DEMO-.
create function public.simulate_official_submission(p_check_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.compliance_checks;
  v_authority text;
  v_ref text := 'DEMO-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_id uuid;
begin
  select * into v_c from public.compliance_checks where id = p_check_id for update;
  if v_c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_c.event_id);
  select authority into v_authority from public.knowledge_sources where id = v_c.official_channel_id;
  insert into public.official_submissions (check_id, event_id, authority, channel_source_id, reference)
  values (p_check_id, v_c.event_id, coalesce(v_authority, 'No official channel recorded'), v_c.official_channel_id, v_ref)
  returning id into v_id;
  insert into public.compliance_evidence (check_id, event_id, kind, value, is_simulated)
  values (p_check_id, v_c.event_id, 'submission_reference',
          'Simulated submission ' || v_ref || ' (demonstration; nothing was sent to ' || coalesce(v_authority, 'any authority') || ')', true);
  return v_id;
end $$;

create function public.record_simulated_response(p_submission_id uuid, p_summary text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.official_submissions;
begin
  select * into v_s from public.official_submissions where id = p_submission_id for update;
  if v_s.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.compliance_assert_manager(v_s.event_id);
  if v_s.status <> 'submitted' then
    raise exception 'invalid_transition: % -> response_recorded', v_s.status using errcode = '23514';
  end if;
  update public.official_submissions
     set status = 'response_recorded', response_summary = btrim(p_summary), responded_at = now()
   where id = p_submission_id;
  insert into public.compliance_evidence (check_id, event_id, kind, value, is_simulated)
  values (v_s.check_id, v_s.event_id, 'official_response',
          'Simulated response to ' || v_s.reference || ': ' || btrim(p_summary), true);
end $$;

-- Platform admins record that a person checked a source's current content (or withdraw that).
create function public.set_source_verification(p_source_id uuid, p_verified boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_verified and char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'note_required: say what was checked' using errcode = '23514';
  end if;
  update public.knowledge_sources
     set last_verified_at = case when p_verified then now() end,
         verified_by = case when p_verified then auth.uid() end,
         verification_note = case when p_verified then btrim(p_note) end
   where id = p_source_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants: members read their event's compliance data; everyone signed in reads the source
-- registry. No direct writes for any API role.
-- ---------------------------------------------------------------------------------------------
alter table public.knowledge_sources enable row level security;
alter table public.compliance_checks enable row level security;
alter table public.compliance_references enable row level security;
alter table public.compliance_evidence enable row level security;
alter table public.official_submissions enable row level security;

create policy knowledge_sources_select on public.knowledge_sources for select to authenticated using (true);
create policy compliance_checks_select on public.compliance_checks for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy compliance_references_select on public.compliance_references for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy compliance_evidence_select on public.compliance_evidence for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy official_submissions_select on public.official_submissions for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());

grant select on public.knowledge_sources, public.compliance_checks, public.compliance_references,
  public.compliance_evidence, public.official_submissions to authenticated;

grant execute on function public.sync_compliance_checks(uuid, jsonb) to authenticated;
grant execute on function public.create_compliance_check(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.update_compliance_check(uuid, text, text) to authenticated;
grant execute on function public.assign_compliance_reviewer(uuid, uuid) to authenticated;
grant execute on function public.add_compliance_reference(uuid, uuid, text) to authenticated;
grant execute on function public.add_compliance_evidence(uuid, text, text) to authenticated;
grant execute on function public.set_compliance_status(uuid, text, text) to authenticated;
grant execute on function public.simulate_official_submission(uuid) to authenticated;
grant execute on function public.record_simulated_response(uuid, text) to authenticated;
grant execute on function public.set_source_verification(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Curated source registry (reference data). Checked 2026-10-22: the DET pages answer HTTP 403 to
-- automated clients, so their summaries come from search-result snippets, not the pages; the DDA
-- URL in the project report returned 404 and was replaced by the address search returned. None is
-- verified: last_verified_at stays null until a platform admin checks the live page.
-- ---------------------------------------------------------------------------------------------
insert into public.knowledge_sources
  (key, url, title, authority, jurisdiction, scope, source_type, summary, summary_kind, retrieval_status, retrieved_at, retrieval_note)
values
  ('det_event_permit',
   'https://www.dubaidet.gov.ae/en/our-services/for-consumers-and-students/apply-for-an-event-permit',
   'Apply for an event permit', 'Dubai Department of Economy and Tourism (DET)', 'AE-DU',
   'Event permits in Dubai issued through the DET e-Permits portal.',
   'official_gov',
   'Search-result summary (not the page itself): a permit is described as required for venues or organisers holding entertainment, sport, charity, religious or business events; applications go through the e-Permits portal, which requires registration with a Dubai trade licence; a venue NOC is uploaded; the permit is described as issued within five business days after approval and payment. Check the live page before relying on any of this.',
   'search_result_summary', 'blocked', '2026-10-22T09:00:00Z',
   'Direct fetch returned HTTP 403 (automated clients blocked). Summary from a web-search result on 2026-10-22.'),
  ('det_epermits_register',
   'https://www.dubaidet.gov.ae/en/our-services/for-consumers-and-students/register-on-epermits',
   'Register on the ePermits portal', 'Dubai Department of Economy and Tourism (DET)', 'AE-DU',
   'Registration of companies on the DET e-Permits portal (prerequisite for event permits).',
   'official_gov',
   'Search-result summary: applicants register on the portal before applying; the summary says only companies holding a Dubai trade licence can use e-Permits and that account approval takes about 24 hours. Not checked against the live page.',
   'search_result_summary', 'blocked', '2026-10-22T09:00:00Z',
   'Direct fetch returned HTTP 403. Summary from a web-search result on 2026-10-22.'),
  ('det_events_activations',
   'https://www.dubaidet.gov.ae/en/licences-and-permits/events-and-activations',
   'Events and activations licences', 'Dubai Department of Economy and Tourism (DET)', 'AE-DU',
   'Overview of DET licences and permits for events and activations.',
   'official_gov', '', 'none', 'blocked', '2026-10-22T09:00:00Z',
   'Direct fetch returned HTTP 403; no content summary recorded.'),
  ('det_ticketed_events',
   'https://www.dubaidet.gov.ae/en/our-services/for-consumers-and-students/apply-to-sell-event-tickets',
   'Issue event tickets', 'Dubai Department of Economy and Tourism (DET)', 'AE-DU',
   'Ticketed events, registrations and guest lists for permitted events.',
   'official_gov',
   'Search-result summary: events involving tickets, registrations or guest lists are described as needing a separate ticketed-event permit. Whether a free university hackathon registration falls under this is not established; ask DET.',
   'search_result_summary', 'not_retrieved', '2026-10-22T09:00:00Z',
   'Not fetched directly (same site blocks automated clients). Summary from a web-search result on 2026-10-22.'),
  ('dda_event_permit',
   'https://dda.gov.ae/en/planning-development/advertising-and-events/events-services/event-permit',
   'Event Permit (DDA)', 'Dubai Development Authority (DDA)', 'AE-DU',
   'Events inside DDA jurisdiction (free zone areas it administers, e.g. TECOM communities).',
   'official_free_zone',
   'Search-result summary: the service grants permits for events within DDA jurisdiction (free zone areas); documents listed include a layout, a master-developer NOC, an agenda, the organiser trade licence and an emergency/evacuation plan; applications through DDA e-services. Fee figures in search results conflicted, so none are recorded.',
   'search_result_summary', 'not_retrieved', '2026-10-22T09:00:00Z',
   'The project report URL (…/advertising-and-events/event-permit) returned HTTP 404 on 2026-10-22; this address came from a web search and was not fetched.'),
  ('uae_gov_portal',
   'https://u.ae/', 'The Official Platform of the UAE Government', 'UAE Government (TDRA)', 'AE',
   'General entry point to UAE federal and emirate government services and information.',
   'official_gov',
   'Fetched 2026-10-22: the official UAE government portal for citizens, residents and visitors; supported by the Telecommunications and Digital Government Regulatory Authority (TDRA). It does not by itself establish any event requirement.',
   'team_paraphrase', 'retrieved', '2026-10-22T09:00:00Z',
   'Fetched successfully on 2026-10-22.');

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
