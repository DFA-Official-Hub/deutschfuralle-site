#!/usr/bin/env python3
"""Rebuild assets/style.min.css from assets/fonts.css + assets/style.css and inline it into every page's <head>.
Edit style.css / fonts.css, then run: python3 build.py"""
import re,glob
def mini(s):
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S); s=re.sub(r'\s*\n\s*','',s)
    return re.sub(r'\s*([{};,>])\s*',r'\1',s).replace(';}','}')
css=mini(open('assets/fonts.css').read()+open('assets/style.css').read())
open('assets/style.min.css','w').write(css+'\n')
inline=css.replace('url(fonts/','url(assets/fonts/')
pre=''.join(f'<link rel="preload" href="assets/fonts/{f}" as="font" type="font/woff2" crossorigin>' for f in
  ['poppins-400-latin.woff2','poppins-500-latin.woff2','poppins-600-latin.woff2','poppins-700-latin.woff2','montserrat-800-brand.woff2'])
block=f'<!--css-->{pre}<style>{inline}</style><!--/css-->'
for f in glob.glob('*.html'):
    h=open(f).read()
    h=re.sub(r'<link rel="preconnect"[^>]*>|<link href="https://fonts.googleapis.com[^>]*>','',h)
    h=re.sub(r'<!--css-->.*?<!--/css-->|<link rel="stylesheet" href="assets/style(\.min)?\.css">',lambda m:'@@CSS@@',h,flags=re.S)
    h=h.replace('@@CSS@@',block,1).replace('@@CSS@@','')
    open(f,'w').write(h)
