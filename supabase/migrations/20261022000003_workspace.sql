-- HalaEvents 0007 — event workspace: tasks, task dependencies, accepting a plan into tasks,
-- the event timeline and in-app notifications (P4 + Phase 6, event.md §18).
-- Status rules mirror src/modules/tasks/rules.ts. "Blocked" and "overdue" are derived, not stored.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  category text not null default 'logistics' check (category in (
    'venue', 'logistics', 'catering', 'safety', 'compliance', 'registration', 'communications',
    'sponsorship', 'finance', 'technology', 'judging', 'staffing', 'closeout'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  -- Calendar date in the event's timezone (deadlines are days, not instants).
  due_date date,
  owner_user_id uuid references auth.users (id) on delete set null,
  owner_label text check (owner_label is null or char_length(owner_label) between 2 and 60),
  origin text not null default 'manual' check (origin in ('manual', 'ai_plan', 'playbook_plan')),
  suggestion_id uuid references public.ai_suggestions (id) on delete set null,
  plan_item_key text check (plan_item_key is null or plan_item_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completed check ((status = 'done') = (completed_at is not null)),
  constraint tasks_origin_link check ((origin = 'manual') = (suggestion_id is null and plan_item_key is null))
);

create unique index tasks_one_per_suggestion on public.tasks (suggestion_id) where suggestion_id is not null;
create index tasks_event_idx on public.tasks (event_id, status, due_date);

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id)
);
create index task_dependencies_reverse on public.task_dependencies (depends_on_task_id);

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create function public.task_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('todo', 'in_progress'), ('todo', 'done'), ('todo', 'cancelled'),
    ('in_progress', 'todo'), ('in_progress', 'done'), ('in_progress', 'cancelled'),
    ('done', 'in_progress'),
    ('cancelled', 'todo')
  );
$$;

-- A task is blocked while any task it depends on is neither done nor cancelled.
create function public.task_is_blocked(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.task_dependencies d
      join public.tasks t on t.id = d.depends_on_task_id
     where d.task_id = p_task_id and t.status not in ('done', 'cancelled')
  );
$$;

-- Events whose work can still change. Completed/archived/cancelled events are read-only.
create function public.event_workspace_open(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events where id = p_event_id and status in ('draft', 'planning', 'ready', 'live')
  );
$$;

create function public.enforce_task_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.event_workspace_open(new.event_id) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'todo' then
      raise exception 'invalid_transition: new task must start as todo' using errcode = '23514';
    end if;
  else
    if new.event_id is distinct from old.event_id or new.origin is distinct from old.origin
       or new.suggestion_id is distinct from old.suggestion_id or new.plan_item_key is distinct from old.plan_item_key then
      raise exception 'task_identity_immutable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if not public.task_status_transition_allowed(old.status, new.status) then
        raise exception 'invalid_transition: % -> %', old.status, new.status using errcode = '23514';
      end if;
      if new.status = 'done' and public.task_is_blocked(new.id) then
        raise exception 'task_blocked: finish or cancel its dependencies first' using errcode = '23514';
      end if;
    end if;
  end if;
  new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) else null end;
  -- Owners are people who can act on the event: its owner or organizers.
  if new.owner_user_id is not null and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and not exists (
       select 1 from public.event_members
        where event_id = new.event_id and user_id = new.owner_user_id and role in ('owner', 'organizer')
     ) then
    raise exception 'owner_not_event_manager' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger tasks_enforce_rules before insert or update on public.tasks
  for each row execute function public.enforce_task_rules();

-- Same event, open workspace, and no cycle. The event row lock serializes concurrent edge inserts,
-- so two requests can't each add half of a cycle.
create function public.enforce_task_dependency_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_dep_event uuid;
begin
  select event_id into v_event from public.tasks where id = new.task_id;
  select event_id into v_dep_event from public.tasks where id = new.depends_on_task_id;
  if v_event is null or v_dep_event is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_event <> v_dep_event then
    raise exception 'cross_event_dependency' using errcode = '23514';
  end if;
  if not public.event_workspace_open(v_event) then
    raise exception 'event_locked' using errcode = '23514';
  end if;
  new.event_id := v_event;
  perform 1 from public.events where id = v_event for update;
  if exists (
    with recursive reach(id) as (
      select d.depends_on_task_id from public.task_dependencies d where d.task_id = new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join reach r on d.task_id = r.id
    )
    select 1 from reach where id = new.task_id
  ) then
    raise exception 'dependency_cycle' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger task_dependencies_enforce_rules before insert on public.task_dependencies
  for each row execute function public.enforce_task_dependency_rules();

