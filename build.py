#!/usr/bin/env python3
"""Rebuild assets/style.min.css from assets/fonts.css + assets/style.css (B2 design) and inline it into every page's <head>.
Edit style.css / fonts.css, then run: python3 build.py"""
import re,glob
def mini(s):
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S); s=re.sub(r'\s*\n\s*','',s)
    return re.sub(r'\s*([{};,>])\s*',r'\1',s).replace(';}','}')
css=mini(open('assets/fonts.css').read()+open('assets/style.css').read())
open('assets/style.min.css','w').write(css+'\n')
FONTS=['archivo-var-latin.woff2','inter-var-latin.woff2','montserrat-800-brand.woff2']
for f in glob.glob('*.html')+glob.glob('books/*.html'):
    base='/assets/' if f=='404.html' else ('../assets/' if f.startswith('books/') else 'assets/')
    pre=''.join(f'<link rel="preload" href="{base}fonts/{x}" as="font" type="font/woff2" crossorigin>' for x in FONTS)
    block=f'<!--css-->{pre}<style>{css.replace("url(fonts/","url("+base+"fonts/")}</style><!--/css-->'
    h=open(f).read()
    h=re.sub(r'<link rel="preconnect"[^>]*>|<link href="https://fonts.googleapis.com[^>]*>','',h)
    h=re.sub(r'<!--css-->.*?<!--/css-->|<link rel="stylesheet" href="[^"]*\.css">',lambda m:'@@CSS@@',h,flags=re.S)
    h=h.replace('@@CSS@@',block,1).replace('@@CSS@@','')
    open(f,'w').write(h)
