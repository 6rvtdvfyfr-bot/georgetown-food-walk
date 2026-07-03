import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import StaticMaps from 'staticmaps';

const HERE = import.meta.dirname;
const TRIP_SLUG = 'georgetown-2026-07-10';

function loadEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv(path.join(HERE, '.env.local'));
const SUPABASE_URL = env.SUPABASE_URL;
const ANON_KEY = env.SUPABASE_ANON_KEY;
const TOKEN = env.SUPABASE_USER_ACCESS_TOKEN;

if (!SUPABASE_URL || !ANON_KEY || !TOKEN) {
  console.error('Missing config. Copy .env.local.example to .env.local and fill it in — see README.md.');
  process.exit(1);
}

async function sb(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error(
        `Supabase request failed (401 unauthorized). Your SUPABASE_USER_ACCESS_TOKEN has probably expired ` +
        `(they only last about an hour) — sign in again on the live site and grab a fresh one. Details: ${text}`
      );
    }
    throw new Error(`Supabase request failed (${res.status} ${pathAndQuery}): ${text}`);
  }
  return res.json();
}

async function downloadPhoto(storagePath) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/trip-photos/${storagePath}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Photo download failed (${res.status}): ${storagePath}`);
  return Buffer.from(await res.arrayBuffer());
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function starString(rating) {
  if (!rating) return 'not rated';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

async function main() {
  const [trip] = await sb(`/rest/v1/trips?slug=eq.${encodeURIComponent(TRIP_SLUG)}&select=*`);
  if (!trip) throw new Error(`No trip found for slug ${TRIP_SLUG}`);

  const stops = await sb(`/rest/v1/stops?trip_id=eq.${trip.id}&select=*&order=seq`);
  const members = await sb(`/rest/v1/members?trip_id=eq.${trip.id}&select=*`);
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));

  const stopIds = stops.map((s) => s.id).join(',');
  const entries = stopIds ? await sb(`/rest/v1/entries?stop_id=in.(${stopIds})&select=*`) : [];
  const photos = stopIds ? await sb(`/rest/v1/photos?stop_id=in.(${stopIds})&select=*&order=created_at`) : [];

  const entriesByStop = {};
  for (const e of entries) (entriesByStop[e.stop_id] ||= []).push(e);
  const photosByStop = {};
  for (const p of photos) (photosByStop[p.stop_id] ||= []).push(p);

  const outDir = path.join(HERE, 'recap-output');
  const photosDir = path.join(outDir, 'photos');
  mkdirSync(photosDir, { recursive: true });

  console.log(`Downloading ${photos.length} photo(s)...`);
  const photoFilesByStop = {};
  for (const stop of stops) {
    photoFilesByStop[stop.id] = [];
    const stopPhotos = photosByStop[stop.id] || [];
    for (const [i, p] of stopPhotos.entries()) {
      const author = membersById[p.member_id]?.display_name || 'someone';
      const ext = path.extname(p.storage_path) || '.jpg';
      const filename = `stop${stop.seq}-${slugify(stop.name)}-${slugify(author)}-${i + 1}${ext}`;
      const bytes = await downloadPhoto(p.storage_path);
      writeFileSync(path.join(photosDir, filename), bytes);
      photoFilesByStop[stop.id].push(filename);
    }
  }

  console.log('Rendering route map...');
  const map = new StaticMaps({ width: 1000, height: 750 });
  for (const s of stops) {
    map.addCircle({ coord: [s.lng, s.lat], radius: 12, fillColor: '#8B3A2F', color: '#FFFFFF', width: 2 });
  }
  map.addLine({ coords: stops.map((s) => [s.lng, s.lat]), color: '#8B3A2FCC', width: 4 });
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const pad = 0.003;
  const bounds = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
  await map.render(undefined, undefined, bounds);
  await map.image.save(path.join(outDir, 'map.png'));

  console.log('Writing prompt.txt...');
  const lines = [];
  lines.push(
    `Create a single-image photo montage/collage recapping a food walking tour in Georgetown, Washington DC, on ${trip.trip_date}.`
  );
  lines.push('');
  lines.push(
    `Composition: show all ${stops.length} stops arranged along one curvy, hand-drawn-style arrow/path representing ` +
    `the walking route, in the order below (stop 1 first). Use the attached map.png as a subtle, low-opacity ` +
    `background watermark showing the real route through the neighborhood.`
  );
  lines.push(
    "For each stop, place its attached photo(s) near its point on the route, along with a small rating card " +
    "showing both people's star ratings and a short quote from their notes if given. Only use the real attached " +
    "photos — do not invent people, food, or scenes that aren't shown in them."
  );
  lines.push('');
  lines.push('Stops, in order:');

  for (const stop of stops) {
    const stopEntries = entriesByStop[stop.id] || [];
    const stopPhotoFiles = photoFilesByStop[stop.id] || [];
    lines.push('');
    lines.push(`${stop.seq}. ${stop.name} (${stop.category || 'stop'}) — ${stop.address}`);
    if (stop.notes) lines.push(`   About: ${stop.notes}`);
    for (const member of members) {
      const entry = stopEntries.find((e) => e.member_id === member.id);
      if (entry) {
        const noteText = entry.note ? ` — "${entry.note}"` : '';
        lines.push(`   ${member.display_name}: ${starString(entry.rating)}${noteText}`);
      } else {
        lines.push(`   ${member.display_name}: not rated`);
      }
    }
    lines.push(
      stopPhotoFiles.length
        ? `   Photos for this stop: ${stopPhotoFiles.join(', ')}`
        : '   Photos for this stop: none uploaded — skip a photo here, just show the rating card.'
    );
  }

  lines.push('');
  lines.push(
    'Attached files: map.png (background watermark) plus the photo files listed above (in the photos/ folder) — ' +
    'upload all of them to this conversation along with this prompt.'
  );
  lines.push(
    'Style: warm, scrapbook/travel-journal feel; keep names, ratings, and quotes legible; one cohesive image, not a strict grid.'
  );

  writeFileSync(path.join(outDir, 'prompt.txt'), lines.join('\n'));

  console.log('\nDone! Wrote:');
  console.log(`  ${path.join(outDir, 'prompt.txt')}`);
  console.log(`  ${path.join(outDir, 'map.png')}`);
  console.log(`  ${photosDir}/ (${photos.length} photo file(s))`);
  console.log('\nNext: start a new ChatGPT conversation, upload map.png plus everything in photos/, then paste in prompt.txt.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
