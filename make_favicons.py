#!/usr/bin/env python3
"""Render EIDOLON raster favicons (favicon.ico + favicon-192.png) to match
favicon.svg — a glowing yellow round character token (ring + bust) on black.

No SVG renderer is available on this box, so the geometry from favicon.svg is
reproduced directly with Pillow (drawn supersampled, then downscaled for
antialiasing). Re-run if favicon.svg's shapes change.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent
YELLOW = (252, 238, 10)          # #fcee0a
BLACK = (0, 0, 0)
BASE = 64                        # SVG viewBox is 64x64
SS = 16                          # supersample factor -> 1024px master
N = BASE * SS
SW = 3 * SS                      # stroke-width 3 in SVG units


def s(v):
    return v * SS


def round_line(draw, x0, y0, x1, y1, width, fill):
    """A line with round caps (Pillow's line caps are square)."""
    draw.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=fill, width=width)
    r = width / 2
    for (cx, cy) in ((x0, y0), (x1, y1)):
        draw.ellipse([s(cx) - r, s(cy) - r, s(cx) + r, s(cy) + r], fill=fill)


def stroke_ellipse(draw, cx, cy, rx, ry, width, fill):
    draw.ellipse([s(cx - rx), s(cy - ry), s(cx + rx), s(cy + ry)],
                 outline=fill, width=width)


def draw_glyph():
    """Draw the yellow glyph on a transparent RGBA master."""
    f = YELLOW + (255,)
    # Bust (head + shoulders) on its own layer so it can be clipped to the
    # token circle: the shoulder arc would otherwise poke out past the ring.
    inner = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    di = ImageDraw.Draw(inner)
    stroke_ellipse(di, 32, 27, 6.5, 6.5, SW, f)            # head
    # shoulders: quadratic curve M17 52 Q17 38 32 38 Q47 38 47 52
    pts = []
    for (p0, p1, p2) in (((17, 52), (17, 38), (32, 38)), ((32, 38), (47, 38), (47, 52))):
        for i in range(41):
            t = i / 40
            x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
            pts.append((x, y))
    for a, b in zip(pts, pts[1:]):
        round_line(di, a[0], a[1], b[0], b[1], SW, f)
    # clip the bust to the token circle (r=19 centreline)
    mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(mask).ellipse([s(32 - 19), s(32 - 19), s(32 + 19), s(32 + 19)], fill=255)
    inner.putalpha(ImageChops.darker(inner.split()[3], mask))
    # outer token ring drawn on top (not clipped)
    do = ImageDraw.Draw(inner)
    stroke_ellipse(do, 32, 32, 19, 19, SW, f)
    return inner


def compose(size):
    glyph = draw_glyph()
    # Flatten the yellow glyph onto black so the glow source is a bright RGB
    # image we can bloom additively.
    glyph_rgb = Image.alpha_composite(
        Image.new("RGBA", (N, N), BLACK + (255,)), glyph).convert("RGB")

    # GLOW: stack blurred copies with *additive* (screen) blending so the halo
    # actually brightens the black background — mimicking the SVG feGaussianBlur
    # merge (radii ~6/3/1.2 SVG units, replicated for a strong soft bloom).
    glow = Image.new("RGB", (N, N), BLACK)
    for radius, gain in ((8 * SS, 1.0), (4 * SS, 1.0), (2 * SS, 0.9), (1 * SS, 0.8)):
        blur = glyph_rgb.filter(ImageFilter.GaussianBlur(radius))
        if gain != 1.0:
            blur = blur.point(lambda p: int(p * gain))
        glow = ImageChops.screen(glow, blur)

    # crisp glyph on top of the bloom
    canvas = ImageChops.lighter(glow, glyph_rgb)
    out = canvas.resize((size, size), Image.LANCZOS)
    return out


def main():
    png = compose(192)
    png.save(ROOT / "favicon-192.png", "PNG")
    print("wrote favicon-192.png (192x192)")

    ico_master = compose(256)
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_master.save(ROOT / "favicon.ico", format="ICO", sizes=sizes)
    print("wrote favicon.ico", sizes)


if __name__ == "__main__":
    main()
