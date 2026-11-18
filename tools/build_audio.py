#!/usr/bin/env python3
"""Build the A1.1 Kursbuch audio page and its QR short links (DRAFT, noindex, not in the sitemap).

Source of truth: audio/a1-1/tracks.json (the track manifest). Edit that file, then run:
    python3 tools/build_audio.py                 # build pages from the manifest
    python3 tools/build_audio.py --placeholder   # (re)write a PLACEHOLDER manifest first, then build

Writes:
    audio/a1-1/index.html        the track list, one <audio preload="none"> player per track
    audio/a1-1/<track-id>/index.html   one stable QR stub per track (JS location.replace + noscript refresh)

Track-id scheme (lower case, URL-safe, never reused once printed in a QR code):
    main tracks  <lektion>-<nn>   e.g. 1-01, 1-02 ... 7-16   (Lektion number, two-digit track within it)
    extras       x<nn>            e.g. x01 ... x15
    If the real book numbers its tracks differently (e.g. "1.05" or a running 1-107), keep the ids
    matching the printed numbers so a student can type them, and set each entry's "id" in the manifest.

Hosting: audio lives as GitHub Release assets in a separate public repo. Change ASSET_BASE below once
(or give a track its own "url") to move hosts; every page and stub is regenerated from it.
Always link the stable github.com/.../releases/download/... URL, never the signed release-assets URL
it redirects to (that one expires).

QR_TARGET: 'page' (default) sends a scanned QR code to the track on the list page (#t-<id>).
'asset' would send it straight to the MP3, but GitHub serves release assets as
application/octet-stream + Content-Disposition: attachment, so a top-level visit DOWNLOADS the file
instead of playing it (checked in Chrome, Android Chrome emulation and WebKit/iPhone emulation).
"""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = 'https://www.deutschfuralle.com'
BASE_PATH = '/audio/a1-1/'
OUT = ROOT / 'audio' / 'a1-1'
MANIFEST = OUT / 'tracks.json'
TEMPLATE = ROOT / 'german-for-kids.html'   # header, nav, footer and <head> scripts are copied from this page

# ---- hosting: change here only -------------------------------------------------------------
ASSET_BASE = 'https://github.com/DFA-Official-Hub/audio-hosting-test/releases/download/v0-test/'
PLACEHOLDER_FILE = 'dfa-test-tone.mp3'   # generated test tone, NOT course audio
QR_TARGET = 'page'                       # 'page' (recommended) or 'asset'
# ---------------------------------------------------------------------------------------------

FONTS = ['archivo-var-latin.woff2', 'inter-var-latin.woff2', 'montserrat-800-brand.woff2']
ID_RE = re.compile(r'^(?:\d{1,2}-\d{2}|x\d{2})$')
esc = lambda s: html.escape(str(s), quote=True)


def placeholder_manifest():
    per_lesson = [15, 15, 15, 15, 15, 16, 16]          # 107 main tracks over 7 placeholder sections
    tracks = []
    for lesson, n in enumerate(per_lesson, 1):
        for i in range(1, n + 1):
            tracks.append({'id': f'{lesson}-{i:02d}', 'title': f'Placeholder track {lesson}.{i:02d}',
                           'section': f'Lektion {lesson} (placeholder)', 'isExtra': False, 'file': PLACEHOLDER_FILE})
    for i in range(1, 16):
        tracks.append({'id': f'x{i:02d}', 'title': f'Placeholder extra {i:02d}',
                       'section': 'Extras', 'isExtra': True, 'file': PLACEHOLDER_FILE})
    return {'_note': 'PLACEHOLDER DATA. Every entry points to a generated test tone, not course audio. '
                     'Replace with the real A1.1 track list before publishing.',
            'placeholder': True, 'tracks': tracks}


def url_of(t):
    return t.get('url') or ASSET_BASE + t['file']


def load():
    m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    seen = set()
    for t in m['tracks']:
        assert ID_RE.match(t['id']), f"bad track id {t['id']!r}"
        assert t['id'] not in seen, f"duplicate track id {t['id']}"
        assert t.get('url') or t.get('file'), f"track {t['id']} has no file or url"
        seen.add(t['id'])
    return m


