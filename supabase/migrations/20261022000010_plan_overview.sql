-- Plan overview (summary, requirements, missing information, budget categories, risks) next to the
-- task proposals. Stored with the current plan; written only through the manager-checked function below.
alter table public.ai_plans
  add column overview jsonb check (
    overview is null or (jsonb_typeof(overview) = 'object' and octet_length(overview::text) <= 12000)
  );

create function public.set_ai_plan_overview(p_plan_id uuid, p_overview jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.ai_plans where id = p_plan_id and status = 'current';
  if v_event is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.ai_assert_event_manager(v_event);
  if p_overview is null or jsonb_typeof(p_overview) <> 'object' then
    raise exception 'invalid_overview' using errcode = '22023';
  end if;
  update public.ai_plans set overview = p_overview where id = p_plan_id;
end $$;

grant execute on function public.set_ai_plan_overview(uuid, jsonb) to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
