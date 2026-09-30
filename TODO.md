# TODO

Pending issues, features, and ideas for EIDOLON.
Items are removed from the list once they are implemented / resolved (no archive section).

## BIG (Y version bump)

1. Touch support for the stage: pinch-zoom / two-finger rotate (pointer drag
   already pans on touch).

## SMALL (Z version bump)

1. Center referense lines
2. Make accent color disabled by default
3. Saved files' names
4. Default character / example presets
5. Per-language SEO URLs: read `?lang=xx` on load (overrides the saved
   language), add `<link rel="alternate" hreflang>` for all 8 languages +
   `x-default`, per-language `<loc>` entries in `sitemap.xml`, and a matching
   canonical per variant, so crawlers index the localized title/description
   (`seo_title` / `seo_desc`) instead of only the EN head.
