# Trip Planner

Successor to the Italy 2026 trip-companion app (predecessor project: `../Italy Trip/`, deployed site was `gh-deploy/index.html`, a single-file HTML/JS/localStorage PWA). This project rebuilds that concept with the fixes below.

**Read [`Lessons Learned — Italy 2026.html`](Lessons%20Learned%20—%20Italy%202026.html) before making architecture decisions.** It's the full post-trip retro this file summarizes. Don't re-derive requirements from scratch — start there.

## Non-negotiable architecture decisions (from the retro)

1. **Use a real synced backend (e.g. Firebase or Supabase), not localStorage.** The predecessor kept all user data (expenses, gelato log, walk distances, check-ins) in per-device `localStorage` with no sync. This was the single biggest source of complaints: Money felt fragile (one "wallet phone," manual backups out of anxiety), Passport felt hollow (no shared view), Walk meter couldn't support a leaderboard. Every feature that lets the group log data needs to be shared and live across everyone's phones from day one — this is not a nice-to-have to bolt on later.

2. **Never hand-type map coordinates.** The predecessor had 80 hand-typed `[lat, lng]` literals with no verification, which caused pins to be sporadically wrong in the field (up to ~1 mile off once). Generate/verify coordinates via a geocoding API or authoritative place ID, with a spot-check step before deploy.

3. **Don't bake hard-guessed numeric estimates into the UI as authoritative.** The predecessor's walk-meter baseline (~20.7 km planned) was off by ~5x from actual (100+ km per person) and became visibly wrong almost immediately, which undermines trust in the rest of the app. Prefer deriving stats from real logged data over pre-trip guesses, or clearly label estimates as estimates.

4. **Design for social/competitive features, not solo trackers.** Explicitly requested: a walking-distance leaderboard, and shared ratings on the same gelato spot/restaurant/coffee across travelers so the trip ends with real group "winners," not one person's private log.

5. **Money needs multi-user entry, receipts, and itemized attribution.** Anyone should be able to add an expense from their own device (not just one "wallet phone"), attach a receipt photo, and record who was actually present per expense — not just a fixed family-level split.

6. **Plan for offline-write-then-resync, not cache-first-static.** Once data is dynamic/shared instead of a static cached shell, the old service-worker cache-first pattern doesn't fit. Design an explicit local queue that syncs when connectivity returns.

7. **Content editing must work without a laptop, or content is frozen at departure.** Nobody edited the predecessor's site during the trip — no laptop, and hand-editing a 3,900-line HTML file from a phone wasn't realistic. If in-trip edits matter, build a minimal mobile-usable admin view backed by the database. Otherwise, explicitly design for a pre-departure content freeze.

## What worked and should carry over unchanged

- **Itinerary pacing methodology** — right amount of downtime per day was explicitly praised. Reuse the planning judgment, not just app features.
- **Essentials ticket vault** (tickets/PDFs, PNRs, emergency numbers, flights, car rental in one drawer) — heavily used, keep the pattern.
- **City tabs with map + timeline per stop** — among the most-opened surfaces daily.
- **Self-guided food walking tours** — a curated, multi-stop, food-focused walking route (used in Rome) was a standout hit. Build this into future trips as a standard day-type wherever the destination supports it.
- **Date-aware quick views** — the predecessor's "boarding pass" view correctly detected when the trip had ended and showed a different state. Keep building UI that's aware of trip phase (pre-trip / in-trip / post-trip).

## Day-trip template — validated via the Georgetown Food Walk (built 2026-07, walked 2026-07-10)

This was the first real trip built on the architecture above — deliberately small and low-stakes (2 people, 1 day, one food-walk) so the shared-backend pattern could be piloted before a bigger multi-day trip depends on it. **Treat the process below as the reusable template for scoping the next trip. The specific tech choices (Supabase, email magic-link auth, plain HTML/JS + Leaflet, GitHub Pages) were one valid instantiation, not a mandate — re-evaluate each choice against what's current and appropriate next time.** Full build narrative/decisions are in that trip's own `REQUIREMENTS.md` if it's still in the repo; this section is the distilled, backend-agnostic lessons.

