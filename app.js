import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TRIP_SLUG = 'georgetown-2026-07-10';

const el = (id) => document.getElementById(id);

if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('REPLACE_WITH')) {
  el('phase-banner').textContent = 'Not configured yet — set SUPABASE_URL / SUPABASE_ANON_KEY in index.html.';
  throw new Error('Supabase config missing — see SETUP.md');
}

const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const authPanel = el('auth-panel');
const appPanel = el('app-panel');
const noAccessPanel = el('no-access-panel');
const phaseBanner = el('phase-banner');
const stopsListEl = el('stops-list');
const authStatus = el('auth-status');

let map = null;
let markers = {}; // stopId -> Leaflet marker
let trip = null;
let stops = [];
let membersByEmail = {};
let membersById = {};
let currentMember = null;
let entriesByStop = {}; // stopId -> [{member_id, rating, note, ...}]
let photosByStop = {}; // stopId -> [{member_id, storage_path, signedUrl, ...}]
let pendingEdits = {}; // stopId -> { rating, note }

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Date-phase logic ----------

function todayStrIn(timezone) {
  return new Date().toLocaleDateString('sv-SE', { timeZone: timezone });
}

function nowMinutesIn(timezone) {
  const t = new Date().toLocaleTimeString('sv-SE', { timeZone: timezone, hour12: false });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function parsePlannedTimeToMinutes(label) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
  if (!match) return null;
  let [, h, m, ap] = match;
  h = parseInt(h, 10);
  m = parseInt(m, 10);
  if (/pm/i.test(ap) && h !== 12) h += 12;
  if (/am/i.test(ap) && h === 12) h = 0;
  return h * 60 + m;
}

function getPhase() {
  const today = todayStrIn(trip.timezone);
  if (today < trip.trip_date) return 'before';
  if (today > trip.trip_date) return 'after';
  return 'during';
}

function renderPhaseBanner() {
  const phase = getPhase();
  if (phase === 'before') {
    const days = Math.round((new Date(trip.trip_date) - new Date(todayStrIn(trip.timezone))) / 86400000);
    phaseBanner.textContent = days > 0
      ? `${days} day${days === 1 ? '' : 's'} until the walk (Fri Jul 10)`
      : `The walk starts soon!`;
  } else if (phase === 'during') {
    phaseBanner.textContent = "Today's the walk — good luck out there 🍩";
  } else {
    phaseBanner.textContent = 'Walk complete! Rate and add photos for the record.';
  }
  return phase;
}

function currentAndNextStopIds(phase) {
  if (phase !== 'during') return { currentId: null, nextId: null };
  const nowMin = nowMinutesIn(trip.timezone);
  let currentId = null, nextId = null;
  for (const s of stops) {
    const t = parsePlannedTimeToMinutes(s.planned_time);
    if (t === null) continue;
    if (t <= nowMin) currentId = s.id;
    if (t > nowMin && nextId === null) nextId = s.id;
  }
  return { currentId, nextId };
}

// ---------- Auth ----------

el('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('auth-email').value.trim();
  authStatus.textContent = 'Sending link…';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  authStatus.textContent = error ? `Error: ${error.message}` : 'Check your email for the sign-in link!';
});

el('sign-out').addEventListener('click', () => supabase.auth.signOut());
el('no-access-sign-out').addEventListener('click', () => supabase.auth.signOut());

el('trip-info-toggle').addEventListener('click', () => {
  el('trip-info').classList.toggle('hidden');
});

supabase.auth.onAuthStateChange((_event, session) => {
  handleSession(session);
});

async function handleSession(session) {
  if (!session) {
    authPanel.classList.remove('hidden');
    appPanel.classList.add('hidden');
    noAccessPanel.classList.add('hidden');
    return;
  }
  authPanel.classList.add('hidden');
  await loadEverything(session.user.email);
}

// ---------- Data loading ----------

async function loadEverything(email) {
  const { data: tripRow } = await supabase.from('trips').select('*').eq('slug', TRIP_SLUG).single();
  trip = tripRow;

  const { data: memberRows } = await supabase.from('members').select('*').eq('trip_id', trip?.id ?? '');
  membersByEmail = {};
  membersById = {};
  for (const m of memberRows || []) {
    membersByEmail[m.email] = m;
    membersById[m.id] = m;
  }
  currentMember = membersByEmail[email] || null;

  if (!trip || !currentMember) {
    appPanel.classList.add('hidden');
    noAccessPanel.classList.remove('hidden');
    return;
  }
  noAccessPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');

  const { data: stopRows } = await supabase.from('stops').select('*').eq('trip_id', trip.id).order('seq');
  stops = stopRows || [];

  await refetchEntriesAndPhotos();
  initMap();
  renderAll();
  subscribeRealtime();
  flushPendingQueue();
}

