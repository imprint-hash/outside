-- Outside: database setup. Paste into Supabase → SQL Editor → Run. Safe to run twice.
--
-- One table holds every kind of record (users, check-ins, hellos, messages,
-- meet-ups, blocks, reports, events), each as a JSON document. Row Level
-- Security is on with no policies, so the public (anon) key can read or
-- write nothing: only the app's server, with the secret key, can.

create table if not exists public.records (
  collection text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists records_collection_idx on public.records (collection);
create index if not exists records_user_idx on public.records ((data->>'userId'));

alter table public.records enable row level security;

-- No policies on purpose: nothing is readable with the public key.
revoke all on public.records from anon, authenticated;