create trigger tasks_audit after insert or delete on public.tasks
  for each row execute function public.audit_row_change('id', 'event_id');
create trigger tasks_audit_update after update of status, owner_user_id, owner_label, due_date, priority, title on public.tasks
  for each row when (
    old.status is distinct from new.status or old.owner_user_id is distinct from new.owner_user_id
    or old.owner_label is distinct from new.owner_label or old.due_date is distinct from new.due_date
    or old.priority is distinct from new.priority or old.title is distinct from new.title
  )
  execute function public.audit_row_change('id', 'event_id');
create trigger task_dependencies_audit after insert or delete on public.task_dependencies
  for each row execute function public.audit_row_change('task_id', 'event_id');

-- ---------------------------------------------------------------------------------------------
-- Accepting plan proposals into tasks (the only path from AI output to real tasks).
-- ---------------------------------------------------------------------------------------------
create function public.accept_ai_plan(p_plan_id uuid, p_suggestion_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.ai_plans;
  v_s record;
  v_dep text;
  v_count integer := 0;
begin
  select * into v_plan from public.ai_plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.ai_assert_event_manager(v_plan.event_id);
  if v_plan.status <> 'current' then
    raise exception 'invalid_transition: plan is superseded' using errcode = '23514';
  end if;
  perform 1 from public.events where id = v_plan.event_id for update;

  for v_s in
    select * from public.ai_suggestions
     where plan_id = p_plan_id and kind = 'task' and status = 'proposed'
       and (p_suggestion_ids is null or id = any (p_suggestion_ids))
     for update
  loop
    insert into public.tasks (
      event_id, title, description, category, priority, due_date, owner_label, origin, suggestion_id, plan_item_key
    ) values (
      v_plan.event_id,
      left(v_s.payload ->> 'title', 120),
      left(coalesce(v_s.payload ->> 'description', ''), 1000),
      v_s.payload ->> 'category',
      v_s.payload ->> 'priority',
      (v_s.payload ->> 'dueDate')::date,
      nullif(left(v_s.payload ->> 'proposedOwner', 60), ''),
      case when v_s.source = 'ai' then 'ai_plan' else 'playbook_plan' end,
      v_s.id,
      v_s.item_key
    );
    update public.ai_suggestions set status = 'accepted', decided_by = auth.uid(), decided_at = now()
     where id = v_s.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'nothing_to_accept' using errcode = '22023';
  end if;

  -- Wire dependencies between every accepted task of this plan (earlier partial accepts included).
  for v_s in
    select t.id as task_id, s.payload from public.tasks t
      join public.ai_suggestions s on s.id = t.suggestion_id
     where s.plan_id = p_plan_id
  loop
    for v_dep in select jsonb_array_elements_text(coalesce(v_s.payload -> 'dependsOn', '[]')) loop
      insert into public.task_dependencies (task_id, depends_on_task_id)
      select v_s.task_id, t2.id from public.tasks t2
        join public.ai_suggestions s2 on s2.id = t2.suggestion_id
       where s2.plan_id = p_plan_id and t2.plan_item_key = v_dep
      on conflict do nothing;
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Member directory (display names for owner pickers and the timeline). profiles is private to its
-- user, so this exposes only the display name and event role, and only to members of the event.
-- ---------------------------------------------------------------------------------------------
create function public.event_member_directory(p_event_id uuid)
returns table (user_id uuid, display_name text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(p.display_name, 'Member'), m.role
    from public.event_members m
    left join public.profiles p on p.user_id = m.user_id
   where m.event_id = p_event_id and public.is_event_member(p_event_id)
   order by m.role, p.display_name;
$$;

-- ---------------------------------------------------------------------------------------------
-- Timeline: important changes from audit_log, readable by every event member. Only whitelisted
-- fields leave this function (no raw before/after rows, no private columns).
-- ---------------------------------------------------------------------------------------------
create function public.event_timeline(p_event_id uuid, p_limit integer default 50)
returns table (
  at timestamptz, actor_kind text, actor_name text, entity_type text, entity_id text, action text, details jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_event_member(p_event_id) or public.is_platform_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select a.at, a.actor_kind, coalesce(p.display_name, case when a.actor_kind = 'system' then 'HalaEvents' else 'Member' end),
         a.entity_type, a.entity_id, a.action,
         jsonb_strip_nulls(jsonb_build_object(
           'title', coalesce(a.after ->> 'title', a.before ->> 'title', a.after ->> 'name'),
           'from', a.before ->> 'status',
           'to', a.after ->> 'status',
           'source', a.after ->> 'source',
           'kind', a.after ->> 'kind',
           'role', a.after ->> 'role',
           'owner_changed', case when a.action = 'update' and (a.before ->> 'owner_user_id') is distinct from (a.after ->> 'owner_user_id') then true end,
           'due_from', case when a.action = 'update' and (a.before ->> 'due_date') is distinct from (a.after ->> 'due_date') then a.before ->> 'due_date' end,
           'due_to', case when a.action = 'update' and (a.before ->> 'due_date') is distinct from (a.after ->> 'due_date') then a.after ->> 'due_date' end,
           'simulated', case when (a.after ->> 'is_simulated')::boolean then true end
         ))
    from public.audit_log a
    left join public.profiles p on p.user_id = a.actor_user_id
   where a.event_id = p_event_id
     and a.entity_type in (
       'events', 'event_members', 'tasks', 'task_dependencies', 'ai_plans', 'ai_suggestions',
       'compliance_checks', 'compliance_evidence', 'compliance_references', 'official_submissions'
     )
   order by a.at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- ---------------------------------------------------------------------------------------------
-- In-app notifications. channel is always 'in_app': a row is "delivered" once stored, because the
-- recipient's inbox reads it from here; "read" when the recipient opens it. No email/push exists.
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  kind text not null check (kind in (
    'missing_information', 'compliance_concern', 'deadline_approaching', 'decision_required', 'compliance_status_changed'
  )),
  title text not null check (char_length(title) between 3 and 160),
  body text not null default '' check (char_length(body) <= 600),
  link_path text check (link_path is null or (link_path ~ '^/app(/[A-Za-z0-9_-]+)*$' and char_length(link_path) <= 200)),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200),
  channel text not null default 'in_app' check (channel = 'in_app'),
  delivery_status text not null default 'delivered' check (delivery_status in ('delivered', 'read')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_read check ((delivery_status = 'read') = (read_at is not null))
);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_recent on public.notifications (user_id, created_at desc);

-- Internal helpers (not granted).
create function public.notify_user(
  p_user uuid, p_event uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text
) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, event_id, kind, title, body, link_path, dedupe_key)
  values (p_user, p_event, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 600), p_link, p_dedupe)
  on conflict do nothing;
  return case when found then 1 else 0 end;
