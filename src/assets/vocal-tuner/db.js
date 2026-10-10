const NAME = 'mentria-ext-vocal-tuner';
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('takes')) d.createObjectStore('takes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => { d.close(); opening = null; };
      d.onclose = () => { opening = null; };
      resolve(d);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

function ask(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finish(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('aborted', 'AbortError'));
  });
}

export function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function listTakes() {
  const d = await open();
  const all = await ask(d.transaction('takes').objectStore('takes').getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getTake(id) {
  const d = await open();
  return (await ask(d.transaction('takes').objectStore('takes').get(id))) || null;
}

export async function saveTake(take, audio) {
  const d = await open();
  const tx = d.transaction(['takes', 'audio'], 'readwrite');
  const done = finish(tx);
  try {
    tx.objectStore('takes').put(take);
    const store = tx.objectStore('audio');
    if (audio && audio.dry) store.put(audio.dry, take.id + ':dry');
    if (audio && audio.tuned) store.put(audio.tuned, take.id + ':tuned');
  } catch (e) {
    done.catch(() => {});
    try { tx.abort(); } catch (_) {}
    throw e;
  }
  return done;
}

export async function updateTake(take) {
  const d = await open();
  const tx = d.transaction('takes', 'readwrite');
  tx.objectStore('takes').put(take);
  return finish(tx);
}

export async function saveRender(take, tuned) {
  return saveTake(take, { tuned });
}

export async function getAudio(id, kind) {
  const d = await open();
  return (await ask(d.transaction('audio').objectStore('audio').get(id + ':' + kind))) || null;
}

export async function deleteTake(id) {
  const d = await open();
  const tx = d.transaction(['takes', 'audio'], 'readwrite');
  tx.objectStore('takes').delete(id);
  tx.objectStore('audio').delete(id + ':dry');
  tx.objectStore('audio').delete(id + ':tuned');
  return finish(tx);
}
