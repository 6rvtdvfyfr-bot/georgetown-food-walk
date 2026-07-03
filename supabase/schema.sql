-- =========================================================
-- Georgetown Food Walk — schema, RLS, storage policies, seed data
-- Run once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run from scratch on a fresh project; not idempotent against
-- partial state (drop tables first if re-running after a partial failure).
-- =========================================================

-- ---------- TABLES ----------

create table trips (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  trip_date   date not null,
  timezone    text not null default 'America/New_York',
  created_at  timestamptz not null default now()
);

create table members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  email        text not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  unique (trip_id, email)
);

create table stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  seq           int not null,
  name          text not null,
  address       text not null,
  lat           double precision not null,
  lng           double precision not null,
  planned_time  text,
  duration_min  int,
  category      text,
  notes         text,
  link          text,
  created_at    timestamptz not null default now(),
  unique (trip_id, seq)
);

create table entries (
  id          uuid primary key default gen_random_uuid(),
  stop_id     uuid not null references stops(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  rating      int check (rating between 1 and 5),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (stop_id, member_id)
);

create table photos (
  id           uuid primary key default gen_random_uuid(),
  stop_id      uuid not null references stops(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  storage_path text not null,
  caption      text,
  created_at   timestamptz not null default now()
);

-- ---------- HELPER FUNCTIONS ----------
-- security definer + fixed search_path so RLS policies stay simple one-liners
-- and don't recurse through the tables they're protecting.

create or replace function is_allowlisted_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members m
    where m.email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id from members m
  where m.email = (auth.jwt() ->> 'email')
  limit 1;
$$;

-- ---------- RLS ----------

alter table trips   enable row level security;
alter table members enable row level security;
alter table stops   enable row level security;
alter table entries enable row level security;
alter table photos  enable row level security;

create policy "trips_select_allowlisted"
  on trips for select
  using (is_allowlisted_member());

create policy "members_select_allowlisted"
  on members for select
  using (is_allowlisted_member());

create policy "stops_select_allowlisted"
  on stops for select
  using (is_allowlisted_member());

-- entries: everyone allowlisted can see everyone's entries (shared ratings),
-- but can only write/edit/delete their own.
create policy "entries_select_allowlisted"
  on entries for select
  using (is_allowlisted_member());

create policy "entries_insert_own"
  on entries for insert
  with check (member_id = current_member_id());

create policy "entries_update_own"
  on entries for update
  using (member_id = current_member_id())
  with check (member_id = current_member_id());

create policy "entries_delete_own"
  on entries for delete
  using (member_id = current_member_id());

create policy "photos_select_allowlisted"
  on photos for select
  using (is_allowlisted_member());

create policy "photos_insert_own"
  on photos for insert
  with check (member_id = current_member_id());

create policy "photos_delete_own"
  on photos for delete
  using (member_id = current_member_id());

-- ---------- REALTIME ----------
-- Broadcast row-level changes on entries/photos so both phones update live.

alter publication supabase_realtime add table entries;
alter publication supabase_realtime add table photos;

-- ---------- SEED: trip + members ----------

insert into trips (slug, title, trip_date, timezone) values
  ('georgetown-2026-07-10', 'Georgetown Food Walk', '2026-07-10', 'America/New_York');

insert into members (trip_id, email, display_name)
select id, 'gollenb@gmail.com', 'You' from trips where slug = 'georgetown-2026-07-10'
union all
select id, 'algollenberg@gmail.com', 'Audra' from trips where slug = 'georgetown-2026-07-10';

-- ---------- SEED: stops ----------
-- Coordinates geocoded via OSM Nominatim (https://nominatim.openstreetmap.org/search),
-- one request per address, each cross-checked against its returned display_name
-- and against Georgetown's known bounding box (~lat 38.902-38.912, lng -77.058 to -77.075)
-- before being recorded here. Source display_name kept in the comment above each
-- row so the coordinate is auditable, per the project's "never hand-type
-- coordinates" rule.

-- 1. Call Your Mother Deli — 3428 O St NW
-- Nominatim: "3428, O Street Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9076299, -77.0688724
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 1, 'Call Your Mother Deli', '3428 O St NW, Washington, DC 20007',
       38.9076299, -77.0688724, '4:00 PM', 20, 'bagels',
       'Everything bagel with scallion cream cheese is the move. Can get a line — order ahead if possible.'
from trips where slug = 'georgetown-2026-07-10';

-- 2. Baked & Wired — 1052 Thomas Jefferson St NW
-- Nominatim: "Baked and Wired, 1052, Thomas Jefferson Street Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9038790, -77.0604350
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 2, 'Baked & Wired', '1052 Thomas Jefferson St NW, Washington, DC 20007',
       38.9038790, -77.0604350, '4:35 PM', 20, 'pastries',
       'Known for quirky cupcake flavors and brownies; less touristy than Georgetown Cupcake down the street.'
from trips where slug = 'georgetown-2026-07-10';

-- 3. Georgetown Cupcake — 3301 M St NW
-- Nominatim: "Georgetown Cupcake, 3301, M Street Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9052539, -77.0661542
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 3, 'Georgetown Cupcake', '3301 M St NW, Washington, DC 20007',
       38.9052539, -77.0661542, '5:10 PM', 15, 'cupcakes',
       'The famous one — worth comparing head-to-head against Baked & Wired.'
from trips where slug = 'georgetown-2026-07-10';

-- 4. Ching Ching Cha — 1063 Wisconsin Ave NW
-- Nominatim: "1063, Wisconsin Avenue Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9043981, -77.0624534
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 4, 'Ching Ching Cha', '1063 Wisconsin Ave NW, Washington, DC 20007',
       38.9043981, -77.0624534, '5:40 PM', 30, 'tea',
       'Sit-down tea house — a good palate reset between sweets, and the day''s one seated indoor stop.'
from trips where slug = 'georgetown-2026-07-10';

-- 5. Wisemiller's Grocery & Deli — 1236 36th St NW
-- Nominatim: "1236, 36th Street Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9063026, -77.0704579
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 5, 'Wisemiller''s Grocery & Deli', '1236 36th St NW, Washington, DC 20007',
       38.9063026, -77.0704579, '6:25 PM', 25, 'savory',
       'Georgetown institution near the university (of St. Elmo''s Fire fame) — a quick savory sandwich stop.'
from trips where slug = 'georgetown-2026-07-10';

-- 6. Dolcezza Gelato — 1560 Wisconsin Ave NW
-- Nominatim: "1560, Wisconsin Avenue Northwest, Georgetown, Ward 2, Washington, DC, 20007" → 38.9103302, -77.0650183
insert into stops (trip_id, seq, name, address, lat, lng, planned_time, duration_min, category, notes)
select id, 6, 'Dolcezza Gelato', '1560 Wisconsin Ave NW, Washington, DC 20007',
       38.9103302, -77.0650183, '7:05 PM', 20, 'gelato',
       'Closing stop — gelato as a finale, echoing the Rome food walk from the last trip.'
from trips where slug = 'georgetown-2026-07-10';

-- ---------- STORAGE ----------
-- 1. In the Supabase dashboard: Storage → New bucket → name it "trip-photos" →
--    leave "Public bucket" UNCHECKED → Create.
-- 2. Then run the policies below. Path convention written by the app:
--      trip-photos/{stop_id}/{member_id}/{timestamp}-{filename}
--    which lets these policies key off path segments without a table join.

create policy "trip_photos_select_allowlisted"
  on storage.objects for select
  using (
    bucket_id = 'trip-photos'
    and is_allowlisted_member()
  );

create policy "trip_photos_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'trip-photos'
    and is_allowlisted_member()
    and (storage.foldername(name))[2] = current_member_id()::text
  );

create policy "trip_photos_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[2] = current_member_id()::text
  );
