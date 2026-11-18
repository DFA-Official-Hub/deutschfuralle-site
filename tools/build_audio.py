#!/usr/bin/env python3
"""Build the A1.1 Kursbuch audio page and its QR short links (noindex, not in the sitemap).

Sources
    Manifest: audio/a1-1/tracks.json (committed, validated snapshot) holds, per track: id (as printed in the
              book), slug, title, section, group, isExtra, url. The page, the stubs and the 404 lookup are built from it.
    Book:     the audio scripts, audio-scripts.md. Every '### [Track A1.1-...]' header there is one track; the book
              is the master list. It is read ONLY when AUDIO_SCRIPTS=/path/to/audio-scripts.md is set (so the build
              works on a clean clone), and by --init.

Usage
    python3 tools/build_audio.py                    validate tracks.json (and the book, if AUDIO_SCRIPTS is set), build
    AUDIO_SCRIPTS=/path/audio-scripts.md python3 tools/build_audio.py     same, plus the check against the book
    python3 tools/build_audio.py --init             write tracks.json from the book with PLACEHOLDER urls
    python3 tools/build_audio.py --init --host URL  write tracks.json from the book with real urls:
                                                    URL + '<book id>.mp3' (e.g. the release download base)
    (--init reads AUDIO_SCRIPTS, or the academics copy on the DFA build box if AUDIO_SCRIPTS is unset.)
The build always checks tracks.json on its own: exactly EXPECTED_TOTAL tracks and EXPECTED_EXTRAS extras, valid
ids, slug = id without 'A1.1-', extras flag matching the id, https urls, no duplicate id or slug.
With AUDIO_SCRIPTS set it also stops if a book track is missing from tracks.json, appears twice, is not in the
book, or has a title that differs from the book.

404 lookup: the build writes the slug list into a small inline script in /404.html (between <!--audio404--> markers).
A mistyped URL under /audio/a1-1/ (lower case, no trailing slash, with 'A1.1-' in front) is sent to the right stub;
an unknown id gets a short "track not found" message with a link to the list. No network calls.

Track ids and URLs (fixed by the book, audio-scripts.md v2.5)
    Book id   A1.1-L01-02  (A1.1-Lxx-nn lesson track, A1.1-ZSn-nn Zwischenspiel, A1.1-AT-nn Abschlusstest,
                            A1.1-PT-nn Prüfungstraining)
    Slug      L01-02       (the book id without 'A1.1-'), so the printed URL is
              www.deutschfuralle.com/audio/a1-1/L01-02   (case-sensitive on GitHub Pages; QR codes carry the exact case)
    Anchor    /audio/a1-1/#t-L01-02
    NEVER REUSE A PRINTED ID OR SLUG. Once a QR code or URL is in print, that slug must keep pointing
    at that recording forever. If a track is cut, keep its stub (point it at the nearest track);
    if one is added, give it a new number. Never renumber.

Extras: the 15 tracks of the Zwischenspiele (ZS1-ZS3), the A1.1-Abschlusstest (AT) and the
Prüfungstraining (PT), as listed under "Release structure on the audio web page" in the scripts.

Hosting: GitHub Release assets in a separate public DFA repo. Always use the stable
github.com/.../releases/download/... URL, never the signed release-assets URL it redirects to (expires).
QR stubs go to the track on this page, not to the MP3: GitHub serves release assets as
application/octet-stream + Content-Disposition: attachment, so opening the MP3 directly downloads it.

Placeholder note: while any track url still points at the test asset (TEST_ASSET), the page shows a
"Draft preview" box. It disappears by itself once every url is real. It must be gone before go-live.
"""
import html, json, os, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = 'https://www.deutschfuralle.com'
BASE_PATH = '/audio/a1-1/'
OUT = ROOT / 'audio' / 'a1-1'
MANIFEST = OUT / 'tracks.json'
BOX_SCRIPTS = '/workspace/academics/book-series/books/A1.1-Kursbuch/audio-scripts.md'   # only used by --init
EXPECTED_TOTAL, EXPECTED_EXTRAS = 122, 15   # A1.1 Kursbuch v2.5: 107 lesson tracks + 15 extras (ZS1-3, AT, PT)
NOT_FOUND = ROOT / '404.html'
ID_RE = re.compile(r'^A1\.1-(L\d{2}|ZS\d|AT|PT)-\d{2}$')
TEMPLATE = ROOT / 'german-for-kids.html'   # header, nav, footer and <head> scripts are copied from this page

