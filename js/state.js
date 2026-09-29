// EIDOLON shared namespace + tiny DOM helper. Loaded first; every other
// module attaches to window.EIDOLON.
window.EIDOLON = window.EIDOLON || {};
EIDOLON.$ = (id) => document.getElementById(id);

// Constants shared across modules.
EIDOLON.const = {
  EXPORT_SIZE: 512, // default exported token edge, in px (placeholder)
};

// Silent localStorage setter — blocked storage (private mode, file:// quirks)
// must never break the app.
EIDOLON.save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

// ---- Working-area state: the single source of mutable state. Every module
// aliases it as `const S = EIDOLON.state;` and reads/writes S.<field>.
// Persisted fields live in localStorage under `eidolon:*` keys; when you add
// one, add its default here AND a restore line in js/app.js. ----
EIDOLON.state = {
  lang: 'en', // UI language (persisted as eidolon:lang by js/i18n.js)
};