end $$;

create function public.notify_event_managers(
  p_event uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text, p_except uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_count integer := 0;
begin
  for v_user in
    select user_id from public.event_members
     where event_id = p_event and role in ('owner', 'organizer') and user_id is distinct from p_except
  loop
    v_count := v_count + public.notify_user(v_user, p_event, p_kind, p_title, p_body, p_link, p_dedupe);
  end loop;
  return v_count;
end $$;

-- A new plan needs an organizer decision (accept or dismiss its proposals).
create function public.notify_plan_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_event_managers(
    new.event_id, 'decision_required', 'A plan is waiting for your review',
    case when new.source = 'ai' then 'Review the proposed tasks and accept the ones you want in the workspace.'
         else 'A plan built from the playbook (no AI) is ready to review.' end,
    '/app/events/' || new.event_id || '/plan', 'plan:' || new.id, null
  );
  return null;
end $$;
create trigger ai_plans_notify after insert on public.ai_plans
  for each row execute function public.notify_plan_created();

-- Deadlines (computed here from stored tasks) and missing information (labels computed by the app
-- from the playbook). Idempotent through dedupe keys. There is no scheduler: this runs when an
-- organizer works on the event (see event.md §18.5).
create function public.refresh_event_notifications(p_event_id uuid, p_missing jsonb default '[]')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
  v_t record;
  v_item jsonb;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_event_member(p_event_id, array['owner', 'organizer']) or not public.is_active_account() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_missing, '[]')) <> 'array' or jsonb_array_length(coalesce(p_missing, '[]')) > 20 then
    raise exception 'invalid_missing' using errcode = '22023';
  end if;
  select (now() at time zone timezone)::date into v_today from public.events where id = p_event_id;

  for v_t in
    select id, title, due_date, owner_user_id from public.tasks
     where event_id = p_event_id and status in ('todo', 'in_progress') and due_date is not null
       and due_date <= v_today + 3
  loop
    if v_t.owner_user_id is not null then
      v_count := v_count + public.notify_user(
        v_t.owner_user_id, p_event_id, 'deadline_approaching',
        case when v_t.due_date < v_today then 'Overdue: ' else 'Due soon: ' end || v_t.title,
        'Due ' || to_char(v_t.due_date, 'DD Mon YYYY') || '.',
        '/app/events/' || p_event_id || '/tasks',
        'deadline:' || v_t.id || ':' || v_t.due_date || ':' || (v_t.due_date < v_today)
      );
    else
      v_count := v_count + public.notify_event_managers(
        p_event_id, 'deadline_approaching',
        case when v_t.due_date < v_today then 'Overdue: ' else 'Due soon: ' end || v_t.title,
        'Due ' || to_char(v_t.due_date, 'DD Mon YYYY') || '. Nobody owns this task yet.',
        '/app/events/' || p_event_id || '/tasks',
        'deadline:' || v_t.id || ':' || v_t.due_date || ':' || (v_t.due_date < v_today)
      );
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_missing, '[]')) loop
    if coalesce(v_item ->> 'key', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'
       or char_length(coalesce(v_item ->> 'label', '')) not between 3 and 120 then
      raise exception 'invalid_missing' using errcode = '22023';
    end if;
    v_count := v_count + public.notify_event_managers(
      p_event_id, 'missing_information', 'Information needed: ' || (v_item ->> 'label'),
      'The plan and compliance checks need this answer.',
      '/app/events/' || p_event_id || '/interview',
      'missing:' || p_event_id || ':' || (v_item ->> 'key')
    );
  end loop;
  return v_count;
end $$;

create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  update public.notifications set delivery_status = 'read', read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.notifications enable row level security;

create policy tasks_select_member on public.tasks for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
create policy tasks_insert_manager on public.tasks for insert to authenticated
  with check (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account()
              and origin = 'manual');
create policy tasks_update_manager on public.tasks for update to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account())
  with check (public.is_event_member(event_id, array['owner', 'organizer']));
