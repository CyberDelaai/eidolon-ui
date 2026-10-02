(function (EIDOLON) {
  'use strict';
  // ---- Reference overlay: a framing guide drawn over the stage preview only.
  // It lives on its own canvas stacked on the preview and never goes through
  // EIDOLON.render, so it can't reach the exported image or roster thumbnails.
  //
  // Silhouettes are SVG path strings in a 200×200 box centred on the token
  // (-100..100 = the frame's outer radius), so one definition draws both the
  // picker icon (<svg>) and the overlay (Path2D, scaled to the frame). ----
  const S = EIDOLON.state;

  const CIRCLE = (cx, cy, r) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  const ELLIPSE = (cx, cy, rx, ry) => `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;

  const SHAPES = {
    // head & shoulders — the classic token framing
    bust: CIRCLE(0, -30, 32) +
      ' M -15 -2 L 15 -2 L 17 14 C 50 20 78 34 84 70 L 92 100 L -92 100 L -84 70 C -78 34 -50 20 -17 14 Z',
    // close-up: the face fills the token
    head: ELLIPSE(0, -12, 50, 62) +
      ' M -24 40 L 24 40 L 28 66 C 58 74 80 88 86 100 L -86 100 C -80 88 -58 74 -28 66 Z',
    // full figure standing inside the token
    body: CIRCLE(0, -70, 14) +
      ' M -11 -54 L 11 -54 L 13 -48 L 31 -42 L 40 -2 L 31 1 L 24 -28 L 20 -26 L 21 10 L 17 92 L 4 92 L 0 24' +
      ' L -4 92 L -17 92 L -21 10 L -20 -26 L -24 -28 L -31 1 L -40 -2 L -31 -42 L -13 -48 Z',
    // side view, facing right
    profile: 'M -40 -62 C -10 -88 42 -78 50 -36 L 54 -20 L 66 -6 L 55 0 L 57 10 L 50 14 L 52 25' +
      ' C 48 35 32 35 22 33 L 20 50 C 50 58 76 72 84 100 L -82 100 C -78 72 -62 58 -40 48 C -60 30 -66 -30 -40 -62 Z',
  };
  EIDOLON.refShapes = SHAPES;
  EIDOLON.refOrder = ['bust', 'head', 'body', 'profile'];

  const cache = {};
  const path2d = (k) => cache[k] || (cache[k] = new Path2D(SHAPES[k]));

  // Draw the current reference onto the overlay canvas (N×N device px),
  // clipped to the token's cut-out like the portrait is.
  EIDOLON.drawReference = function drawReference(ctx, N) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, N, N);
    const kind = S.ref.kind, a = S.ref.opacity / 100;
    if (a <= 0) return;
    if (kind === 'custom' && S.customRef) {
      ctx.globalAlpha = a;
      ctx.drawImage(S.customRef, 0, 0, N, N); // same square as the exported image
      ctx.globalAlpha = 1; // custom art is shown whole (it may include its own frame)
    } else if (SHAPES[kind]) {
      drawShape(ctx, N, kind, a);
    }
    if (S.ref.guides !== 'off') drawGuides(ctx, N, a, S.ref.guides);
  };

  function drawShape(ctx, N, kind, a) {
    const g = EIDOLON.geom(N), k = g.R / 100;
    ctx.save();
    ctx.translate(g.cx, g.cy); ctx.scale(k, k);
    const p = path2d(kind);
    ctx.fillStyle = `rgba(0,240,255,${a * 0.55})`;
    ctx.fill(p);
    ctx.lineWidth = 1.6 / k * (N / 512); ctx.setLineDash([6 / k * (N / 512), 4 / k * (N / 512)]);
    ctx.strokeStyle = `rgba(232,232,238,${Math.min(1, a * 1.4)})`;
    ctx.stroke(p);
    ctx.restore();
    EIDOLON.applyCutout(ctx, N);
  }

  // Guides, drawn over (not clipped by) the cut-out, spanning the frame's box:
  // 'cross' = a dashed cross through the token centre with a small ring on the
  // centre point; 'grid' = the camera-app rule-of-thirds grid (2 + 2 lines).
  function drawGuides(ctx, N, a, mode) {
    const g = EIDOLON.geom(N), u = g.u, R = g.R;
    ctx.save();
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = `rgba(0,240,255,${Math.min(1, a * 1.6)})`;
    ctx.setLineDash([8 * u, 5 * u]);
    ctx.beginPath();
    const offs = mode === 'grid' ? [-R / 3, R / 3] : [0];
    offs.forEach((o) => {
      ctx.moveTo(g.cx + o, g.cy - R); ctx.lineTo(g.cx + o, g.cy + R);
      ctx.moveTo(g.cx - R, g.cy + o); ctx.lineTo(g.cx + R, g.cy + o);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (mode === 'cross') { ctx.beginPath(); ctx.arc(g.cx, g.cy, 6 * u, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
})(window.EIDOLON);
