// EIDOLON — main UI controller. Everything runs inside one IIFE and reads/writes
// the shared state via `const S = EIDOLON.state;`. As it grows, organize it into
// clearly-marked `// ---- section ----` blocks, the same convention the other
// cyberdeck.tools apps follow.
(function (EIDOLON) {
  'use strict';
  const $ = EIDOLON.$;
  const S = EIDOLON.state; // eslint-disable-line no-unused-vars

  // ---- helpers ----
  function setStatus(msg, kind) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---- restore persisted settings (eidolon:* keys) ----
  function restore() {
    // Add one line per persisted setting, e.g.:
    // S.size = parseInt(localStorage.getItem('eidolon:size') || S.size, 10);
  }

  // ---- init ----
  function init() {
    restore();
    setStatus('');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.EIDOLON);
