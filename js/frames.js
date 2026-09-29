(function (EIDOLON) {
  'use strict';
  // ---- Frame library. Every frame is drawn procedurally (no image assets), so
  // it stays crisp at any export size and tints with two colours.
  //   shape: the cut-out the portrait is clipped to ('circle' | 'square' | …)
  //   draw(ctx, g, c): paints the frame. g = geometry { N, cx, cy, R, t, u }
  //     (R = outer radius, t = thickness px, u = 1/512 of the edge for hairlines),
  //     c = { main, accent } — accent is null when the ACCENT toggle is off;
  //     the helpers below skip a null colour, so frames need no extra checks.
  //   inset (optional): where the portrait cut-out sits, as a fraction of the
  //     thickness (default 0.5 = under the middle of the band).
  // Frames draw into their own layer, so destination-out cuts are safe. ----

  // Regular polygon (n sides, first vertex at angle a0) with circumradius `r`.
  function poly(ctx, n, a0, cx, cy, r) {
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * 2 * Math.PI) / n;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  // Vertices of the same polygon (for accent dots).
  function polyPts(n, a0, cx, cy, r) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * 2 * Math.PI) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }
  const POLY = {
    hex: { n: 6, a0: -Math.PI / 2 },
    octa: { n: 8, a0: -Math.PI / 2 + Math.PI / 8 },
    diamond: { n: 4, a0: -Math.PI / 2 },
  };

  // Append the outline of `shape` (outer radius r, inset inward by d px) to
  // the current path. Does not beginPath, so two calls + fill('evenodd') = a band.
  function shapePath(ctx, shape, cx, cy, r, d) {
    d = d || 0;
    if (shape === 'square') {
      const h = r - d, k = Math.max(0, r * 0.1 - d * 0.6);
      ctx.moveTo(cx - h + k, cy - h);
      ctx.arcTo(cx + h, cy - h, cx + h, cy + h, k);
      ctx.arcTo(cx + h, cy + h, cx - h, cy + h, k);
      ctx.arcTo(cx - h, cy + h, cx - h, cy - h, k);
      ctx.arcTo(cx - h, cy - h, cx + h, cy - h, k);
      ctx.closePath();
    } else if (shape === 'box') {
      // plain square, sharp corners
      const h = r - d;
      ctx.moveTo(cx - h, cy - h); ctx.lineTo(cx + h, cy - h);
      ctx.lineTo(cx + h, cy + h); ctx.lineTo(cx - h, cy + h);
      ctx.closePath();
    } else if (shape === 'clip') {
      // augmented-ui signature: square with clipped top-left + bottom-right corners
      const h = r - d, k = Math.max(0, r * 0.34 - d * (Math.SQRT2 - 1));
      ctx.moveTo(cx - h + k, cy - h); ctx.lineTo(cx + h, cy - h);
      ctx.lineTo(cx + h, cy + h - k); ctx.lineTo(cx + h - k, cy + h);
      ctx.lineTo(cx - h, cy + h); ctx.lineTo(cx - h, cy - h + k);
      ctx.closePath();
    } else if (POLY[shape]) {
      const p = POLY[shape], cos = Math.cos(Math.PI / p.n);
      poly(ctx, p.n, p.a0, cx, cy, r - d / cos);
    } else {
      ctx.moveTo(cx + r - d, cy);
      ctx.arc(cx, cy, Math.max(0, r - d), 0, Math.PI * 2);
      ctx.closePath();
    }
  }
  EIDOLON.shapePath = shapePath;

  // Fill the band of `shape` between insets d0 and d1.
  function band(ctx, g, shape, d0, d1, color) {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    shapePath(ctx, shape, g.cx, g.cy, g.R, d0);
    shapePath(ctx, shape, g.cx, g.cy, g.R, d1);
    ctx.fill('evenodd');
  }
  // Stroke a circular arc (angles in degrees, 0 = up, clockwise).
  function arc(ctx, g, r, a0, a1, w, color) {
    if (!color) return;
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, r, ((a0 - 90) * Math.PI) / 180, ((a1 - 90) * Math.PI) / 180);
    ctx.stroke();
  }
  function dot(ctx, x, y, r, color) {
    if (!color) return;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Corner bracket: an L whose corner sits at (x, y), arms pointing along (sx, sy).
  function bracket(ctx, x, y, sx, sy, len, w, color) {
    if (!color) return;
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(x + sx * len, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * len);
    ctx.stroke();
  }
  const hair = (g) => Math.max(1, g.u * 2.2);

  const FRAMES = {
    // clean ring + a hairline accent inside it
    ring: {
      shape: 'circle',
      draw(ctx, g, c) {
        band(ctx, g, 'circle', 0, g.t, c.main);
        band(ctx, g, 'circle', g.t + g.u * 5, g.t + g.u * 5 + hair(g), c.accent);
      },
    },
    // two concentric rings with a gap
    double: {
      shape: 'circle', inset: 0.15, // portrait shows through the gap
      draw(ctx, g, c) {
        band(ctx, g, 'circle', 0, g.t * 0.3, c.main);
        band(ctx, g, 'circle', g.t * 0.45, g.t * 0.55, c.accent);
        band(ctx, g, 'circle', g.t * 0.7, g.t, c.main);
      },
    },
    // ring broken into three segments + a continuous inner accent line
    segment: {
      shape: 'circle',
      draw(ctx, g, c) {
        const r = g.R - g.t / 2;
        [[10, 110], [130, 230], [250, 350]].forEach(([a, b]) => arc(ctx, g, r, a, b, g.t, c.main));
        [0, 120, 240].forEach((a) => arc(ctx, g, r, a - 4, a + 4, g.t * 0.45, c.accent));
        band(ctx, g, 'circle', g.t + g.u * 5, g.t + g.u * 5 + hair(g), c.accent);
      },
    },
    // chromatic-split ring with signal dropout notches
    glitch: {
      shape: 'circle',
      draw(ctx, g, c) {
        const off = Math.max(1.5, g.u * 5);
        ctx.save(); ctx.globalAlpha = 0.85;
        ctx.translate(-off, 0); band(ctx, g, 'circle', 0, g.t, '#ff003c');
        ctx.translate(off * 2, off * 0.4); band(ctx, g, 'circle', 0, g.t, c.accent);
        ctx.restore();
        band(ctx, g, 'circle', 0, g.t, c.main);
        // dropout notches + displaced slices
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        [[28, 6], [152, 3], [205, 9], [311, 4]].forEach(([a, w]) => arc(ctx, g, g.R - g.t / 2, a, a + w, g.t + 2, '#000'));
        ctx.restore();
        // slices start at the circle's edge on their row, run inward, and are
        // clipped to the round so they never bleed outside the token
        ctx.save();
        ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); ctx.clip();
        // [row (fraction of R from centre), length (fraction of R), side (-1 left / 1 right),
        //  colour ('m' main / 'a' accent / 'r' red), thickness (u)]
        const SLICES = [
          [-0.86, 0.12, 1, 'm', 2], [-0.74, 0.2, -1, 'a', 3], [-0.62, 0.14, -1, 'm', 3],
          [-0.55, 0.08, 1, 'r', 2], [-0.41, 0.1, 1, 'm', 4], [-0.18, 0.07, -1, 'r', 2],
          [0.05, 0.12, 1, 'a', 2], [0.22, 0.09, -1, 'm', 5], [0.34, 0.22, 1, 'a', 3],
          [0.47, 0.13, -1, 'r', 2], [0.58, 0.06, 1, 'm', 2], [0.71, 0.1, -1, 'm', 3],
          [0.83, 0.16, 1, 'r', 2],
        ];
        const COL = { m: c.main, a: c.accent || c.main, r: '#ff003c' };
        SLICES.forEach(([y, w, side, col, th]) => {
          ctx.fillStyle = COL[col];
          const h = Math.max(1, g.u * th), yy = g.cy + y * g.R;
          const edge = Math.sqrt(Math.max(0, g.R * g.R - (y * g.R) ** 2));
          const x0 = side > 0 ? g.cx + edge - g.R * w : g.cx - edge;
          ctx.fillRect(x0, yy, g.R * w, h);
        });
        ctx.restore();
      },
    },
    // ring with circuit traces running inward, ending in nodes
    circuit: {
      shape: 'circle',
      draw(ctx, g, c) {
        band(ctx, g, 'circle', 0, g.t, c.main);
        ctx.strokeStyle = c.accent; ctx.lineWidth = hair(g) * 1.2; ctx.lineCap = 'round';
        for (let i = 0; c.accent && i < 16; i++) {
          const a = ((i * 22.5 + 11.25) * Math.PI) / 180, len = g.t * (i % 3 === 0 ? 1.6 : i % 2 ? 0.9 : 1.2);
          const r0 = g.R - g.t * 0.35, r1 = g.R - g.t - len;
          const x0 = g.cx + r0 * Math.sin(a), y0 = g.cy - r0 * Math.cos(a);
          const x1 = g.cx + r1 * Math.sin(a), y1 = g.cy - r1 * Math.cos(a);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          dot(ctx, x1, y1, Math.max(1.5, g.t * 0.16), c.accent);
        }
        band(ctx, g, 'circle', g.t * 0.3, g.t * 0.3 + hair(g), c.accent);
      },
    },
    // square with corner brackets
    square: {
      shape: 'square',
      draw(ctx, g, c) {
        band(ctx, g, 'square', 0, g.t, c.main);
        const h = g.R - g.t - g.u * 8, len = g.R * 0.22, w = Math.max(1, g.t * 0.22);
        bracket(ctx, g.cx - h, g.cy - h, 1, 1, len, w, c.accent);
        bracket(ctx, g.cx + h, g.cy - h, -1, 1, len, w, c.accent);
        bracket(ctx, g.cx - h, g.cy + h, 1, -1, len, w, c.accent);
        bracket(ctx, g.cx + h, g.cy + h, -1, -1, len, w, c.accent);
      },
    },
    // plain sharp-cornered square + an inner accent square
    box: {
      shape: 'box',
      draw(ctx, g, c) {
        band(ctx, g, 'box', 0, g.t, c.main);
        band(ctx, g, 'box', g.t + g.u * 5, g.t + g.u * 5 + hair(g), c.accent);
      },
    },
    // augmented-ui clipped panel with accent brackets on the square corners
    clip: {
      shape: 'clip',
      draw(ctx, g, c) {
        band(ctx, g, 'clip', 0, g.t, c.main);
        const h = g.R - g.t - g.u * 8, len = g.R * 0.26, w = Math.max(1, g.t * 0.28);
        bracket(ctx, g.cx + h, g.cy - h, -1, 1, len, w, c.accent);
        bracket(ctx, g.cx - h, g.cy + h, 1, -1, len, w, c.accent);
      },
    },
    // hexagon with accent vertex nodes
    hex: {
      shape: 'hex',
      draw(ctx, g, c) {
        band(ctx, g, 'hex', 0, g.t, c.main);
        const rv = g.R - (g.t / 2) / Math.cos(Math.PI / 6);
        polyPts(6, POLY.hex.a0, g.cx, g.cy, rv).forEach(([x, y]) => dot(ctx, x, y, g.t * 0.42, c.accent));
      },
    },
    // octagon with an inner accent line
    octa: {
      shape: 'octa',
      draw(ctx, g, c) {
        band(ctx, g, 'octa', 0, g.t, c.main);
        band(ctx, g, 'octa', g.t + g.u * 5, g.t + g.u * 5 + hair(g), c.accent);
      },
    },
    // diamond with accent vertex nodes
    diamond: {
      shape: 'diamond',
      draw(ctx, g, c) {
        band(ctx, g, 'diamond', 0, g.t, c.main);
        const rv = g.R - (g.t / 2) / Math.cos(Math.PI / 4);
        polyPts(4, POLY.diamond.a0, g.cx, g.cy, rv).forEach(([x, y]) => dot(ctx, x, y, g.t * 0.5, c.accent));
      },
    },
    // no frame — just the round cut-out
    none: { shape: 'circle', draw() {} },
  };
  EIDOLON.frames = FRAMES;
  EIDOLON.frameOrder = ['ring', 'double', 'segment', 'glitch', 'circuit', 'square', 'box', 'clip', 'hex', 'octa', 'diamond', 'none'];
})(window.EIDOLON);
