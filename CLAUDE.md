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

## Open backlog

Older feature ideas not superseded by the above (Overview calendar deep-links, per-stop timeline start-time editing, hide "buy tickets" once booked, phrasebook, currency cheatsheet, live open/closed status per stop, dress-code warnings) are in the "Carried-forward feature backlog" section of the Lessons Learned doc — worth a look when scoping v1 features, but not the headline decisions.

### Badges — idea under consideration, not decided (added 2026-07-03)

Brian made custom embroidered-patch-style badge images (e.g. via ChatGPT) mid-trip for "random things" worth celebrating — a fun tradition worth supporting somehow in a future Passport-style feature. One rough idea floated, **not settled**: split badges into (a) fixed/predictable ones whose art could be pre-generated before departure since the achievement names are known ahead of time, paired with the one-tap "share to group" idea, vs. (b) spontaneous/wildcard ones for in-the-moment jokes that can't be pre-generated and might warrant a lightweight in-app "mint a custom badge" flow instead of leaving the app.

Treat this as a starting point for discussion when this feature actually gets scoped, not a design to build. If Brian drops a reference image (e.g. `ostinanza-patch-reference.png`) into this folder, use it as the style reference for that conversation.