**The process that worked, in order:**
1. Nail down scope and hard constraints with the user first (group size, backend cost/complexity tolerance, auth model) before writing any code — these are genuine decision points, not defaults to assume.
2. Research candidate content (stops/activities), then write it to a **throwaway, human-reviewable draft** (a temp HTML page with recommendations + sourced "why this place" justification) before seeding anything into the real database. Get explicit sign-off on that draft.
3. Schema pattern worth reusing regardless of backend: an **allowlist table** (who's on this trip) plus small **policy-helper functions** (e.g. `is_allowlisted_member()`, `current_member_id()`) so every row-security rule stays a one-liner instead of repeating a subquery everywhere.
4. Geocode every address through a real API and cross-check the result (bounding box, returned place name) — never hand-type coordinates, per the architecture rule above.
5. Set up auth **early**, not the day before, and test that email actually delivers end-to-end days in advance. Default free-tier email senders (e.g. Supabase's shared sender) have low, loosely-documented rate limits that heavy testing burns through fast.
6. Test the shared/social feature (ratings, shared logs, whatever the "social" hook is) with **both real people signed in concurrently**, not just solo testing — that's the entire point of the architecture and it's the easiest thing to only test alone by accident.
7. Test mobile-specific UI behaviors **on the actual phones** that will be used — camera/photo-picker inputs, map deep-links, anything device-specific can't be verified from a desktop browser preview.
8. Freeze schema/RLS changes in roughly the final 24 hours before the event — that's exactly when a broken policy is most costly and hardest to calmly debug.
9. If a post-trip artifact (recap doc, photo collage, journal export) is wanted, build a small script that pulls the *real logged data* rather than hand-assembling it, using the least-privileged credential that can do the job (e.g. a user's own short-lived session token, not an admin/service-role key).

**Pitfalls hit this time — worth checking for proactively next time:**
- An itinerary drafted from general knowledge of "well-known spots" without checking *current* hours/existence had **three** real errors (a bagel shop that closes at 2pm, a tea house that had permanently relocated to a different neighborhood, a dessert shop address that was no longer that business) — caught only because the user pushed back on the timing feeling off. Always verify current hours/existence via fresh search before finalizing, don't trust general/training knowledge for anything time-sensitive.
- A "fun fact" about a stop's pop-culture connection was fabricated (sounded plausible, wasn't true) — caught only because the user asked for sourced justification. Any superlative/trivia claim in generated content needs an actual source check, not confidence from training data.
- A function that could be triggered concurrently by two different code paths (a direct user action + a realtime subscription reacting to that same action) mutated shared state in place across `await` boundaries, causing intermittent duplicate UI entries. When a function can run concurrently with itself, build a local copy and swap it in atomically at the end — never reset-then-mutate shared state across an await.
- A file input meant for photo uploads used a "prefer camera" attribute that forced mobile browsers straight into a (malfunctioning) live camera instead of the normal photo-library picker — invisible in desktop testing, broke on both real phones on the actual trip day.
- Default map links didn't match the travelers' actual device ecosystem (they wanted Apple Maps specifically for Apple Watch navigation, not Google Maps) — worth just asking which maps app up front for iPhone-owning travelers.
- A last-minute attempt to fix an email rate-limit by adding custom SMTP (Resend) introduced a *worse* problem the day before the trip: the provider's free shared sending domain silently only delivers to the account owner's own signup address. Vet a stopgap fix's own limitations before adopting it under time pressure, or just don't make infrastructure changes that close to the event.
- Repeated magic-link sign-ins for the same account in a short window can invalidate an already-open session's refresh token (normal auth-provider security behavior), unexpectedly logging out a tab that didn't do anything wrong. Good to know ahead of time so it doesn't read as a mystery bug on the trip day.
- ChatGPT's consumer free tier turned out to be too rate-limited to comfortably run the planned photo-collage workflow — worth picking a different tool/approach (or paid tier) next time rather than assuming a manual paste-into-ChatGPT step is frictionless.

## Open backlog

Older feature ideas not superseded by the above (Overview calendar deep-links, per-stop timeline start-time editing, hide "buy tickets" once booked, phrasebook, currency cheatsheet, live open/closed status per stop, dress-code warnings) are in the "Carried-forward feature backlog" section of the Lessons Learned doc — worth a look when scoping v1 features, but not the headline decisions.

### In-app admin/master mode — idea for future trips, not built for Georgetown (added 2026-07-13)

Came up when Brian wanted to add a friend as a viewer after the Georgetown trip had already ended, and separately wanted to fix/delete stray ratings without opening Supabase directly. Worth **designing in from the start of the next trip's build** rather than bolting on after the fact:

- **Worth building**: a scoped admin mode gated behind an `is_admin` flag on the member's row, exposing exactly two things in the app itself: (a) member management (add/remove people, e.g. sharing the trip with someone after the fact), and (b) moderation (edit or delete anyone's rating/note/photo, not just your own).
- **Deliberately not in scope for in-app admin**: adding/reordering/editing the *stops themselves*. That's rare (basically once per trip) and the existing research → geocode → SQL-seed flow already works and keeps coordinates verified — an in-browser "add a stop" form would either need its own geocoding integration or invite hand-typed lat/lng, which is exactly what architecture rule 2 exists to prevent.
- Not free even at this scope: a new `is_admin` column, a couple of new RLS policies, and two small UI panels — worth planning for up front on the next trip rather than treating as a quick bolt-on.

### Badges — idea under consideration, not decided (added 2026-07-03)

Brian made custom embroidered-patch-style badge images (e.g. via ChatGPT) mid-trip for "random things" worth celebrating — a fun tradition worth supporting somehow in a future Passport-style feature. One rough idea floated, **not settled**: split badges into (a) fixed/predictable ones whose art could be pre-generated before departure since the achievement names are known ahead of time, paired with the one-tap "share to group" idea, vs. (b) spontaneous/wildcard ones for in-the-moment jokes that can't be pre-generated and might warrant a lightweight in-app "mint a custom badge" flow instead of leaving the app.

Treat this as a starting point for discussion when this feature actually gets scoped, not a design to build. If Brian drops a reference image (e.g. `ostinanza-patch-reference.png`) into this folder, use it as the style reference for that conversation.
