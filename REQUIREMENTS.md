# Georgetown Food Walk — Requirements & Recommended Plan

Status: **requirements only — no application code has been written yet.** This document is for review before any schema or app code is built.

## Context

This is the first real trip built on the "Trip Planner" successor architecture described in this project's [`CLAUDE.md`](CLAUDE.md), written after a retro on the Italy 2026 app (`../Italy Trip/`). That retro's non-negotiable rules — real synced backend, no hand-typed coordinates, no hard-guessed numeric estimates, design for shared/social features, multi-user entry, offline-aware sync, mobile-usable content editing — apply here even though this trip is tiny: a single afternoon/evening food walking tour in Georgetown, Washington DC, on **Friday 2026-07-10**, for two people — the user (`gollenb@gmail.com`) and Audra (`algollenberg@gmail.com`).

The point of building this now, at small scale, is to stand up and validate the shared-backend pattern (especially shared ratings on the same stop across travelers) cheaply before a bigger future trip depends on it. Both people will rate stops, leave notes, and upload photos live from their phones during the walk; that data (timestamped, attributed) is meant to feed a separate visual-journal effort later — building the journal itself is out of scope here, this app only needs to capture clean, attributable data for it.

## Goals

- Shared, live-synced ratings/notes/photos per stop, visible to both people (realtime, not just on next refresh).
- Verified, real map data — geocoded addresses, not hand-typed coordinates.
- A single mobile-first static web app usable from a phone browser, no laptop, no app install.
- $0 cost, no credit card required for setup.

## Non-goals (explicitly out of scope)

Badges, a walking leaderboard, expense splitting, a general multi-trip framework, and the actual visual-journal compilation (this app only captures raw data for that).

## Access & Auth

- Two allowlisted users only: `gollenb@gmail.com`, `algollenberg@gmail.com`.
- **Supabase email magic link** (passwordless OTP) — chosen over Google OAuth to avoid registering an OAuth app in Google Cloud Console.
- Allowlisting is **data-driven**, via a `members` table checked by RLS — not hardcoded email strings in policy SQL — so a future trip can reuse the same schema with different people.

## Backend: Supabase (Postgres + Auth + Storage)

**Why Supabase over Firebase:** Firebase now requires a billing account (credit card on file) to use Cloud Storage even when usage stays free. Supabase's free tier needs no card at all for Postgres, Auth, or Storage. Accepted tradeoff: free Supabase projects auto-pause after 7 days idle — resume manually via the dashboard as needed.

### Schema (Postgres)

```sql
create table trips (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,          -- 'georgetown-2026-07-10'
  title       text not null,
  trip_date   date not null,
  timezone    text not null default 'America/New_York',
  created_at  timestamptz not null default now()
);

create table members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  email        text not null,                -- must match auth.jwt() ->> 'email'
  display_name text not null,                -- 'You' / 'Audra'
  created_at   timestamptz not null default now(),
  unique (trip_id, email)
);

create table stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  seq           int not null,                -- display/walk order
  name          text not null,
  address       text not null,               -- human-readable, geocoded from this
  lat           double precision not null,
  lng           double precision not null,
  planned_time  text,                        -- display only, not authoritative
  duration_min  int,
  category      text,                        -- 'bagels' | 'dessert' | 'tea' | 'gelato' | ...
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
  unique (stop_id, member_id)                -- one rating/note per person per stop; edits are upserts
);

create table photos (
  id           uuid primary key default gen_random_uuid(),
  stop_id      uuid not null references stops(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  storage_path text not null,
  caption      text,
  created_at   timestamptz not null default now()
);
```

RLS is enabled on all five tables, gated through two `security definer` helper functions (avoids RLS-policy recursion and keeps every table policy a one-liner):

```sql
create or replace function is_allowlisted_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.email = (auth.jwt() ->> 'email'));
$$;

create or replace function current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.id from members m where m.email = (auth.jwt() ->> 'email') limit 1;
$$;
```