def template_parts():
    s = TEMPLATE.read_text(encoding='utf-8')
    csp = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]*>', s).group(0)
    scripts = s[s.index('<script>'):s.index('<meta name="dfa:published"')]          # consent + GA4 + tracking
    header = s[s.index('<a class="skip"'):s.index('</header>') + len('</header>')]
    footer = s[s.index('<footer'):s.index('</body>')]
    css = (ROOT / 'assets' / 'style.min.css').read_text(encoding='utf-8').strip()
    pre = ''.join(f'<link rel="preload" href="/assets/fonts/{x}" as="font" type="font/woff2" crossorigin>' for x in FONTS)
    cssblock = f'<!--css-->{pre}<style>{css.replace("url(fonts/", "url(/assets/fonts/")}</style><!--/css-->'
    return csp, scripts, header, footer, cssblock


PAGE_CSS = """<style>
.au-note{background:#fff7e0;border:1px solid #e9c46a;color:#4a3b00;border-radius:12px;padding:12px 16px;margin:0 0 22px}
main nav ul.au-jump{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px;padding:0;list-style:none}
.au-jump a{display:inline-block;padding:6px 12px;border:1px solid #cfe0d3;border-radius:999px;text-decoration:none;color:#1d6f2b;font-weight:600;font-size:.92rem;background:#fff}
.au-jump a:focus-visible,.au-jump a:hover{background:#e7f3e8;outline:3px solid var(--g);outline-offset:2px}
.au-sec{margin:0 0 30px;scroll-margin-top:96px}
.au-list{list-style:none;margin:10px 0 0;padding:0;border:1px solid #dfe7e1;border-radius:14px;background:#fff;overflow:hidden}
.au-item{display:grid;grid-template-columns:4.2rem 1fr minmax(240px,320px);gap:6px 14px;align-items:center;padding:10px 16px;border-top:1px solid #e1ece3;scroll-margin-top:96px}
.au-item:first-child{border-top:0}
.au-item:nth-child(even){background:#f6faf7}
.au-num{font-family:Archivo,system-ui,sans-serif;font-weight:700;color:#1d6f2b;font-variant-numeric:tabular-nums}
.au-title{margin:0;font-weight:600;color:var(--ink)}
.au-item audio{width:100%;height:40px}
.au-item audio:focus-visible{outline:3px solid var(--g);outline-offset:2px;border-radius:20px}
.au-item:focus{outline:3px solid var(--g);outline-offset:-3px}
.au-item.is-target{background:#e3f4e5;box-shadow:inset 4px 0 0 #2b8a3e}
.au-help{color:#4b5a52}
.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media(max-width:640px){.au-item{grid-template-columns:3.4rem 1fr;padding:12px}.au-item audio{grid-column:1/-1}}
</style>"""

PAGE_JS = """<script>
(function(){
  var players=document.querySelectorAll('.au-item audio');
  // one track at a time
  players.forEach(function(a){a.addEventListener('play',function(){players.forEach(function(b){if(b!==a&&!b.paused)b.pause();});});});
  // a QR short link lands on #t-<id>: highlight that track and move keyboard focus to its player
  function target(){
    var id=decodeURIComponent(location.hash.slice(1));if(!/^t-/.test(id))return;
    var li=document.getElementById(id);if(!li)return;
    document.querySelectorAll('.au-item.is-target').forEach(function(x){x.classList.remove('is-target');});
    li.classList.add('is-target');li.setAttribute('tabindex','-1');
    li.scrollIntoView({block:'center'});li.focus({preventScroll:true});   // next Tab press lands on this track's player
  }
  window.addEventListener('hashchange',target);
  if(document.readyState==='complete')target();else window.addEventListener('load',function(){setTimeout(target,0);});
})();
</script>"""


def item(t):
    tid = esc(t['id']); title = esc(t['title'])
    return (f'<li class="au-item" id="t-{tid}"><span class="au-num" aria-hidden="true">{tid}</span>'
            f'<p class="au-title" id="lbl-{tid}"><span class="visually-hidden">Track {tid}: </span>{title}</p>'
            f'<audio controls preload="none" src="{esc(url_of(t))}" aria-labelledby="lbl-{tid}">'
            f'<a href="{esc(url_of(t))}">Download track {tid}</a></audio></li>')


