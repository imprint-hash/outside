-- Outside: database setup. Paste into Supabase → SQL Editor → Run. Safe to run twice.
--
-- One table holds every kind of record (users, check-ins, hellos, messages,
-- meet-ups, blocks, reports, events, reviews, searches, profiles), each as a
-- JSON document. Row Level Security is on with no policies, so the public
-- (anon) key can read or write nothing: only the app's server, with the
-- secret key, can.

create table if not exists public.records (
  collection text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists records_collection_idx on public.records (collection);
create index if not exists records_user_idx on public.records ((data->>'userId'));
create index if not exists records_venue_idx on public.records ((data->>'venueId'));
create index if not exists records_place_idx on public.records ((data->>'placeId'));
create index if not exists records_city_idx on public.records ((data->>'city'));

alter table public.records enable row level security;

-- No policies on purpose: nothing is readable with the public key.
revoke all on public.records from anon, authenticated;
