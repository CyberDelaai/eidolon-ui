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
  // Status messages pop up as a toast at the bottom centre. kind: 'ok' | 'warn'
  // | undefined (info). Repeated calls (e.g. PACKING 3/12…) update it in place
  // and keep it up; warnings linger a little longer. An empty msg is ignored.
  function setStatus(msg, kind) {
    const el = $('toast');
    if (!el || !msg) return;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => el.classList.remove('show'), kind === 'warn' ? 3600 : 2200);
  }
  function debounce(fn, ms) {
    let id = 0;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }
  // Filename-safe part: letters/digits (any script) joined by '-', '' when empty,
  // so '_' stays free to separate the fields of an export name.
  function slug(s) {
    return String(s || '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  // 6-hex content id of the source image (FNV-1a over its bytes): the same
  // portrait gets the same id on any machine, so re-exports replace their own
  // file and never another character's that happens to share a name.
  function hashBlob(blob) {
    return blob.arrayBuffer().then((buf) => {
      const b = new Uint8Array(buf);
      let h = 0x811c9dc5;
      for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
    });
  }
  function ensureHash(item) {
    if (item.hash) return Promise.resolve(item.hash);
    return hashBlob(item.blob).catch(() => item.id.slice(-6))
      .then((h) => { item.hash = h; persistItem(item); return h; });
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
  const GUIDES = ['off', 'cross', 'grid']; // S.ref.guides click-through order
  const persistTimers = {};
  function persistItem(item) {
    clearTimeout(persistTimers[item.id]);
    persistTimers[item.id] = setTimeout(() => {
      const rec = {
        id: item.id, name: item.name, blob: item.blob, order: item.order, hash: item.hash || '',
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
  // The old NAME STYLE 'none' (HIDDEN) became the LABEL on/off switch.
  function upgradeLabel(st) {
    if (st && typeof st === 'object' && typeof st.labelOn !== 'boolean' && 'labelStyle' in st) {
      st.labelOn = st.labelStyle !== 'none';
      if (st.labelStyle === 'none') st.labelStyle = 'plate';
    }
    // the old BADGE AT corner dropdown became a draggable position
    if (st && typeof st === 'object' && typeof st.badgePos === 'string' && typeof st.badgeX !== 'number') {
      const d = { tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1] }[st.badgePos] || [1, 1];
      st.badgeX = d[0] * 0.74; st.badgeY = d[1] * 0.74;
    }
    return st;
  }
  function restore() {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    mergeInto(S.style, upgradeLabel(read('eidolon:style')));
    if (!['plate', 'arc'].includes(S.style.labelStyle)) S.style.labelStyle = 'plate';
    mergeInto(S.out, read('eidolon:out'));
    const ref = read('eidolon:ref');
    if (ref && typeof ref.guides === 'boolean') ref.guides = ref.guides ? 'cross' : 'off'; // the old on/off guides became a 3-way cycle
    mergeInto(S.ref, ref);
    mergeInto(S.fx, read('eidolon:fx'));
    mergeInto(S.colors, read('eidolon:colors'));
    if (!['none', 'mono', 'neon', 'holo'].includes(S.fx.tone)) S.fx.tone = 'none';
    if (!['off', 'custom'].concat(EIDOLON.refOrder).includes(S.ref.kind)) S.ref.kind = 'off';
    if (!GUIDES.includes(S.ref.guides)) S.ref.guides = 'off';
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
        id: r.id, name: r.name, blob: r.blob, order: r.order, hash: r.hash || '', src: toSource(img),
        tf: Object.assign(EIDOLON.newTransform(), r.tf), adj: Object.assign(EIDOLON.newAdjust(), r.adj),
        label: r.label || '', badge: r.badge || '',
        popOn: !!r.popOn, popMask: mask ? toSource(mask, 512) : null,
      })).catch(() => null)));
    }).then((items) => {
      items = (items || []).filter(Boolean);
      if (!items.length) return;
      const had = S.items.length;
      S.items = items.concat(S.items); // images added before the DB answered go last
      let saved = -1;
      try { saved = items.findIndex((it) => it.id === localStorage.getItem('eidolon:selected')); } catch (e) {}
      select(had ? items.length + S.current : Math.max(saved, 0));
    }).catch(() => {}).then(seedDefaultToken);
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

  // The bundled C-DOGGO example token: picture, framing, pop-out mask for the
  // ears. Added on the very first run (eidolon:seeded is set
  // once the roster has anything, so deleting it never brings it back), and
  // every EXAMPLE preset turns the selected token into it. Opened from file://
  // the fetch fails and we just skip.
  // (one folder up on a generated /<lang>/ page — see make_langs.py)
  const ASSET_ROOT = document.documentElement.hasAttribute('data-url-lang') ? '../' : '';
  const DOGGO_SRC = { img: ASSET_ROOT + 'examples/cyber-doggo.webp', mask: ASSET_ROOT + 'examples/cyber-doggo-pop-out-mask.webp', name: 'cyber-doggo.webp', tf: { zoom: 1, y: 0.02 } };
  let doggoAssets = null, doggoPending = null, doggoFailed = false;
  // -> Promise<{ blob, img, mask }>, fetched once and shared
  function getDoggo() {
    if (doggoAssets) return Promise.resolve(doggoAssets);
    if (!doggoPending) {
      const get = (url) => fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(url))));
      doggoPending = Promise.all([get(DOGGO_SRC.img), get(DOGGO_SRC.mask).then(decode).catch(() => null)])
        .then(([raw, mask]) => {
          // some static servers send .webp as octet-stream
          const blob = /^image[/]/.test(raw.type) ? raw : new Blob([raw], { type: 'image/webp' });
          return decode(blob).then((img) => (doggoAssets = { blob, img, mask }));
        })
        .catch((e) => { doggoFailed = true; throw e; })
        .finally(() => { doggoPending = null; });
    }
    return doggoPending;
  }
  // Turn a token into the doggo (in place, nothing persisted): picture, framing,
  // look, pop-out. tk = { label?, badge?, tf? } — name, badge and framing
  // overrides (an example's `token`).
  function dressAsDoggo(it, a, tk) {
    tk = tk || {};
    it.blob = a.blob; it.name = DOGGO_SRC.name; it.src = toSource(a.img); it.hash = '';
    it.tf = Object.assign(EIDOLON.newTransform(), DOGGO_SRC.tf, tk.tf); it.adj = EIDOLON.newAdjust();
    it.label = tk.label || ''; it.badge = tk.badge || '';
    it.popMask = null; it.popOn = false;
    if (a.mask) buildPopMask(it, a.mask);
    return it;
  }
  // The selected token becomes the doggo (a new one on an empty roster).
  function doggoToken(tk) {
    return getDoggo().then((a) => {
      let it = cur();
      if (!it) { it = newItem(a.blob, a.img); S.items.push(it); select(S.items.length - 1); }
      dressAsDoggo(it, a, tk);
      ensureHash(it); itemChanged(it);
      return it;
    });
  }
  function seedDefaultToken() {
    const seeded = (() => { try { return localStorage.getItem('eidolon:seeded'); } catch (e) { return null; } })();
    if (seeded) return;
    if (S.items.length) { EIDOLON.save('eidolon:seeded', '1'); return; }
    getDoggo().then(() => {
      if (S.items.length) return; // the user got there first — never dress their token
      // the starter is the ENEMY example: its doggo + look, no confirm (nothing to replace)
      return doggoToken(EXAMPLES.ENEMY.token).then(() => {
        applyStyleOf('ENEMY', EXAMPLES.ENEMY);
        EIDOLON.save('eidolon:seeded', '1');
        nudgeClear(true);
      });
    }).catch(() => {});
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
  function newItem(blob, img) {
    return {
      id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: blob.name || 'token', blob, order: orderSeq++, src: toSource(img),
      tf: EIDOLON.newTransform(), adj: EIDOLON.newAdjust(), label: '', badge: '',
      popOn: false, popMask: null, hash: '',
    };
  }
  function addBlobs(list) {
    const blobs = [...list].filter((b) => b && /^image\//.test(b.type || 'image/'));
    if (!blobs.length) return Promise.resolve(0);
    return Promise.all(blobs.map((blob) => decode(blob).then((img) => ({ blob, img })).catch(() => null)))
      .then((res) => {
        const ok = res.filter(Boolean);
        ok.forEach(({ blob, img }) => {
          const item = newItem(blob, img);
          S.items.push(item);
          ensureHash(item); // persists once the id is known
        });
        if (ok.length) {
          nudgeClear(false);
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
    if (cur()) EIDOLON.save('eidolon:selected', cur().id);
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
  // CLEAR pulses while an untouched example doggo is on stage ("clear it, load
  // your own"); any change (style, FX, token edit), a clear or loading images
  // stops it — so it's switched on only after an apply's own change calls.
  const nudgeClear = (on) => $('clearBtn').classList.toggle('nudge', !!on);
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
    nudgeClear(false);
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
      const r = document.createElement('span');
      r.className = 'roster-ref'; r.textContent = '◎'; r.title = t('t_as_ref');
      r.addEventListener('click', (e) => { e.stopPropagation(); tokenAsRef(it); });
      b.appendChild(r);
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
  let overlayDrag = null; // 'label' | 'badge' while one is dragged on the stage
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
    nudgeClear(false); // any edit makes the example the user's own
    syncControls(); requestDraw(); persistItem(item); rosterChanged();
  }
  function styleChanged() {
    nudgeClear(false);
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
    // The label / badge under a client point, or null (preview pixels via the canvas size).
    const overlayAt = (e) => {
      const r = cv.getBoundingClientRect(), k = cv.width / r.width;
      return EIDOLON.overlayAt(cv.width, cur(), (e.clientX - r.left) * k, (e.clientY - r.top) * k);
    };
    // Hover edit icon: shows over the name / badge under the pointer and opens
    // its window; it stays while the pointer moves from the canvas onto it.
    const hov = $('ovlHover');
    const showHover = (which) => {
      const it = cur(), a = which && EIDOLON.overlayAnchor(cv.width, it, which);
      if (!a) { hov.hidden = true; return; }
      const r = cv.getBoundingClientRect(), k = cv.width / r.width, m = 14;
      hov.style.left = clamp(a.x / k, m, r.width - m) + 'px';
      hov.style.top = clamp(a.y / k, m, r.height - m) + 'px';
      hov.dataset.ovl = which;
      hov.title = t(which === 'badge' ? 't_edit_badge' : 't_edit_label');
      hov.hidden = false;
    };
    hov.addEventListener('click', () => { setOvlOpen(hov.dataset.ovl, true); hov.hidden = true; });
    hov.addEventListener('pointerleave', (e) => { if (e.relatedTarget !== cv) hov.hidden = true; });
    cv.addEventListener('contextmenu', (e) => {
      const which = cur() && !brush.on && overlayAt(e);
      if (!which) return;
      e.preventDefault();
      hov.hidden = true;
      setOvlOpen(which, true);
    });
    cv.addEventListener('pointerdown', (e) => {
      const it = cur();
      if (!it) { $('fileInput').click(); return; }
      hov.hidden = true;
      if (e.button === 2) return; // right-click: the contextmenu handler above
      if (brush.on) { brushDown(e); return; }
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, w: cv.getBoundingClientRect().width, overlay: overlayAt(e) };
      if (drag.overlay) {
        // label / badge drag: moves the style position (R units), snapping unless Alt
        const st = S.style, b = drag.overlay === 'badge';
        drag.x0 = b ? st.badgeX : st.labelX; drag.y0 = b ? st.badgeY : st.labelY;
        drag.sx = e.clientX; drag.sy = e.clientY;
        overlayDrag = drag.overlay;
        cv.classList.add('moving'); drawRef();
      } else {
        cv.classList.add('grabbing');
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const it = cur();
      if (brush.on) { cv.classList.remove('over-overlay'); hov.hidden = true; brushMove(e); return; }
      if (!drag) {
        const which = it && overlayAt(e);
        cv.classList.toggle('over-overlay', !!which);
        if (which) showHover(which); else if (e.pointerType === 'mouse') hov.hidden = true;
        return;
      }
      if (!it) return;
      if (drag.overlay) { moveOverlay(e); return; }
      it.tf.x += (e.clientX - drag.x) / drag.w;
      it.tf.y += (e.clientY - drag.y) / drag.w;
      drag.x = e.clientX; drag.y = e.clientY;
      requestDraw();
    });
    function moveOverlay(e) {
      const st = S.style, g = EIDOLON.geom(drag.w), r = cv.getBoundingClientRect();
      let x, y;
      if (drag.overlay === 'label' && st.labelStyle === 'arc') {
        // the arc follows the pointer's angle around the centre
        x = (e.clientX - r.left - r.width / 2) / g.R; y = (e.clientY - r.top - r.height / 2) / g.R;
      } else {
        const lim = 1.2;
        x = clamp(drag.x0 + (e.clientX - drag.sx) / g.R, -lim, lim);
        y = clamp(drag.y0 + (e.clientY - drag.sy) / g.R, -lim, lim);
      }
      [x, y] = EIDOLON.snapOverlay(drag.overlay, x, y, e.altKey);
      if (drag.overlay === 'badge') { st.badgeX = x; st.badgeY = y; } else { st.labelX = x; st.labelY = y; }
      requestDraw();
    }
    const end = () => {
      if (brush.stroke) { brushUp(); return; }
      if (!drag) return;
      const was = drag.overlay;
      drag = null; overlayDrag = null;
      cv.classList.remove('grabbing', 'moving');
      if (was) { styleChanged(); showHover(was); if (ovlOpen === was) placeOvlPop(); } else itemChanged(); // (touch has no hover: a tap shows the icon)
    };
    cv.addEventListener('pointerleave', (e) => {
      cv.classList.remove('over-overlay');
      if (e.relatedTarget !== hov) hov.hidden = true;
      if (brush.on && !brush.stroke) { brush.cursor = null; requestDraw(); }
    });
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // Ctrl+wheel zooms (also trackpad pinch, which arrives as ctrlKey wheel),
    // Shift+wheel rotates; +Alt makes either one finer. A plain wheel is left
    // alone so the page scrolls.
    stage.addEventListener('wheel', (e) => {
      const it = cur();
      if (!it || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      const dy = e.deltaY || e.deltaX;
      if (e.shiftKey) {
        it.tf.rot = ((Math.round(it.tf.rot + Math.sign(dy) * (e.altKey ? 1 : 5)) + 540) % 360) - 180;
      } else {
        const r = cv.getBoundingClientRect();
        zoomAt(it, Math.exp(-dy * (e.altKey ? 0.0003 : 0.0015)), (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
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
    const gb = $('guidesBtn');
    gb.dataset.mode = S.ref.guides;
    gb.setAttribute('aria-pressed', S.ref.guides !== 'off' ? 'true' : 'false');
    $('refOpacity').value = S.ref.opacity;
    $('refOpVal').textContent = S.ref.opacity + '%';
    $('refOpacity').disabled = S.ref.kind === 'off' && S.ref.guides === 'off';
    drawRef();
  }
  function drawRef() {
    const rc = $('refCanvas'), cv = $('tokenCanvas');
    if (rc.width !== cv.width) { rc.width = cv.width; rc.height = cv.height; }
    EIDOLON.drawReference(rc.getContext('2d'), rc.width);
    if (brush.on && cur()) EIDOLON.drawBrushOverlay(rc.getContext('2d'), rc.width, cur(), brush.cursor);
    if (overlayDrag) EIDOLON.drawSnapOverlay(rc.getContext('2d'), rc.width, overlayDrag);
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
  // A roster token, rendered as it would export, becomes the custom reference.
  function tokenAsRef(it) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    EIDOLON.render(c.getContext('2d'), 1024, it);
    c.toBlob((blob) => { if (blob) setCustomRef(blob); }, 'image/png');
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
    $('guidesBtn').addEventListener('click', () => {
      S.ref.guides = GUIDES[(GUIDES.indexOf(S.ref.guides) + 1) % GUIDES.length]; saveRef(); syncRef();
    });
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
    let all;
    try { all = JSON.parse(localStorage.getItem('eidolon:presets') || '{}') || {}; } catch (e) { return {}; }
    Object.keys(all).forEach((n) => { if (all[n]) upgradeLabel(all[n].style); });
    return all;
  }
  const savePresets = (p) => EIDOLON.save('eidolon:presets', JSON.stringify(p));
  // Built-in EXAMPLE presets (the COMMLINK EXAMPLE_* idea): defined here, never
  // stored, so they're read-only, stay current and never reach an export.
  // Full styles over the pristine defaults, so applying one is deterministic.
  const DEFAULT_STYLE = JSON.parse(JSON.stringify(S.style)); // captured before restore()
  const DOGGO = '匚-刀口厶厶口'; // the starter token's name, in ASCII-art style
  const EXAMPLES = (() => {
    // token: the example's name / badge / framing (tf overrides) — APPLY puts
    // them on the C-DOGGO it makes of the selected token (absent = empty / default).
    const ex = (style, fx, token) => ({ style: Object.assign({}, DEFAULT_STYLE, style), fx: Object.assign(EIDOLON.newFx(), fx || {}), token: token || null, example: true });
    return {
      PC: ex({ frame: 'ring', frameColor: '#00f0ff', accent: true, accentColor: '#fcee0a', glow: 'all', labelOn: true, labelStyle: 'arc' },
        null, { label: DOGGO }),
      ENEMY: ex({ frame: 'ring', frameColor: '#ff003c', glow: 'outer', bgColor: '#14050a', labelOn: false,
        badgeFrom: 'custom', badgeColor: '#ff003c' },
        null, { badge: '8' }),
      NPC: ex({ frame: 'hex', frameColor: '#e8e8ee', thickness: 6, glow: 'off', labelOn: true, labelStyle: 'plate' }),
      BOSS: ex({ frame: 'segment', frameColor: '#fcee0a', accent: true, accentColor: '#ff003c', thickness: 11, glow: 'all', labelOn: true, labelStyle: 'arc' },
        { on: true, vig: true, vigColor: '#ff003c', vigAmt: 45 }),
      NETRUNNER: ex({ frame: 'clip', frameColor: '#39ff14', accent: true, accentColor: '#00f0ff', glow: 'inner', labelOn: true, labelStyle: 'plate' },
        { on: true, tone: 'neon', toneMix: 35, scan: true, scanAmt: 30, scanGap: 4 }, { label: DOGGO }),
    };
  })();
  const showExamples = () => { try { return localStorage.getItem('eidolon:showExamples') !== '0'; } catch (e) { return true; } };
  // User presets first (they win a name clash), then the examples.
  function allPresets() {
    const own = loadPresets(), out = {};
    Object.keys(own).forEach((n) => { if (own[n] && own[n].style) out[n] = own[n]; });
    if (showExamples()) Object.keys(EXAMPLES).forEach((n) => { if (!out[n]) out[n] = EXAMPLES[n]; });
    return out;
  }
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
  // Example thumbnails show what APPLY makes: the doggo with the example's name / badge.
  let doggoDemo = null;
  function thumbItem(p) {
    if (!p.example) return cur();
    if (!doggoDemo) return null;
    const tk = p.token || {};
    return Object.assign({}, doggoDemo, { label: tk.label || '', badge: tk.badge || '', tf: Object.assign({}, doggoDemo.tf, tk.tf) });
  }
  // Draw the current token (or the empty frame) as it would look with a preset.
  function renderPresetThumb(canvas, p) {
    const N = Math.round(56 * dpr());
    canvas.width = N; canvas.height = N;
    const keepStyle = S.style, keepFx = S.fx;
    [S.style, S.fx] = presetLook(p);
    try { EIDOLON.render(canvas.getContext('2d'), N, thumbItem(p)); } finally { S.style = keepStyle; S.fx = keepFx; }
  }
  function buildPresetList() {
    const box = $('presetList'), presets = allPresets();
    box.textContent = '';
    if (!doggoDemo && !doggoFailed && showExamples()) {
      getDoggo().then((a) => { doggoDemo = dressAsDoggo({ id: 'doggo-demo' }, a); buildPresetList(); }).catch(() => {});
    }
    const names = Object.keys(presets).sort((a, b) => (!!presets[a].example - !!presets[b].example)
      || (presets[b].savedAt || 0) - (presets[a].savedAt || 0));
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
      item.className = 'preset-item' + (p.example ? ' example' : '');
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
      meta.textContent = '// ' + [p.example ? t('p_example') : presetStamp(p.savedAt), String(p.style.frame || '').toUpperCase(), p.fx && p.fx.on ? '+FX' : '', p.out ? '+OUT' : '']
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
      if (p.example) { body.append(nm, meta, acts); item.append(c, body); box.appendChild(item); return; } // read-only
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
    const p = allPresets()[name];
    if (!p || !p.style) return;
    // an EXAMPLE replaces the selected token with its C-DOGGO — ask first
    if (p.example) {
      if (!confirm(t('c_example', { n: name }))) return;
      doggoToken(p.token).then(() => true, () => false).then((ok) => {
        applyStyleOf(name, p);
        if (ok) nudgeClear(true); // after the apply's own change calls
      });
      return;
    }
    applyStyleOf(name, p);
  }
  function applyStyleOf(name, p) {
    mergeInto(S.style, p.style);
    if (S.style.frame !== 'custom' && !EIDOLON.frames[S.style.frame]) S.style.frame = 'ring';
    if (!['plate', 'arc'].includes(S.style.labelStyle)) S.style.labelStyle = 'plate';
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
    $('presetShowEx').checked = showExamples();
    $('presetShowEx').addEventListener('change', (e) => { EIDOLON.save('eidolon:showExamples', e.target.checked ? '1' : '0'); buildPresetList(); });
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
      setPopMask(it, img);
      setStatus(t('s_popmask'), 'ok');
    }).catch(() => setStatus(t('s_loadfail'), 'warn'));
  }
  function setPopMask(it, img) {
    buildPopMask(it, img);
    itemChanged(it);
  }
  function buildPopMask(it, img) {
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

  // ---- COLOUR window: the stage's corner icon opens the selected token's
  // colour adjustments in a window floating to the right of the canvas ----
  function setAdjOpen(on) {
    if (on) setOvlOpen(null);
    $('adjPop').hidden = !on;
    $('adjBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function setupAdjPop() {
    $('adjBtn').addEventListener('click', () => setAdjOpen($('adjPop').hidden));
    $('adjClose').addEventListener('click', () => { setAdjOpen(false); $('adjBtn').focus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('adjPop').hidden) setAdjOpen(false); });
    // stays open while working on the canvas; a press anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      if (!$('adjPop').hidden && !$('stageShell').contains(e.target)) setAdjOpen(false);
    });
  }

  // ---- NAME / BADGE window: floats beside the name / badge it edits (one of
  // it and COLOUR open at a time; COLOUR's spot when that overlay isn't drawn).
  // Opened by the right panel's edit icons, the edit icon that shows while
  // hovering the name / badge on the stage, or a right-click on them. ----
  let ovlOpen = null; // 'label' | 'badge' | null
  function setOvlOpen(which, focus) {
    ovlOpen = which || null;
    if (ovlOpen) setAdjOpen(false);
    $('ovlPop').hidden = !ovlOpen;
    document.querySelectorAll('.ovl-body').forEach((b) => { b.hidden = b.dataset.ovl !== ovlOpen; });
    document.querySelectorAll('[data-ovledit]').forEach((b) => b.setAttribute('aria-expanded', b.dataset.ovledit === ovlOpen ? 'true' : 'false'));
    ovlTitle();
    placeOvlPop();
    if (ovlOpen && focus) {
      const first = document.querySelector('.ovl-body[data-ovl="' + ovlOpen + '"]').querySelector('select:enabled, button:enabled');
      if (first) first.focus();
    }
  }
  function ovlTitle() { if (ovlOpen) $('ovlTitle').textContent = '// ' + t(ovlOpen === 'badge' ? 'l_badge' : 'l_name'); }
  // Put the window beside its overlay on the stage: right of it, else left,
  // else below / above, kept inside the viewport. Without a drawn overlay it
  // falls back to the stylesheet spot (COLOUR's).
  function placeOvlPop() {
    const pop = $('ovlPop'), cv = $('tokenCanvas'), it = cur();
    pop.style.left = pop.style.top = pop.style.right = '';
    const b = ovlOpen && it && EIDOLON.overlayBox(cv.width, it, ovlOpen);
    if (!b) return;
    const shell = $('stageShell').getBoundingClientRect(), r = cv.getBoundingClientRect(), k = r.width / cv.width;
    const box = { l: r.left + b.x0 * k, t: r.top + b.y0 * k, r: r.left + b.x1 * k, b: r.top + b.y1 * k };
    const w = pop.offsetWidth, h = pop.offsetHeight, gap = 16, m = 8;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let x = null, y;
    if (box.r + gap + w <= vw - m) x = box.r + gap;
    else if (box.l - gap - w >= m) x = box.l - gap - w;
    if (x !== null) y = (box.t + box.b) / 2 - h / 2;
    else {
      x = (box.l + box.r) / 2 - w / 2;
      y = box.b + gap + h <= vh - m || box.t - gap - h < m ? box.b + gap : box.t - gap - h;
    }
    x = clamp(x, m, Math.max(m, vw - m - w));
    y = clamp(y, m, Math.max(m, vh - m - h));
    pop.style.left = (x - shell.left) + 'px';
    pop.style.top = (y - shell.top) + 'px';
    pop.style.right = 'auto';
  }
  function setupOvlPop() {
    document.querySelectorAll('[data-ovledit]').forEach((b) => {
      b.addEventListener('click', () => setOvlOpen(ovlOpen === b.dataset.ovledit ? null : b.dataset.ovledit, true));
    });
    $('ovlClose').addEventListener('click', () => {
      const w = ovlOpen;
      setOvlOpen(null);
      const back = document.querySelector('[data-ovledit="' + w + '"]');
      if (back) back.focus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ovlOpen) setOvlOpen(null); });
    // like COLOUR: stays open while working on the stage; a press anywhere
    // else (bar the panel's own edit icons, which toggle it) closes it
    document.addEventListener('pointerdown', (e) => {
      if (ovlOpen && !$('stageShell').contains(e.target) && !e.target.closest('[data-ovledit]')) setOvlOpen(null);
    });
    document.addEventListener('eidolon:lang', ovlTitle);
    window.addEventListener('resize', () => { if (ovlOpen) placeOvlPop(); });
    setOvlOpen(null);
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
    nudgeClear(false);
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

  // ---- frame grid + colour grids ----
  // The COMMLINK accent palette: a neon row (+ the saved custom swatch and
  // picker), then a row of softer tones (+ the AUTO button).
  const PALETTE = [
    ['#fcee0a', '#00f0ff', '#ff003c', '#39ff14', '#ff8800', '#c800ff', '#ff10f0'],
    ['#ff6b6b', '#ff9f43', '#feca57', '#1dd1a1', '#00d2d3', '#54a0ff', '#a29bfe'],
  ];
  const saveColors = () => EIDOLON.save('eidolon:colors', JSON.stringify(S.colors));
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
  // Fill every [data-swatches="k"] grid; a swatch sets S.style[k], the picker
  // sets it and remembers it as the grid's saved custom swatch (S.colors[k]).
  function buildSwatches() {
    document.querySelectorAll('[data-swatches]').forEach((box) => {
      const k = box.dataset.swatches;
      const swatch = (hex, cls, aug) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = cls;
        if (aug) b.setAttribute('data-augmented-ui', aug);
        if (hex) b.dataset.color = hex;
        b.addEventListener('click', () => { S.style[k] = b.dataset.color; styleChanged(); });
        return b;
      };
      const row = (hexes) => hexes.forEach((hex) => box.appendChild(swatch(hex, 'swatch')));
      row(PALETTE[0]);
      const group = document.createElement('div');
      group.className = 'custom-color-group';
      group.setAttribute('data-augmented-ui', 'tl-clip br-clip border');
      group.appendChild(swatch('', 'swatch swatch-saved', 'tl-clip border'));
      const pick = document.createElement('label');
      pick.className = 'swatch-pick-btn';
      pick.setAttribute('data-augmented-ui', 'br-clip border');
      pick.innerHTML = '<input type="color" />' + PICK_ICON;
      pick.firstChild.addEventListener('input', (e) => {
        S.style[k] = S.colors[k] = e.target.value; saveColors(); styleChanged();
      });
      group.appendChild(pick);
      box.appendChild(group);
      const brk = document.createElement('div');
      brk.className = 'grid-break';
      box.appendChild(brk);
      row(PALETTE[1]);
      const auto = document.createElement('button');
      auto.type = 'button'; auto.className = 'swatch-auto';
      auto.setAttribute('data-augmented-ui', 'tl-clip br-clip border');
      auto.addEventListener('click', () => autoColor(k));
      box.appendChild(auto);
    });
    swatchTitles();
  }
  function swatchTitles() {
    document.querySelectorAll('.color-grid .swatch-pick-btn').forEach((l) => { l.title = t('t_pick'); });
    document.querySelectorAll('.color-grid .swatch-auto').forEach((b) => { b.textContent = t('b_autocol'); b.title = t('t_autocol'); });
  }

  // ---- AUTO colours ----
  // Detects the selected token's primary (frameColor) and secondary
  // (accentColor) colours: a seeded k-means over its centre-weighted pixels,
  // then a seeded weighted pick among the clusters. Every press draws a new
  // seed, so repeated presses walk through the other plausible matches; the
  // first press of a session (seed 0) takes the best-scoring one.
  let autoSeed = 0;
  const autoCache = new WeakMap(); // source canvas -> sampled pixels
  function rng(seed) { // mulberry32
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // [r, g, b, weight] per opaque pixel of a ≤64 px copy; centre pixels weigh
  // more, since that's where the character usually is. px.bg = the backdrop
  // colours: the big colour groups of the outer 4% border.
  function autoPixels(src) {
    let px = autoCache.get(src);
    if (px) return px;
    const k = 64 / Math.max(src.width, src.height), c = document.createElement('canvas');
    const W = c.width = Math.max(1, Math.round(src.width * k)), H = c.height = Math.max(1, Math.round(src.height * k));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, edge = Math.max(1, Math.round(Math.min(W, H) * 0.04));
    const border = [];
    px = [];
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < W; xx++) {
        const i = (y * W + xx) * 4;
        if (d[i + 3] < 128) continue;
        const dx = (xx + 0.5) / W - 0.5, dy = (y + 0.5) / H - 0.5;
        px.push([d[i], d[i + 1], d[i + 2], Math.exp(-(dx * dx + dy * dy) * 5)]);
        if (y < edge || y >= H - edge || xx < edge || xx >= W - edge) border.push([d[i], d[i + 1], d[i + 2], 1]);
      }
    }
    px.bg = border.length ? kmeans(border, Math.min(3, border.length), rng(7)).filter((o) => o.w > 0.3).map((o) => o.c) : [];
    px.outerL = border.length ? border.reduce((s, p) => s + lightness(p), 0) / border.length : null;
    autoCache.set(src, px);
    return px;
  }
  // 0 on a backdrop colour, rising to 1 away from it.
  function notBg(c, bg) {
    return bg.reduce((f, b) => f * (1 - Math.exp(-dist2(c, b) / (2 * 28 * 28))), 1);
  }
  // Discount the backdrop, unless that would leave next to nothing (a close-up
  // whose border is the character itself).
  function dropBg(px, bg) {
    const out = px.map((p) => [p[0], p[1], p[2], p[3] * notBg(p, bg)]);
    const sum = (a) => a.reduce((s, p) => s + p[3], 0);
    return sum(out) > 0.15 * sum(px) ? out.filter((p) => p[3] > 0) : px;
  }
  // The same [r, g, b, weight] list over every pixel of the full-size source,
  // binned to 5 bits per channel (each bin keeps its mean colour), so tiny
  // details survive that the 64 px copy would average away.
  const autoFullCache = new WeakMap();
  function autoPixelsFull(src) {
    let px = autoFullCache.get(src);
    if (px) return px;
    const W = src.width, H = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const bins = new Float64Array(32768 * 4);
    for (let y = 0; y < H; y++) {
      const dy = (y + 0.5) / H - 0.5;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] < 128) continue;
        const dx = (x + 0.5) / W - 0.5, w = Math.exp(-(dx * dx + dy * dy) * 5);
        const b = (((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)) * 4;
        bins[b] += d[i] * w; bins[b + 1] += d[i + 1] * w; bins[b + 2] += d[i + 2] * w; bins[b + 3] += w;
      }
    }
    px = [];
    for (let b = 0; b < bins.length; b += 4) {
      const w = bins[b + 3];
      if (w) px.push([bins[b] / w, bins[b + 1] / w, bins[b + 2] / w, w]);
    }
    autoFullCache.set(src, px);
    return px;
  }
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Weighted k-means (k-means++ seeding) -> [{ c: [r, g, b], w }], w summing to 1.
  function kmeans(px, K, rand, minW) {
    const cents = [px[Math.floor(rand() * px.length)].slice(0, 3)];
    while (cents.length < K) {
      let sum = 0;
      const d = px.map((p) => { const v = p[3] * Math.min(...cents.map((c) => dist2(p, c))); sum += v; return v; });
      if (!sum) break;
      let r = rand() * sum, i = 0;
      while (i < d.length - 1 && (r -= d[i]) > 0) i++;
      cents.push(px[i].slice(0, 3));
    }
    let acc = [];
    for (let it = 0; it < 10; it++) {
      acc = cents.map(() => [0, 0, 0, 0]);
      px.forEach((p) => {
        let best = 0, bd = Infinity;
        cents.forEach((c, j) => { const v = dist2(p, c); if (v < bd) { bd = v; best = j; } });
        const a = acc[best];
        a[0] += p[0] * p[3]; a[1] += p[1] * p[3]; a[2] += p[2] * p[3]; a[3] += p[3];
      });
      acc.forEach((a, j) => { if (a[3]) cents[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    const total = acc.reduce((s, a) => s + a[3], 0) || 1;
    return cents.map((c, j) => ({ c, w: acc[j][3] / total })).filter((o) => o.w > (minW || 0.02));
  }
  // HSV saturation, 0..1.
  const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]); return mx ? (mx - Math.min(c[0], c[1], c[2])) / mx : 0; };
  const ACCENT_SAT = 0.45; // accents should read as a colour, not a tinted grey
  // Accent candidates: the colourful (chroma > 20%, saturation ≥ ACCENT_SAT)
  // pixels that differ from the main colour, weighted by their chroma and
  // clustered on their own, so small colour groups (sparks, eyes, a glowing
  // rune) get a group instead of being swallowed by the big grey ones. Falls
  // back to any pixels far from the main colour, then to the most distant
  // 15%, for images with little colour.
  function accentClusters(px, main, rand) {
    const chroma = (p) => (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])) / 255;
    const far = px.filter((p) => dist2(p, main) > 90 * 90);
    let set = far.filter((p) => chroma(p) > 0.2 && sat(p) >= ACCENT_SAT).map((p) => [p[0], p[1], p[2], p[3] * chroma(p)]);
    if (set.length < 24) set = far;
    if (set.length < 24) {
      const by = px.map((p) => [dist2(p, main), p]).sort((a, b) => b[0] - a[0]);
      set = by.slice(0, Math.max(1, Math.ceil(by.length * 0.15))).map((e) => e[1]);
    }
    return kmeans(set, Math.min(5, set.length), rand, 0.01);
  }
  // Group candidates into hue families (within 35°; greys form their own), so
  // a colour split into several shades doesn't crowd out a rarer one.
  function hueFamilies(cand) {
    const fams = [];
    cand.forEach((o) => {
      const [r, g, b] = hexRgb(o.hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
      const grey = !mx || ch / mx < 0.15;
      const h = grey || !ch ? 0 : 60 * (mx === r ? ((g - b) / ch + 6) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4);
      const f = fams.find((f) => f.grey === grey && (grey || Math.min(Math.abs(f.h - h), 360 - Math.abs(f.h - h)) < 35));
      if (f) f.m.push(o); else fams.push({ h, grey, s: o.s, m: [o] }); // cand is sorted, so s = its best
    });
    return fams;
  }
  // Seeded weighted pick (weight = w(o)); seed 0 always takes the first.
  function seededPick(list, w, seed, rand) {
    if (!seed) return list[0];
    const sum = list.reduce((s, o) => s + w(o), 0);
    let r = rand() * sum;
    return list.find((o) => (r -= w(o)) <= 0) || list[list.length - 1];
  }
  // HSV saturation × value: how much a colour reads as a colour, 0..1.
  function vivid(c) {
    const mx = Math.max(...c), mn = Math.min(...c);
    return mx ? ((mx - mn) / mx) * (mx / 255) : 0;
  }
  // HSL lightness, 0..1.
  const lightness = (c) => (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510;
  const FRAME_GAP = 0.22; // the frame's minimum lightness distance from the image's outer edge
  // Re-light a colour: with `outer` (the image edge's lightness, for the frame)
  // keep it at least FRAME_GAP lighter or darker than that edge — on its own
  // side when that's enough already, else towards the side with more room;
  // without it (accent), clamp it so a near-black / near-white cluster still
  // shows up on the dark stage.
  function autoHex(c, outer) {
    let [r, g, b] = c.map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let L = clamp(l, 0.3, 0.8);
    if (outer != null && Math.abs(l - outer) < FRAME_GAP) {
      L = clamp(outer < 0.5 ? outer + FRAME_GAP : outer - FRAME_GAP, 0.08, 0.92);
    } else if (outer != null) L = clamp(l, 0.08, 0.92);
    if (L !== l) {
      // scale the chroma around the new lightness, keeping hue and saturation
      const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      const k = s * (1 - Math.abs(2 * L - 1)) / ((mx - mn) || 1);
      [r, g, b] = [r, g, b].map((v) => L + (v - l) * k);
    }
    return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  }
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) || 0);
  function autoColor(k) {
    const item = cur();
    if (!item || !item.src) { setStatus(t('s_autonone'), 'warn'); return; }
    const isFrame = k === 'frameColor';
    let px;
    try { px = dropBg(isFrame ? autoPixels(item.src) : autoPixelsFull(item.src), autoPixels(item.src).bg); } catch (e) { px = []; }
    if (!px.length) { setStatus(t('s_autonone'), 'warn'); return; }
    const seed = autoSeed++, rand = rng(seed * 2654435761 + 1);
    const frame = hexRgb(S.style.frameColor), now = hexRgb(S.style[k]);
    const clusters = isFrame ? kmeans(px, 6, rand) : accentClusters(px, frame, rand);
    // frame: big, colourful and already contrasting with the image's outer
    // edge wins; accent: colourful and far from the frame, its size barely
    // matters (a rare colour is as good a pick as a common one)
    const outer = isFrame ? autoPixels(item.src).outerL : null;
    const score = (o) => isFrame
      ? o.w * (0.15 + vivid(o.c)) * (outer == null ? 1 : 0.3 + Math.abs(lightness(o.c) - outer))
      : Math.pow(o.w, 0.2) * (0.2 + vivid(o.c)) * Math.sqrt(dist2(o.c, frame)) / 441;
    let cand = clusters.map((o) => ({ hex: autoHex(o.c, outer), s: score(o) }))
      .filter((o) => o.s > 0).sort((a, b) => b.s - a.s);
    // never land on (nearly) the colour already set, when there's another option
    const fresh = cand.filter((o) => dist2(hexRgb(o.hex), now) > 900);
    if (fresh.length) cand = fresh;
    // accent: drop washed-out groups (averaging can dull a cluster), if any colourful one is left
    const vivids = isFrame ? [] : cand.filter((o) => sat(hexRgb(o.hex)) >= ACCENT_SAT);
    if (vivids.length) cand = vivids;
    if (!cand.length) return;
    // accent: pick a hue family first (by its best score), then a shade in it
    const pool = isFrame ? cand : seededPick(hueFamilies(cand), (f) => f.s, seed, rand).m;
    // kept as the grid's saved custom swatch, as if picked with the picker
    S.style[k] = S.colors[k] = seededPick(pool, (o) => o.s * o.s, seed, rand).hex;
    saveColors(); styleChanged();
  }
  function syncSwatches() {
    document.querySelectorAll('[data-swatches]').forEach((box) => {
      const k = box.dataset.swatches, v = String(S.style[k]).toLowerCase();
      const saved = box.querySelector('.swatch-saved');
      saved.dataset.color = saved.style.background = saved.style.color = S.colors[k];
      saved.setAttribute('aria-label', S.colors[k]);
      box.querySelectorAll('.swatch').forEach((sw) => {
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === v);
        if (sw !== saved) { sw.style.background = sw.style.color = sw.dataset.color; sw.setAttribute('aria-label', sw.dataset.color); }
      });
      const input = box.querySelector('input[type="color"]');
      if (input.value !== v) input.value = v;
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
        el.addEventListener('click', () => {
          S.style[k] = !S.style[k];
          // NAME LABEL / BADGE ON with an empty field: give the selected token a
          // stand-in so the label / badge shows at once
          const it = cur(), fill = { labelOn: ['label', 'Char Name'], badgeOn: ['badge', '1'] }[k];
          if (fill && S.style[k] && it && !String(it[fill[0]] || '').trim()) { it[fill[0]] = fill[1]; itemChanged(it); }
          styleChanged();
        });
      } else {
        el.addEventListener('input', () => { S.style[k] = el.type === 'range' ? +el.value : el.value; styleChanged(); });
      }
    });
    // data-resetpos="label|badge": put a dragged label / badge back where it starts
    document.querySelectorAll('[data-resetpos]').forEach((b) => {
      const w = b.dataset.resetpos;
      b.addEventListener('click', () => {
        S.style[w + 'X'] = DEFAULT_STYLE[w + 'X']; S.style[w + 'Y'] = DEFAULT_STYLE[w + 'Y'];
        styleChanged();
      });
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
    $('flipBtn').addEventListener('click', () => {
      const it = cur();
      if (!it) return;
      // mirror about the token's vertical centre line, not the image's own
      // centre: reflecting the whole placement negates pan-x and rotation too
      it.tf.flip = !it.tf.flip; it.tf.x = -it.tf.x; it.tf.rot = -it.tf.rot;
      itemChanged(it);
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
    document.querySelectorAll('[data-for]').forEach((b) => {
      const hex = st[b.dataset.for], n = parseInt(String(hex).slice(1), 16) || 0;
      b.style.background = hex;
      // picker icon: dark on light fills, light on dark ones
      b.style.color = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? '#111' : '#fff';
    });
    syncSwatches();
    document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('active', st.bgMode === b.dataset.bg));
    $('accentColorRow').classList.toggle('disabled', !st.accent);
    $('swapBtn').classList.toggle('disabled', !st.accent);
    [['.label-param', st.labelOn], ['.badge-param', st.badgeOn]].forEach(([sel, on]) => {
      document.querySelectorAll(sel).forEach((row) => {
        row.classList.toggle('disabled', !on);
        row.querySelectorAll('select, button, input').forEach((c) => { c.disabled = !on; });
      });
    });
    // edit icons follow their ON/OFF switch; switching OFF closes the open window
    const ovlOn = { label: st.labelOn, badge: st.badgeOn };
    document.querySelectorAll('[data-ovledit]').forEach((b) => { b.disabled = !ovlOn[b.dataset.ovledit]; });
    if (ovlOpen && !ovlOn[ovlOpen]) setOvlOpen(null);
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
    $('flipBtn').disabled = !it; $('flipBtn').setAttribute('aria-pressed', tf.flip ? 'true' : 'false');
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
  // Export names: token[_name]_<id6>[_preset][_b<badge>]_<size>.<ext>
  //   name   — the token's NAME field (skipped when empty; never the source filename)
  //   id6    — content hash of the source image (ensureHash)
  //   preset — the saved preset matching the current look, if any
  //   badge  — the badge (numbered sets pad it: b01…b12)
  function activePresetName() {
    const all = allPresets(), nowKey = lookKey(S.style, S.fx);
    return Object.keys(all).find((n) => all[n] && all[n].style && lookKey(...presetLook(all[n])) === nowKey) || '';
  }
  function baseName(it) {
    return ['token', slug(it.label), it.hash, slug(activePresetName())].filter(Boolean).join('_');
  }
  function tokenFile(it, N, ext, badge) {
    const b = slug(badge);
    return [baseName(it), b && 'b' + b, N].filter(Boolean).join('_') + '.' + ext;
  }
  function stamp() {
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  }
  function exportCurrent() {
    const it = cur();
    if (!it || busy) return;
    const N = S.out.size;
    Promise.all([toBlob(EIDOLON.renderCanvas(it, N), MIME[S.out.format]), ensureHash(it)]).then(([b]) => {
      const name = tokenFile(it, N, extOf(b), S.style.badgeOn ? it.badge : '');
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
    if (busy) return;
    const N = S.out.size, ext = S.out.format, items = S.items.slice();
    Promise.all(items.map(ensureHash)).then(() => {
      zipJobs(items.map((it) => ({ item: it, name: tokenFile(it, N, ext, S.style.badgeOn ? it.badge : '') })), `tokens_${stamp()}_${N}.zip`);
    });
  }
  function zipSet() {
    const it = cur();
    if (!it || busy) return;
    const N = S.out.size, ext = S.out.format, n = clamp(S.out.setCount, 2, 99), pad = String(n).length;
    ensureHash(it).then(() => {
      const jobs = [];
      for (let k = 1; k <= n; k++) {
        const badge = String(k).padStart(pad, '0');
        jobs.push({ item: it, opts: { badge: String(k) }, name: tokenFile(it, N, ext, badge) });
      }
      zipJobs(jobs, `${baseName(it)}_set${n}_${N}.zip`);
    });
  }

  // ---- init ----
  function init() {
    restore();
    buildSwatches();
    buildSrcGroups();
    setupRefBar();
    setupPopout();
    setupPresets();
    setupFx();
    setupPanels();
    setupAdjPop();
    setupOvlPop();
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
    document.addEventListener('eidolon:lang', () => { syncSrcGroups(); swatchTitles(); updateTexts(); buildRoster(); syncRef(); presetsChanged(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.EIDOLON);
