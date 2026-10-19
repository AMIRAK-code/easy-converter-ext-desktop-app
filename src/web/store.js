// Hands files between extension pages (overlay -> editor tab) via IndexedDB.
// Entries are taken (read + deleted) once and expire after an hour.

const DB = 'easy-convert', STORE = 'handoff';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export async function putFile(file) {
  const id = crypto.randomUUID();
  await tx('readwrite', (s) => {
    s.put({ ...file, at: Date.now() }, id);
    // Sweep stale entries.
    const cur = s.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      if (Date.now() - (c.value?.at ?? 0) > 3600_000) c.delete();
      c.continue();
    };
  });
  return id;
}

export async function takeFile(id) {
  let value;
  await tx('readwrite', (s) => {
    const req = s.get(id);
    req.onsuccess = () => { value = req.result; s.delete(id); };
  });
  return value ?? null;
}
