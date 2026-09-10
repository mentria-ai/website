export function selectNextTrack(catalog, history, preferences, currentMood, currentEnergy) {
  const recentIds = history.slice(-20).map((t) => t.id);
  const current = history[history.length - 1] || null;
  const pool = albumPool(catalog, history, current);

  const candidates = pool.filter((t) => !recentIds.includes(t.id));
  if (candidates.length === 0) return pool[Math.floor(Math.random() * pool.length)];

  const scored = candidates.map((track) => {
    let score = 1.0;

    // Avoid same mood back-to-back
    if (currentMood && track.mood === currentMood) score *= 0.3;

    // Smooth energy transitions
    if (currentEnergy != null) {
      const delta = Math.abs(track.energy - currentEnergy);
      if (delta > 0.5) score *= 0.5;
      if (delta < 0.1) score *= 0.7;
    }

    // Prefer interludes for big mood/energy jumps
    if (currentMood && track.mood !== currentMood && currentEnergy != null) {
      const delta = Math.abs(track.energy - currentEnergy);
      if (delta > 0.3 && track.type === "short_interlude") score *= 3.0;
    }

    // User preference signals
    const pref = preferences[track.id];
    if (pref) {
      if (pref.liked) score *= 2.0;
      if (pref.skipped) score *= 0.3;
      score *= 1 + (pref.listened_ratio || 0) * 0.5;
    }

    // Aggregate mood preference
    score *= moodAffinity(preferences, catalog, track.mood);

    return { track, score };
  });

  // Weighted random from top 10
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(10, scored.length));
  const total = top.reduce((s, x) => s + x.score, 0);

  let roll = Math.random() * total;
  for (const { track, score } of top) {
    roll -= score;
    if (roll <= 0) return track;
  }
  return top[0].track;
}

function moodAffinity(preferences, catalog, mood) {
  const tracks = catalog.filter((t) => t.mood === mood);
  if (tracks.length === 0) return 1.0;

  let signal = 0;
  let count = 0;
  for (const t of tracks) {
    const p = preferences[t.id];
    if (p) {
      signal += p.liked ? 2 : p.skipped ? -1 : (p.listened_ratio || 0);
      count++;
    }
  }
  if (count === 0) return 1.0;
  return Math.max(0.2, 1 + (signal / count) * 0.3);
}

const ALBUM_RUN = 3;

function albumPool(catalog, history, current) {
  const albums = {};
  for (const t of catalog) {
    if (!t.album) return catalog;
    (albums[t.album] = albums[t.album] || []).push(t);
  }
  const ids = Object.keys(albums);
  if (ids.length < 2) return catalog;
  let run = 0;
  for (let i = history.length - 1; i >= 0 && history[i].album === (current && current.album); i--) run++;
  if (current && run < ALBUM_RUN && run < albums[current.album].length) return albums[current.album];
  const lastPlayed = {};
  history.forEach((t, i) => { lastPlayed[t.album] = i; });
  const choices = ids.filter((id) => id !== (current && current.album));
  const rank = (id) => (id in lastPlayed ? lastPlayed[id] : -1);
  const oldest = Math.min(...choices.map(rank));
  const tie = choices.filter((id) => rank(id) === oldest);
  return albums[tie[Math.floor(Math.random() * tie.length)]];
}