async function refetchEntriesAndPhotos() {
  const stopIds = stops.map((s) => s.id);
  if (stopIds.length === 0) return;

  // Build into local objects and only swap them into the shared module state once
  // fully populated. This function can run concurrently (a save triggers it directly,
  // and again via the realtime subscription reacting to that same write) — mutating
  // the shared objects in place across the awaits below let two overlapping calls
  // interleave their pushes into the same array, duplicating rows.
  const { data: entryRows } = await supabase.from('entries').select('*').in('stop_id', stopIds);
  const newEntriesByStop = {};
  for (const e of entryRows || []) {
    (newEntriesByStop[e.stop_id] ||= []).push(e);
  }

  const { data: photoRows } = await supabase.from('photos').select('*').in('stop_id', stopIds).order('created_at');
  const newPhotosByStop = {};
  for (const p of photoRows || []) {
    const { data: signed } = await supabase.storage.from('trip-photos').createSignedUrl(p.storage_path, 3600);
    p.signedUrl = signed?.signedUrl || null;
    (newPhotosByStop[p.stop_id] ||= []).push(p);
  }

  entriesByStop = newEntriesByStop;
  photosByStop = newPhotosByStop;
}

function subscribeRealtime() {
  supabase
    .channel('trip-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async () => {
      await refetchEntriesAndPhotos();
      renderStops();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, async () => {
      await refetchEntriesAndPhotos();
      renderStops();
    })
    .subscribe();
}

// ---------- Map ----------

function makeMarkerIcon(num, highlight) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${highlight ? '#8B3A2F' : '#c98f84'};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);">
      <span style="transform:rotate(45deg);font-size:12px;font-weight:600;">${num}</span>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

