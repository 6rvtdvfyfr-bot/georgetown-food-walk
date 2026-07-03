# Recap prompt generator

Run this after the walk (or anytime there's real data) to pull the actual ratings, notes, and photos out of Supabase and produce a ChatGPT-ready prompt for a photo-montage recap — instead of manually writing the prompt and re-typing everyone's ratings by hand.

## One-time setup

```bash
cd scripts/recap
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — same values already in the app's `index.html`, not secret.
- `SUPABASE_USER_ACCESS_TOKEN` — your own signed-in session token. To get it:
  1. Open the live app and sign in as usual.
  2. Open the browser's developer console (right-click → Inspect → Console).
  3. Paste this and press enter:
     ```js
     JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.includes('auth-token')))).access_token
     ```
  4. Copy the printed string (no quotes) into `.env.local`.

This token expires after about an hour — if the script fails with a 401, just grab a fresh one. Using your own session token (rather than Supabase's all-access service role key) keeps this script limited to exactly what the app already lets you read: this trip's stops, members, ratings, and photos — nothing more.

## Run it

```bash
npm run generate
```

Output lands in `recap-output/` (gitignored):
- `map.png` — a real map of the route, rendered from the same stop coordinates in the database.
- `photos/` — every uploaded photo, downloaded and named by stop/person.
- `prompt.txt` — the full prompt, with real stop order, both people's actual star ratings and notes.

## Using it

Start a new ChatGPT conversation, upload `map.png` and everything in `photos/`, then paste in the contents of `prompt.txt`. Feel free to hand-edit `prompt.txt` first if you want to tweak the style instructions.
