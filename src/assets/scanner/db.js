const NAME = 'mentria-ext-scanner';
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
    };
    req.onsuccess = () => resolve(req.result);
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

export async function listDocs() {
  const d = await open();
  const all = await ask(d.transaction('docs').objectStore('docs').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id) {
  const d = await open();
  return (await ask(d.transaction('docs').objectStore('docs').get(id))) || null;
}

export async function saveDoc(doc) {
  const d = await open();
  const tx = d.transaction('docs', 'readwrite');
  tx.objectStore('docs').put(doc);
  return finish(tx);
}

export async function getPage(id) {
  const d = await open();
  return (await ask(d.transaction('pages').objectStore('pages').get(id))) || null;
}

export async function savePage(page) {
  const d = await open();
  const tx = d.transaction('pages', 'readwrite');
  tx.objectStore('pages').put(page);
  return finish(tx);
}

export async function deletePage(id) {
  const d = await open();
  const tx = d.transaction('pages', 'readwrite');
  tx.objectStore('pages').delete(id);
  return finish(tx);
}

export async function deleteDoc(id) {
  const d = await open();
  const tx = d.transaction(['docs', 'pages'], 'readwrite');
  tx.objectStore('docs').delete(id);
  const pages = tx.objectStore('pages');
  const req = pages.index('docId').openKeyCursor(IDBKeyRange.only(id));
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    pages.delete(c.primaryKey);
    c.continue();
  };
  return finish(tx);
}
