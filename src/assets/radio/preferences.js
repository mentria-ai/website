const DB_NAME = "mentria-radio";
const DB_VERSION = 1;
const STORE = "preferences";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "trackId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPreference(trackId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(trackId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function getAllPreferences() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const map = {};
      for (const p of req.result) map[p.trackId] = p;
      resolve(map);
    };
    req.onerror = () => resolve({});
  });
}

export async function updatePreference(trackId, updates) {
  const db = await openDB();
  const existing = (await getPreference(trackId)) || {
    trackId,
    listened_ratio: 0,
    skipped: false,
    liked: false,
    play_count: 0,
    session_contexts: [],
  };
  const merged = { ...existing, ...updates };
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(merged);
    tx.oncomplete = () => resolve(merged);
  });
}

export async function exportJSONL(catalog) {
  const prefs = await getAllPreferences();
  const lines = [];

  for (const [trackId, pref] of Object.entries(prefs)) {
    const track = catalog.find((t) => t.id === trackId);
    if (!track) continue;
    const ctx = pref.session_contexts;
    lines.push(
      JSON.stringify({
        track_id: track.id,
        mood: track.mood,
        energy: track.energy,
        bpm: track.bpm,
        key: track.key,
        instruments: track.instruments,
        type: track.type,
        duration_sec: track.duration_sec,
        listened_ratio: pref.listened_ratio,
        skipped: pref.skipped,
        liked: pref.liked,
        play_count: pref.play_count,
        session_context: ctx && ctx.length > 0 ? ctx[ctx.length - 1] : null,
      })
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mentria-radio-prefs-${Date.now()}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