# Temporary test asset (generated tone, not course audio). Any url starting with this counts as placeholder.
TEST_ASSET = 'https://github.com/DFA-Official-Hub/audio-hosting-test/releases/download/v0-test/dfa-test-tone.mp3'
QR_TARGET = 'page'   # 'page' (decided by Head of Tech) or 'asset'

FONTS = ['archivo-var-latin.woff2', 'inter-var-latin.woff2', 'montserrat-800-brand.woff2']
HEAD_RE = re.compile(r'^### \[Track (A1\.1-(L\d{2}|ZS\d|AT|PT)-\d{2})\] (.+?)\s*$')
EXTRA_KINDS = ('ZS', 'AT', 'PT')
esc = lambda s: html.escape(str(s), quote=True)


class BuildError(Exception):
    pass


def slug_of(book_id):
    return book_id[len('A1.1-'):]


def read_book(path):
    """Return the book's tracks in order: id, title, section (from the '## ' heading above it), isExtra."""
    SCRIPTS = pathlib.Path(path)
    if not SCRIPTS.exists():
        raise BuildError(f'audio scripts not found at {SCRIPTS} (set AUDIO_SCRIPTS=/path/to/audio-scripts.md)')
    tracks, section, errors, seen = [], None, [], {}
    for n, line in enumerate(SCRIPTS.read_text(encoding='utf-8').splitlines(), 1):
        if line.startswith('## '):
            section = line[3:].strip()
        elif line.startswith('### [Track'):
            m = HEAD_RE.match(line)
            if not m:
                errors.append(f'scripts line {n}: track header not in the A1.1-<part>-<nn> format: {line!r}'); continue
            bid, part, title = m.group(1), m.group(2), m.group(3)
            if bid in seen:
                errors.append(f'scripts line {n}: {bid} appears twice in the book (first on line {seen[bid]})'); continue
            seen[bid] = n
            extra = part.startswith(EXTRA_KINDS)
            tracks.append({'id': bid, 'slug': slug_of(bid), 'title': title, 'section': section,
                           'group': 'extras' if extra else 'course', 'isExtra': extra})
    if errors:
        raise BuildError('\n'.join(errors))
    if not tracks:
        raise BuildError(f'no "### [Track ...]" headers found in {SCRIPTS}')
    return tracks


def extras_order(t):   # Zwischenspiele first (they sit between the lessons), then Abschlusstest, then Prüfungstraining
    part = t['id'].split('-')[1]
    return ({'AT': 1, 'PT': 2}.get(part, 0), t['id'])


