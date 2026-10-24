-- HalaEvents 0021 — "Additional event details": the organizer's optional free-text description of
-- requirements, preferences and constraints the interview didn't cover (event.md §16.4). Additive:
-- a nullable column, so existing events are unaffected. Members read it with the existing table-level
-- select grant; it is written only through save_event_details(), with the interview's rules
-- (owner/organizer, active account, event still draft/planning/ready). Structured interview answers
-- and event facts stay separate and are never derived from this text.
alter table public.events add column additional_details text
  check (additional_details is null or char_length(additional_details) between 1 and 3000);

create function public.save_event_details(p_event_id uuid, p_details text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_text text := nullif(btrim(coalesce(p_details, ''), E' \t\r\n'), '');
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
  update public.events set additional_details = v_text where id = p_event_id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.save_event_details(uuid, text) to authenticated;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
