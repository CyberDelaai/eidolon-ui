#!/usr/bin/env python3
"""Generate this tool's per-language pages: ru/, fr/, de/, es/, it/, ja/, zh/.

Search engines only see the HTML they're served, so a UI translated by JS
after load is invisible to them. Each language gets its own URL instead:
/<tool>/<lang>/index.html is a copy of index.html with

  - <html lang> + data-url-lang (the i18n code pins the UI language to it)
  - a translated <title>, meta description and og/twitter title + description
  - its own canonical / og:url / og:locale and the JSON-LD "url"
  - relative asset paths prefixed with ../ (no <base>: it would break
    fragment references like url(#…) SVG filters)

It also keeps the hreflang block in index.html in sync, rewrites sitemap.xml
with every language URL + xhtml:link alternates, and does the same for this
tool's entries in the hub's ../cyberdeck-tools/sitemap.xml (when present).

index.html (English) is the only source: NEVER edit the generated folders.
bump_version.py runs this script after every bump; run it by hand after any
other index.html change:

    python make_langs.py
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOL = "eidolon-ui"
BASE = f"https://cyberdeck.tools/{TOOL}/"
INDEX = ROOT / "index.html"
SITEMAP = ROOT / "sitemap.xml"
HUB_SITEMAP = ROOT.parent / "cyberdeck-tools" / "sitemap.xml"

LANGS = ["en", "ru", "fr", "de", "es", "it", "ja", "zh"]
LOCALES = {"en": "en_US", "ru": "ru_RU", "fr": "fr_FR", "de": "de_DE",
           "es": "es_ES", "it": "it_IT", "ja": "ja_JP", "zh": "zh_CN"}

# Search-result copy per language (English lives in index.html itself).
# title <= ~60 chars, desc <= ~160 (Google cuts longer ones); og_* feed both
# the Open Graph and the Twitter card tags.
SEO = {
    "ru": dict(
        title='EIDOLON — конструктор киберпанк-токенов для Roll20 и Foundry',
        desc='Бесплатный конструктор токенов для НРИ: 12 киберпанк-рамок, таблички с именем, номерные значки и глитч-эффекты, пакетный экспорт PNG-токенов для Roll20 и Foundry.',
        og_title='EIDOLON — конструктор киберпанк-токенов',
        og_desc='Превратите любой портрет в токен для VTT прямо в браузере: киберпанк-рамки, таблички, номерные значки, глитч и пакетный экспорт для Roll20 / Foundry.',
    ),
    "fr": dict(
        title='EIDOLON — Créateur de jetons JDR cyberpunk (Roll20, Foundry)',
        desc='Créateur de jetons JDR gratuit : 12 cadres cyberpunk, plaques de nom, badges numérotés et effets glitch, export de jetons PNG par lots pour Roll20 et Foundry.',
        og_title='EIDOLON — Créateur de jetons JDR cyberpunk',
        og_desc="Transformez n'importe quel portrait en jeton VTT dans votre navigateur : cadres cyberpunk, plaques de nom, badges, glitch et export par lots pour Roll20 / Foundry.",
    ),
    "de": dict(
        title='EIDOLON — Cyberpunk-Token-Ersteller für Roll20 und Foundry',
        desc='Kostenloser Token-Ersteller für Rollenspiele: 12 Cyberpunk-Rahmen, Namensschilder, nummerierte Abzeichen, Glitch-Effekte und PNG-Stapelexport für Roll20 und Foundry.',
        og_title='EIDOLON — Cyberpunk-Token-Ersteller',
        og_desc='Verwandle jedes Porträt im Browser in ein VTT-Token: Cyberpunk-Rahmen, Namensschilder, Abzeichen, Glitch und Stapel-Export für Roll20 / Foundry.',
    ),
    "es": dict(
        title='EIDOLON — Creador de tokens cyberpunk para Roll20 y Foundry',
        desc='Creador de tokens gratuito: 12 marcos cyberpunk, placas de nombre, insignias numeradas y efectos glitch, exportación PNG por lotes para Roll20 y Foundry.',
        og_title='EIDOLON — Creador de tokens cyberpunk',
        og_desc='Convierte cualquier retrato en un token para VTT en tu navegador: marcos cyberpunk, placas de nombre, insignias, glitch y exportación por lotes para Roll20 / Foundry.',
    ),
    "it": dict(
        title='EIDOLON — Creatore di token cyberpunk per Roll20 e Foundry',
        desc='Creatore di token per GDR gratuito: 12 cornici cyberpunk, targhette col nome, badge numerati ed effetti glitch, esportazione PNG in blocco per Roll20 e Foundry.',
        og_title='EIDOLON — Creatore di token cyberpunk',
        og_desc='Trasforma qualsiasi ritratto in un token VTT nel browser: cornici cyberpunk, targhette, badge, glitch ed esportazione in blocco per Roll20 / Foundry.',
    ),
    "ja": dict(
        title='EIDOLON — サイバーパンク風 TRPG トークンメーカー（Roll20・Foundry）',
        desc='TRPG キャラクターのトークンを無料で作成。12種のサイバーパンク風フレーム、名前プレート、番号バッジ、グリッチ効果に対応し、Roll20・Foundry 向けに PNG を一括書き出しできます。',
        og_title='EIDOLON — サイバーパンク風トークンメーカー',
        og_desc='ブラウザで肖像画を VTT 用トークンに。サイバーパンク風フレーム、名前プレート、バッジ、グリッチ、Roll20 / Foundry 向け一括書き出し。',
    ),
    "zh": dict(
        title='EIDOLON — 赛博朋克 TRPG 令牌制作器（Roll20 / Foundry）',
        desc='免费的 TRPG 角色令牌制作器：12 种赛博朋克边框、名字铭牌、编号徽标与故障特效，可批量导出 PNG 令牌用于 Roll20 和 Foundry。',
        og_title='EIDOLON — 赛博朋克令牌制作器',
        og_desc='在浏览器中把任意头像变成 VTT 令牌：赛博朋克边框、名字铭牌、徽标、故障特效，批量导出用于 Roll20 / Foundry。',
    ),
}

HREFLANG_START = "<!-- hreflang: generated by make_langs.py -->"
HREFLANG_END = "<!-- /hreflang -->"
GENERATED = "<!-- GENERATED by make_langs.py from ../index.html — edit index.html, then re-run -->"


def url(lang):
    return BASE if lang == "en" else f"{BASE}{lang}/"


def esc(s):
    return html.escape(s, quote=True)


def sub1(text, pattern, repl, what):
    text, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        sys.exit(f"error: {what} not found in index.html")
    return text


def set_meta(text, attr, name, value):
    return sub1(text, rf'(<meta {attr}="{re.escape(name)}" content=")[^"]*(" />)',
                lambda m: m.group(1) + esc(value) + m.group(2), f"{attr}={name}")


def hreflang_block():
    links = [f'<link rel="alternate" hreflang="{l}" href="{url(l)}" />' for l in LANGS]
    links.append(f'<link rel="alternate" hreflang="x-default" href="{BASE}" />')
    return "\n".join([HREFLANG_START, *links, HREFLANG_END])


def with_hreflang(text):
    block = hreflang_block()
    if HREFLANG_START in text:
        return re.sub(re.escape(HREFLANG_START) + r".*?" + re.escape(HREFLANG_END), lambda m: block, text, flags=re.S)
    return sub1(text, r'(<link rel="canonical" href="[^"]*" />\n)', lambda m: m.group(1) + block + "\n", "canonical")


def prefix_paths(text):
    """../ before relative src / href attributes. Inside a <script> block only
    the opening tag is touched (its src=), so template strings in the inline
    JS are left alone."""
    rel = re.compile(r'(\s(?:src|href)=")(?!https?:|data:|#|/|mailto:|javascript:|\.\./)([^"]+")')

    def fix(part):
        if not part.startswith("<script"):
            return rel.sub(r"\1../\2", part)
        tag_end = part.index(">") + 1
        return rel.sub(r"\1../\2", part[:tag_end]) + part[tag_end:]

    return "".join(fix(p) for p in re.split(r"(<script\b.*?</script>)", text, flags=re.S))


def localize(src, lang):
    t, s = SEO[lang], src
    s = sub1(s, r"\n", "\n" + GENERATED + "\n", "first line")  # right after the version comment
    s = sub1(s, r'<html lang="en">', f'<html lang="{lang}" data-url-lang="{lang}">', '<html lang="en">')
    s = sub1(s, r"<title>[^<]*</title>", lambda m: f"<title>{esc(t['title'])}</title>", "<title>")
    s = set_meta(s, "name", "description", t["desc"])
    s = set_meta(s, "property", "og:title", t["og_title"])
    s = set_meta(s, "property", "og:description", t["og_desc"])
    s = set_meta(s, "name", "twitter:title", t["og_title"])
    s = set_meta(s, "name", "twitter:description", t["og_desc"])
    s = set_meta(s, "property", "og:url", url(lang))
    s = sub1(s, r'(<link rel="canonical" href=")[^"]*(" />)', lambda m: m.group(1) + url(lang) + m.group(2), "canonical")
    locales = [f'<meta property="og:locale" content="{LOCALES[lang]}" />'] + [
        f'<meta property="og:locale:alternate" content="{LOCALES[l]}" />' for l in LANGS if l != lang]
    block = re.compile(r'<meta property="og:locale" content="[^"]*" />\n(?:<meta property="og:locale:alternate" content="[^"]*" />\n)*')
    if block.search(s):
        s = block.sub(lambda m: "\n".join(locales) + "\n", s, count=1)
    else:  # no og:locale block in index.html: add one after og:url
        s = sub1(s, r'(<meta property="og:url" content="[^"]*" />\n)', lambda m: m.group(1) + "\n".join(locales) + "\n", "og:url")
    s = sub1(s, rf'("url": "){re.escape(BASE)}(")', lambda m: m.group(1) + url(lang) + m.group(2), 'JSON-LD "url"')
    return prefix_paths(s)


def url_entries(lastmod, priority_en, priority_lang, indent="  "):
    alts = "".join(f'\n{indent}  <xhtml:link rel="alternate" hreflang="{l}" href="{url(l)}" />' for l in LANGS)
    alts += f'\n{indent}  <xhtml:link rel="alternate" hreflang="x-default" href="{BASE}" />'
    out = []
    for l in LANGS:
        out.append(f"{indent}<url>\n{indent}  <loc>{url(l)}</loc>\n{indent}  <lastmod>{lastmod}</lastmod>\n"
                   f"{indent}  <changefreq>weekly</changefreq>\n{indent}  <priority>{priority_en if l == 'en' else priority_lang}</priority>"
                   f"{alts}\n{indent}</url>\n")
    return "".join(out)


URLSET_OPEN = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'


def write_tool_sitemap(lastmod):
    SITEMAP.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + URLSET_OPEN + "\n"
                       + url_entries(lastmod, "1.0", "0.9") + "</urlset>\n", encoding="utf-8")


def update_hub_sitemap(lastmod):
    if not HUB_SITEMAP.exists():
        print(f"note: {HUB_SITEMAP} not found, hub sitemap skipped")
        return
    text = HUB_SITEMAP.read_text(encoding="utf-8")
    blocks = list(re.finditer(r"  <url>\n.*?\n  </url>\n", text, flags=re.S))
    mine = [b for b in blocks if re.search(rf"<loc>{re.escape(BASE)}", b.group(0))]
    if not mine:
        print(f"note: {BASE} is not listed in the hub sitemap, skipped")
        return
    prio = re.search(r"<priority>([^<]+)</priority>", mine[0].group(0))
    p_en = prio.group(1) if prio else "0.8"
    p_lang = f"{max(0.1, float(p_en) - 0.1):.1f}"
    new = url_entries(lastmod, p_en, p_lang)
    out, pos = [], 0
    for i, b in enumerate(mine):
        out.append(text[pos:b.start()])
        if i == 0:
            out.append(new)
        pos = b.end()
    out.append(text[pos:])
    text = "".join(out)
    text = re.sub(r"<urlset[^>]*>", URLSET_OPEN, text, count=1)
    HUB_SITEMAP.write_text(text, encoding="utf-8")
    print("sitemap: cyberdeck-tools/sitemap.xml updated (commit the hub repo too)")


def main():
    for lang, t in SEO.items():
        for k, limit in (("title", 60), ("desc", 165)):
            if len(t[k]) > limit:
                print(f"warning: {lang} {k} is {len(t[k])} chars (> {limit})")

    src = with_hreflang(INDEX.read_text(encoding="utf-8"))
    INDEX.write_text(src, encoding="utf-8")
    for lang in LANGS[1:]:
        out = ROOT / lang / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(localize(src, lang), encoding="utf-8")
    m = re.search(r'"dateModified": "([^"]+)"', src)
    lastmod = m.group(1) if m else __import__("datetime").date.today().isoformat()
    write_tool_sitemap(lastmod)
    update_hub_sitemap(lastmod)
    print(f"langs: wrote {', '.join(l + '/' for l in LANGS[1:])} (lastmod {lastmod})")


if __name__ == "__main__":
    main()
