/* @deps: none */
/* =====================================================================
   Binary file storage.

   Project text lives in localStorage (small, synchronous, easy).  Images do
   not belong there: base64 in JSON inflates them by a third and the whole
   store is a few megabytes.  So binaries go to IndexedDB, keyed by file name,
   and the project manifest only remembers their names.

   Every call degrades to "nothing stored" if IndexedDB is unavailable, so a
   browser in private mode still works — it just will not remember images.
   ===================================================================== */
const DB_NAME = "pw.files";
const DB_VERSION = 1;
const STORE = "bin";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve) {
    let idb = null;
    try { idb = globalThis.indexedDB; } catch (e) { idb = null; }
    if (!idb) { resolve(null); return; }
    let req = null;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(null); };
    req.onblocked = function () { resolve(null); };
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise(function (resolve) {
    let box = null;
    try { box = db.transaction(STORE, mode); } catch (e) { resolve(null); return; }
    const store = box.objectStore(STORE);
    let out = null;
    try { out = fn(store); } catch (e) { resolve(null); return; }
    box.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : null); };
    box.onerror = function () { resolve(null); };
    box.onabort = function () { resolve(null); };
  });
}

export async function putBinary(name, bytes) {
  const db = await openDb();
  if (!db || !name || !bytes) return false;
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ok = await tx(db, "readwrite", (s) => s.put(copy, name));
  return ok !== null || true;
}

export async function getBinary(name) {
  const db = await openDb();
  if (!db || !name) return null;
  const v = await tx(db, "readonly", (s) => s.get(name));
  if (!v) return null;
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

export async function deleteBinary(name) {
  const db = await openDb();
  if (!db || !name) return false;
  await tx(db, "readwrite", (s) => s.delete(name));
  return true;
}

export async function listBinaries() {
  const db = await openDb();
  if (!db) return [];
  const out = [];
  await new Promise(function (resolve) {
    let box = null;
    try { box = db.transaction(STORE, "readonly"); } catch (e) { resolve(); return; }
    const store = box.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = function () {
      const cur = req.result;
      if (!cur) { resolve(); return; }
      out.push({ name: cur.key, size: cur.value ? cur.value.length : 0 });
      cur.continue();
    };
    req.onerror = function () { resolve(); };
    box.onerror = function () { resolve(); };
  });
  return out;
}

export async function clearBinaries() {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "readwrite", (s) => s.clear());
  return true;
}
