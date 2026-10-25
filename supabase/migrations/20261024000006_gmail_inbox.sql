-- HalaEvents 0023 — Gmail inbox agent (prototype). gmail_connections: one read-only Gmail link per
-- user; the refresh token is stored encrypted by the app (AES-256-GCM), never in plain text.
-- vendor_replies: vendor emails the organizer pulled in with "Check for replies", matched to the
-- event by the HE reference code in the subject, plus the organizer-requested analysis. Replies
-- are visible to the event's owner/organizers only. Nothing here sends mail or confirms anything.
create table public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  email text not null check (char_length(email) between 3 and 320),
  refresh_token_enc text not null check (char_length(refresh_token_enc) between 20 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gmail_connections enable row level security;
create policy gmail_connections_own on public.gmail_connections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.gmail_connections from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_connections to authenticated;

create table public.vendor_replies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  category text not null check (category in ('venue', 'catering', 'transport')),
  -- null when the email answered a general (category-only) request
  place_id text check (place_id is null or char_length(place_id) between 1 and 400),
  reference text not null check (reference ~ '^HE-[0-9A-F]{8}$'),
  gmail_message_id text not null check (char_length(gmail_message_id) between 1 and 100),
  from_email text not null check (char_length(from_email) <= 320),
  from_name text check (from_name is null or char_length(from_name) <= 200),
  subject text not null check (char_length(subject) <= 500),
  body text not null check (char_length(body) <= 20000),
  received_at timestamptz not null,
  analysis jsonb,
  analyzed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (event_id, gmail_message_id)
);
create index vendor_replies_event_idx on public.vendor_replies (event_id, received_at desc);
alter table public.vendor_replies enable row level security;
create policy vendor_replies_select on public.vendor_replies for select to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']));
create policy vendor_replies_insert on public.vendor_replies for insert to authenticated
  with check (public.is_event_member(event_id, array['owner', 'organizer']) and created_by = auth.uid());
create policy vendor_replies_update on public.vendor_replies for update to authenticated
  using (public.is_event_member(event_id, array['owner', 'organizer']))
  with check (public.is_event_member(event_id, array['owner', 'organizer']));
revoke all on public.vendor_replies from public, anon, authenticated;
grant select on public.vendor_replies to authenticated;
grant insert (event_id, category, place_id, reference, gmail_message_id, from_email, from_name,
  subject, body, received_at) on public.vendor_replies to authenticated;
grant update (analysis, analyzed_at) on public.vendor_replies to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_attendee(text, text, text, text, text, boolean) to anon;
grant execute on function public.public_event_by_slug(text) to anon;
