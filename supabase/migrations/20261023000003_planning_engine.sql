-- HalaEvents 0013 — planning engine: more event types, and 'playbook' as the generator recorded on ai_runs.
-- Additive only: existing rows keep their values ('gemini', 'groq', 'xai', 'mock' stay allowed for history).
alter table public.events drop constraint events_event_type_check;
alter table public.events add constraint events_event_type_check
  check (event_type in ('university_hackathon', 'conference', 'workshop'));

alter table public.ai_runs drop constraint ai_runs_provider_check;
alter table public.ai_runs add constraint ai_runs_provider_check
  check (provider in ('gemini', 'groq', 'xai', 'mock', 'playbook'));

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
