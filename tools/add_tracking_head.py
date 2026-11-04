#!/usr/bin/env python3
"""One-off helper (spec 1.3 + 3): insert the tracking head snippet after the CSP meta and extend the CSP.
Idempotent. admin.html, portal.html and reader.html get the CSP change only, never the snippet."""
import pathlib,re
SNIP=open('tools/tracking-head.html',encoding='utf-8').read().rstrip('\n')
EXCLUDE={'admin.html','portal.html','reader.html'}
def csp(s):
    s=s.replace("https://static.cloudflareinsights.com;","https://static.cloudflareinsights.com https://www.googletagmanager.com https://connect.facebook.net;",1)
    s=s.replace("img-src 'self' data: blob: https:;","img-src 'self' data: blob: https: https://www.googletagmanager.com https://*.google-analytics.com https://www.facebook.com;",1)
    s=s.replace("https://cloudflareinsights.com;","https://cloudflareinsights.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://www.facebook.com;",1)
    return s
for p in sorted([*pathlib.Path('.').glob('*.html'),*pathlib.Path('books').glob('*.html')]):
    s=p.read_text(encoding='utf-8'); s2=s
    if 'https://connect.facebook.net' not in s2: s2=csp(s2)
    if p.name not in EXCLUDE and 'dfa-consent.js' not in s2:
        s2,n=re.subn(r'(<meta http-equiv="Content-Security-Policy"[^>]*>)',lambda m:m.group(1)+'\n'+SNIP,s2,count=1)
        if not n: print('NO CSP, check manually',p); continue
    if s2!=s: p.write_text(s2,encoding='utf-8'); print('ok',p)
