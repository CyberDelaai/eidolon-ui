// EIDOLON — main UI controller. Everything runs inside one IIFE and reads/writes
// the shared state via `const S = EIDOLON.state;`. Drawing lives in render.js
// (pipeline) and frames.js (frame library); this file wires input, the stage,
// the roster, persistence and export.
(function (EIDOLON) {
  'use strict';
  const $ = EIDOLON.$;
  const S = EIDOLON.state;
  const C = EIDOLON.const;
  const t = (k, vars) => {
    let s = EIDOLON.t(k);
    if (vars) Object.keys(vars).forEach((v) => { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  };
  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  const cur = () => S.items[S.current] || null;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- helpers ----
  // Status line: the OUTPUT column's, mirrored inside the BATCH modal.
  function setStatus(msg, kind) {
    ['status', 'batchStatus'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'status' + (kind ? ' ' + kind : '');
    });
  }
  function debounce(fn, ms) {
    let id = 0;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }
  function slug(s) {
    return String(s || 'token').replace(/\.[a-z0-9]+$/i, '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'token';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function toBlob(canvas, type) {
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, 0.95));
  }
  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }
  function openPicker(input) {
    try { if (input.showPicker) { input.showPicker(); return; } } catch (e) {}
    input.click();
  }

  // ---- persistence: style/output in localStorage, roster + assets in IndexedDB ----
  const saveStyle = debounce(() => EIDOLON.save('eidolon:style', JSON.stringify(S.style)), 150);
  const saveOut = () => EIDOLON.save('eidolon:out', JSON.stringify(S.out));
  const saveRef = () => EIDOLON.save('eidolon:ref', JSON.stringify(S.ref));
  const persistTimers = {};
  function persistItem(item) {
    clearTimeout(persistTimers[item.id]);
    persistTimers[item.id] = setTimeout(() => {
      const rec = {
        id: item.id, name: item.name, blob: item.blob, order: item.order,
        tf: item.tf, adj: item.adj, label: item.label, badge: item.badge, popOn: !!item.popOn,
      };
      const put = (mask) => EIDOLON.idb.put('items', item.id, Object.assign(rec, { popMask: mask || null })).catch(() => {});
      if (item.popMask) item.popMask.toBlob(put, 'image/png'); else put(null);
    }, 300);
  }

  // ---- restore persisted settings (eidolon:* keys) ----
  function mergeInto(target, raw) {
    if (!raw || typeof raw !== 'object') return;
    Object.keys(target).forEach((k) => {
      if (k in raw && typeof raw[k] === typeof target[k]) target[k] = raw[k];
    });
  }
  function restore() {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    mergeInto(S.style, read('eidolon:style'));
    mergeInto(S.out, read('eidolon:out'));
    mergeInto(S.ref, read('eidolon:ref'));
    mergeInto(S.fx, read('eidolon:fx'));
    if (!['none', 'mono', 'neon', 'holo'].includes(S.fx.tone)) S.fx.tone = 'none';
    if (!['off', 'custom'].concat(EIDOLON.refOrder).includes(S.ref.kind)) S.ref.kind = 'off';
    if (S.style.frame !== 'custom' && !EIDOLON.frames[S.style.frame]) S.style.frame = 'ring';
    if (S.style.bgMode === 'blur') S.style.bgMode = 'extend'; // the old BLUR fill became EXTEND
  }
  // Roster + custom assets come back asynchronously from IndexedDB.
  function restoreDb() {
    EIDOLON.idb.all('items').then((recs) => {
      recs = (recs || []).filter((r) => r && r.blob).sort((a, b) => a.order - b.order);
      return Promise.all(recs.map((r) => Promise.all([
        decode(r.blob),
        r.popMask ? decode(r.popMask).catch(() => null) : null,
      ]).then(([img, mask]) => ({
        id: r.id, name: r.name, blob: r.blob, order: r.order, src: toSource(img),
        tf: Object.assign(EIDOLON.newTransform(), r.tf), adj: Object.assign(EIDOLON.newAdjust(), r.adj),
        label: r.label || '', badge: r.badge || '',
        popOn: !!r.popOn, popMask: mask ? toSource(mask, 512) : null,
      })).catch(() => null)));
    }).then((items) => {
      items = (items || []).filter(Boolean);
      if (!items.length) return;
      const had = S.items.length;
      S.items = items.concat(S.items); // images added before the DB answered go last
      select(had ? items.length + S.current : 0);
    }).catch(() => {});
    EIDOLON.idb.get('assets', 'frame').then((b) => b && decode(b).then((img) => {
      S.customFrame = toSource(img, 1024); buildFrameGrid(); updateButtons(); styleChanged();
    })).catch(() => {});
    EIDOLON.idb.get('assets', 'ref').then((b) => b && decode(b).then((img) => {
      S.customRef = toSource(img, 1024); buildRefBar(); requestDraw();
    })).catch(() => {});
    EIDOLON.idb.get('assets', 'mask').then((b) => b && decode(b).then((img) => {
      S.customMask = maskFrom(img); updateButtons(); styleChanged();
    })).catch(() => {});
  }

  // ---- image loading ----
  function decode(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  // Rasterize to a canvas no larger than `max` on its longest edge.
  function toSource(img, max) {
    max = max || C.MAX_SOURCE;
    const w0 = img.naturalWidth || img.width || 512, h0 = img.naturalHeight || img.height || 512;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  // Greyscale image -> alpha mask (white keeps, black cuts), 512² for speed.
  function maskFrom(img) {
    const N = 512, c = document.createElement('canvas');
    c.width = N; c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) * (p[i + 3] / 255);
      p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = l;
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  let orderSeq = Date.now();
  function addBlobs(list) {
    const blobs = [...list].filter((b) => b && /^image\//.test(b.type || 'image/'));
    if (!blobs.length) return Promise.resolve(0);
    return Promise.all(blobs.map((blob) => decode(blob).then((img) => ({ blob, img })).catch(() => null)))
      .then((res) => {
        const ok = res.filter(Boolean);
        ok.forEach(({ blob, img }) => {
          const item = {
            id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name: blob.name || 'token', blob, order: orderSeq++, src: toSource(img),
            tf: EIDOLON.newTransform(), adj: EIDOLON.newAdjust(), label: '', badge: '',
            popOn: false, popMask: null,
          };
          S.items.push(item);
          persistItem(item);
        });
        if (ok.length) {
          select(S.items.length - ok.length);
          setStatus(t('s_loaded', { n: ok.length }), 'ok');
        } else {
          setStatus(t('s_loadfail'), 'warn');
        }
        return ok.length;
      });
  }
  function fromUrl(url) {
    url = String(url || '').trim();
    if (!/^(https?:|data:|blob:)/i.test(url)) { setStatus(t('s_loadfail'), 'warn'); return; }
    setStatus(t('s_fetching'));
    fetch(url, { mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => {
        const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'token');
        const f = new File([b], name, { type: b.type || 'image/png' });
        return addBlobs([f]);
      })
      .then((n) => { if (n) $('urlInput').value = ''; })
      .catch(() => setStatus(t('s_urlfail'), 'warn'));
  }
  // Drag-and-drop: files first, then a dragged image's URL (from another tab).
  function handleTransfer(dt) {
    if (!dt) return;
    const files = [...(dt.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { addBlobs(files); return; }
    const html = dt.getData && dt.getData('text/html');
    const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const url = (m && m[1]) || (dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain')));
    if (url) fromUrl(url.split('\n')[0]);
  }

  // ---- roster ----
  function select(i) {
    S.current = S.items.length ? clamp(i, 0, S.items.length - 1) : -1;
    if (brush.on && !cur()) setBrush(false);
    syncControls(); requestDraw(); rosterChanged(); updateButtons(); presetsChanged();
  }
  function removeItem(i) {
    const it = S.items[i];
    if (!it) return;
    S.items.splice(i, 1);
    EIDOLON.idb.del('items', it.id).catch(() => {});
    select(i >= S.current ? Math.min(S.current, S.items.length - 1) : S.current - 1);
  }
  let clearArmed = 0;
  function clearAll() {
    if (!S.items.length) return;
    if (!clearArmed) {
      clearArmed = setTimeout(() => { clearArmed = 0; $('clearBtn').textContent = t('b_clear'); }, 3000);
      $('clearBtn').textContent = t('b_sure');
      return;
    }
    clearTimeout(clearArmed); clearArmed = 0;
    $('clearBtn').textContent = t('b_clear');
    S.items.forEach((it) => EIDOLON.idb.del('items', it.id).catch(() => {}));
    S.items = [];
    select(-1);
    setStatus(t('s_cleared'));
  }
  const thumbs = new Map(); // item.id -> thumbnail canvas
  function buildRoster() {
    const box = $('roster');
    box.textContent = '';
    const size = 84, N = Math.round(size * dpr());
    S.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'roster-item' + (i === S.current ? ' active' : '');
      b.title = it.label || it.name;
      let c = thumbs.get(it.id);
      if (!c) { c = document.createElement('canvas'); thumbs.set(it.id, c); }
      c.width = N; c.height = N;
      EIDOLON.render(c.getContext('2d'), N, it);
      b.appendChild(c);
      const x = document.createElement('span');
      x.className = 'roster-x'; x.textContent = '×'; x.title = t('t_remove');
      x.addEventListener('click', (e) => { e.stopPropagation(); removeItem(i); });
      b.appendChild(x);
      b.addEventListener('click', () => select(i));
      box.appendChild(b);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'roster-add'; add.textContent = '+'; add.title = t('t_add');
    add.addEventListener('click', () => $('fileInput').click());
    box.appendChild(add);
    const ids = new Set(S.items.map((it) => it.id));
    [...thumbs.keys()].forEach((id) => { if (!ids.has(id)) thumbs.delete(id); });
  }
  const rosterChanged = debounce(buildRoster, 180);

  // ---- stage preview ----
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      const cv = $('tokenCanvas');
      EIDOLON.render(cv.getContext('2d'), cv.width, cur());
      drawRef();
      $('stage').classList.toggle('has-image', !!cur());
    });
  }
  function fitCanvas() {
    const stage = $('stage'), cv = $('tokenCanvas');
    // sized from the width only — the stage's height follows the canvas
    const css = Math.max(160, Math.min(C.PREVIEW_MAX, stage.clientWidth - 48));
    cv.style.width = css + 'px'; cv.style.height = css + 'px';
    const px = Math.round(css * dpr());
    if (cv.width !== px) { cv.width = px; cv.height = px; }
    requestDraw();
  }
  // Called whenever the selected token's transform/adjustments/label change.
  function itemChanged(item) {
    item = item || cur();
    if (!item) return;
    syncControls(); requestDraw(); persistItem(item); rosterChanged();
  }
  function styleChanged() {
    syncControls(); saveStyle(); requestDraw(); drawFrameThumbs(); rosterChanged(); markActivePreset();
  }

  // Zoom by factor k keeping the token-space point (px, py) (fractions of N,
  // relative to the centre) fixed under the cursor.
  function zoomAt(item, k, px, py) {
    const z = clamp(item.tf.zoom * k, 0.1, 4);
    k = z / item.tf.zoom;
    item.tf.x = px - k * (px - item.tf.x);
    item.tf.y = py - k * (py - item.tf.y);
    item.tf.zoom = z;
  }
  function setupStage() {
    const cv = $('tokenCanvas'), stage = $('stage');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      const it = cur();
      if (!it) { $('fileInput').click(); return; }
      if (brush.on) { brushDown(e); return; }
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, w: cv.getBoundingClientRect().width };
      cv.classList.add('grabbing');
    });
    cv.addEventListener('pointermove', (e) => {
      const it = cur();
      if (brush.on) { brushMove(e); return; }
      if (!drag || !it) return;
      it.tf.x += (e.clientX - drag.x) / drag.w;
      it.tf.y += (e.clientY - drag.y) / drag.w;
      drag.x = e.clientX; drag.y = e.clientY;
      requestDraw();
    });
    const end = () => {
      if (brush.stroke) { brushUp(); return; }
      if (drag) { drag = null; cv.classList.remove('grabbing'); itemChanged(); }
    };
    cv.addEventListener('pointerleave', () => { if (brush.on && !brush.stroke) { brush.cursor = null; requestDraw(); } });
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // Ctrl+wheel zooms (also trackpad pinch, which arrives as ctrlKey wheel),
    // Shift+wheel rotates; a plain wheel is left alone so the page scrolls.
    stage.addEventListener('wheel', (e) => {
      const it = cur();
      if (!it || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      const dy = e.deltaY || e.deltaX;
      if (e.shiftKey) {
        it.tf.rot = ((Math.round(it.tf.rot + Math.sign(dy) * 5) + 540) % 360) - 180;
      } else {
        const r = cv.getBoundingClientRect();
        zoomAt(it, Math.exp(-dy * 0.0015), (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
      }
      itemChanged(it);
    }, { passive: false });
    new ResizeObserver(fitCanvas).observe(stage);

    // drop anywhere on the page; highlight the stage while dragging
    let depth = 0;
    document.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; stage.classList.add('dragover'); });
    document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('dragover'); } });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; stage.classList.remove('dragover');
      handleTransfer(e.dataTransfer);
    });
    document.addEventListener('paste', (e) => {
      if (isTyping(document.activeElement)) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const files = [...(cd.items || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); addBlobs(files); return; }
      const txt = cd.getData('text/plain');
      if (/^https?:\/\/\S+$/i.test((txt || '').trim())) { e.preventDefault(); fromUrl(txt); }
    });
    // keyboard: arrows nudge, +/- zoom, [ ] rotate, 0 reset
    document.addEventListener('keydown', (e) => {
      const it = cur();
      if (!it || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 0.02 : 0.004;
      const map = {
        ArrowLeft: () => { it.tf.x -= step; }, ArrowRight: () => { it.tf.x += step; },
        ArrowUp: () => { it.tf.y -= step; }, ArrowDown: () => { it.tf.y += step; },
        '+': () => zoomAt(it, 1.05, 0, 0), '=': () => zoomAt(it, 1.05, 0, 0), '-': () => zoomAt(it, 1 / 1.05, 0, 0),
        '[': () => { it.tf.rot = Math.max(-180, it.tf.rot - (e.shiftKey ? 15 : 1)); },
        ']': () => { it.tf.rot = Math.min(180, it.tf.rot + (e.shiftKey ? 15 : 1)); },
        '{': () => { it.tf.rot = Math.max(-180, it.tf.rot - 15); }, '}': () => { it.tf.rot = Math.min(180, it.tf.rot + 15); },
        0: () => { it.tf = EIDOLON.newTransform(); },
      };
      const fn = map[e.key];
      if (!fn) return;
      e.preventDefault(); fn(); itemChanged(it);
    });
  }

  // ---- reference overlay (preview only — drawn on #refCanvas, never exported) ----
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function refIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-112 -112 224 224');
    svg.setAttribute('aria-hidden', 'true');
    const make = (tag, attrs) => {
      const el = document.createElementNS(SVG_NS, tag);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    };
    const add = (tag, attrs) => svg.appendChild(make(tag, attrs));
    const ring = { cx: 0, cy: 0, r: 100, fill: 'none', stroke: 'currentColor', 'stroke-width': 7, opacity: 0.45 };
    if (kind === 'off') {
      add('circle', ring);
      add('line', { x1: -70, y1: 70, x2: 70, y2: -70, stroke: 'currentColor', 'stroke-width': 12 });
    } else if (kind === 'custom') {
      add('rect', { x: -80, y: -80, width: 160, height: 160, fill: 'none', stroke: 'currentColor', 'stroke-width': 10, 'stroke-dasharray': '22 14' });
      add('path', { d: 'M 0 -45 L 0 45 M -45 0 L 45 0', stroke: 'currentColor', 'stroke-width': 14 });
    } else {
      add('circle', ring);
      // clip the silhouette to the ring, like the overlay is clipped to the cut-out
      add('clipPath', { id: 'refclip-' + kind }).appendChild(make('circle', { cx: 0, cy: 0, r: 100 }));
      add('path', { d: EIDOLON.refShapes[kind], fill: 'currentColor', 'clip-path': `url(#refclip-${kind})` });
    }
    return svg;
  }
  function buildRefBar() {
    const box = $('refTiles');
    box.textContent = '';
    ['off'].concat(EIDOLON.refOrder, ['custom']).forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ref-tile'; b.dataset.ref = k;
      b.setAttribute('role', 'radio');
      if (k === 'custom' && S.customRef) {
        const c = document.createElement('canvas'), N = Math.round(28 * dpr());
        c.width = N; c.height = N;
        c.getContext('2d').drawImage(S.customRef, 0, 0, N, N);
        b.appendChild(c);
        const x = document.createElement('span');
        x.className = 'roster-x'; x.textContent = '×'; x.dataset.i18nTitle = 't_ref_clear';
        x.addEventListener('click', (e) => { e.stopPropagation(); clearCustomRef(); });
        b.appendChild(x);
      } else {
        b.appendChild(refIcon(k));
      }
      b.addEventListener('click', () => {
        if (k === 'custom' && (!S.customRef || S.ref.kind === 'custom')) { $('refInput').click(); return; }
        S.ref.kind = k; saveRef(); syncRef();
      });
      box.appendChild(b);
    });
    syncRef();
  }
  function syncRef() {
    document.querySelectorAll('.ref-tile').forEach((b) => {
      const on = b.dataset.ref === S.ref.kind;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.title = t('t_ref_' + b.dataset.ref);
      const x = b.querySelector('.roster-x');
      if (x) x.title = t('t_ref_clear');
    });
    $('refOpacity').value = S.ref.opacity;
    $('refOpVal').textContent = S.ref.opacity + '%';
    $('refOpacity').disabled = S.ref.kind === 'off';
    drawRef();
  }
  function drawRef() {
    const rc = $('refCanvas'), cv = $('tokenCanvas');
    if (rc.width !== cv.width) { rc.width = cv.width; rc.height = cv.height; }
    EIDOLON.drawReference(rc.getContext('2d'), rc.width);
    if (brush.on && cur()) EIDOLON.drawBrushOverlay(rc.getContext('2d'), rc.width, cur(), brush.cursor);
  }
  function setCustomRef(blob) {
    decode(blob).then((img) => {
      S.customRef = toSource(img, 1024);
      S.ref.kind = 'custom'; saveRef();
      EIDOLON.idb.put('assets', 'ref', blob).catch(() => {});
      buildRefBar();
      setStatus(t('s_ref'), 'ok');
    }).catch(() => setStatus(t('s_loadfail'), 'warn'));
  }
  function clearCustomRef() {
    S.customRef = null;
    if (S.ref.kind === 'custom') { S.ref.kind = 'off'; saveRef(); }
    EIDOLON.idb.del('assets', 'ref').catch(() => {});
    buildRefBar();
  }
  function setupRefBar() {
    $('refOpacity').addEventListener('input', (e) => { S.ref.opacity = +e.target.value; saveRef(); syncRef(); });
    $('refInput').addEventListener('change', (e) => { if (e.target.files[0]) setCustomRef(e.target.files[0]); e.target.value = ''; });
    buildRefBar();
  }

  // ---- batch export modal: EXPORT ALL + NUMBERED SET behind one button ----
  let batchReturn = null; // element to refocus when the modal closes
  function openBatch() {
    if (!S.items.length) return;
    batchReturn = document.activeElement;
    updateButtons();
    $('batchModal').hidden = false;
    const first = [$('zipAllBtn'), $('zipSetBtn'), $('batchClose')].find((b) => !b.disabled);
    if (first) first.focus();
  }
  function closeBatch() {
    if ($('batchModal').hidden) return;
    $('batchModal').hidden = true;
    if (batchReturn && batchReturn.focus) batchReturn.focus();
  }
  function setupBatch() {
    $('batchBtn').addEventListener('click', openBatch);
    $('batchClose').addEventListener('click', closeBatch);
    // click on the dimmed backdrop (not the panel) closes
    $('batchModal').addEventListener('click', (e) => { if (e.target === $('batchModal')) closeBatch(); });
    // keys stay inside the modal: Esc closes, nothing reaches the stage
    // shortcuts or the PRESETS panel's Esc handler
    $('batchModal').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeBatch(); }
      e.stopPropagation();
    });
  }

  // ---- presets: named snapshots of the global look (S.style, optionally
  // S.out), in a COMMLINK-style slide-out side panel. Stored as
  // eidolon:presets = { NAME: { style, out?, savedAt } }. Per-token data
  // (portrait, transform, name, badge) is never part of a preset. ----
  function loadPresets() {
    try { return JSON.parse(localStorage.getItem('eidolon:presets') || '{}') || {}; } catch (e) { return {}; }
  }
  const savePresets = (p) => EIDOLON.save('eidolon:presets', JSON.stringify(p));
  // Identity of a look (style + fx) — used to highlight the preset matching the current settings.
  const lookKey = (st, fx) => JSON.stringify([Object.keys(S.style).map((k) => st[k]), Object.keys(S.fx).map((k) => fx[k])]);
  // A preset saved before FX existed carries no fx: it means "no effects", so
  // it resolves to the defaults (master switch off), not to whatever is on now.
  const presetLook = (p) => [Object.assign({}, S.style, p.style), Object.assign(EIDOLON.newFx(), p.fx || {})];
  function presetStamp(ms) {
    const d = new Date(ms || 0);
    if (isNaN(d.getTime())) return '';
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${p2(d.getFullYear() % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  // Draw the current token (or the empty frame) as it would look with a preset.
  function renderPresetThumb(canvas, p) {
    const N = Math.round(56 * dpr());
    canvas.width = N; canvas.height = N;
    const keepStyle = S.style, keepFx = S.fx;
    [S.style, S.fx] = presetLook(p);
    try { EIDOLON.render(canvas.getContext('2d'), N, cur()); } finally { S.style = keepStyle; S.fx = keepFx; }
  }
  function buildPresetList() {
    const box = $('presetList'), presets = loadPresets();
    box.textContent = '';
    const names = Object.keys(presets).sort((a, b) => (presets[b].savedAt || 0) - (presets[a].savedAt || 0));
    if (!names.length) {
      const e = document.createElement('div');
      e.className = 'preset-empty'; e.textContent = t('p_empty');
      box.appendChild(e);
      return;
    }
    const nowKey = lookKey(S.style, S.fx);
    names.forEach((name) => {
      const p = presets[name];
      const item = document.createElement('div');
      item.className = 'preset-item';
      item.dataset.key = lookKey(...presetLook(p));
      item.classList.toggle('active', item.dataset.key === nowKey);
      const c = document.createElement('canvas');
      c.className = 'preset-thumb'; c.title = t('b_apply');
      renderPresetThumb(c, p);
      c.addEventListener('click', () => applyPreset(name));
      const body = document.createElement('div');
      body.className = 'preset-body';
      const nm = document.createElement('div');
      nm.className = 'preset-name'; nm.textContent = name;
      const meta = document.createElement('div');
      meta.className = 'preset-meta';
      meta.textContent = '// ' + [presetStamp(p.savedAt), String(p.style.frame || '').toUpperCase(), p.fx && p.fx.on ? '+FX' : '', p.out ? '+OUT' : '']
        .filter(Boolean).join(' · ');
      const acts = document.createElement('div');
      acts.className = 'preset-actions';
      const mk = (cls, attr, text, title) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ' + cls; b.setAttribute(attr, '');
        b.setAttribute('data-augmented-ui', 'tl-clip br-clip border');
        b.textContent = text;
        if (title) b.title = title;
        acts.appendChild(b);
        return b;
      };
      mk('btn-alt', 'data-apply', t('b_apply')).addEventListener('click', () => applyPreset(name));
      mk('', 'data-override', '⇪', t('t_poverride')).addEventListener('click', () => {
        if (!confirm(t('c_poverwrite', { n: name }))) return;
        storePreset(name);
      });
      mk('btn-warn', 'data-del', '✕', t('t_pdelete')).addEventListener('click', () => {
        if (!confirm(t('c_pdelete', { n: name }))) return;
        const all = loadPresets();
        delete all[name];
        savePresets(all);
        buildPresetList();
        setStatus(t('s_pdeleted', { n: name }));
      });
      body.append(nm, meta, acts);
      item.append(c, body);
      box.appendChild(item);
    });
  }
  const presetsChanged = debounce(() => { if ($('sidePresets').classList.contains('open')) buildPresetList(); }, 200);
  // Cheap highlight refresh on every style change (no thumbnail re-render).
  function markActivePreset() {
    const nowKey = lookKey(S.style, S.fx);
    document.querySelectorAll('.preset-item').forEach((el) => el.classList.toggle('active', el.dataset.key === nowKey));
  }
  function storePreset(name) {
    const all = loadPresets();
    all[name] = { style: JSON.parse(JSON.stringify(S.style)), fx: JSON.parse(JSON.stringify(S.fx)), savedAt: Date.now() };
    if ($('presetWithOut').checked) all[name].out = JSON.parse(JSON.stringify(S.out));
    savePresets(all);
    buildPresetList();
    setStatus(t('s_psaved', { n: name }), 'ok');
  }
  function savePresetFromInput() {
    const input = $('presetName'), name = input.value.trim().toUpperCase();
    if (!name) { setStatus(t('s_pnamereq'), 'warn'); input.focus(); return; }
    if (loadPresets()[name] && !confirm(t('c_poverwrite', { n: name }))) return;
    storePreset(name);
    input.value = '';
  }
  function applyPreset(name) {
    const p = loadPresets()[name];
    if (!p || !p.style) return;
    mergeInto(S.style, p.style);
    if (S.style.frame !== 'custom' && !EIDOLON.frames[S.style.frame]) S.style.frame = 'ring';
    if (p.out) { mergeInto(S.out, p.out); saveOut(); updateTexts(); }
    S.fx = EIDOLON.newFx();
    if (p.fx) mergeInto(S.fx, p.fx);
    saveFx(); syncFx();
    styleChanged();
    setStatus(t('s_papplied', { n: name }), 'ok');
  }
  function exportPresets() {
    const body = JSON.stringify({ app: 'eidolon', kind: 'presets', version: 1, presets: loadPresets() }, null, 2);
    download(new Blob([body], { type: 'application/json' }), 'eidolon_presets.json');
  }
  function importPresets(file) {
    file.text().then((txt) => {
      const data = JSON.parse(txt), src = data && (data.presets || data);
      const all = loadPresets();
      let n = 0;
      Object.keys(src || {}).forEach((name) => {
        const p = src[name];
        if (!p || !p.style || typeof p.style !== 'object') return;
        const key = String(name).trim().toUpperCase().slice(0, 24);
        if (!key) return;
        all[key] = { style: p.style, savedAt: p.savedAt || Date.now() };
        if (p.out && typeof p.out === 'object') all[key].out = p.out;
        if (p.fx && typeof p.fx === 'object') all[key].fx = p.fx;
        n++;
      });
      if (!n) throw new Error('empty');
      savePresets(all);
      buildPresetList();
      setStatus(t('s_pimported', { n }), 'ok');
    }).catch(() => setStatus(t('s_pimportfail'), 'warn'));
  }
  function setupPresets() {
    $('presetSave').addEventListener('click', savePresetFromInput);
    $('presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePresetFromInput(); } });
    $('presetWithOut').checked = (() => { try { return localStorage.getItem('eidolon:presetOut') === '1'; } catch (e) { return false; } })();
    $('presetWithOut').addEventListener('change', (e) => EIDOLON.save('eidolon:presetOut', e.target.checked ? '1' : '0'));
    $('presetExport').addEventListener('click', exportPresets);
    $('presetImport').addEventListener('click', () => $('presetFile').click());
    $('presetFile').addEventListener('change', (e) => { if (e.target.files[0]) importPresets(e.target.files[0]); e.target.value = ''; });
  }

  // ---- pop-out brush: paint which parts of the portrait break out over the
  // frame. Each token has its own mask (item.popMask), a canvas in the image's
  // pixel space (≤512 px), so strokes follow pan / zoom / rotate / mirror. ----
  const brush = { on: false, erase: false, size: 8, stroke: null, cursor: null };
  function ensureMask(it) {
    if (!it.popMask) {
      const k = Math.min(1, 512 / Math.max(it.src.width, it.src.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(it.src.width * k));
      c.height = Math.max(1, Math.round(it.src.height * k));
      it.popMask = c;
    }
    return it.popMask;
  }
  // Token point (fractions of the edge) -> mask pixels, inverting the portrait
  // transform; kk = mask px per token edge (for brush widths).
  function toMask(it, fx, fy) {
    const N = 1000, g = EIDOLON.geom(N), s = EIDOLON.baseScale(it.src, g) * it.tf.zoom;
    const dx = fx * N - (g.cx + it.tf.x * N), dy = fy * N - (g.cy + it.tf.y * N);
    const a = (it.tf.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    let lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    if (it.tf.flip) lx = -lx;
    const k = it.popMask.width / (it.src.width * s);
    return { x: (lx + (it.src.width * s) / 2) * k, y: (ly + (it.src.height * s) / 2) * k, kk: k * N };
  }
  function paintSegment(it, a, b) {
    const m = ensureMask(it).getContext('2d'), p = toMask(it, a.x, a.y), q = toMask(it, b.x, b.y);
    m.globalCompositeOperation = brush.erase ? 'destination-out' : 'source-over';
    m.strokeStyle = '#fff'; m.lineCap = 'round'; m.lineJoin = 'round';
    m.lineWidth = Math.max(1, (brush.size / 100) * p.kk);
    m.beginPath(); m.moveTo(p.x, p.y); m.lineTo(q.x + 0.01, q.y); m.stroke();
  }
  function stagePoint(e) {
    const r = $('tokenCanvas').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function brushDown(e) {
    const it = cur();
    if (!it) return;
    $('tokenCanvas').setPointerCapture(e.pointerId);
    const p = stagePoint(e);
    if (!brush.erase) it.popOn = true;
    brush.stroke = p;
    brush.cursor = { x: p.x, y: p.y, r: brush.size / 200 };
    paintSegment(it, p, p);
    syncPop(); requestDraw();
  }
  function brushMove(e) {
    const it = cur(), p = stagePoint(e);
    brush.cursor = { x: p.x, y: p.y, r: brush.size / 200 };
    if (it && brush.stroke) { paintSegment(it, brush.stroke, p); brush.stroke = p; }
    requestDraw();
  }
  function brushUp() {
    brush.stroke = null;
    const it = cur();
    if (it) { persistItem(it); rosterChanged(); }
  }
  function setBrush(on) {
    brush.on = !!on && !!cur();
    if (!brush.on) { brush.cursor = null; brush.stroke = null; }
    $('stage').classList.toggle('brushing', brush.on);
    $('popBar').hidden = !brush.on;
    document.querySelector('.ref-bar:not(.pop-bar)').hidden = brush.on;
    fitPopBar();
    syncPop(); requestDraw();
  }
  function syncPop() {
    const it = cur();
    $('popToggle').dataset.pos = it && it.popOn ? 'right' : 'left';
    $('popToggle').closest('.fx-toggle').classList.toggle('disabled', !it);
    $('popPaintBtn').disabled = !it;
    $('popLoadBtn').disabled = !it;
    $('popPaintBtn').classList.toggle('active', brush.on);
    $('popMode').dataset.pos = brush.erase ? 'right' : 'left';
    $('popSize').value = brush.size;
    $('popSizeVal').textContent = brush.size + '%';
  }
  // DONE -> OK when the brush bar can't hold everything on one row (the
  // FILL / CLEAR / DONE group would wrap below the size slider).
  function fitPopBar() {
    const bar = $('popBar'), done = $('popDone'), acts = $('popActions');
    if (bar.hidden) return;
    const first = bar.firstElementChild;
    done.classList.remove('short');
    // items are centre-aligned with different heights, so "wrapped" means the
    // group starts below the bottom edge of the bar's first item
    if (acts.offsetTop >= first.offsetTop + first.offsetHeight) done.classList.add('short');
  }
  // LOAD POP-OUT: an image becomes the token's pop-out mask, stretched over
  // the portrait. Images with transparency use their alpha (e.g. a cut-out of
  // the character); opaque ones use brightness (white breaks out, black stays in).
  function loadPopMask(file) {
    const it = cur();
    if (!it) return;
    decode(file).then((img) => {
      const m = ensureMask(it), x = m.getContext('2d', { willReadFrequently: true });
      x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, m.width, m.height);
      x.drawImage(img, 0, 0, m.width, m.height);
      const d = x.getImageData(0, 0, m.width, m.height), p = d.data;
      let alpha = false;
      for (let i = 3; i < p.length; i += 4) if (p[i] < 250) { alpha = true; break; }
      for (let i = 0; i < p.length; i += 4) {
        const a = alpha ? p[i + 3] : 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a;
      }
      x.putImageData(d, 0, 0);
      it.popOn = true;
      itemChanged(it);
      setStatus(t('s_popmask'), 'ok');
    }).catch(() => setStatus(t('s_loadfail'), 'warn'));
  }
  function setupPopout() {
    $('popLoadBtn').addEventListener('click', () => $('popMaskInput').click());
    $('popMaskInput').addEventListener('change', (e) => { if (e.target.files[0]) loadPopMask(e.target.files[0]); e.target.value = ''; });
    $('popToggle').addEventListener('click', () => { const it = cur(); if (it) { it.popOn = !it.popOn; itemChanged(it); } });
    $('popPaintBtn').addEventListener('click', () => setBrush(!brush.on));
    $('popDone').addEventListener('click', () => setBrush(false));
    $('popMode').addEventListener('click', () => { brush.erase = !brush.erase; syncPop(); });
    $('popSize').addEventListener('input', (e) => { brush.size = +e.target.value; syncPop(); });
    $('popFill').addEventListener('click', () => {
      const it = cur();
      if (!it) return;
      const m = ensureMask(it), x = m.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, m.width, m.height);
      it.popOn = true; itemChanged(it);
    });
    $('popClear').addEventListener('click', () => {
      const it = cur();
      if (!it || !it.popMask) return;
      it.popMask.getContext('2d').clearRect(0, 0, it.popMask.width, it.popMask.height);
      itemChanged(it);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && brush.on) setBrush(false); });
    new ResizeObserver(fitPopBar).observe($('popBar'));
    document.addEventListener('eidolon:lang', fitPopBar);
    syncPop();
  }

  // ---- side panels (PRESETS, FX): fixed, slide in from the left edge, one
  // open at a time (COMMLINK pattern). Each is <aside class="side-panel"
  // data-panel="name"> with a .side-toggle tab inside. ----
  const PANEL_OPEN = { presets: () => buildPresetList(), fx: () => syncFx() };
  function setOpenPanel(name) {
    document.querySelectorAll('.side-panel').forEach((p) => {
      const on = p.dataset.panel === name, tab = p.querySelector('.side-toggle');
      p.classList.toggle('open', on);
      p.classList.toggle('peer-open', !!name && !on);
      tab.setAttribute('aria-expanded', on ? 'true' : 'false');
      tab.querySelector('.arrow').textContent = on ? '<' : '>';
    });
    EIDOLON.save('eidolon:panel', name || '');
    if (PANEL_OPEN[name]) PANEL_OPEN[name]();
  }
  function setupPanels() {
    document.querySelectorAll('.side-panel').forEach((p) => {
      p.querySelector('.side-toggle').addEventListener('click', () => setOpenPanel(p.classList.contains('open') ? '' : p.dataset.panel));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.querySelector('.side-panel.open')) setOpenPanel('');
    });
    // a press anywhere outside the open panel (its tab is inside it) closes it;
    // the press still goes through to whatever was under the pointer
    document.addEventListener('pointerdown', (e) => {
      const open = document.querySelector('.side-panel.open');
      if (open && !open.contains(e.target)) setOpenPanel('');
    });
    const was = (() => { try { return localStorage.getItem('eidolon:panel'); } catch (e) { return ''; } })();
    setOpenPanel(PANEL_OPEN[was] ? was : '');
  }

  // ---- FX panel: S.fx — master switch + per-effect switches and settings,
  // bound via data-fx (value), data-fxfor (colour swatch) and data-needs
  // (a settings row that dims while its effect is off). ----
  const saveFx = debounce(() => EIDOLON.save('eidolon:fx', JSON.stringify(S.fx)), 150);
  function fxLive() {
    const f = S.fx;
    return f.on && (f.tone !== 'none' || f.glitch || f.rgb || f.grain || f.vig || f.scan);
  }
  function fxChanged() {
    syncFx(); saveFx(); requestDraw(); rosterChanged(); markActivePreset();
  }
  function syncFx() {
    const f = S.fx;
    document.querySelectorAll('[data-fx]').forEach((el) => {
      const v = f[el.dataset.fx];
      if (el.classList.contains('side-switch')) el.dataset.pos = v ? 'right' : 'left';
      else if (String(el.value) !== String(v)) el.value = v;
    });
    document.querySelectorAll('[data-fxfor]').forEach((b) => { b.style.background = $(b.dataset.fxfor).value; });
    document.querySelectorAll('[data-needs]').forEach((row) => {
      const k = row.dataset.needs;
      row.classList.toggle('disabled', !(k === 'tone' ? f.tone !== 'none' : f[k]));
    });
    document.querySelectorAll('[data-val^="fx."]').forEach((el) => {
      el.textContent = (VAL_FMT[el.dataset.val] || String)(f[el.dataset.val.slice(3)]);
    });
    $('fxBody').classList.toggle('off', !f.on);
    $('fxTab').classList.toggle('lit', fxLive());
  }
  function setupFx() {
    document.querySelectorAll('[data-fx]').forEach((el) => {
      const k = el.dataset.fx;
      if (el.classList.contains('side-switch')) {
        el.addEventListener('click', () => { S.fx[k] = !S.fx[k]; fxChanged(); });
      } else {
        el.addEventListener('input', () => { S.fx[k] = el.type === 'range' ? +el.value : el.value; fxChanged(); });
      }
    });
    document.querySelectorAll('[data-fxfor]').forEach((b) => b.addEventListener('click', () => openPicker($(b.dataset.fxfor))));
    $('fxReroll').addEventListener('click', () => { S.fx.glitchSeed = 1 + Math.floor(Math.random() * 9999); fxChanged(); });
    $('fxReset').addEventListener('click', () => {
      const on = S.fx.on;
      S.fx = Object.assign(EIDOLON.newFx(), { on });
      fxChanged();
    });
    syncFx();
  }

  // ---- colour-source choosers (LABEL): <span class="src-group" data-src="plateFrom"
  // data-custom="plateColor" data-opts="frame,accent,bg,custom">. Each chip is
  // painted in the colour it resolves to; the custom chip opens the picker. ----
  const SRC_TAG = { frame: 'FR', accent: 'AC', bg: 'BG', auto: '' };
  const PICK_ICON = '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm-177-377q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120-160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm200 0q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120 160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Z"/></svg>';
  function buildSrcGroups() {
    document.querySelectorAll('.src-group').forEach((grp) => {
      grp.textContent = '';
      grp.dataset.opts.split(',').forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'src-chip' + (v === 'auto' ? ' auto' : ''); b.dataset.v = v;
        b.setAttribute('role', 'radio');
        if (v === 'custom') b.innerHTML = PICK_ICON; else b.textContent = SRC_TAG[v];
        b.addEventListener('click', () => {
          S.style[grp.dataset.src] = v;
          styleChanged();
          if (v === 'custom') openPicker($(grp.dataset.custom));
        });
        grp.appendChild(b);
      });
    });
    syncSrcGroups();
  }
  function syncSrcGroups() {
    document.querySelectorAll('.src-group').forEach((grp) => {
      const from = S.style[grp.dataset.src], custom = S.style[grp.dataset.custom];
      grp.querySelectorAll('.src-chip').forEach((b) => {
        const v = b.dataset.v, on = v === from;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.title = t('t_src_' + v);
        if (v === 'auto') return;
        const col = EIDOLON.colorFrom(v, custom);
        b.style.background = col; b.style.color = EIDOLON.ink(col);
      });
    });
  }

  // ---- frame grid + palette ----
  const PALETTE = ['#00f0ff', '#fcee0a', '#ff003c', '#39ff14', '#b026ff', '#ff7a00', '#e8e8ee', '#050507'];
  function frameKeys() { return EIDOLON.frameOrder.concat(S.customFrame ? ['custom'] : []); }
  function buildFrameGrid() {
    const grid = $('frameGrid');
    grid.textContent = '';
    frameKeys().forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'frame-tile'; b.dataset.frame = k;
      b.setAttribute('role', 'radio');
      b.title = k.toUpperCase();
      b.appendChild(document.createElement('canvas'));
      b.addEventListener('click', () => { S.style.frame = k; styleChanged(); });
      grid.appendChild(b);
    });
    drawFrameThumbs();
  }
  function drawFrameThumbs() {
    const st = S.style;
    document.querySelectorAll('.frame-tile').forEach((b) => {
      const k = b.dataset.frame, c = b.querySelector('canvas'), N = Math.round(46 * dpr());
      c.width = N; c.height = N;
      const x = c.getContext('2d'), R = (N / 2) * 0.8;
      const g = { N, cx: N / 2, cy: N / 2, R, t: R * 0.16, u: N / 200 };
      if (k === 'custom') {
        x.drawImage(S.customFrame, 0, 0, N, N);
        x.globalCompositeOperation = 'multiply'; x.fillStyle = st.frameColor; x.fillRect(0, 0, N, N);
        x.globalCompositeOperation = 'destination-in'; x.drawImage(S.customFrame, 0, 0, N, N);
      } else if (k === 'none') {
        x.setLineDash([3 * dpr(), 3 * dpr()]); x.strokeStyle = 'rgba(122,122,136,0.9)'; x.lineWidth = dpr();
        x.beginPath(); x.arc(g.cx, g.cy, R - 1, 0, Math.PI * 2); x.stroke();
      } else {
        EIDOLON.frames[k].draw(x, g, { main: st.frameColor, accent: st.accent ? st.accentColor : null });
      }
      const on = (st.frame === 'custom' && !S.customFrame ? 'ring' : st.frame) === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function buildPalette() {
    const box = $('palette');
    PALETTE.forEach((hex) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.style.background = hex;
      b.setAttribute('aria-label', hex);
      b.addEventListener('click', () => { S.style.frameColor = hex; styleChanged(); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); S.style.accentColor = hex; styleChanged(); });
      box.appendChild(b);
    });
  }

  // ---- custom frame / mask ----
  function setCustom(kind, blob) {
    decode(blob).then((img) => {
      if (kind === 'frame') {
        S.customFrame = toSource(img, 1024);
        S.style.frame = 'custom';
        buildFrameGrid();
      } else {
        S.customMask = maskFrom(img);
      }
      EIDOLON.idb.put('assets', kind, blob).catch(() => {});
      setStatus(t(kind === 'frame' ? 's_frame' : 's_mask'), 'ok');
      updateButtons(); styleChanged();
    }).catch(() => setStatus(t('s_loadfail'), 'warn'));
  }
  function clearCustom(kind) {
    if (kind === 'frame') {
      S.customFrame = null;
      if (S.style.frame === 'custom') S.style.frame = 'ring';
      buildFrameGrid();
    } else {
      S.customMask = null;
    }
    EIDOLON.idb.del('assets', kind).catch(() => {});
    updateButtons(); styleChanged();
  }

  // ---- controls: generic data-attribute binding ----
  //   data-style="k"  -> S.style[k]      data-out="k"  -> S.out[k]
  //   data-tf="k"     -> cur().tf[k]     data-adj="k"  -> cur().adj[k]
  //   data-item="k"   -> cur()[k] (text)
  //   data-for="k"    -> a swatch that opens the colour input for S.style[k]
  //   data-bg="mode"  -> background fill mode button
  //   data-val="path" -> a live readout next to a slider
  function bindControls() {
    document.querySelectorAll('[data-style]').forEach((el) => {
      const k = el.dataset.style;
      if (el.dataset.opts) {
        // multi-position switch: pick the clicked segment; keyboard (detail 0) cycles
        const opts = el.dataset.opts.split(',');
        el.addEventListener('click', (e) => {
          const r = el.getBoundingClientRect();
          const i = e.detail
            ? clamp(Math.floor(((e.clientX - r.left) / r.width) * opts.length), 0, opts.length - 1)
            : (opts.indexOf(S.style[k]) + 1) % opts.length;
          S.style[k] = opts[i]; styleChanged();
        });
      } else if (el.classList.contains('side-switch')) {
        el.addEventListener('click', () => { S.style[k] = !S.style[k]; styleChanged(); });
      } else {
        el.addEventListener('input', () => { S.style[k] = el.type === 'range' ? +el.value : el.value; styleChanged(); });
      }
    });
    document.querySelectorAll('[data-for]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.bg && S.style.bgMode !== b.dataset.bg) { S.style.bgMode = b.dataset.bg; styleChanged(); return; }
        openPicker($(b.dataset.for));
      });
    });
    document.querySelectorAll('[data-bg]:not([data-for])').forEach((b) => {
      b.addEventListener('click', () => { S.style.bgMode = b.dataset.bg; styleChanged(); });
    });
    document.querySelectorAll('[data-tf], [data-adj]').forEach((el) => {
      const grp = el.dataset.tf ? 'tf' : 'adj', k = el.dataset[grp];
      const apply = () => {
        const it = cur();
        if (!it) return;
        if (el.classList.contains('side-switch')) it[grp][k] = !it[grp][k];
        else it[grp][k] = k === 'zoom' ? +el.value / 100 : +el.value;
        itemChanged(it);
      };
      el.addEventListener(el.classList.contains('side-switch') ? 'click' : 'input', apply);
    });
    document.querySelectorAll('[data-item]').forEach((el) => {
      el.addEventListener('input', () => { const it = cur(); if (it) { it[el.dataset.item] = el.value; itemChanged(it); } });
    });
    document.querySelectorAll('[data-out]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.out;
        S.out[k] = k === 'format' ? el.value : clamp(parseInt(el.value, 10) || C.EXPORT_SIZE, k === 'setCount' ? 2 : 16, k === 'setCount' ? 99 : 4096);
        saveOut(); syncControls(); updateTexts();
      });
    });
    $('swapBtn').addEventListener('click', () => {
      const s = S.style;
      [s.frameColor, s.accentColor] = [s.accentColor, s.frameColor];
      styleChanged();
    });
    $('resetTfBtn').addEventListener('click', () => { const it = cur(); if (it) { it.tf = EIDOLON.newTransform(); itemChanged(it); } });
    $('resetAdjBtn').addEventListener('click', () => { const it = cur(); if (it) { it.adj = EIDOLON.newAdjust(); itemChanged(it); } });

    $('loadBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => { addBlobs(e.target.files); e.target.value = ''; });
    $('urlGo').addEventListener('click', () => fromUrl($('urlInput').value));
    $('urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') fromUrl($('urlInput').value); });
    $('clearBtn').addEventListener('click', clearAll);
    $('cframeBtn').addEventListener('click', () => (S.customFrame ? clearCustom('frame') : $('frameInput').click()));
    $('cmaskBtn').addEventListener('click', () => (S.customMask ? clearCustom('mask') : $('maskInput').click()));
    $('frameInput').addEventListener('change', (e) => { if (e.target.files[0]) setCustom('frame', e.target.files[0]); e.target.value = ''; });
    $('maskInput').addEventListener('change', (e) => { if (e.target.files[0]) setCustom('mask', e.target.files[0]); e.target.value = ''; });

    $('exportBtn').addEventListener('click', exportCurrent);
    $('copyBtn').addEventListener('click', copyCurrent);
    $('zipAllBtn').addEventListener('click', zipAll);
    $('zipSetBtn').addEventListener('click', zipSet);
  }

  const VAL_FMT = {
    thickness: (v) => v + '%', margin: (v) => v + '%', frameOpacity: (v) => v + '%',
    'tf.zoom': (v) => Math.round(v * 100) + '%', 'tf.rot': (v) => Math.round(v) + '°',
    'fx.toneMix': (v) => v + '%', 'fx.glitchAmt': (v) => v + '%', 'fx.rgbAmt': (v) => v + 'px',
    'fx.grainAmt': (v) => v + '%', 'fx.vigAmt': (v) => v + '%', 'fx.scanAmt': (v) => v + '%', 'fx.scanGap': (v) => v + 'px',
    'adj.bright': (v) => v + '%', 'adj.contrast': (v) => v + '%', 'adj.sat': (v) => v + '%', 'adj.hue': (v) => v + '°',
  };
  // Push state into every control (values, toggles, swatches, readouts).
  function syncControls() {
    const st = S.style, it = cur();
    const tf = it ? it.tf : EIDOLON.newTransform(), adj = it ? it.adj : EIDOLON.newAdjust();
    document.querySelectorAll('[data-style]').forEach((el) => {
      const v = st[el.dataset.style];
      if (el.dataset.opts) {
        const opts = el.dataset.opts.split(','), i = Math.max(0, opts.indexOf(v));
        el.style.setProperty('--n', opts.length); el.style.setProperty('--idx', i);
        el.querySelectorAll('.lab').forEach((l, j) => l.classList.toggle('on', j === i));
      } else if (el.classList.contains('side-switch')) el.dataset.pos = v ? 'right' : 'left';
      else if (String(el.value) !== String(v)) el.value = v;
    });
    document.querySelectorAll('[data-for]').forEach((b) => { b.style.background = st[b.dataset.for]; });
    document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('active', st.bgMode === b.dataset.bg));
    $('accentColorRow').classList.toggle('disabled', !st.accent);
    document.querySelectorAll('[data-tf], [data-adj]').forEach((el) => {
      const grp = el.dataset.tf ? 'tf' : 'adj', k = el.dataset[grp], v = (grp === 'tf' ? tf : adj)[k];
      el.disabled = !it;
      if (el.classList.contains('side-switch')) { el.dataset.pos = v ? 'right' : 'left'; el.closest('.fx-toggle').classList.toggle('disabled', !it); }
      else el.value = k === 'zoom' ? Math.round(v * 100) : v;
    });
    document.querySelectorAll('[data-item]').forEach((el) => {
      el.disabled = !it;
      if (document.activeElement !== el) el.value = it ? it[el.dataset.item] || '' : '';
    });
    document.querySelectorAll('[data-out]').forEach((el) => { if (document.activeElement !== el) el.value = S.out[el.dataset.out]; });
    document.querySelectorAll('[data-val]').forEach((el) => {
      const p = el.dataset.val, [a, b] = p.split('.');
      const v = b ? (a === 'tf' ? tf : a === 'fx' ? S.fx : adj)[b] : st[a];
      el.textContent = (VAL_FMT[p] || String)(v);
    });
    $('resetTfBtn').disabled = !it; $('resetAdjBtn').disabled = !it;
    syncPop(); syncSrcGroups();
  }
  function updateButtons() {
    const it = cur();
    $('exportBtn').disabled = !it;
    $('copyBtn').disabled = !it || !window.ClipboardItem;
    $('zipSetBtn').disabled = !it;
    $('zipAllBtn').disabled = S.items.length < 2;
    $('batchBtn').disabled = !S.items.length;
    $('batchCount').textContent = S.items.length;
    $('clearBtn').disabled = !S.items.length;
    updateTexts();
  }
  // Texts assembled in JS (not plain data-i18n nodes) — rerun on language change.
  function updateTexts() {
    $('exportBtn').textContent = t('b_export') + ' ' + S.out.format.toUpperCase();
    $('batchFmt').textContent = `${S.out.size} PX · ${S.out.format.toUpperCase()}`;
    $('cframeBtn').textContent = t(S.customFrame ? 'b_cframe_x' : 'b_cframe');
    $('cmaskBtn').textContent = t(S.customMask ? 'b_cmask_x' : 'b_cmask');
    $('clearBtn').textContent = t(clearArmed ? 'b_sure' : 'b_clear');
  }

  // ---- export ----
  const MIME = { png: 'image/png', webp: 'image/webp' };
  // Browsers without a WebP encoder silently hand back PNG — name by what we got.
  const extOf = (blob) => (blob.type === 'image/webp' ? 'webp' : 'png');
  let busy = false;
  function setBusy(on) {
    busy = on;
    ['exportBtn', 'copyBtn', 'zipAllBtn', 'zipSetBtn'].forEach((id) => { $(id).classList.toggle('busy', on); });
    if (!on) updateButtons();
    else ['exportBtn', 'copyBtn', 'zipAllBtn', 'zipSetBtn'].forEach((id) => { $(id).disabled = true; });
  }
  function baseName(it) { return slug(it.label || it.name); }
  function exportCurrent() {
    const it = cur();
    if (!it || busy) return;
    const N = S.out.size;
    toBlob(EIDOLON.renderCanvas(it, N), MIME[S.out.format]).then((b) => {
      const name = `${baseName(it)}_${N}.${extOf(b)}`;
      download(b, name);
      setStatus(t('s_saved', { f: name }), 'ok');
    }).catch(() => setStatus(t('s_fail'), 'warn'));
  }
  function copyCurrent() {
    const it = cur();
    if (!it || busy) return;
    const blobP = toBlob(EIDOLON.renderCanvas(it, S.out.size), 'image/png');
    // Safari wants the ClipboardItem built synchronously from a promise
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })])
      .then(() => setStatus(t('s_copied'), 'ok'))
      .catch(() => setStatus(t('s_copyfail'), 'warn'));
  }
  // Render jobs one by one (yielding between them so the UI can repaint), then zip.
  function zipJobs(jobs, zipName) {
    if (busy || !jobs.length) return;
    setBusy(true);
    const files = [], used = new Set(), mime = MIME[S.out.format];
    let i = 0;
    const next = () => {
      if (i >= jobs.length) {
        download(EIDOLON.zip(files), zipName);
        setStatus(t('s_saved', { f: zipName }), 'ok');
        setBusy(false);
        return;
      }
      const job = jobs[i++];
      setStatus(t('s_packing', { i, n: jobs.length }));
      toBlob(EIDOLON.renderCanvas(job.item, S.out.size, job.opts), mime)
        .then((b) => b.arrayBuffer().then((buf) => [b, buf]))
        .then(([b, buf]) => {
          let name = job.name.replace(/\.\w+$/, '.' + extOf(b)), k = 2;
          const base = name;
          while (used.has(name)) name = base.replace(/(\.\w+)$/, `-${k++}$1`);
          used.add(name);
          files.push({ name, data: new Uint8Array(buf) });
          setTimeout(next, 0);
        })
        .catch(() => { setStatus(t('s_fail'), 'warn'); setBusy(false); });
    };
    next();
  }
  function zipAll() {
    const N = S.out.size, ext = S.out.format;
    zipJobs(S.items.map((it) => ({ item: it, name: `${baseName(it)}_${N}.${ext}` })), `eidolon_tokens_${N}.zip`);
  }
  function zipSet() {
    const it = cur();
    if (!it) return;
    const N = S.out.size, ext = S.out.format, n = clamp(S.out.setCount, 2, 99), pad = String(n).length;
    const jobs = [];
    for (let k = 1; k <= n; k++) jobs.push({ item: it, opts: { badge: String(k) }, name: `${baseName(it)}_${String(k).padStart(pad, '0')}_${N}.${ext}` });
    zipJobs(jobs, `${baseName(it)}_set${n}_${N}.zip`);
  }

  // ---- init ----
  function init() {
    restore();
    buildPalette();
    buildSrcGroups();
    setupRefBar();
    setupPopout();
    setupPresets();
    setupFx();
    setupPanels();
    setupBatch();
    buildFrameGrid();
    bindControls();
    setupStage();
    syncControls();
    updateButtons();
    buildRoster();
    fitCanvas();
    setStatus('');
    restoreDb();
    // canvas text needs the web font; redraw once it's ready
    if (document.fonts && document.fonts.load) {
      document.fonts.load('700 32px "JetBrains Mono"').then(() => { requestDraw(); rosterChanged(); }).catch(() => {});
    }
    document.addEventListener('eidolon:lang', () => { syncSrcGroups(); updateTexts(); buildRoster(); syncRef(); presetsChanged(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.EIDOLON);