def init_manifest(host=None):
    book = read_book(os.environ.get('AUDIO_SCRIPTS') or BOX_SCRIPTS)
    course = [t for t in book if not t['isExtra']]
    extras = sorted((t for t in book if t['isExtra']), key=extras_order)
    for t in course + extras:
        t['url'] = (host.rstrip('/') + '/' + t['id'] + '.mp3') if host else f'{TEST_ASSET}?track={t["slug"]}'
    MANIFEST.write_text(json.dumps({
        'book': 'DFA Sprachsteg A1.1 Kursbuch', 'source': 'audio-scripts.md',
        '_note': 'Generated from the "### [Track ...]" headers of audio-scripts.md. A printed id/slug is never reused.'
                 + ('' if host else ' PLACEHOLDER urls: every track plays the same generated test tone.'),
        'tracks': course + extras}, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')


def validate_manifest(manifest):
    """Checks tracks.json on its own (always runs, no book needed)."""
    errs, tracks = [], manifest.get('tracks', [])
    ids = [t.get('id') for t in tracks]
    if len(tracks) != EXPECTED_TOTAL:
        errs.append(f'tracks.json has {len(tracks)} tracks, expected {EXPECTED_TOTAL}')
    n_extra = sum(1 for t in tracks if t.get('isExtra') is True)
    if n_extra != EXPECTED_EXTRAS:
        errs.append(f'tracks.json has {n_extra} extras, expected {EXPECTED_EXTRAS}')
    for i in sorted({str(i) for i in ids if ids.count(i) > 1}):
        errs.append(f'duplicate track: {i} is in tracks.json {ids.count(i)} times')
    slugs = {}
    for t in tracks:
        i, s = str(t.get('id', '')), str(t.get('slug', ''))
        m = ID_RE.match(i)
        if not m:
            errs.append(f'bad id {i!r} (expected A1.1-Lxx-nn, A1.1-ZSn-nn, A1.1-AT-nn or A1.1-PT-nn)'); continue
        if s != slug_of(i):
            errs.append(f'{i}: slug {s!r} must be {slug_of(i)!r} (the printed URL)')
        if s.lower() in slugs and slugs[s.lower()] != i:
            errs.append(f'duplicate slug: {s!r} is used by {slugs[s.lower()]} and {i}')
        slugs.setdefault(s.lower(), i)
        if t.get('isExtra') is not m.group(1).startswith(EXTRA_KINDS):
            errs.append(f'{i}: isExtra must be {m.group(1).startswith(EXTRA_KINDS)}')
        if not t.get('title') or not t.get('section'):
            errs.append(f'{i}: title and section are required')
        if not str(t.get('url', '')).startswith('https://'):
            errs.append(f'{i}: url must be an https URL')
    if errs:
        raise BuildError(f'tracks.json failed its own checks ({len(errs)} problem{"s" if len(errs) > 1 else ""}):\n  - '
                         + '\n  - '.join(errs))


def validate(manifest, book):
    """Checks tracks.json against the book (only when AUDIO_SCRIPTS is set)."""
    errs = []
    tracks = manifest.get('tracks', [])
    book_by_id = {t['id']: t for t in book}
    ids = [t.get('id') for t in tracks]
    for i in sorted({i for i in ids if ids.count(i) > 1}):
        errs.append(f'duplicate track: {i} is in tracks.json {ids.count(i)} times')
    for i in [b['id'] for b in book if b['id'] not in ids]:
        errs.append(f'missing track: {i} is in the book but not in tracks.json')
    for i in [i for i in dict.fromkeys(ids) if i not in book_by_id]:
        errs.append(f'unknown track: {i} is in tracks.json but not in the book')
    slugs = {}
    for t in tracks:
        s = str(t.get('slug', '')); k = s.lower()
        if k in slugs and slugs[k] != t.get('id'):
            errs.append(f'duplicate slug: {s!r} is used by {slugs[k]} and {t.get("id")}')
        slugs.setdefault(k, t.get('id'))
        b = book_by_id.get(t.get('id'))
        if not b:
            continue
        if s != b['slug']:
            errs.append(f'{t["id"]}: slug {s!r} must be {b["slug"]!r} (the printed URL)')
        if t.get('isExtra') is not b['isExtra']:
            errs.append(f'{t["id"]}: isExtra must be {b["isExtra"]}')
        if t.get('title') != b['title']:
            errs.append(f'{t["id"]}: title {t.get("title")!r} differs from the book {b["title"]!r}')
        if not str(t.get('url', '')).startswith('https://'):
            errs.append(f'{t["id"]}: url must be an https URL')
    if errs:
        raise BuildError(f'tracks.json does not match the book ({len(errs)} problem{"s" if len(errs) > 1 else ""}):\n  - '
                         + '\n  - '.join(errs))


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
main nav ul.au-jump{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;margin:0 0 26px;padding:0;list-style:none}
.au-jump a{display:inline-block;padding:6px 12px;border:1px solid #cfe0d3;border-radius:999px;text-decoration:none;color:#1d6f2b;font-weight:600;font-size:.92rem;background:#fff}
.au-jump a:focus-visible,.au-jump a:hover{background:#e7f3e8;outline:3px solid var(--g);outline-offset:2px}
.au-group{margin:34px 0 0}
.au-sec,.au-group h2,.au-sec h3{scroll-margin-top:var(--au-top,108px)}
.au-sec{margin:0 0 26px}
.au-sec h3{margin:18px 0 8px;font-size:1.1rem}
.au-list{list-style:none;margin:8px 0 0;padding:0;border:1px solid #dfe7e1;border-radius:14px;background:#fff;overflow:hidden}
.au-item{display:grid;grid-template-columns:5.2rem 1fr minmax(240px,320px) auto;gap:6px 14px;align-items:center;padding:10px 16px;border-top:1px solid #e1ece3;scroll-margin:var(--au-top,108px) 0 200px}
.au-item:first-child{border-top:0}
.au-item:nth-child(even){background:#f6faf7}
.au-num{font-family:Archivo,system-ui,sans-serif;font-weight:700;color:#1d6f2b;font-variant-numeric:tabular-nums}
.au-title{margin:0;font-weight:600;color:var(--ink)}
.au-item audio{width:100%;height:40px}
.au-item audio:focus-visible{outline:3px solid var(--g);outline-offset:2px;border-radius:20px}
.au-dl{font-size:.88rem;color:#1d6f2b;font-weight:600}
.au-item:focus{outline:3px solid var(--g);outline-offset:-3px}
.au-item.is-target{background:#e3f4e5;box-shadow:inset 4px 0 0 #2b8a3e}
.au-help{color:#4b5a52;margin:4px 0 0}
.au-ai{color:#4b5a52;font-size:.92rem;margin-top:26px}
.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media(max-width:640px){.au-item{grid-template-columns:4.4rem 1fr;padding:12px}.au-item audio{grid-column:1/-1}.au-dl{grid-column:1/-1;justify-self:end}}
body.au-cc-open main{padding-bottom:220px}
</style>"""

PAGE_JS = """<script>
(function(){
  var players=[].slice.call(document.querySelectorAll('.au-item audio'));
  // one track at a time: starting a track pauses any other
  players.forEach(function(a){a.addEventListener('play',function(){players.forEach(function(b){if(b!==a&&!b.paused)b.pause();});});});
  // while the cookie banner is open, add room at the bottom so it never sits over the last players
  function cc(){var b=document.getElementById('dfa-cc');var on=false;if(b){var st=getComputedStyle(b);on=st.display!=='none'&&st.visibility!=='hidden'&&b.getBoundingClientRect().height>0;}document.body.classList.toggle('au-cc-open',on);}
  // a QR short link lands on #t-<id>: highlight that track, keep it clear of the header and the banner, focus it
  function target(){
    cc();
    var id=decodeURIComponent(location.hash.slice(1));if(!/^t-/.test(id))return;
    var li=document.getElementById(id);if(!li)return;
    document.querySelectorAll('.au-item.is-target').forEach(function(x){x.classList.remove('is-target');});
    li.classList.add('is-target');li.setAttribute('tabindex','-1');
    // scroll-margin-top = full (unshrunk) header height + 24px breathing room; measured live, CSS default 108px
    var hdr=document.querySelector('header.site');if(hdr)document.documentElement.style.setProperty('--au-top',(Math.max(hdr.offsetHeight,84)+24)+'px');
    // the first track of a section brings its heading along (and the group heading for the first section),
    // so no heading is left half under the sticky header
    var anchor=li,sec=li.closest('.au-sec');
    if(sec&&li===sec.querySelector('.au-item')){anchor=sec.querySelector('h3')||li;var g=sec.closest('.au-group');if(g&&sec===g.querySelector('.au-sec'))anchor=g.querySelector('h2')||anchor;}
    // give the track itself the extra margin (so the browser's own #fragment scroll lands the same way)
    var top=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--au-top'))||108;
    var extra=Math.max(0,li.getBoundingClientRect().top-anchor.getBoundingClientRect().top);
    var room=window.innerHeight-(document.body.classList.contains('au-cc-open')?230:10)-li.offsetHeight;
    li.style.scrollMarginTop=(top+(top+extra<=room?extra:0))+'px';
    li.scrollIntoView({block:'start'});
    li.focus({preventScroll:true});   // the next Tab press lands on this track's player
  }
  window.addEventListener('hashchange',target);
  if(document.readyState==='complete')target();else window.addEventListener('load',function(){setTimeout(target,0);});
  if(window.MutationObserver)new MutationObserver(cc).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden']});
})();
</script>"""


def item(t):
    s = esc(t['slug']); title = esc(t['title']); url = esc(t['url'])
    return (f'<li class="au-item" id="t-{s}"><span class="au-num" aria-hidden="true">{s}</span>'
            f'<p class="au-title" id="lbl-{s}"><span class="visually-hidden">Track {s}: </span>{title}</p>'
            f'<audio controls preload="none" src="{url}" aria-labelledby="lbl-{s}"></audio>'
            f'<a class="au-dl" href="{url}" aria-label="Download track {s}">Download</a></li>')


def sections(tracks):
    out, order = {}, []
    for t in tracks:
        if t['section'] not in out:
            out[t['section']] = []; order.append(t['section'])
        out[t['section']].append(t)
    return [(name, out[name]) for name in order]


def build_page(m):
    csp, scripts, header, footer, cssblock = template_parts()
    course = sections([t for t in m['tracks'] if not t['isExtra']])
    extras = sections([t for t in m['tracks'] if t['isExtra']])
    n_course = sum(len(v) for _, v in course); n_extra = sum(len(v) for _, v in extras)
    placeholder = any(t['url'].startswith(TEST_ASSET) for t in m['tracks'])

    def sec_html(prefix, i, name, ts):
        sid = f'{prefix}{i}'
        return (f'<section class="au-sec" id="{sid}" aria-labelledby="h-{sid}"><h3 id="h-{sid}">{esc(name)}</h3>'
                f'<ol class="au-list">{"".join(item(t) for t in ts)}</ol></section>')

    jump = ''.join(f'<li><a href="#c{i}">{esc(name.split(" · ")[0])}</a></li>' for i, (name, _) in enumerate(course, 1))
    jump += '<li><a href="#extras">Exam practice &amp; extras</a></li>'
    note = ('<p class="au-note" role="note"><strong>Draft preview.</strong> For now every player here plays the same '
            'test tone. The real recordings will replace it.</p>') if placeholder else ''
    title = 'A1.1 Kursbuch Audio – Deutsch Für Alle'
    desc = 'All the listening tracks for the DFA A1.1 Kursbuch, free to play online: lessons 1 to 12, songs, reviews and exam practice.'
    head = (f'<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">{csp}\n{scripts}'
            f'<meta name="robots" content="noindex"><meta name="referrer" content="strict-origin-when-cross-origin">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{esc(title)}</title>\n'
            f'<meta name="description" content="{esc(desc)}">\n<link rel="canonical" href="{SITE}{BASE_PATH}">\n'
            f'<link rel="icon" href="/assets/favicon.png" sizes="48x48"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n'
            f'{cssblock}{PAGE_CSS}</head>')
    body = (
        f'<div class="page-head"><h1>A1.1 Kursbuch Audio</h1><p>All the listening tracks for your A1.1 book, in one place. '
        f'Free to play, no account needed.</p></div>\n'
        f'<section style="max-width:980px">{note}'
        f'<p>Every track has the same number as in your book, so find the exercise you\'re working on and press play. '
        f'Listen as many times as you like. If you scan a QR code in the book, you\'ll land right on that track.</p>'
        f'<nav aria-label="Jump to a lesson"><ul class="au-jump">{jump}</ul></nav>'
        f'<div class="au-group" id="course"><h2>Course audio</h2>'
        f'<p class="au-help">{n_course} tracks for Lektion 1 to 12, in the order they come up in the book.</p>'
        + ''.join(sec_html('c', i, n, ts) for i, (n, ts) in enumerate(course, 1)) +
        f'</div><div class="au-group" id="extras"><h2>Exam practice &amp; extras</h2>'
        f'<p class="au-help">{n_extra} tracks: the songs and reviews from the three Zwischenspiele, the listening part of the '
        f'A1.1 final test, and Start Deutsch 1 exam practice. Use them when you reach those pages, or any time you want extra listening.</p>'
        + ''.join(sec_html('e', i, n, ts) for i, (n, ts) in enumerate(extras, 1)) +
        f'</div>'
        f'<p class="au-ai" lang="de">Die Stimmen und die Musik in diesen Aufnahmen sind KI-generiert. '
        f'<span lang="en">/ The voices and the music in these recordings are AI-generated.</span></p>'
        f'<p>Is a track not playing? Email <a href="mailto:contact.deutschfuralle@gmail.com">contact.deutschfuralle@gmail.com</a> '
        f'or <a href="/whatsapp" target="_blank" rel="noopener">message us on WhatsApp</a> with the track number.</p>'
        f'</section>')
    page = f'{head}<body class="concept-b inner">{header}\n<main id="main">\n{body}\n</main>\n{footer}{PAGE_JS}</body></html>\n'
    (OUT / 'index.html').write_text(page, encoding='utf-8')
    return n_course, n_extra, placeholder


def stub(slug, dest):
    return ('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n'
            f'<title>Track {esc(slug)} – A1.1 Kursbuch Audio</title>\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex">\n'
            f'<link rel="canonical" href="{SITE}{BASE_PATH}">\n'
            f'<script>location.replace({json.dumps(dest)}.replace("#",location.search+"#"))</script>\n'
            f'<noscript><meta http-equiv="refresh" content="0;url={esc(dest)}"></noscript>\n'
            '</head><body style="font-family:system-ui,sans-serif;padding:2rem">'
            f'<p>Opening <a href="{esc(dest)}">track {esc(slug)}</a>…</p></body></html>\n')


def build_stubs(m):
    keep = set()
    for t in m['tracks']:
        dest = f'{BASE_PATH}#t-{t["slug"]}' if QR_TARGET == 'page' else t['url']
        # One stub per printed slug. No lower-case alias folders: L01-01/ and l01-01/ would collide when the repo is
        # cloned on Windows or macOS (case-insensitive file systems).
        d = t['slug']; keep.add(d); (OUT / d).mkdir(exist_ok=True)
        (OUT / d / 'index.html').write_text(stub(d, dest), encoding='utf-8')
    removed = []
    for d in OUT.iterdir():   # every folder under audio/a1-1/ is a generated stub; drop ones no longer in the manifest
        if d.is_dir() and d.name not in keep:
            for f in d.iterdir(): f.unlink()
            d.rmdir(); removed.append(d.name)
    return len(keep), removed


AUDIO_404 = """<!--audio404--><script>
/* A1.1 audio short links: case-insensitive lookup, built by tools/build_audio.py from audio/a1-1/tracks.json. No network calls. */
(function(){
  var m=location.pathname.match(/^\\/audio\\/a1-1\\/([^\\/]+)\\/?(?:index\\.html)?$/i);
  if(!m&&!/^\\/audio\\/a1-1\\//i.test(location.pathname))return;
  var S=" __SLUGS__ ",raw="",id="";
  if(m){try{raw=decodeURIComponent(m[1]);}catch(e){raw=m[1];}id=raw.toUpperCase().replace(/^A1[.-]1-/,"");}
  var dest="/audio/a1-1/"+id+"/";
  // known id and not already on that exact path (a missing stub must not loop): go to the stub
  if(id&&S.indexOf(" "+id+" ")>-1&&location.pathname!==dest){location.replace(dest+location.search+location.hash);return;}
  document.addEventListener("DOMContentLoaded",function(){
    var h=document.querySelector("main .page-head");if(!h)return;
    document.title="Track not found – A1.1 Kursbuch Audio";
    h.innerHTML="<h1>Track not found</h1><p class=\\"au404\\"></p><p><a class=\\"btn\\" href=\\"/audio/a1-1/\\">See all A1.1 tracks</a></p>";
    h.querySelector(".au404").textContent=raw?("We couldn't find a track called \\u201c"+raw+"\\u201d. Check the number printed next to the exercise in your book, or pick the track from the full list."):"We couldn't find that page. All the A1.1 tracks are on one list.";
  });
})();
</script><!--/audio404-->"""


def build_404(m):
    """Write (or refresh) the inline audio lookup in /404.html, keeping everything else in the file as it is."""
    if not NOT_FOUND.exists():
        raise BuildError('404.html not found')
    s = NOT_FOUND.read_text(encoding='utf-8')
    block = AUDIO_404.replace('__SLUGS__', ' '.join(t['slug'] for t in m['tracks']))
    s = re.sub(r'<!--audio404-->.*?<!--/audio404-->', '', s, flags=re.S)
    csp = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]*>', s)
    # right after the CSP meta (so the CSP covers it), before the analytics scripts load
    at = csp.end() if csp else s.index('<meta charset="utf-8">') + len('<meta charset="utf-8">')
    s = s[:at] + block + s[at:]
    NOT_FOUND.write_text(s, encoding='utf-8')


def main(argv):
    OUT.mkdir(parents=True, exist_ok=True)
    if '--init' in argv:
        host = argv[argv.index('--host') + 1] if '--host' in argv else None
        init_manifest(host)
    m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    validate_manifest(m)
    src = os.environ.get('AUDIO_SCRIPTS')
    if src:
        validate(m, read_book(src))
    a, b, ph = build_page(m)
    n, removed = build_stubs(m)
    build_404(m)
    print(f'audio/a1-1: {a + b} tracks = {a} course + {b} extras; {n} stub pages (target={QR_TARGET}); 404 lookup updated; '
          + (f'checked against {src}' if src else 'book check skipped (AUDIO_SCRIPTS not set)')
          + (f'; removed {len(removed)} old stubs' if removed else '') + (' [PLACEHOLDER urls: draft note shown]' if ph else ''))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BuildError as e:
        sys.exit(f'build_audio: ERROR: {e}')
