#!/usr/bin/env python3
"""Insert/refresh the tracking head snippet (tools/tracking-head.html) after the CSP meta and extend the CSP.
Idempotent; re-run after editing tracking-head.html and every page gets the current snippet.
admin.html, portal.html, reader.html and doc.html get the CSP change only, never the snippet.
account.html (auth redirect landing: ?code= / tokens in the URL) gets neither: no analytics at all."""
import pathlib,re
SNIP=open('tools/tracking-head.html',encoding='utf-8').read().rstrip('\n')
EXCLUDE={'admin.html','portal.html','reader.html','doc.html','account.html'}  # doc.html: private document viewer (ids/invoice numbers in the URL)
NO_CSP={'account.html'}  # auth landing page: no analytics hosts in its CSP either
# links/index.html (copy of the dfa-links hub) sends its own page_view with a redirect callback, so its gtag config
# differs in one line (send_page_view:false); everything else is the shared snippet.
CFG="<script>gtag('js',new Date());var dfaCfg={page_location:window.DFA_CLEAN_URL,page_referrer:window.DFA_CLEAN_REF};if(window.DFA_DEBUG)dfaCfg.debug_mode=true;gtag('config','G-L3X22MD03E',dfaCfg);</script>"
LINKS_CFG="<script>gtag('js',new Date());gtag('config','G-L3X22MD03E',{page_location:window.DFA_CLEAN_URL,page_referrer:window.DFA_CLEAN_REF,send_page_view:false,debug_mode:window.DFA_DEBUG||undefined}); /* the page_view below is sent once, with a redirect callback */</script>"
assert CFG in SNIP, 'tracking-head.html gtag config line changed: update CFG/LINKS_CFG'
BLOCK=re.compile(r'\n?<script>\nwindow\.dataLayer=.*?<script src="/assets/dfa-track\.js\?v=\d+" defer></script>',re.S)  # any version of the snippet
def csp(s):
    s=s.replace("https://static.cloudflareinsights.com;","https://static.cloudflareinsights.com https://www.googletagmanager.com https://connect.facebook.net;",1)
    s=s.replace("img-src 'self' data: blob: https:;","img-src 'self' data: blob: https: https://www.googletagmanager.com https://*.google-analytics.com https://www.facebook.com;",1)
    s=s.replace("https://cloudflareinsights.com;","https://cloudflareinsights.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://www.facebook.com;",1)
    return s
for p in sorted([*pathlib.Path('.').glob('*.html'),*pathlib.Path('books').glob('*.html'),*pathlib.Path('blog').glob('*.html'),pathlib.Path('links/index.html')]):
    s=p.read_text(encoding='utf-8'); s2=s
    if p.as_posix()=='links/index.html':   # refresh only; never inserted fresh, CSP untouched
        s2=BLOCK.sub(lambda m:('\n' if m.group(0).startswith('\n') else '')+SNIP.replace(CFG,LINKS_CFG),s2,count=1)
        if s2!=s: p.write_text(s2,encoding='utf-8'); print('ok',p)
        continue
    if p.name not in NO_CSP and 'https://connect.facebook.net' not in s2: s2=csp(s2)
    if p.name not in EXCLUDE and 'dfa-consent.js' not in s2:
        s2,n=re.subn(r'(<meta http-equiv="Content-Security-Policy"[^>]*>)',lambda m:m.group(1)+'\n'+SNIP,s2,count=1)
        if not n: print('NO CSP, check manually',p); continue
    elif p.name not in EXCLUDE: s2=BLOCK.sub(lambda m:('\n' if m.group(0).startswith('\n') else '')+SNIP,s2,count=1)  # refresh an older snippet
    if p.name in EXCLUDE: s2=BLOCK.sub('',s2)  # remove a previously inserted snippet
    if s2!=s: p.write_text(s2,encoding='utf-8'); print('ok',p)
