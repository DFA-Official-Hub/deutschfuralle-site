#!/usr/bin/env python3
"""After rebasing feat/seo-v1 onto a new feat/tracking-v1: take tracking-v1's version of every conflicted
generated file (HTML pages, style.min.css), then run this. It re-applies the hand edits that are not part of
tools/seo.py and rebuilds (build.py -> tools/seo.py). Idempotent."""
import pathlib, re, subprocess, sys
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
# cache-bust the two JS files this branch changes: one version above whatever tracking-v1 ships
for name in ('dfa-track.js', 'dfa-mock-a1.js'):
    files = [*ROOT.glob('*.html'), *ROOT.glob('books/*.html'), ROOT / 'tools/tracking-head.html']
    vers = [int(v) for f in files for v in re.findall(rf'{re.escape(name)}\?v=(\d+)', f.read_text(encoding='utf-8'))]
    if not vers: continue
    base = subprocess.run(['git', 'show', 'origin/feat/tracking-v1:tools/tracking-head.html'], cwd=ROOT, capture_output=True, text=True).stdout
    up = [int(v) for v in re.findall(rf'{re.escape(name)}\?v=(\d+)', base)]
    target = (max(up) + 1) if up else max(vers)
    if name == 'dfa-mock-a1.js':
        exam = subprocess.run(['git', 'show', 'origin/feat/tracking-v1:exam-prep.html'], cwd=ROOT, capture_output=True, text=True).stdout
        target = int(re.search(r'dfa-mock-a1\.js\?v=(\d+)', exam).group(1)) + 1
    for f in files:
        s = f.read_text(encoding='utf-8'); s2 = re.sub(rf'({re.escape(name)}\?v=)\d+', rf'\g<1>{target}', s)
        if s2 != s: f.write_text(s2, encoding='utf-8')
    print(name, '-> v', target)
subprocess.run([sys.executable, 'build.py'], cwd=ROOT, check=True)
