-- HalaEvents 0019 — align ai_plans.assumptions with PlanOutput (≤ 20 items of ≤ 300 characters).
-- The old limit (8 items, 4000 bytes) rejected valid plans: a university-hackathon plan with no
-- interview answers carries 9 assumptions. Widening a CHECK keeps every existing row valid.
alter table public.ai_plans drop constraint ai_plans_assumptions_check;
alter table public.ai_plans add constraint ai_plans_assumptions_check check (
  jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) <= 20
  and octet_length(assumptions::text) <= 20000
);

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
