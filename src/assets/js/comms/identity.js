const KEYRING_VAULT = 'mentria.store.keyring.vault';

const vaultApi = () => (typeof window !== 'undefined' && window.MentriaIdentity) || null;

const keyringHere = () => {
  try { return !!localStorage.getItem(KEYRING_VAULT); } catch (_) { return false; }
};

let keyringP = null;
const keyring = () => {
  if (!keyringP) {
    keyringP = import('/assets/js/mentria-unlock.js')
      .then(async (m) => { try { await m.ready(); } catch (_) {} return m; })
      .catch(() => { keyringP = null; return null; });
  }
  return keyringP;
};

const linkedState = async () => {
  if (!keyringHere()) return null;
  const KR = await keyring();
  if (!KR) return null;
  try {
    const st = KR.state();
    return st && (st.linked || []).includes('identity') ? { KR, st } : null;
  } catch (_) { return null; }
};

export const hasIdentity = () => {
  const id = vaultApi();
  try { return !!id && id.isSetUp(); } catch (_) { return false; }
};

export const isOpen = () => {
  const id = vaultApi();
  try { return !!id && id.isUnlocked(); } catch (_) { return false; }
};

const openFromKeyring = async (id) => {
  const ring = await linkedState();
  if (!ring || !ring.st.unlocked) return false;
  let list = [];
  try {
    list = await ring.KR.secrets('identity');
    if (!list.length) return false;
    await id.openLinked(list.map((x) => x.bytes));
  } catch (_) {
    return false;
  } finally {
    list.forEach((x) => { try { x.bytes.fill(0); } catch (_) {} });
  }
  return isOpen();
};

export const openQuietly = async () => {
  const id = vaultApi();
  if (!id || !hasIdentity()) return false;
  if (isOpen()) return true;
  try { if (await id.tryDeviceUnlock()) return true; } catch (_) {}
  return openFromKeyring(id);
};

export const askToOpen = async () => {
  if (await openQuietly()) return 'open';
  if (!hasIdentity()) return 'elsewhere';
  const ring = await linkedState();
  if (!ring || !ring.st.setUp) return 'elsewhere';
  let UI = null;
  try { UI = await import('/assets/js/mentria-unlock-ui.js'); } catch (_) { return 'elsewhere'; }
  try { await UI.showLaunch(); } catch (_) {}
  return (await openQuietly()) ? 'open' : 'cancelled';
};

export const secretCopy = () => {
  const id = vaultApi();
  if (!id) throw new Error('locked');
  return new Uint8Array(id.getSecret());
};
