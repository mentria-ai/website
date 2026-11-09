export const RELAY = 'wss://relay.mentria.ai';
export const TURN_CRED_URL = 'https://relay.mentria.ai/turn-cred';
export const FALLBACK_ICE = [{ urls: 'stun:turn.mentria.ai:3478' }];

let cachedIce = null;
let iceExpiry = 0;
const REFRESH_LEAD = 60;

export const getIce = async () => {
  const nowS = Date.now() / 1000;
  if (cachedIce && nowS < iceExpiry - REFRESH_LEAD) return cachedIce;
  try {
    const r = await fetch(TURN_CRED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    iceExpiry = nowS + (data.ttl || 3600);
    cachedIce = data.iceServers || FALLBACK_ICE;
    return cachedIce;
  } catch (err) {
    console.warn('turn-cred fetch failed, using STUN-only fallback:', err);
    return FALLBACK_ICE;
  }
};