Policy shape: `trips`, `members`, and `stops` are `select`-only for allowlisted members (frozen/reference content). `entries` and `photos` are `select`-able by any allowlisted member (this is the "shared ratings" requirement — everyone sees everyone's entries) but `insert`/`update`/`delete` are restricted to rows where `member_id = current_member_id()` (you can only edit your own rating/note/photo).

### Storage

Bucket `trip-photos`, created **private** (not public) — a public bucket would leak photos to anyone with the URL, defeating the two-person restriction. Path convention: `trip-photos/{stop_id}/{member_id}/{timestamp}-{filename}`, which lets storage policies key off path segments (`storage.foldername(name)`) without a DB join:

- `select`: any allowlisted member (shared viewing).
- `insert`/`delete`: only into/from a path whose `member_id` segment matches `current_member_id()`.

Since the bucket is private, the app fetches photos via short-lived signed URLs (`createSignedUrl`), not public CDN links.

## Content: Georgetown stop list

Revised after checking real operating hours (the first draft baked in unverified assumptions — see below). Route runs roughly campus-side to M St to the C&O Canal and back to M St, all within Georgetown's compact core:

| # | Time | Stop | Address | Category | Duration | Verified Fri hours |
|---|------|------|---------|----------|----------|---------------------|
| 1 | 4:00 PM | Wisemiller's Grocery & Deli | 1236 36th St NW, Washington, DC 20007 | Savory | ~20 min | 8am–11pm |
| 2 | 4:35 PM | Chaia Tacos | 3207 Grace St NW, Washington, DC 20007 | Savory | ~25 min | 11am–8pm |
| 3 | 5:15 PM | Compass Coffee | 1351 Wisconsin Ave NW, Washington, DC 20007 | Coffee | ~20 min | 6am–7pm |
| 4 | 5:50 PM | Georgetown Cupcake | 3301 M St NW, Washington, DC 20007 | Cupcakes | ~15 min | 10am–9pm |
| 5 | 6:15 PM | Amorino Gelato | 3401 M St NW, Washington, DC 20007 | Gelato | ~20 min | 11am–7pm |

Finishes ~6:35 PM with a comfortable margin before every stop's close time. Since stop content lives in the `stops` table (not hardcoded in the app), it can be edited later by re-running SQL against Supabase without touching app code.

**Dropped from the original draft, and why** (caught during setup, before deploy — exactly the kind of thing the "verify, don't guess" rule is for):
- **Call Your Mother Deli** — closes 2pm Friday; incompatible with any afternoon/evening slot.
- **Ching Ching Cha** — the Georgetown location closed after 25 years and relocated to Dupont Circle, a different neighborhood.
- **Original Dolcezza address (1560 Wisconsin Ave NW)** — no longer a Dolcezza location; current locations don't include Georgetown/Wisconsin Ave.
- **Baked & Wired** — closes ~4pm daily, incompatible with the walk's timing.

**Coordinates are not hand-typed.** Each address was geocoded via OpenStreetMap's free Nominatim API, with each result's `display_name` checked against the intended business, and all five results cross-checked against Georgetown's known bounding box (~lat 38.902–38.912, lng -77.058 to -77.075). The address, returned coordinate, and Nominatim's `display_name` are recorded as a comment above each seed row in `supabase/schema.sql`, so the source is auditable later.

## Frontend

Plain HTML/CSS/JS, no build step, no framework:

- **Supabase JS client** via CDN ESM import (auth + data + storage + realtime).
- **Leaflet.js + OpenStreetMap tiles**: numbered markers, popups, a dashed route polyline in walk order (pattern reused from the predecessor's map view, minus hand-typed coordinates).
- **Realtime sync**: subscribe to Postgres changes on `entries` and `photos` (`supabase.channel(...).on('postgres_changes', ...)`) so if Audra rates a stop while both phones are open, the other's screen updates live — this directly serves the "shared ratings" goal better than fetch-on-load-only.
- **Date-aware UI** (`America/New_York`): pre-trip countdown, in-trip "now/next" highlighting by comparing current time to each stop's planned time, post-trip recap emphasizing photos/notes/ratings (feeds the future journal).
- **Stop card**: name, description, what-to-order, an "Open in Maps" link, a 1–5 star rating control, a note field, a photo upload button (`<input type="file" accept="image/*" capture="environment">` for direct camera access) — shows both people's entries side by side, not just your own.
- **Lightweight trip-info panel**: meeting time/place and logistics notes. No full multi-section ticket vault — that pattern was sized for a multi-week trip with flights/hotels/tickets, not a single afternoon.
- **Minimal offline handling**: on a failed save, queue the pending entry in `localStorage` and retry on reconnect/next load — a small write-queue, not a full sync engine, and the only place `localStorage` is used (never as the source of truth).

## Files (to be created once this document is approved)

- `index.html` — page shell, CDN imports, sign-in panel, map + timeline layout
- `app.js` — Supabase client, magic-link auth, realtime subscriptions, map rendering, rating/photo save logic
- `style.css` — stop-card/star-rating/map styling
- `supabase/schema.sql` — full DDL, RLS, storage policies, seed data (run manually in Supabase's SQL editor)

## Hosting

Static site via **GitHub Pages** — same pattern the predecessor used (git repo + Pages, deploy from `main` root).

## Manual one-time setup (user must do these — not automatable by an agent)

1. Create a free Supabase project at supabase.com (no card required).
2. Copy the Project URL and `anon` public API key from Project Settings → API into the app config.
3. Run `supabase/schema.sql` in the Supabase SQL editor (after the build fills in geocoded stop rows).
4. Create a **private** Storage bucket named `trip-photos`, then run the storage policy SQL.
5. Authentication → URL Configuration: set the Site URL / Redirect URLs to the eventual GitHub Pages URL, or magic links won't return to the right place.
6. (Optional hardening) Authentication → Providers → Email: consider disabling public signups, since RLS already blocks non-allowlisted emails from seeing any data.
7. Create a GitHub repo and enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).
8. If returning after a gap, manually "Resume" the Supabase project first if it auto-paused (7 days idle).

## Verification plan

1. Load the deployed site; confirm all 6 markers render in the right real-world Georgetown locations and the route line follows walk order.
2. Sign in as `gollenb@gmail.com` via magic link; confirm it lands back in an authenticated state.
3. Sign in as `algollenberg@gmail.com` via magic link on a separate device/profile — confirms the allowlist covers both real addresses.
4. Negative test: sign in with a third, non-allowlisted email — confirm the app shows zero data (RLS actually blocking access, not just decorative).
5. Submit a rating + note + photo as one user; confirm it appears for the other user, ideally live via the realtime subscription (or after a refresh at minimum).
6. Have the second user rate the same stop differently; confirm both ratings show side by side, attributed by name correctly.
7. Confirm an uploaded photo actually renders (validates the private-bucket signed-URL flow).
8. Confirm the date-phase logic computes the right "before/during/after" state relative to `America/New_York` and 2026-07-10.
9. Real-device check on both phones: camera capture opens the camera (not just a file picker), layout is usable one-handed while standing at a food stop.

## Execution order

1. ~~Write this document (no app code yet) for review.~~ ← this step
2. **Pause here for explicit go-ahead** before writing schema/app code.
3. Resolve the stop-5 open item (savory pick) and confirm Audra's email is correct.
4. Once approved: build `supabase/schema.sql` (with geocoded, spot-checked coordinates), then `index.html`/`app.js`/`style.css`.
5. User completes the manual Supabase/GitHub setup steps above; app is wired up and deployed to GitHub Pages.
6. Run the verification plan end-to-end with both real emails.
