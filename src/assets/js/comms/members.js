const MEMBERS_MAX = 50;
const JOINS_MAX = 20;

const pubOk = (p) => !!p && typeof p === 'object' && typeof p.x === 'string' && typeof p.y === 'string' && p.x.length > 0 && p.y.length > 0 && p.x.length <= 64 && p.y.length <= 64;
const keyOk = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k);

export const noteMember = (entry, { sigFp, name, pub, spub, ts } = {}) => {
  if (!entry || !sigFp) return entry;
  const members = Object.assign({}, entry.members || {});
  const prev = members[sigFp] || {};
  members[sigFp] = {
    name: String(name || prev.name || '').slice(0, 32),
    pub: pubOk(pub) ? { x: pub.x, y: pub.y } : prev.pub,
    spub: pubOk(spub) ? { x: spub.x, y: spub.y } : prev.spub,
    seen: Math.max(prev.seen || 0, Number(ts) || 0)
  };
  const keep = Object.entries(members).sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0)).slice(0, MEMBERS_MAX);
  entry.members = Object.fromEntries(keep);
  return entry;
};

export const noteJoined = (entry, ctl, sigFp) => {
  if (!entry || !ctl || typeof ctl.inv !== 'string' || !ctl.inv) return { twice: null };
  const who = sigFp || (typeof ctl.jid === 'string' && ctl.jid ? 'g:' + ctl.jid.slice(0, 32) : null);
  if (!who) return { twice: null };
  const joins = Object.assign({}, entry.joins || {});
  const list = (joins[ctl.inv] || []).slice();
  if (!list.some((j) => j.who === who)) list.push({ who, name: String(ctl.name || '').slice(0, 32), ts: Date.now() });
  joins[ctl.inv] = list.slice(0, 10);
  const keep = Object.entries(joins).sort((a, b) => Math.max(...b[1].map((j) => j.ts || 0)) - Math.max(...a[1].map((j) => j.ts || 0))).slice(0, JOINS_MAX);
  entry.joins = Object.fromEntries(keep);
  return { twice: list.length >= 2 ? [list[0].name, list[1].name] : null };
};

export const membersOf = (entry, mySigFp) => Object.entries((entry && entry.members) || {})
  .filter(([fp]) => fp !== mySigFp)
  .map(([sigFp, m]) => ({ sigFp, name: m.name || '', pub: m.pub }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const acceptRekey = (entry, payload, senderSigFp) => !!entry && !!payload && payload.kind === 'room-rekey'
  && typeof payload.room === 'string' && payload.room === entry.room
  && keyOk(payload.key) && payload.kv === 2
  && !!senderSigFp && !!(entry.members && entry.members[senderSigFp]);
