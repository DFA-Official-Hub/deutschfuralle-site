#!/usr/bin/env python3
"""Build a throwaway PREVIEW copy of this branch for GitHub Pages at
https://dfa-official-hub.github.io/deutschfuralle-site-preview/ (separate public repo, never production).

Usage: python3 tools/build_preview.py <out_dir> [<dfa-links checkout>]

What it changes, and only in the copy (the branch itself is untouched):
  * CNAME is NOT copied, so the preview can never claim www.deutschfuralle.com.
  * Root-absolute paths (href="/...", src="/...") get the project prefix /deutschfuralle-site-preview/,
    because a project Pages site is served from a sub-path.
  * Every page gets <meta name="robots" content="noindex, nofollow"> so search engines ignore the preview.
  * links/index.html redirects to the preview copy of the hub (/hub/) instead of the live hub.
  * Optional: the dfa-links branch is copied into /hub/.
Analytics: the head snippet's hostname guard (tools/tracking-head.html) disables GA4 and the Meta Pixel on any host
other than deutschfuralle.com and dfa-official-hub.github.io/dfa-links/, so preview visits send nothing to the
production property or Pixel. Add ?dfa_debug=1 once per tab to switch sending on for a test (GA4 debug_mode).
"""
import pathlib,re,shutil,subprocess,sys
BASE='/deutschfuralle-site-preview/'
out=pathlib.Path(sys.argv[1]).resolve(); hub=sys.argv[2] if len(sys.argv)>2 else None
root=pathlib.Path(__file__).resolve().parent.parent
if out.exists(): shutil.rmtree(out)
out.mkdir(parents=True)
files=subprocess.run(['git','ls-files'],cwd=root,capture_output=True,text=True,check=True).stdout.split('\n')
for f in filter(None,files):
    if f=='CNAME': continue
    d=out/f; d.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(root/f,d)
if hub:
    hf=subprocess.run(['git','ls-files'],cwd=hub,capture_output=True,text=True,check=True).stdout.split('\n')
    for f in filter(None,hf):
        if f=='CNAME': continue
        d=out/'hub'/f; d.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(pathlib.Path(hub)/f,d)
ROBOTS='<meta name="robots" content="noindex, nofollow">'
for p in out.rglob('*.html'):
    s=p.read_text(encoding='utf-8')
    if not p.is_relative_to(out/'hub'):
        s=re.sub(r'((?:href|src)=")/(?!/)',r'\1'+BASE,s)
    if p==out/'links'/'index.html':
        s=s.replace('https://dfa-official-hub.github.io/dfa-links/','https://dfa-official-hub.github.io'+BASE+'hub/')
    if ROBOTS not in s: s=re.sub(r'(<head>|<meta charset="utf-8">)',lambda m:m.group(1)+ROBOTS,s,count=1)
    p.write_text(s,encoding='utf-8')
c=out/'assets'/'dfa-consent.js'; c.write_text(c.read_text().replace('href="/privacy.html','href="'+BASE+'privacy.html'))
(out/'.nojekyll').write_text('')
(out/'robots.txt').write_text('User-agent: *\nDisallow: /\n')
(out/'README.md').write_text('# deutschfuralle-site PREVIEW (not production)\n\nAuto-built from a feature branch of DFA-Official-Hub/deutschfuralle-site by tools/build_preview.py. '
  'No CNAME, noindex, analytics disabled by hostname guard. Safe to delete once the PR is merged.\n')
print('preview built in',out)