create policy tasks_delete_manager on public.tasks for delete to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account()
         and public.event_workspace_open(event_id));

create policy task_dependencies_select_member on public.task_dependencies for select to authenticated
  using (public.is_event_member(event_id) or public.is_platform_admin());
-- event_id is overwritten by the trigger from the task, so the check uses the task's event.
create policy task_dependencies_insert_manager on public.task_dependencies for insert to authenticated
  with check (
    exists (select 1 from public.tasks t where t.id = task_id
             and public.is_event_member(t.event_id, array['owner', 'organizer']))
    and public.is_active_account()
  );
create policy task_dependencies_delete_manager on public.task_dependencies for delete to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']) and public.is_active_account()
         and public.event_workspace_open(event_id));

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());

grant select, delete on public.tasks to authenticated;
grant insert (event_id, title, description, category, priority, due_date, owner_user_id, owner_label)
  on public.tasks to authenticated;
grant update (title, description, category, priority, status, due_date, owner_user_id, owner_label)
  on public.tasks to authenticated;
grant select, delete on public.task_dependencies to authenticated;
grant insert (task_id, depends_on_task_id, event_id) on public.task_dependencies to authenticated;
grant select on public.notifications to authenticated;

-- Called by invoker-rights policies.
grant execute on function public.event_workspace_open(uuid) to authenticated;
grant execute on function public.task_status_transition_allowed(text, text) to authenticated;
grant execute on function public.task_is_blocked(uuid) to authenticated;
grant execute on function public.accept_ai_plan(uuid, uuid[]) to authenticated;
grant execute on function public.event_member_directory(uuid) to authenticated;
grant execute on function public.event_timeline(uuid, integer) to authenticated;
grant execute on function public.refresh_event_notifications(uuid, jsonb) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Keep every function in public unreachable for PUBLIC/anon unless granted above (see 0001 header).
revoke execute on all functions in schema public from public, anon;
