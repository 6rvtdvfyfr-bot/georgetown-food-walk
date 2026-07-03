# Setup — Georgetown Food Walk

One-time steps to get this app live. See [REQUIREMENTS.md](REQUIREMENTS.md) for the full design.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up/log in (no card required for the free tier).
2. "New project" → name it (e.g. `georgetown-food-walk`) → set a database password (save it) → pick a region → Create. Wait ~2 minutes for provisioning.

## 2. Run the schema

1. In the Supabase dashboard, open **SQL Editor** → New query.
2. Before running, edit `supabase/schema.sql` in this repo if Audra's email needs to change (it's currently `algollenberg@gmail.com`).
3. Paste the full contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.

## 3. Create the photo storage bucket

1. Go to **Storage** → New bucket → name it exactly `trip-photos` → leave **Public bucket unchecked** → Create.
   (The storage policies for this bucket are already included at the bottom of `schema.sql` and will apply once the bucket exists.)

## 4. Get your API credentials

1. Go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open [`index.html`](index.html) in this repo and replace the two placeholder values:
   ```js
   window.SUPABASE_URL = 'REPLACE_WITH_SUPABASE_PROJECT_URL';
   window.SUPABASE_ANON_KEY = 'REPLACE_WITH_SUPABASE_ANON_KEY';
   ```

## 5. Create a GitHub repo and enable Pages

1. On [github.com](https://github.com), create a new repository (e.g. `georgetown-food-walk`). Don't initialize it with a README.
2. Push this project to it:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages** → Source: "Deploy from a branch" → Branch: `main` / `(root)` → Save.
4. Note the published URL (e.g. `https://<you>.github.io/<repo>/`) — you'll need it in the next step.

## 6. Point Supabase auth at your Pages URL

1. Back in Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to your GitHub Pages URL, and add it under **Redirect URLs** too.
   (Without this, magic-link emails won't return you to the right place.)

## 7. Test it

Follow the verification steps in [REQUIREMENTS.md](REQUIREMENTS.md#verification-plan) — sign in as both emails, submit a rating/photo, confirm it shows up for the other person.

## Notes

- Free Supabase projects **auto-pause after 7 days idle**. If the app seems broken after a gap, check the Supabase dashboard and click "Resume project" first.
- The `anon` key is safe to expose in client-side code — it's meant to be public. Access is actually controlled by the Row Level Security policies in `schema.sql`, not by hiding this key.