function initMap() {
  if (map || stops.length === 0) return;
  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const latlngs = stops.map((s) => [s.lat, s.lng]);
  stops.forEach((s, i) => {
    const marker = L.marker([s.lat, s.lng], { icon: makeMarkerIcon(i + 1, false) }).addTo(map);
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(s.name)}</strong><br>${escapeHtml(s.planned_time || '')}</div>`);
    markers[s.id] = marker;
  });
  L.polyline(latlngs, { color: '#8B3A2F', dashArray: '6, 9', weight: 3 }).addTo(map);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
}

// ---------- Rendering ----------

function renderAll() {
  const phase = renderPhaseBanner();
  renderStops(phase);
}

function starWidget(stopId, currentRating) {
  const val = pendingEdits[stopId]?.rating ?? currentRating ?? 0;
  return [1, 2, 3, 4, 5].map((n) =>
    `<span class="pp-star ${n <= val ? 'active' : ''}" data-stop="${stopId}" data-val="${n}">★</span>`
  ).join('');
}

function renderStops(phaseArg) {
  const phase = phaseArg || getPhase();
  const { currentId, nextId } = currentAndNextStopIds(phase);

  stopsListEl.innerHTML = stops.map((s, i) => {
    const entries = entriesByStop[s.id] || [];
    const photos = photosByStop[s.id] || [];
    const myEntry = entries.find((e) => e.member_id === currentMember.id);
    const otherEntries = entries.filter((e) => e.member_id !== currentMember.id);
    const draft = pendingEdits[s.id] || { rating: myEntry?.rating ?? 0, note: myEntry?.note ?? '' };
    pendingEdits[s.id] = draft;

    const mapsUrl = `https://maps.apple.com/?ll=${s.lat},${s.lng}&q=${encodeURIComponent(s.name)}`;
    const highlightClass = s.id === currentId ? 'is-current' : '';

    const otherEntriesHtml = otherEntries.map((e) => {
      const name = membersById[e.member_id]?.display_name || 'Someone';
      const stars = '★'.repeat(e.rating || 0) + '☆'.repeat(5 - (e.rating || 0));
      return `<div class="entry-row"><span class="entry-name">${escapeHtml(name)}</span><span>${stars}</span></div>
        ${e.note ? `<p class="entry-note">${escapeHtml(e.note)}</p>` : ''}`;
    }).join('');

    const photosHtml = photos.length
      ? `<div class="photo-strip">${photos.map((p) =>
          p.signedUrl ? `<img src="${p.signedUrl}" alt="photo at ${escapeHtml(s.name)}">` : ''
        ).join('')}</div>`
      : '';

    return `
      <div class="stop-card ${highlightClass}" data-stop-id="${s.id}">
        <div class="stop-head">
          <span class="stop-num">${i + 1}</span>
          <span class="stop-name">${escapeHtml(s.name)}</span>
          <span class="stop-meta">${escapeHtml(s.planned_time || '')}${s.duration_min ? ` · ~${s.duration_min}m` : ''}</span>
        </div>
        <p class="stop-notes">${escapeHtml(s.notes || '')}</p>
        <p class="stop-links"><a href="${mapsUrl}" target="_blank" rel="noopener">📍 Open in Maps</a></p>

        <div class="entries">
          ${otherEntriesHtml || '<p class="muted">No one else has rated this yet.</p>'}
          ${photosHtml}
          <div class="rate-form">
            <div class="pp-stars">${starWidget(s.id, myEntry?.rating)}</div>
            <textarea data-note-for="${s.id}" placeholder="Notes (what you ordered, thoughts...)">${escapeHtml(draft.note)}</textarea>
            <input type="file" accept="image/*" data-photo-for="${s.id}">
            <button data-save-for="${s.id}">Save my rating</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Event wiring (re-attached each render since innerHTML is replaced)
  stopsListEl.querySelectorAll('.pp-star').forEach((star) => {
    star.addEventListener('click', () => {
      const stopId = star.dataset.stop;
      pendingEdits[stopId] = pendingEdits[stopId] || {};
      pendingEdits[stopId].rating = Number(star.dataset.val);
      renderStops();
    });
  });

  stopsListEl.querySelectorAll('[data-note-for]').forEach((ta) => {
    ta.addEventListener('input', () => {
      const stopId = ta.dataset.noteFor;
      pendingEdits[stopId] = pendingEdits[stopId] || {};
      pendingEdits[stopId].note = ta.value;
    });
  });

  stopsListEl.querySelectorAll('[data-save-for]').forEach((btn) => {
    btn.addEventListener('click', () => saveEntry(btn.dataset.saveFor));
  });

  stopsListEl.querySelectorAll('[data-photo-for]').forEach((input) => {
    input.addEventListener('change', () => savePhoto(input.dataset.photoFor, input.files[0]));
  });

  stopsListEl.querySelectorAll('.stop-card').forEach((card) => {
    card.addEventListener('click', (evt) => {
      if (evt.target.closest('a, button, input, textarea, .pp-star')) return;
      const marker = markers[card.dataset.stopId];
      if (marker) {
        map.flyTo(marker.getLatLng(), 16);
        marker.openPopup();
      }
    });
  });
}

// ---------- Saving (with a minimal offline retry queue) ----------

const QUEUE_KEY = 'georgetown-pending-entries';

function queuePending(row) {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  queue.push(row);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function flushPendingQueue() {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  if (queue.length === 0) return;
  const remaining = [];
  for (const row of queue) {
    const { error } = await supabase.from('entries').upsert(row, { onConflict: 'stop_id,member_id' });
    if (error) remaining.push(row);
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  if (remaining.length < queue.length) {
    await refetchEntriesAndPhotos();
    renderStops();
  }
}

window.addEventListener('online', flushPendingQueue);

async function saveEntry(stopId) {
  const draft = pendingEdits[stopId] || {};
  const row = {
    stop_id: stopId,
    member_id: currentMember.id,
    rating: draft.rating || null,
    note: draft.note || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('entries').upsert(row, { onConflict: 'stop_id,member_id' });
  if (error) {
    queuePending(row);
    authStatus.textContent = '';
  }
  await refetchEntriesAndPhotos();
  renderStops();
}

async function savePhoto(stopId, file) {
  if (!file || !currentMember) return;
  const path = `${stopId}/${currentMember.id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from('trip-photos').upload(path, file);
  if (uploadError) {
    alert(`Photo upload failed: ${uploadError.message}`);
    return;
  }
  await supabase.from('photos').insert({ stop_id: stopId, member_id: currentMember.id, storage_path: path });
  await refetchEntriesAndPhotos();
  renderStops();
}

// ---------- Boot ----------

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  await handleSession(session);
})();
