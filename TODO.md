# TODO

Pending issues, features, and ideas for EIDOLON.
Items are removed from the list once they are implemented / resolved (no archive section).

## BIG (Y version bump)

1. Touch support for the stage: pinch-zoom / two-finger rotate (pointer drag
   already pans on touch).
2. Portrait FX as its own UI element / section (a single // FX dropdown plus
   OVERLAY + SCANLINES rows were removed for now): MONO / NEON gradient-map /
   HOLO projection / GLITCH RGB-split, a tinted vignette OVERLAY (colour +
   strength) and SCANLINES, with more functionality — per-effect parameters
   (intensity, colours, glitch seed, scanline density), stacking several
   effects, live thumbnails of each effect. Hook points: `portraitLayer()`
   (pixel pass on the U layer) and `cutoutLayer()` (overlays drawn
   `source-atop` before the clip) in `js/render.js`.
3. Pop-out currently needs a transparent-background PNG; consider a brush to
   paint which part of an opaque portrait breaks out of the frame.

## SMALL (Z version bump)

1. Confirm the tagline (`tag` / `tag_alt` in `js/i18n.js`) — currently placeholder copy.
