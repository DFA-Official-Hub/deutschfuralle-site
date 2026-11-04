#!/usr/bin/env python3
"""After rebasing feat/seo-v1 onto a new feat/tracking-v1: take tracking-v1's version of every conflicted
generated file (HTML pages, style.min.css), then run this. It re-applies the hand edits that are not part of
tools/seo.py (registration.html dest, JS cache versions) and rebuilds (build.py -> tools/seo.py). Idempotent."""
import pathlib, re, subprocess, sys
BASE = __import__('os').environ.get('SEO_BASE', 'origin/main')
ROOT = pathlib.Path(__file__).resolve().parent.parent
def edit(rel, old, new):
    p = ROOT / rel; s = p.read_text(encoding='utf-8')
    if new in s: return
    assert old in s, f'{rel}: anchor not found, re-apply by hand'
    p.write_text(s.replace(old, new), encoding='utf-8')
edit('registration.html',
     """    var wa=document.querySelector('a[href*="wa.me/"]');   // matches all 64 existing wa.me anchors (wa-btn, wa-float, btn, unclassed); reuses their number, never hard-coded
    var dest = via==='wa' && wa ? wa.href.split('?')[0]+'?text='+encodeURIComponent(txt)""",
     """    var dest = via==='wa' ? '/whatsapp?text='+encodeURIComponent(txt)   // /whatsapp forwards to wa.me with the text; the number is only in whatsapp.html""")
# cache-bust the JS files this branch changes: one version above whatever the base branch ships
BUMP = {'dfa-track.js': 'tools/tracking-head.html', 'dfa-mock-a1.js': 'exam-prep.html', 'site.js': 'index.html', 'dfa-auth.js': 'verify.html'}
files = [*ROOT.glob('*.html'), *ROOT.glob('books/*.html'), ROOT / 'tools/tracking-head.html']
for name, ref in BUMP.items():
    base = subprocess.run(['git', 'show', BASE + ':' + ref], cwd=ROOT, capture_output=True, text=True).stdout
    target = int(re.search(rf'{re.escape(name)}\?v=(\d+)', base).group(1)) + 1
    for f in files:
        s = f.read_text(encoding='utf-8'); s2 = re.sub(rf'(/{re.escape(name)}\?v=)\d+', rf'\g<1>{target}', s)
        if s2 != s: f.write_text(s2, encoding='utf-8')
    print(name, '-> v', target)
subprocess.run([sys.executable, 'build.py'], cwd=ROOT, check=True)
