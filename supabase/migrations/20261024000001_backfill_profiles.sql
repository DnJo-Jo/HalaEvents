-- HalaEvents 0018 — backfill profiles for auth users created before migration 0001 was applied.
-- handle_new_user() only fires for new sign-ups, so users who registered on a project before the
-- schema existed have no profile, fail is_active_account() and cannot finish onboarding.
-- Idempotent and additive: inserts an empty, active, not-onboarded profile (column defaults) for
-- each auth user without one; existing profiles and auth accounts are never modified.
insert into public.profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
