-- HalaEvents 0012 — allow xAI (Grok) as an AI provider name in ai_runs.
alter table public.ai_runs drop constraint ai_runs_provider_check;
alter table public.ai_runs add constraint ai_runs_provider_check check (provider in ('gemini', 'groq', 'xai', 'mock'));

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
