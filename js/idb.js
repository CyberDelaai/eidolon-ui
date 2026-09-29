(function (EIDOLON) {
  'use strict';
  // ---- Persistence: roster images + custom frame/mask survive reloads (IndexedDB) ----
  // Two stores: 'items' (one record per roster token: source Blob + transform,
  // adjustments, label, badge, order) and 'assets' ('frame' / 'mask' Blobs).
  // Every call returns a Promise; callers wrap them in .catch() so a blocked
  // IDB never breaks the app (it just won't persist).
  const IDB = (function () {
    const NAME = 'eidolon', VERSION = 1, STORES = ['items', 'assets'];
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        let r;
        try { r = indexedDB.open(NAME, VERSION); } catch (e) { return rej(e); }
        r.onupgradeneeded = () => STORES.forEach((s) => {
          if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
        });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    }
    function tx(store, mode, run) {
      return open().then((db) => new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const rq = run(t.objectStore(store));
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = t.onabort = () => rej(t.error);
      }));
    }
    return {
      put: (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key)),
      get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
      del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
      all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    };
  })();
  EIDOLON.idb = IDB;
})(window.EIDOLON);
