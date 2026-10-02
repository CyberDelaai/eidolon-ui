(function (EIDOLON) {
  'use strict';
  // ---- Token renderer. One pure-ish function draws a token for a roster item
  // at any edge size N, so the stage preview and every export share the exact
  // same pipeline. Transforms are stored as fractions of N (resolution-free).
  //
  // Layer order:
  //   U  portrait layer — the image with transform, adjustments and pixel FX (unclipped)
  //   L  cut-out layer  — background + U + FX overlays, clipped to the shape/mask
  //   B  frame layer    — built-in frame or tinted custom PNG (+ opacity)
  //   G  glow halo      — B's blur minus B itself, optionally split at the frame's outer edge
  //   then pop-out (top half of U over the frame), label, badge. ----
  const S = EIDOLON.state;

  // Reusable scratch canvases (render is synchronous, so sharing them is safe).
  const pool = {};
  function scratch(key, N) {
    let c = pool[key];
    if (!c) c = pool[key] = document.createElement('canvas');
    if (c.width !== N || c.height !== N) { c.width = N; c.height = N; }
    const x = c.getContext('2d', { willReadFrequently: key === 'U' }); // U gets FX pixel passes
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.shadowBlur = 0; x.shadowColor = 'transparent';
    x.clearRect(0, 0, N, N);
    return c;
  }

  // ---- helpers ----
  function rgb(hex) {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Dark or light ink for text sitting on a `hex` fill.
  function ink(hex) {
    const [r, g, b] = rgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#050507' : '#e8e8ee';
  }
  EIDOLON.ink = ink;
  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
  // Deterministic PRNG, so GLITCH slices and GRAIN don't flicker between redraws.
  function rng(seedStr) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = Math.imul(s ^ seedStr.charCodeAt(i), 2654435761) >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Resolve a label / badge colour source. 'accent' follows the ACCENT switch:
  // with accent OFF there is no accent colour anywhere, so it falls back to the
  // frame colour. 'auto' returns null (the caller picks an ink for contrast).
  function colorFrom(from, custom) {
    const st = S.style;
    if (from === 'frame') return st.frameColor;
    if (from === 'accent') return st.accent ? st.accentColor : st.frameColor;
    if (from === 'bg') return st.bgColor;
    if (from === 'auto') return null;
    return custom;
  }
  EIDOLON.colorFrom = colorFrom;
  const font = (px) => `700 ${px}px "JetBrains Mono", monospace`;
  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  function geom(N) {
    // outer radius: half the edge minus the empty margin on each side
    const R = N / 2 - (N * Math.min(10, Math.max(0, S.style.margin))) / 100;
    return { N, cx: N / 2, cy: N / 2, R, t: (R * S.style.thickness) / 100, u: N / 512 };
  }
  function frameDef() {
    const st = S.style;
    if (st.frame === 'custom' && S.customFrame) return { shape: 'circle', inset: 0.5, custom: true };
    return EIDOLON.frames[st.frame] || EIDOLON.frames.ring;
  }
  EIDOLON.geom = geom;

  // Image scale for zoom = 1: cover the frame's bounding box.
  function baseScale(src, g) { return (2 * g.R) / Math.min(src.width, src.height); }
  EIDOLON.baseScale = baseScale;

  function adjFilter(a) {
    if (!a || (a.bright === 100 && a.contrast === 100 && a.sat === 100 && !a.hue)) return 'none';
    return `brightness(${a.bright}%) contrast(${a.contrast}%) saturate(${a.sat}%) hue-rotate(${a.hue}deg)`;
  }

  // ---- U: the portrait with transform + adjustments ----
  function portraitLayer(item, g) {
    const N = g.N, c = scratch('U', N), x = c.getContext('2d', { willReadFrequently: true });
    const src = item.src, tf = item.tf, s = baseScale(src, g) * tf.zoom;
    x.save();
    x.translate(g.cx + tf.x * N, g.cy + tf.y * N);
    x.rotate((tf.rot * Math.PI) / 180);
    x.scale(tf.flip ? -1 : 1, 1);
    x.filter = adjFilter(item.adj);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, (-src.width * s) / 2, (-src.height * s) / 2, src.width * s, src.height * s);
    x.restore();
    if (S.fx.on) portraitFx(x, N, item);
    return c;
  }

  // ---- FX (S.fx, gated by the master switch). TONE / GLITCH / RGB / GRAIN are
  // pixel passes on the portrait layer U; VIGNETTE / SCANLINES are drawn over
  // the whole cut-out in cutoutFx(). ----
  function portraitFx(x, N, item) {
    const f = S.fx;
    const tone = f.tone !== 'none' && f.toneMix > 0;
    const glitch = f.glitch && f.glitchAmt > 0, split = f.rgb && f.rgbAmt > 0, grain = f.grain && f.grainAmt > 0;
    if (!tone && !glitch && !split && !grain) return;
    const img = x.getImageData(0, 0, N, N), d = img.data;
    if (tone) toneMap(d, N, f);
    if (glitch || split) resample(d, N, f, item, glitch, split);
    if (grain) addGrain(d, N, f);
    x.putImageData(img, 0, 0);
  }
  // MONO greyscale · NEON gradient map (near-black -> frame colour -> accent) ·
  // HOLO projection in the frame colour with scan banding; blended by MIX.
  function toneMap(d, N, f) {
    const m = f.toneMix / 100, dark = [5, 5, 7], a = rgb(S.style.frameColor), b = rgb(S.style.accentColor);
    const period = Math.max(2, Math.round(N / 150));
    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
      const r = d[i], g = d[i + 1], bl = d[i + 2], al = d[i + 3];
      const l = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
      let tr, tg, tb, ta = al;
      if (f.tone === 'mono') {
        tr = tg = tb = l * 255;
      } else if (f.tone === 'neon') {
        const k0 = Math.min(1, Math.max(0, (l - 0.5) * 1.25 + 0.5));
        const [p, q, k] = k0 < 0.5 ? [dark, a, k0 * 2] : [a, b, (k0 - 0.5) * 2];
        tr = p[0] + (q[0] - p[0]) * k; tg = p[1] + (q[1] - p[1]) * k; tb = p[2] + (q[2] - p[2]) * k;
      } else {
        const band = Math.floor(px / N) % period < period / 2 ? 1 : 0.55, ll = 0.25 + l * 1.05;
        tr = a[0] * ll + 40 * ll; tg = a[1] * ll + 40 * ll; tb = a[2] * ll + 40 * ll;
        ta = al * 0.9 * band;
      }
      d[i] = r + (tr - r) * m; d[i + 1] = g + (tg - g) * m; d[i + 2] = bl + (tb - bl) * m;
      d[i + 3] = al + (ta - al) * m;
    }
  }
  // GLITCH: seeded horizontal slices shifted sideways; RGB: red and blue
  // sampled left / right of green. One resample pass does both.
  function resample(d, N, f, item, glitch, split) {
    const src = new Uint8ClampedArray(d), shift = new Int32Array(N);
    if (glitch) {
      const amt = f.glitchAmt / 100, rand = rng((item ? item.id : '') + ':' + f.glitchSeed);
      const count = 3 + Math.round(amt * 9);
      for (let k = 0; k < count; k++) {
        const y0 = Math.floor(rand() * N), h = Math.max(1, Math.floor((0.008 + rand() * 0.05) * N));
        const dx = Math.round((rand() - 0.5) * 2 * amt * 0.1 * N);
        for (let y = y0; y < Math.min(N, y0 + h); y++) shift[y] = dx;
      }
    }
    const sh = split ? Math.max(1, Math.round((f.rgbAmt * N) / 512)) : 0;
    const at = (y, xx) => (y * N + Math.min(N - 1, Math.max(0, xx))) * 4;
    for (let y = 0; y < N; y++) {
      for (let xx = 0; xx < N; xx++) {
        const i = (y * N + xx) * 4, xs = xx - shift[y];
        const ir = at(y, xs - sh), ig = at(y, xs), ib = at(y, xs + sh);
        d[i] = src[ir]; d[i + 1] = src[ig + 1]; d[i + 2] = src[ib + 2];
        d[i + 3] = Math.max(src[ir + 3], src[ig + 3], src[ib + 3]);
      }
    }
  }
  // GRAIN: monochrome noise on visible pixels.
  function addGrain(d, N, f) {
    const rand = rng('grain:' + N), a = f.grainAmt * 1.1;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const n = (rand() - 0.5) * a;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
  }
  // VIGNETTE (tinted edge fade) + SCANLINES, drawn source-atop over the
  // background + portrait, before the cut-out clip.
  function cutoutFx(x, g) {
    const f = S.fx, N = g.N;
    x.save();
    x.globalCompositeOperation = 'source-atop';
    if (f.vig && f.vigAmt > 0) {
      const gr = x.createRadialGradient(g.cx, g.cy, g.R * 0.35, g.cx, g.cy, g.R);
      gr.addColorStop(0, rgba(f.vigColor, 0));
      gr.addColorStop(1, rgba(f.vigColor, f.vigAmt / 100));
      x.fillStyle = gr; x.fillRect(0, 0, N, N);
    }
    if (f.scan && f.scanAmt > 0) {
      const p = Math.max(2, Math.round((f.scanGap * N) / 512)), h = Math.max(1, Math.round(p / 2));
      x.fillStyle = `rgba(0,0,0,${f.scanAmt / 100})`;
      for (let y = 0; y < N; y += p) x.fillRect(0, y, N, h);
    }
    x.restore();
  }

  // ---- EXTEND fill: the portrait's outermost rows/columns stretched outward
  // (plus the four corner pixels into the diagonals), blurred and overscanned —
  // the same idea as GRIDMAP's VIBRANT fill. Drawn in the portrait's own
  // transform, so it follows pan / zoom / rotate / mirror and its adjustments. ----
  function drawEdgeExtend(x, item, g) {
    const N = g.N, src = item.src, tf = item.tf, s = baseScale(src, g) * tf.zoom;
    const W = src.width, H = src.height, w = W * s, h = H * s;
    const L = -w / 2, T = -h / 2, R = w / 2, B = h / 2;
    const blur = Math.max(3, Math.round(N * 0.025)), m = blur * 2, E = N * 2; // E reaches past any token corner
    const adj = adjFilter(item.adj);
    x.save();
    x.translate(g.cx + tf.x * N, g.cy + tf.y * N);
    x.rotate((tf.rot * Math.PI) / 180);
    x.scale(tf.flip ? -1 : 1, 1);
    x.filter = (adj === 'none' ? '' : adj + ' ') + `blur(${blur}px)`;
    x.drawImage(src, 0, 0, 1, H, L - E, T, E + m, h);                 // left
    x.drawImage(src, W - 1, 0, 1, H, R - m, T, E + m, h);             // right
    x.drawImage(src, 0, 0, W, 1, L, T - E, w, E + m);                 // top
    x.drawImage(src, 0, H - 1, W, 1, L, B - m, w, E + m);             // bottom
    x.drawImage(src, 0, 0, 1, 1, L - E, T - E, E + m, E + m);         // TL
    x.drawImage(src, W - 1, 0, 1, 1, R - m, T - E, E + m, E + m);     // TR
    x.drawImage(src, 0, H - 1, 1, 1, L - E, B - m, E + m, E + m);     // BL
    x.drawImage(src, W - 1, H - 1, 1, 1, R - m, B - m, E + m, E + m); // BR
    x.drawImage(src, L, T, w, h);                                      // centre, so the blur has no seam
    x.restore();
  }

  // ---- L: background + portrait, clipped to the cut-out ----
  function cutoutLayer(item, U, g, F) {
    const N = g.N, st = S.style, c = scratch('L', N), x = c.getContext('2d');
    if (st.bgMode === 'extend' && item) {
      drawEdgeExtend(x, item, g);
    } else if (st.bgMode !== 'transparent') {
      x.fillStyle = st.bgColor; x.fillRect(0, 0, N, N);
    }
    if (U) x.drawImage(U, 0, 0);
    if (S.fx.on) cutoutFx(x, g);
    clipCutout(x, g, F);
    return c;
  }

  // Keep only what lies inside the cut-out: the custom mask if loaded, else
  // the frame's shape. Leaves the context in source-over.
  function clipCutout(x, g, F) {
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    if (S.customMask) {
      x.drawImage(S.customMask, 0, 0, g.N, g.N);
    } else {
      const inset = S.style.frame === 'none' ? 0 : g.t * (F.inset != null ? F.inset : 0.5);
      x.fillStyle = '#000'; x.beginPath();
      EIDOLON.shapePath(x, F.shape, g.cx, g.cy, g.R, inset);
      x.fill();
    }
    x.restore();
  }
  // For preview-only overlays (the reference): clip an N×N canvas to the cut-out.
  EIDOLON.applyCutout = (ctx, N) => clipCutout(ctx, geom(N), frameDef());

  // ---- B: the frame ----
  function frameLayer(g, F) {
    const N = g.N, st = S.style, c = scratch('B', N), x = c.getContext('2d');
    if (F.custom) {
      // B&W PNG tinted by multiply, then its own alpha restored
      x.drawImage(S.customFrame, 0, 0, N, N);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = st.frameColor; x.fillRect(0, 0, N, N);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(S.customFrame, 0, 0, N, N);
      x.globalCompositeOperation = 'source-over';
    } else {
      F.draw(x, g, { main: st.frameColor, accent: st.accent ? st.accentColor : null });
    }
    return c;
  }

  // ---- G: glow halo. The frame's shadow with the frame body cut away, then
  // kept inside ('inner') or outside ('outer') the frame's outer edge. ----
  function glowLayer(B, g, F, mode) {
    const N = g.N, c = scratch('G', N), x = c.getContext('2d');
    x.shadowColor = S.style.frameColor; x.shadowBlur = N * 0.028;
    x.drawImage(B, 0, 0);
    x.shadowBlur = 0; x.shadowColor = 'transparent';
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(B, 0, 0);
    if (mode === 'inner' || mode === 'outer') {
      x.globalCompositeOperation = mode === 'inner' ? 'destination-in' : 'destination-out';
      x.fillStyle = '#000'; x.beginPath();
      EIDOLON.shapePath(x, F.shape, g.cx, g.cy, g.R, 0);
      x.fill();
    }
    return c;
  }

  // ---- pop-out: the parts of the portrait painted into the token's pop-out
  // mask are redrawn over the frame. The mask lives in the image's own pixel
  // space, so it follows pan / zoom / rotate / mirror. ----
  function withImageTransform(x, item, g, draw) {
    const N = g.N, src = item.src, tf = item.tf, s = baseScale(src, g) * tf.zoom;
    const w = src.width * s, h = src.height * s;
    x.save();
    x.translate(g.cx + tf.x * N, g.cy + tf.y * N);
    x.rotate((tf.rot * Math.PI) / 180);
    x.scale(tf.flip ? -1 : 1, 1);
    draw(-w / 2, -h / 2, w, h);
    x.restore();
  }
  function popLayer(item, U, g) {
    const c = scratch('P', g.N), x = c.getContext('2d');
    x.filter = `blur(${Math.max(0.6, g.N / 700)}px)`; // soften the painted edge a touch
    withImageTransform(x, item, g, (l, t, w, h) => x.drawImage(item.popMask, l, t, w, h));
    x.filter = 'none';
    x.globalCompositeOperation = 'source-in';
    x.drawImage(U, 0, 0);
    // U already carries the portrait FX (tone / glitch / RGB / grain); the
    // cut-out overlays (vignette / scanlines) must be laid over the popped
    // part too, or it reads as a clean cut-out pasted on top.
    if (S.fx.on) cutoutFx(x, g);
    return c;
  }
  // Preview-only guide while the pop-out brush is active (drawn on the
  // overlay canvas, never exported): a faint ghost of the portrait outside the
  // cut-out — the part hidden by the frame / background — the painted mask
  // tinted red, and the brush ring. cursor = { x, y, r } in fractions of N.
  EIDOLON.drawBrushOverlay = function drawBrushOverlay(ctx, N, item, cursor) {
    const g = geom(N), F = frameDef(), U = portraitLayer(item, g);
    const ghost = scratch('GH', N), gx = ghost.getContext('2d');
    gx.globalAlpha = 0.35; gx.drawImage(U, 0, 0); gx.globalAlpha = 1;
    const hole = scratch('HO', N), hx = hole.getContext('2d');
    hx.fillStyle = '#000'; hx.fillRect(0, 0, N, N);
    clipCutout(hx, g, F);
    gx.globalCompositeOperation = 'destination-out';
    gx.drawImage(hole, 0, 0);
    ctx.drawImage(ghost, 0, 0);
    if (item.popMask) {
      const tint = scratch('TI', N), tx = tint.getContext('2d');
      withImageTransform(tx, item, g, (l, t, w, h) => tx.drawImage(item.popMask, l, t, w, h));
      tx.globalCompositeOperation = 'source-in';
      tx.fillStyle = 'rgba(255,0,60,0.45)'; tx.fillRect(0, 0, N, N);
      ctx.drawImage(tint, 0, 0);
    }
    if (cursor) {
      ctx.save();
      ctx.lineWidth = Math.max(1, N / 400);
      ctx.beginPath(); ctx.arc(cursor.x * N, cursor.y * N, cursor.r * N, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(5,5,7,0.8)'; ctx.stroke();
      ctx.setLineDash([N / 120, N / 160]); ctx.strokeStyle = '#fcee0a'; ctx.stroke();
      ctx.restore();
    }
  };

  // ---- label + badge placement. Both sit at a style position (labelX/Y,
  // badgeX/Y: offsets from the centre in units of R); the arc label uses only
  // its direction. The layouts are shared by drawing and stage hit-testing. ----
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function arcAngle() {
    const st = S.style;
    return st.labelX || st.labelY ? Math.atan2(st.labelY, st.labelX) : Math.PI / 2;
  }
  function plateLayout(ctx, text, g) {
    const st = S.style, N = g.N;
    let fs = N * 0.068;
    ctx.font = font(fs); setSpacing(ctx, fs * 0.08);
    const maxW = N * 0.8;
    let w = ctx.measureText(text).width;
    if (w > maxW) { fs *= maxW / w; ctx.font = font(fs); setSpacing(ctx, fs * 0.08); w = ctx.measureText(text).width; }
    const h = fs * 1.6, pw = w + fs * 1.6, pad = N * 0.012;
    // kept fully on the token
    const xc = clampTo(g.cx + st.labelX * g.R, pw / 2 + pad, N - pw / 2 - pad);
    const yc = clampTo(g.cy + st.labelY * g.R, h / 2 + pad, N - h / 2 - pad);
    return { fs, h, pw, k: h * 0.38, xc, yc };
  }
  function arcLayout(ctx, text, g) {
    const N = g.N;
    let fs = N * 0.062;
    const fit = () => {
      ctx.font = font(fs); setSpacing(ctx, 0);
      const ws = [...text].map((ch) => ctx.measureText(ch).width + fs * 0.12);
      return { ws, total: ws.reduce((a, b) => a + b, 0) };
    };
    let m = fit(), r = g.R - fs * 0.8;
    const maxSpan = (150 * Math.PI) / 180;
    while (m.total / r > maxSpan && fs > N * 0.02) { fs *= 0.92; m = fit(); r = g.R - fs * 0.8; }
    const th = arcAngle();
    // on the upper half the text runs the other way round, so it still reads upright
    return { fs, ws: m.ws, r, th, span: m.total / r, pad: (fs * 0.9) / r, top: Math.sin(th) < -1e-6 };
  }
  function badgeLayout(g) {
    const st = S.style, N = g.N, r = N * 0.088, e = r + N * 0.006;
    return { r, bx: clampTo(g.cx + st.badgeX * g.R, e, N - e), by: clampTo(g.cy + st.badgeY * g.R, e, N - e) };
  }

  // ---- label: clipped name plate or text along the ring ----
  function drawLabel(ctx, text, g) {
    const st = S.style, N = g.N;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (st.labelStyle === 'plate') {
      const { fs, h, pw, k, xc, yc } = plateLayout(ctx, text, g);
      const x0 = xc - pw / 2, y0 = yc - h / 2;
      ctx.beginPath();
      ctx.moveTo(x0 + k, y0); ctx.lineTo(x0 + pw, y0); ctx.lineTo(x0 + pw, y0 + h - k);
      ctx.lineTo(x0 + pw - k, y0 + h); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0, y0 + k); ctx.closePath();
      ctx.fillStyle = colorFrom(st.plateFrom, st.plateColor); ctx.fill();
      if (st.accent) { ctx.lineWidth = Math.max(1, N * 0.004); ctx.strokeStyle = st.accentColor; ctx.stroke(); }
      ctx.fillStyle = colorFrom(st.labelFrom, st.labelColor);
      ctx.fillText(text, xc, yc + fs * 0.04);
    } else if (st.labelStyle === 'arc') {
      const L = arcLayout(ctx, text, g);
      ctx.strokeStyle = colorFrom(st.plateFrom, st.plateColor); ctx.lineWidth = L.fs * 1.6; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(g.cx, g.cy, L.r, L.th - L.span / 2 - L.pad, L.th + L.span / 2 + L.pad); ctx.stroke();
      ctx.fillStyle = colorFrom(st.labelFrom, st.labelColor);
      let acc = 0;
      [...text].forEach((ch, i) => {
        const d = (acc + L.ws[i] / 2) / L.r;
        const th = L.top ? L.th - L.span / 2 + d : L.th + L.span / 2 - d;
        acc += L.ws[i];
        ctx.save();
        ctx.translate(g.cx + L.r * Math.cos(th), g.cy + L.r * Math.sin(th));
        ctx.rotate(th + (L.top ? Math.PI / 2 : -Math.PI / 2));
        ctx.fillText(ch, 0, L.fs * 0.04);
        ctx.restore();
      });
    }
    ctx.restore();
  }

  // ---- badge: a numbered/lettered disc ----
  function drawBadge(ctx, text, g) {
    const st = S.style, N = g.N;
    const { r, bx, by } = badgeLayout(g);
    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2);
    const fill = colorFrom(st.badgeFrom, st.badgeColor);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = N * 0.012; ctx.strokeStyle = st.bgMode === 'color' ? st.bgColor : '#050507'; ctx.stroke();
    let fs = r * 1.1;
    ctx.font = font(fs);
    const w = ctx.measureText(text).width;
    if (w > r * 1.55) { fs *= (r * 1.55) / w; ctx.font = font(fs); }
    ctx.fillStyle = colorFrom(st.badgeTextFrom, st.badgeTextColor) || ink(fill); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx, by + fs * 0.05);
    ctx.restore();
  }
  const labelText = (item) => (S.style.labelOn && item && item.label ? item.label.trim().toUpperCase() : '');
  const badgeText = (item) => String((S.style.badgeOn && item && item.badge) || '').trim().toUpperCase();

  // Which draggable overlay ('badge' | 'label' | null) is at canvas pixel (x, y)
  // of an N×N preview of `item`. The badge is drawn last, so it wins.
  let measureCtx = null;
  EIDOLON.overlayAt = function overlayAt(N, item, x, y) {
    const g = geom(N);
    if (badgeText(item)) {
      const b = badgeLayout(g);
      if (Math.hypot(x - b.bx, y - b.by) <= b.r * 1.1) return 'badge';
    }
    const text = labelText(item);
    if (!text) return null;
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    if (S.style.labelStyle === 'arc') {
      const L = arcLayout(measureCtx, text, g);
      const d = Math.hypot(x - g.cx, y - g.cy);
      let da = Math.atan2(y - g.cy, x - g.cx) - L.th;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      return Math.abs(d - L.r) <= L.fs * 0.9 && Math.abs(da) <= L.span / 2 + L.pad ? 'label' : null;
    }
    const P = plateLayout(measureCtx, text, g);
    return Math.abs(x - P.xc) <= P.pw / 2 && Math.abs(y - P.yc) <= P.h / 2 ? 'label' : null;
  };

  // Key positions the overlays snap to (in R units, like labelX/Y, badgeX/Y).
  // The arc label snaps its angle to every 45° instead.
  const D = 0.74, E = 0.92;
  const SNAPS = {
    label: [[0, 0.8], [0, -0.8], [0, 0]],
    badge: [[D, D], [-D, D], [D, -D], [-D, -D], [0, E], [0, -E], [E, 0], [-E, 0], [0, 0]],
  };
  const ARC_STEP = Math.PI / 4, ARC_SNAP = (7 * Math.PI) / 180;
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  // Snap a dragged position (R units): to the nearest key point within reach,
  // else onto the vertical / horizontal centre line. `free` (Alt) skips the
  // snapping; the arc label is still put back on its ring. Returns [x, y].
  EIDOLON.snapOverlay = function snapOverlay(which, x, y, free) {
    if (which === 'label' && S.style.labelStyle === 'arc') {
      let th = Math.atan2(y, x);
      const k = Math.round(th / ARC_STEP) * ARC_STEP;
      if (!free && Math.abs(th - k) <= ARC_SNAP) th = k;
      return [round4(Math.cos(th) * 0.8), round4(Math.sin(th) * 0.8)];
    }
    if (free) return [x, y];
    const reach = which === 'badge' ? 0.12 : 0.1;
    let best = null, bd = reach;
    SNAPS[which].forEach((p) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < bd) { bd = d; best = p; } });
    if (best) return [best[0], best[1]];
    return [Math.abs(x) < reach / 2 ? 0 : x, Math.abs(y) < reach / 2 ? 0 : y];
  };

  // Preview-only guide while dragging an overlay: its snap points (the one in
  // use lit), drawn on #refCanvas after the reference.
  EIDOLON.drawSnapOverlay = function drawSnapOverlay(ctx, N, which) {
    const st = S.style, g = geom(N), s = N / 90;
    const at = which === 'badge' ? [st.badgeX, st.badgeY] : [st.labelX, st.labelY];
    const mark = (x, y, on) => {
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
      ctx.strokeStyle = 'rgba(5,5,7,0.8)'; ctx.lineWidth = Math.max(2, N / 150); ctx.stroke();
      ctx.strokeStyle = on ? '#fcee0a' : 'rgba(232,232,238,0.7)'; ctx.lineWidth = Math.max(1, N / 300); ctx.stroke();
    };
    ctx.save();
    if (which === 'label' && st.labelStyle === 'arc') {
      const th = arcAngle(), r = g.R * 0.9;
      for (let i = 0; i < 8; i++) {
        const a = i * ARC_STEP;
        mark(g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r, Math.abs(Math.atan2(Math.sin(th - a), Math.cos(th - a))) < 1e-3);
      }
    } else {
      SNAPS[which].forEach((p) => mark(g.cx + p[0] * g.R, g.cy + p[1] * g.R, Math.abs(p[0] - at[0]) < 1e-6 && Math.abs(p[1] - at[1]) < 1e-6));
    }
    ctx.restore();
  };

  // Render the token for `item` (may be null → empty frame preview) onto ctx,
  // whose canvas is N×N. opts.badge overrides the item's badge (numbered sets).
  EIDOLON.render = function render(ctx, N, item, opts) {
    opts = opts || {};
    const st = S.style, g = geom(N), F = frameDef();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, N, N);
    const U = item ? portraitLayer(item, g) : null;
    ctx.drawImage(cutoutLayer(item, U, g, F), 0, 0);
    const B = frameLayer(g, F);
    ctx.globalAlpha = st.frameOpacity / 100;
    if (st.glow !== 'off') ctx.drawImage(glowLayer(B, g, F, st.glow), 0, 0);
    ctx.drawImage(B, 0, 0);
    ctx.globalAlpha = 1;
    if (U && item.popOn && item.popMask) ctx.drawImage(popLayer(item, U, g), 0, 0);
    const label = labelText(item);
    if (label) drawLabel(ctx, label, g);
    // numbered sets stamp their badge even with the switch off
    const badge = opts.badge != null ? String(opts.badge).trim().toUpperCase() : badgeText(item);
    if (badge) drawBadge(ctx, badge, g);
    ctx.restore();
  };

  // Render to a fresh N×N canvas (exports).
  EIDOLON.renderCanvas = function renderCanvas(item, N, opts) {
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    EIDOLON.render(c.getContext('2d'), N, item, opts);
    return c;
  };
})(window.EIDOLON);