def build_page(m):
    csp, scripts, header, footer, cssblock = template_parts()
    main, extras, order = {}, [], []
    for t in m['tracks']:
        if t.get('isExtra'): extras.append(t); continue
        if t['section'] not in main: main[t['section']] = []; order.append(t['section'])
        main[t['section']].append(t)
    secs = [(f's{i}', name, main[name]) for i, name in enumerate(order, 1)]
    if extras: secs.append(('extras', 'Extras', extras))
    jump = ''.join(f'<li><a href="#{sid}">{esc(name)}</a></li>' for sid, name, _ in secs)
    body = ''.join(
        f'<section class="au-sec" id="{sid}" aria-labelledby="h-{sid}"><h2 id="h-{sid}">{esc(name)}</h2>'
        + (f'<p class="au-help">{len(ts)} extra tracks that go with the book.</p>' if sid == 'extras' else '')
        + f'<ol class="au-list">{"".join(item(t) for t in ts)}</ol></section>'
        for sid, name, ts in secs)
    n_main = sum(len(v) for v in main.values())
    note = ('<p class="au-note" role="note"><strong>Draft preview.</strong> These are placeholder entries that all play '
            'the same test tone. The real A1.1 tracks will replace them.</p>') if m.get('placeholder') else ''
    title = 'A1.1 Kursbuch Audio – Deutsch Für Alle'
    desc = 'Listen to the A1.1 coursebook audio online: every track with its own player, plus the extras.'
    head = (f'<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">{csp}\n{scripts}'
            f'<meta name="robots" content="noindex"><meta name="referrer" content="strict-origin-when-cross-origin">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{esc(title)}</title>\n'
            f'<meta name="description" content="{esc(desc)}">\n<link rel="canonical" href="{SITE}{BASE_PATH}">\n'
            f'<link rel="icon" href="/assets/favicon.png" sizes="48x48"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n'
            f'{cssblock}{PAGE_CSS}</head>')
    page = (f'{head}<body class="concept-b inner">{header}\n<main id="main">\n'
            f'<div class="page-head"><h1>A1.1 Kursbuch Audio</h1><p>All {n_main} tracks from the A1.1 coursebook, plus '
            f'{len(extras)} extras. Press play on any track. You don\'t need an account.</p></div>\n'
            f'<section style="max-width:980px">{note}'
            f'<p>Each track has its own player, so you can pause, go back and listen again as often as you like. '
            f'If your book or worksheet has a QR code next to an exercise, scanning it brings you straight to that track on this page.</p>'
            f'<nav aria-label="Jump to a section"><ul class="au-jump">{jump}</ul></nav>{body}'
            f'<p>Is a track not playing? Email <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a> '
            f'or <a href="/whatsapp" target="_blank" rel="noopener">message us on WhatsApp</a> with the track number.</p>'
            f'</section>\n</main>\n{footer}{PAGE_JS}</body></html>\n')
    (OUT / 'index.html').write_text(page, encoding='utf-8')
    return n_main, len(extras)


def build_stubs(m):
    keep = set()
    for t in m['tracks']:
        tid = t['id']; keep.add(tid)
        dest = f'{BASE_PATH}#t-{tid}' if QR_TARGET == 'page' else url_of(t)
        d = OUT / tid; d.mkdir(exist_ok=True)
        (d / 'index.html').write_text(
            '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n'
            f'<title>Track {esc(tid)} – A1.1 Kursbuch Audio</title>\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex">\n'
            f'<link rel="canonical" href="{SITE}{BASE_PATH}">\n'
            f'<script>location.replace({json.dumps(dest)})</script>\n'
            f'<noscript><meta http-equiv="refresh" content="0;url={esc(dest)}"></noscript>\n'
            '</head><body style="font-family:system-ui,sans-serif;padding:2rem">'
            f'<p>Opening <a href="{esc(dest)}">track {esc(tid)}</a>…</p></body></html>\n', encoding='utf-8')
    for d in OUT.iterdir():                     # remove stubs for ids no longer in the manifest
        if d.is_dir() and ID_RE.match(d.name) and d.name not in keep:
            (d / 'index.html').unlink(missing_ok=True); d.rmdir()
    return len(keep)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    if '--placeholder' in sys.argv:
        MANIFEST.write_text(json.dumps(placeholder_manifest(), indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    m = load()
    a, b = build_page(m); n = build_stubs(m)
    print(f'audio/a1-1: {a} main + {b} extras, {n} QR stubs (target={QR_TARGET}){" [PLACEHOLDER DATA]" if m.get("placeholder") else ""}')
