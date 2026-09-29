(function (EIDOLON) {
  'use strict';
  // ---- Token renderer. One pure-ish function draws a token for a roster item
  // at any edge size N, so the stage preview and every export share the exact
  // same pipeline. Transforms are stored as fractions of N (resolution-free).
  //
  // Layer order:
  //   U  portrait layer — the image with transform and adjustments (unclipped)
  //   L  cut-out layer  — background + U + overlay/scanlines, clipped to the shape/mask
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
    const x = c.getContext('2d');
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
  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
  // Dark or light ink for text sitting on a `hex` fill.
  function ink(hex) {
    const [r, g, b] = rgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#050507' : '#e8e8ee';
  }
  EIDOLON.ink = ink;
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
    const N = g.N, c = scratch('U', N), x = c.getContext('2d');
    const src = item.src, tf = item.tf, s = baseScale(src, g) * tf.zoom;
    x.save();
    x.translate(g.cx + tf.x * N, g.cy + tf.y * N);
    x.rotate((tf.rot * Math.PI) / 180);
    x.scale(tf.flip ? -1 : 1, 1);
    x.filter = adjFilter(item.adj);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, (-src.width * s) / 2, (-src.height * s) / 2, src.width * s, src.height * s);
    x.restore();
    return c;
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

  // ---- L: background + portrait + overlay, clipped to the cut-out ----
  function cutoutLayer(item, U, g, F) {
    const N = g.N, st = S.style, c = scratch('L', N), x = c.getContext('2d');
    if (st.bgMode === 'extend' && item) {
      drawEdgeExtend(x, item, g);
    } else if (st.bgMode !== 'transparent') {
      x.fillStyle = st.bgColor; x.fillRect(0, 0, N, N);
    }
    if (U) x.drawImage(U, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    if (st.overlayOpacity > 0) {
      const a = st.overlayOpacity / 100;
      const gr = x.createRadialGradient(g.cx, g.cy, g.R * 0.25, g.cx, g.cy, g.R);
      gr.addColorStop(0, rgba(st.overlayColor, a * 0.15));
      gr.addColorStop(1, rgba(st.overlayColor, a));
      x.fillStyle = gr; x.fillRect(0, 0, N, N);
    }
    if (st.scanlines) {
      const p = Math.max(2, Math.round(N / 128));
      x.fillStyle = 'rgba(0,0,0,0.3)';
      for (let y = 0; y < N; y += p) x.fillRect(0, y, N, Math.max(1, p / 2));
    }
    // clip to the cut-out: the custom mask if loaded, else the frame's shape
    x.globalCompositeOperation = 'destination-in';
    if (S.customMask) {
      x.drawImage(S.customMask, 0, 0, N, N);
    } else {
      const inset = st.frame === 'none' ? 0 : g.t * (F.inset != null ? F.inset : 0.5);
      x.fillStyle = '#000'; x.beginPath();
      EIDOLON.shapePath(x, F.shape, g.cx, g.cy, g.R, inset);
      x.fill();
    }
    return c;
  }

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

  // ---- label: clipped name plate or text along the bottom arc ----
  function drawLabel(ctx, text, g) {
    const st = S.style, N = g.N;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (st.labelStyle === 'plate') {
      let fs = N * 0.068;
      ctx.font = font(fs); setSpacing(ctx, fs * 0.08);
      const maxW = N * 0.8;
      let w = ctx.measureText(text).width;
      if (w > maxW) { fs *= maxW / w; ctx.font = font(fs); setSpacing(ctx, fs * 0.08); w = ctx.measureText(text).width; }
      const h = fs * 1.6, pw = w + fs * 1.6, k = h * 0.38;
      const yc = Math.min(g.cy + g.R * 0.8, N - h / 2 - N * 0.012), x0 = g.cx - pw / 2, y0 = yc - h / 2;
      ctx.beginPath();
      ctx.moveTo(x0 + k, y0); ctx.lineTo(x0 + pw, y0); ctx.lineTo(x0 + pw, y0 + h - k);
      ctx.lineTo(x0 + pw - k, y0 + h); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0, y0 + k); ctx.closePath();
      ctx.fillStyle = st.frameColor; ctx.fill();
      if (st.accent) { ctx.lineWidth = Math.max(1, N * 0.004); ctx.strokeStyle = st.accentColor; ctx.stroke(); }
      ctx.fillStyle = st.labelColor;
      ctx.fillText(text, g.cx, yc + fs * 0.04);
    } else if (st.labelStyle === 'arc') {
      let fs = N * 0.062;
      const fit = () => {
        ctx.font = font(fs); setSpacing(ctx, 0);
        const ws = [...text].map((ch) => ctx.measureText(ch).width + fs * 0.12);
        return { ws, total: ws.reduce((a, b) => a + b, 0) };
      };
      let m = fit(), r = g.R - fs * 0.8;
      const maxSpan = (150 * Math.PI) / 180;
      while (m.total / r > maxSpan && fs > N * 0.02) { fs *= 0.92; m = fit(); r = g.R - fs * 0.8; }
      const span = m.total / r, pad = (fs * 0.9) / r;
      ctx.strokeStyle = st.frameColor; ctx.lineWidth = fs * 1.6; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(g.cx, g.cy, r, Math.PI / 2 - span / 2 - pad, Math.PI / 2 + span / 2 + pad); ctx.stroke();
      ctx.fillStyle = st.labelColor;
      let acc = 0;
      [...text].forEach((ch, i) => {
        const th = Math.PI / 2 + span / 2 - (acc + m.ws[i] / 2) / r;
        acc += m.ws[i];
        ctx.save();
        ctx.translate(g.cx + r * Math.cos(th), g.cy + r * Math.sin(th));
        ctx.rotate(th - Math.PI / 2);
        ctx.fillText(ch, 0, fs * 0.04);
        ctx.restore();
      });
    }
    ctx.restore();
  }

  // ---- badge: a numbered/lettered disc on one of the diagonals ----
  function drawBadge(ctx, text, g) {
    const st = S.style, N = g.N;
    const dir = { tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1] }[st.badgePos] || [1, 1];
    const d = g.R * 0.74, bx = g.cx + dir[0] * d, by = g.cy + dir[1] * d;
    const r = N * 0.088;
    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2);
    const fill = st.accent ? st.accentColor : st.frameColor; // no accent -> badge in the frame colour
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = N * 0.012; ctx.strokeStyle = st.bgMode === 'color' ? st.bgColor : '#050507'; ctx.stroke();
    let fs = r * 1.1;
    ctx.font = font(fs);
    const w = ctx.measureText(text).width;
    if (w > r * 1.55) { fs *= (r * 1.55) / w; ctx.font = font(fs); }
    ctx.fillStyle = ink(fill); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx, by + fs * 0.05);
    ctx.restore();
  }

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
    if (U && st.popout) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, N, g.cy); ctx.clip();
      ctx.drawImage(U, 0, 0);
      ctx.restore();
    }
    const label = item && item.label ? item.label.trim().toUpperCase() : '';
    if (label && st.labelStyle !== 'none') drawLabel(ctx, label, g);
    const badge = String(opts.badge != null ? opts.badge : (item && item.badge) || '').trim().toUpperCase();
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
