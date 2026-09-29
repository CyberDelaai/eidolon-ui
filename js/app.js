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
  function setStatus(msg, kind) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
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
  const persistTimers = {};
  function persistItem(item) {
    clearTimeout(persistTimers[item.id]);
    persistTimers[item.id] = setTimeout(() => {
      EIDOLON.idb.put('items', item.id, {
        id: item.id, name: item.name, blob: item.blob, order: item.order,
        tf: item.tf, adj: item.adj, label: item.label, badge: item.badge,
      }).catch(() => {});
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
    if (S.style.frame !== 'custom' && !EIDOLON.frames[S.style.frame]) S.style.frame = 'ring';
  }
  // Roster + custom assets come back asynchronously from IndexedDB.
  function restoreDb() {
    EIDOLON.idb.all('items').then((recs) => {
      recs = (recs || []).filter((r) => r && r.blob).sort((a, b) => a.order - b.order);
      return Promise.all(recs.map((r) => decode(r.blob).then((img) => ({
        id: r.id, name: r.name, blob: r.blob, order: r.order, src: toSource(img),
        tf: Object.assign(EIDOLON.newTransform(), r.tf), adj: Object.assign(EIDOLON.newAdjust(), r.adj),
        label: r.label || '', badge: r.badge || '',
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
    syncControls(); requestDraw(); rosterChanged(); updateButtons();
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
    syncControls(); saveStyle(); requestDraw(); drawFrameThumbs(); rosterChanged();
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
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, w: cv.getBoundingClientRect().width };
      cv.classList.add('grabbing');
    });
    cv.addEventListener('pointermove', (e) => {
      const it = cur();
      if (!drag || !it) return;
      it.tf.x += (e.clientX - drag.x) / drag.w;
      it.tf.y += (e.clientY - drag.y) / drag.w;
      drag.x = e.clientX; drag.y = e.clientY;
      requestDraw();
    });
    const end = () => { if (drag) { drag = null; cv.classList.remove('grabbing'); itemChanged(); } };
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
    thickness: (v) => v + '%', margin: (v) => v + '%', frameOpacity: (v) => v + '%', overlayOpacity: (v) => v + '%',
    'tf.zoom': (v) => Math.round(v * 100) + '%', 'tf.rot': (v) => Math.round(v) + '°',
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
      const v = b ? (a === 'tf' ? tf : adj)[b] : st[a];
      el.textContent = (VAL_FMT[p] || String)(v);
    });
    $('resetTfBtn').disabled = !it; $('resetAdjBtn').disabled = !it;
  }
  function updateButtons() {
    const it = cur();
    $('exportBtn').disabled = !it;
    $('copyBtn').disabled = !it || !window.ClipboardItem;
    $('zipSetBtn').disabled = !it;
    $('zipAllBtn').disabled = S.items.length < 2;
    $('clearBtn').disabled = !S.items.length;
    updateTexts();
  }
  // Texts assembled in JS (not plain data-i18n nodes) — rerun on language change.
  function updateTexts() {
    $('exportBtn').textContent = t('b_export') + ' ' + S.out.format.toUpperCase();
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
    document.addEventListener('eidolon:lang', () => { updateTexts(); buildRoster(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.EIDOLON);
