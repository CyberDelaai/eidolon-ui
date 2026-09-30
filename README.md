# EIDOLON

A free, in-browser **token / avatar maker for TTRPG characters** — a tool in the
[cyberdeck.tools](https://cyberdeck.tools/) family (COMMLINK · CHRONOS · GRIDMAP · ATLAS).

Build cyberpunk-styled character tokens for your virtual tabletop and export them
as PNG. No build step, no backend — just open `index.html`. Everything runs
client-side; your images are never uploaded.

## Features

- **Any source** — drop files, paste from the clipboard (Ctrl+V), load several at
  once, drag an image straight from another tab, or fetch it by URL (when the host
  allows CORS).
- **Roster** — every loaded image becomes its own token with its own framing,
  colour adjustments, name and badge. Click a thumbnail to edit it; the roster,
  your custom frame/mask and all settings survive a reload (IndexedDB +
  localStorage, never uploaded).
- **Reference overlay** — a bar above the preview with person silhouettes (head &
  shoulders, close-up head, full body, profile) or your own reference image,
  laid over the token at adjustable opacity to line portraits up consistently,
  plus a **centre guides** toggle (a cross through the token centre) that
  combines with any of them.
  Preview only — it never appears in exported images.
- **Framing** — drag to pan, Ctrl+wheel to zoom (around the cursor), Shift+wheel to
  rotate, mirror (around the token centre, so the framing stays put), arrow keys to nudge, `[` `]` to rotate, `0` to reset.
- **12 procedural frames** — RING, DOUBLE, SEGMENT, GLITCH, CIRCUIT, SQUARE,
  BOX, CLIP (augmented-ui corners), HEX, OCTA, DIAMOND, NONE. Vector-drawn, so they
  stay crisp at any size, tinted with a **frame** + optional **accent** colour (ON/OFF, off by default, quick
  palette, swap), adjustable **thickness**, **opacity** and neon **glow** (INNER / OUTER / ALL / OFF).
- **Custom frame & mask** — upload a black & white transparent PNG frame (tinted
  like the built-ins; white tint keeps its colours) and/or a greyscale mask
  (white keeps, black cuts) for any cut-out shape.
- **Background** — solid colour, EXTEND (the portrait's edges stretched and
  blurred into the empty space, like GRIDMAP's VIBRANT fill), or transparent.
- **Adjustments** — per-token brightness / contrast / saturation / hue.
- **Labels** — the token's name as a clipped name PLATE or ARC text, and a corner
  **badge** (number / letter) at any corner. Plate, name text, badge and badge
  text colours each take the frame / accent / background colour or a custom
  one (badge text can also pick dark or light automatically for contrast).
- **Pop-out brush** — per token: PAINT POP-OUT, then paint over whatever should
  break out over the frame (a head, horns, a blade) — works on any portrait, no
  background removal needed. While painting, a faint ghost shows the part of
  the portrait hidden outside the frame; PAINT / ERASE, brush size, FILL and
  CLEAR. Or LOAD POP-OUT a ready mask image (white / opaque breaks out, black /
  transparent stays in), then touch it up with the brush. The mask follows pan / zoom / rotate / mirror and is saved per token.
- **Margin** — 0% (the token fills the whole image) up to 10% empty space on
  each side.
- **FX** — a second slide-out tab with a master switch and stackable effects,
  each with its own settings: TONE (MONO / NEON gradient-map / HOLO, with mix),
  GLITCH (amount + reroll seed), RGB SPLIT, GRAIN, a tinted VIGNETTE and
  SCANLINES (strength + spacing). Shared by every token and saved with presets.
- **Presets** — a slide-out PRESETS tab on the left edge: name the current look
  (ENEMIES, PCs, NPCs…) and save it, then re-apply it in one click. Presets hold
  the global look (frame, colours, glow, margin, background, label and badge
  style, and all EFFECTS — optionally the output settings too), never portraits, names or
  badges. Each card shows a live mini-token; overwrite, delete, and EXPORT /
  IMPORT all presets as JSON to share them. Read-only **example presets** (PC,
  NPC, ENEMY, BOSS, NETRUNNER) are built in; SHOW EXAMPLES hides them. An
  example is a whole demo token: after a warning, APPLY replaces the selected
  token's picture, framing, name and badge with the C-DOGGO dressed in that
  look (ENEMY: red badge 8), and its thumbnail shows exactly that.
- **Starter token** — on the very first run the roster starts with the C-DOGGO
  (`examples/`, with a ready pop-out mask for its ears) dressed as the ENEMY
  example; CLEAR pulses until you change anything, clear it or load your own
  images. Delete it
  and it stays gone (applying an example preset brings it back on purpose).
- **Export** — PNG or WebP at 256 / 280 (Roll20) / 400 (Foundry) / 512 / 1024 /
  2048 px, copy to clipboard, and a **BATCH EXPORT** dialog: **export all**
  tokens as one ZIP, or a **numbered
  set** (the same token ×N with badges 1…N — minions, mooks) as a ZIP.
- **File names that never clash** — `token_<name>_<id>_<preset>_b<badge>_<size>.png`,
  e.g. `token_ghost-runner_a3f9c2_enemies_b03_280.png`. The `<id>` is a 6-character
  fingerprint of the source image, so tokens from different portraits never
  overwrite each other, and re-exporting the same one replaces its own file.
  Parts with nothing to say are left out: no name, no matching saved preset, or no
  badge. Search `token_` for every export, the name for one character, or the id
  for every export of one portrait. Batch ZIPs are timestamped
  (`tokens_20260930-1542_280.zip`).
- **8 interface languages** — EN / RU / FR / DE / ES / IT / JP / CN.

## Running

Open `index.html` in any modern browser, or serve the folder:

```
python3 -m http.server 8766
```

## Versioning

`X.Y.Z`, bumped with the helper script (keeps all three in-file version spots
in sync — the line-1 comment, the `#tagVersion` span, and the `VER` constant):

```
python3 bump_version.py {x|y|z}
```

## Built with

- [augmented-ui](https://augmented-ui.com/) — clipped/beveled cyberpunk panel styling
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — UI typeface

## Support

If you find these tools useful, you can support development here: [boosty.to/cyberdelaai/donate](https://boosty.to/cyberdelaai/donate)

## License

[MIT](LICENSE) © 2026 CyberDelaai
