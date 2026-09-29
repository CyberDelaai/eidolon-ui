# TODO

Pending issues, features, and ideas for EIDOLON.
Items are removed from the list once they are implemented / resolved (no archive section).

## BIG (Y version bump)

1. Touch support for the stage: pinch-zoom / two-finger rotate (pointer drag
   already pans on touch).
2. Portrait FX as its own UI element (was a single // FX dropdown, removed for
   now): MONO / NEON gradient-map / HOLO projection / GLITCH RGB-split, with
   more functionality — per-effect parameters (intensity, colours, glitch seed),
   stacking several effects, live thumbnails of each effect. Hook point:
   `portraitLayer()` in `js/render.js` (pixel pass on the U layer).
3. Pop-out currently needs a transparent-background PNG; consider a brush to
   paint which part of an opaque portrait breaks out of the frame.

## SMALL (Z version bump)

1. Add `eidolon_thumbnail.png` (1200×630) for the og:image / twitter:image social previews.
2. Confirm the tagline (`tag` / `tag_alt` in `js/i18n.js`) — currently placeholder copy.
3. Add EIDOLON to the logo tool-switcher menu in the sibling apps (COMMLINK,
   CHRONOS, GRIDMAP, ATLAS).
