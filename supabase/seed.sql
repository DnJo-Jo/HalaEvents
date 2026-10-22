-- HalaEvents seed (runs after migrations on `supabase db reset`, local development only).
--
-- DEMO DATA: every provider below is fictional, flagged is_demo = true, named "Demo …", and shown
-- with a "Demo listing" badge in the UI. They have no members, so nobody can receive their
-- service requests or quote on their behalf; they exist to make the directory explorable.
-- Prices, capacities and availability notes are invented examples, not real offers.
--
-- No users are created. Granting the first platform administrator is a deliberate, manual step
-- done by someone with database-owner access (SQL editor or psql as postgres):
--
--   insert into public.platform_admins (user_id, note)
--   select id, 'initial admin' from auth.users where email = '<admin email>';

insert into public.providers (
  id, kind, category, name, description, city, country, service_area,
  min_capacity, max_capacity, price_min, price_max, currency, pricing_model, capabilities,
  availability_note, verification_status, verified_at, is_demo
) values
  ('d0000000-0000-4000-8000-000000000001', 'venue', 'venue', 'Demo Atrium Hall',
   'Fictional demo venue: a flexible hall with breakout rooms, suited to 24-hour hackathons.',
   'Dubai', 'AE', '{Dubai}', 50, 400, 8000, 25000, 'AED', 'per_day',
   '{Wi-Fi 1 Gbps,Projectors,Breakout rooms,Overnight access}',
   'Demo text: weekends usually free; confirm dates by request.', 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000002', 'venue', 'venue', 'Demo Courtyard Pavilion',
   'Fictional demo venue: semi-outdoor pavilion for showcases and closing ceremonies.',
   'Sharjah', 'AE', '{Sharjah,Dubai}', 30, 250, 5000, 12000, 'AED', 'per_event',
   '{Stage,PA system,Shaded seating}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000003', 'service', 'catering', 'Demo Falcon Catering',
   'Fictional demo caterer: buffets and late-night snacks, vegetarian and halal options.',
   'Dubai', 'AE', '{Dubai,Sharjah,Abu Dhabi}', 20, 600, 45, 120, 'AED', 'per_person',
   '{Halal,Vegetarian,Vegan on request,Overnight service}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000004', 'service', 'av', 'Demo Pixel AV Rentals',
   'Fictional demo AV supplier: screens, microphones, livestream kits and technicians.',
   'Dubai', 'AE', '{Dubai,Abu Dhabi}', null, null, null, null, 'AED', 'quote_only',
   '{LED screens,Wireless mics,Livestream,On-site technician}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000005', 'service', 'security', 'Demo Shield Event Security',
   'Fictional demo security provider: licensed guards and crowd management.',
   'Abu Dhabi', 'AE', '{Abu Dhabi,Dubai}', 50, 5000, 85, 140, 'AED', 'per_hour',
   '{Licensed guards,Bag checks,First aid trained}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000006', 'service', 'transport', 'Demo Metro Shuttles',
   'Fictional demo transport company: shuttle buses between campuses and venues.',
   'Dubai', 'AE', '{Dubai,Sharjah}', null, 300, 900, 2500, 'AED', 'per_day',
   '{Coaches 50 seats,Minibuses 14 seats}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000007', 'service', 'cleaning', 'Demo Sparkle Cleaning',
   'Fictional demo cleaning crew for before, during and after events.',
   'Dubai', 'AE', '{Dubai}', null, null, 60, 90, 'AED', 'per_hour',
   '{Overnight shifts,Waste sorting}', null, 'verified', now(), true),
  ('d0000000-0000-4000-8000-000000000008', 'service', 'photography', 'Demo Lens & Light Studio',
   'Fictional demo photography and video team for event coverage.',
   'Dubai', 'AE', '{Dubai,Sharjah,Abu Dhabi}', null, null, 2500, 6000, 'AED', 'per_event',
   '{Photo,Video highlights,Same-day edits}', null, 'verified', now(), true);

insert into public.venue_profiles (
  provider_id, setting, seated_capacity, standing_capacity, address_text, area,
  access_conditions, accessibility, suitability
) values
  ('d0000000-0000-4000-8000-000000000001', 'indoor', 300, 400, 'Demo address — not a real location', 'Demo District',
   'Demo text: loading dock open until 18:00; overnight events need security on site.',
   '{step_free,accessible_toilets,lift}', '{hackathon,conference,workshop}'),
  ('d0000000-0000-4000-8000-000000000002', 'mixed', 180, 250, 'Demo address — not a real location', 'Demo Quarter',
   'Demo text: amplified sound must end by 23:00.', '{step_free}', '{social,ceremony,exhibition}');

insert into public.provider_services (
  provider_id, category, title, description, pricing_model, price_from, price_to, currency,
  min_quantity, max_quantity, inclusions
) values
  ('d0000000-0000-4000-8000-000000000001', 'venue', 'Demo 24-hour hackathon package',
   'Hall + 4 breakout rooms for 24 hours.', 'per_day', 15000, 25000, 'AED', 50, 400,
   '{Tables and chairs,Wi-Fi,Basic cleaning}'),
  ('d0000000-0000-4000-8000-000000000003', 'catering', 'Demo hackathon meal plan',
   'Lunch, dinner, midnight snack and breakfast.', 'per_person', 95, 120, 'AED', 30, 600,
   '{4 meals,Coffee station,Water}'),
  ('d0000000-0000-4000-8000-000000000003', 'catering', 'Demo coffee & snacks only',
   null, 'per_person', 45, 60, 'AED', 20, 600, '{Coffee station,Snacks every 4 hours}'),
  ('d0000000-0000-4000-8000-000000000004', 'av', 'Demo demo-day stage kit',
   'Screen, 2 mics, livestream to YouTube.', 'quote_only', null, null, 'AED', null, null,
   '{Setup and teardown,Technician}'),
  ('d0000000-0000-4000-8000-000000000006', 'transport', 'Demo campus shuttle loop',
   'Shuttle every 30 minutes between two campuses.', 'per_day', 900, 2500, 'AED', null, 300,
   '{Driver,Fuel}');
