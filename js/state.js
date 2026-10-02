// EIDOLON shared namespace + tiny DOM helper. Loaded first; every other
// module attaches to window.EIDOLON.
window.EIDOLON = window.EIDOLON || {};
EIDOLON.$ = (id) => document.getElementById(id);

// Constants shared across modules.
EIDOLON.const = {
  EXPORT_SIZE: 512,    // default exported token edge, in px
  MAX_SOURCE: 2048,    // loaded images are downscaled to this longest edge
  PREVIEW_MAX: 560,    // max CSS size of the stage preview canvas
};

// Silent localStorage setter — blocked storage (private mode, file:// quirks)
// must never break the app.
EIDOLON.save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

// Default FX settings (the FX side panel). Shared by every token, saved with presets.
EIDOLON.newFx = () => ({
  on: false,                                   // master switch
  tone: 'none', toneMix: 100,                  // 'none' | 'mono' | 'neon' | 'holo', mix %
  glitch: false, glitchAmt: 40, glitchSeed: 1, // displaced horizontal slices
  rgb: false, rgbAmt: 4,                       // RGB channel split, px at 512
  grain: false, grainAmt: 25,                  // film grain %
  vig: false, vigColor: '#000000', vigAmt: 60, // vignette (tinted), %
  scan: false, scanAmt: 30, scanGap: 4,        // scanlines: strength %, spacing px at 512
});

// Default per-token image transform / adjustments (each roster item gets a copy).
EIDOLON.newTransform = () => ({ x: 0, y: 0, zoom: 1, rot: 0, flip: false });
EIDOLON.newAdjust = () => ({ bright: 100, contrast: 100, sat: 100, hue: 0 });

// ---- Working-area state: the single source of mutable state. Every module
// aliases it as `const S = EIDOLON.state;` and reads/writes S.<field>.
// Persisted fields live in localStorage under `eidolon:*` keys; when you add
// one, add its default here AND a restore line in js/app.js. ----
EIDOLON.state = {
  lang: 'en', // UI language (persisted as eidolon:lang by js/i18n.js)

  // -- style: global look shared by every token (persisted as eidolon:style) --
  style: {
    frame: 'ring',          // key into EIDOLON.frames (or 'custom')
    frameColor: '#00f0ff',  // main frame tint
    accent: false,          // draw the accent details at all (off by default)
    accentColor: '#fcee0a', // secondary tint (ticks, nodes, badge)
    thickness: 8,           // frame thickness, % of the outer radius
    margin: 4,              // empty space on each side, % of the token edge (0 = full bleed, max 10)
    frameOpacity: 100,      // %
    glow: 'all',            // neon bloom: 'inner' | 'outer' | 'all' | 'off'
    bgMode: 'color',        // 'color' | 'extend' | 'transparent'
    bgColor: '#0b0b10',
    labelOn: false,         // draw the name label at all
    labelStyle: 'plate',    // 'plate' | 'arc'
    // label + badge colours: *From picks the source — 'frame' | 'accent' | 'bg'
    // | 'custom' (then *Color is used) | 'auto' (badge text: dark or light for contrast)
    plateFrom: 'frame', plateColor: '#00f0ff',        // name plate / arc band fill
    labelFrom: 'custom', labelColor: '#050507',       // name text
    badgeFrom: 'accent', badgeColor: '#fcee0a',       // badge disc
    badgeTextFrom: 'auto', badgeTextColor: '#050507', // badge text
    badgeOn: true,          // draw the badge at all
    badgePos: 'br',         // 'tl' | 'tr' | 'bl' | 'br'
  },

  // -- FX: effects over the portrait / cut-out (persisted as eidolon:fx) --
  fx: EIDOLON.newFx(),

  // -- reference overlay: preview-only guide, never exported (persisted as eidolon:ref) --
  ref: { kind: 'off', opacity: 40, guides: false }, // kind: 'off' | EIDOLON.refOrder key | 'custom'; guides = centre lines

  // -- output prefs (persisted as eidolon:out) --
  out: { size: 512, format: 'png', setCount: 4 },

  // -- roster: one entry per loaded image (persisted in IndexedDB) --
  // { id, name, blob, src (canvas), tf: newTransform(), adj: newAdjust(), label, badge,
  //   popOn, popMask (canvas in the image's pixel space, ≤512 px — the pop-out brush) }
  items: [],
  current: -1,              // index into items, -1 = empty

  // -- custom assets (persisted in IndexedDB) --
  customFrame: null,        // source canvas of the uploaded frame PNG
  customMask: null,         // alpha-mask canvas derived from the uploaded mask
  customRef: null,          // source canvas of the uploaded reference image
};
