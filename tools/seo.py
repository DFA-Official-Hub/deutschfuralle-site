#!/usr/bin/env python3
"""SEO build step (run by build.py, or alone: python3 tools/seo.py). Idempotent.

For every public page it writes one <!--seo-->...<!--/seo--> block into <head> with:
  canonical (clean URL as GitHub Pages serves it: /courses, /books/farben, home = /),
  Open Graph + Twitter card tags, and JSON-LD (EducationalOrganization everywhere,
  Course on /courses, Book on /books/*, FAQPage only where a visible FAQ exists).
It also sets the title and meta description from TITLES below, rewrites internal page links to the
clean root-relative form, points every WhatsApp link at /whatsapp (number only in Supabase wa function secret),
and regenerates sitemap.xml and robots.txt from the list of indexable pages.
"""
import html, json, pathlib, re, subprocess, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = 'https://www.deutschfuralle.com'
OG_IMAGE = SITE + '/assets/og-image.jpg'
WA = '/whatsapp'  # number only in Supabase wa edge function secret
EMAIL = 'contact.deutschfuralle@gmail.com'
# Never indexed, never in the sitemap: private apps, redirects, utility pages.
PRIVATE = {'admin.html', 'portal.html', 'reader.html', 'doc.html', 'verify.html', 'account.html', '404.html',
           'kids-books.html', 'whatsapp.html'}
NOINDEX_ADD = {'account.html', '404.html', 'kids-books.html'}  # had no robots meta before
SHORT_SUB = {'Rainbow and Weather Words in German for Kids': 'Weather Words in German for Kids'}  # keeps book titles <= 60 chars
SKIP = {'links/index.html'}                          # copy of the dfa-links hub, its own canonical; left alone

TITLES = {  # title, meta description (audit 2026-11-04, lightly edited)
 'index.html': ('Online German Classes in Pakistan | Deutsch Für Alle',
   'Learn German live on Zoom in small groups of 2 to 4. A1 and A2 courses with Goethe and ÖSD exam prep, taught from Germany and Pakistan. Book a free demo.'),
 'courses.html': ('German Course Fees in Pakistan: A1–B2 & Kids Classes | DFA',
   'Live online German courses on Zoom from Rs. 15,000: A1 tracks, A2, A1 + A2 combined, B1 (2 months) and kids classes (ages 12-16). Book a free demo class.'),
 'exam-prep.html': ('Free Goethe A1 Mock Test Online (Start Deutsch 1) | DFA',
   "Take a full A1 practice exam in the Goethe Start Deutsch 1 format for free: Hören with audio, Lesen, Schreiben and Sprechen. Timed and marked instantly."),
 'registration.html': ('Register or Book a Free German Demo Class | DFA',
   'Try a real German lesson on Zoom before you pay. Book your free demo or register for the next A1 or A2 batch with Deutsch Für Alle.'),
 'contact.html': ('Contact Deutsch Für Alle – Online German Classes',
   'Questions about fees, batches or Goethe exams? Message us on WhatsApp, where we usually reply fastest, or email contact.deutschfuralle@gmail.com.'),
 'resources.html': ('Free German Learning Resources & A1 Starter Pack | DFA',
   'Free German videos, an A1 starter pack, a short guide to German levels and Goethe and ÖSD exams, and answers to the questions learners ask us most.'),
 'reviews.html': ('Student Reviews & Goethe Exam Results | Deutsch Für Alle',
   'Real Goethe exam results and WhatsApp reviews from DFA students in Pakistan. See what our live online German classes are like before you join.'),
 'books.html': ('German Books for Kids & A1 Workbook | Deutsch Für Alle',
   'Picture and activity books in German for kids aged 3 to 7, plus a German A1 workbook with 150+ exercises. Paperback and printable PDF.'),
 'careers.html': ('Careers – Teach German with Deutsch Für Alle',
   'Are you a German teacher, or want to help our students? Join the small Deutsch Für Alle team. Send your CV and a short note, and we will get back to you.'),
 'privacy.html': (None, None),  # already good
 'blog/goethe-exam-pakistan.html': ('Goethe Exam in Pakistan 2026: A1 & B1 Booking & Documents',
   'How to book the Goethe A1 or B1 exam in Pakistan: centres in Karachi, Lahore and Islamabad, payment, documents and what each level is for.'),
 'blog/german-course-fees-pakistan.html': ('German Language Course Fees in Pakistan 2026: A1 to B2',
   "What a German course costs in Pakistan in 2026: DFA's A1 to B2 fees, what drives the price, how to save and how to choose your level."),
 'german-b1-course.html': ('German B1 Course in Pakistan (Online) | Deutsch Für Alle',
   'Live online German B1 course on Zoom: 2 months, Rs. 40,000, Monday to Friday, four daily time slots. Admissions are open. Book a free demo class.'),
 'german-for-kids.html': ('Online German Classes for Kids (Ages 12-16) | DFA',
   'Live online German classes on Zoom for ages 12 to 16. 3 months, Rs. 8,000 per month, Monday to Friday, four time slots. Book a free demo class.'),
 'books/a1-workbook.html': ('German A1 Workbook with Answers (PDF & Paperback)',
   'German A1 workbook: 9 units, 150+ exercises, review test and answer key. Paperback on Amazon, PDF on Etsy and Gumroad.'),
}

ORG_ID = SITE + '/#organization'
ORG = {'@type': 'EducationalOrganization', '@id': ORG_ID, 'name': 'Deutsch Für Alle', 'alternateName': 'DFA',
       'url': SITE + '/', 'logo': SITE + '/assets/logo.png', 'image': OG_IMAGE, 'email': EMAIL,
       'description': 'Live online German classes on Zoom for learners in Pakistan, A1 and A2, with Goethe and ÖSD exam preparation.',
       'areaServed': {'@type': 'Country', 'name': 'Pakistan'},
       'sameAs': ['https://www.youtube.com/@deutschfuraalle', 'https://www.youtube.com/@DeutschF%C3%BCrAlleKids',
                  'https://instagram.com/deutschfuraalle', 'https://www.facebook.com/profile.php?id=61561997951415',
                  'https://www.tiktok.com/@deutschfuraalle0', 'https://www.threads.net/@deutschfuraalle',
                  'https://www.pinterest.com/deutschfuraalle', 'https://www.linkedin.com/company/deutsch-f%C3%BCr-alle',
                  'https://open.spotify.com/show/5xTb3cZ3NrMYcgXjouiiQA']}
ORG_REF = {'@type': 'EducationalOrganization', '@id': ORG_ID, 'name': 'Deutsch Für Alle', 'url': SITE + '/'}

def txt(s): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
def clean_url(rel):  # 'books/farben.html' -> https://www.../books/farben ; index.html -> /
    rel = re.sub(r'(^|/)index\.html$', r'\1', rel)
    return SITE + '/' + re.sub(r'\.html$', '', rel)
def attr(s): return html.escape(s, quote=True)

# Course nodes for the two stand-alone course pages (from the approved drafts; the FAQPage is built from each page's visible FAQ)
PAGE_COURSES = {
 "german-b1-course.html": {
  "@type": "Course",
  "@id": "https://www.deutschfuralle.com/german-b1-course#course",
  "name": "German B1 Course (Online)",
  "description": "Live online German B1 course on Zoom, 2 months, Monday to Friday, with four daily time slots in Pakistan time. Admissions are open.",
  "url": "https://www.deutschfuralle.com/german-b1-course",
  "inLanguage": "en",
  "teaches": "German language, CEFR level B1",
  "educationalLevel": "B1",
  "timeRequired": "P2M",
  "provider": {
   "@type": "EducationalOrganization",
   "@id": "https://www.deutschfuralle.com/#organization",
   "name": "Deutsch Für Alle",
   "url": "https://www.deutschfuralle.com/"
  },
  "offers": {
   "@type": "Offer",
   "category": "Paid",
   "price": "40000",
   "priceCurrency": "PKR",
   "availability": "https://schema.org/InStock",
   "url": "https://www.deutschfuralle.com/german-b1-course"
  },
  "hasCourseInstance": {
   "@type": "CourseInstance",
   "courseMode": "Online",
   "courseSchedule": {
    "@type": "Schedule",
    "repeatFrequency": "P1D",
    "byDay": [
     "https://schema.org/Monday",
     "https://schema.org/Tuesday",
     "https://schema.org/Wednesday",
     "https://schema.org/Thursday",
     "https://schema.org/Friday"
    ],
    "duration": "PT1H30M",
    "scheduleTimezone": "Asia/Karachi"
   }
  }
 },
 "german-for-kids.html": {
  "@type": "Course",
  "@id": "https://www.deutschfuralle.com/german-for-kids#course",
  "name": "Online German Classes for Kids (Ages 12-16)",
  "description": "Live online German classes on Zoom for ages 12 to 16, from zero to A1. A 3-month course at PKR 8,000 per month (PKR 24,000 in total), Monday to Friday, with four daily time slots in Pakistan time. Admissions are open.",
  "url": "https://www.deutschfuralle.com/german-for-kids",
  "inLanguage": "en",
  "teaches": "German language",
  "timeRequired": "P3M",
  "audience": {
   "@type": "PeopleAudience",
   "suggestedMinAge": 12,
   "suggestedMaxAge": 16
  },
  "provider": {
   "@type": "EducationalOrganization",
   "@id": "https://www.deutschfuralle.com/#organization",
   "name": "Deutsch Für Alle",
   "url": "https://www.deutschfuralle.com/"
  },
  "offers": {
   "@type": "Offer",
   "category": "Paid",
   "price": "8000",
   "priceCurrency": "PKR",
   "description": "PKR 8,000 per month for 3 months (PKR 24,000 in total)",
   "availability": "https://schema.org/InStock",
   "url": "https://www.deutschfuralle.com/german-for-kids",
   "priceSpecification": {
    "@type": "UnitPriceSpecification",
    "price": "8000",
    "priceCurrency": "PKR",
    "billingDuration": "P1M",
    "unitText": "month"
   }
  },
  "hasCourseInstance": {
   "@type": "CourseInstance",
   "courseMode": "Online",
   "courseSchedule": {
    "@type": "Schedule",
    "repeatFrequency": "P1D",
    "byDay": [
     "https://schema.org/Monday",
     "https://schema.org/Tuesday",
     "https://schema.org/Wednesday",
     "https://schema.org/Thursday",
     "https://schema.org/Friday"
    ],
    "duration": "PT1H30M",
    "scheduleTimezone": "Asia/Karachi"
   }
  }
 }
}

def courses(s):
    out = []
    for card in re.findall(r'<div class="card">(?:(?!<div class="card).)*?class="price".*?</a></div>', s, re.S):
        name = txt(re.search(r'<h[23][^>]*>(.*?)</h[23]>', card).group(1))
        price = re.search(r'class="price">Rs\. ([\d,]+)', card).group(1).replace(',', '')
        dur = txt(re.search(r'<strong>Duration:</strong>(.*?)</p>', card, re.S).group(1))
        desc = txt(re.search(r'</div><p>(.*?)</p>', card, re.S).group(1))
        lvl = 'A1 and A2' if 'A1 + A2' in name else ('B1' if 'B1' in name else ('A2' if 'A2' in name else 'A1'))
        link = re.search(r'<a class="btn" href="(/german-[a-z0-9-]+)"', card)
        url = SITE + link.group(1) if link else SITE + '/courses'
        offer = {'@type': 'Offer', 'category': 'Paid', 'price': price, 'priceCurrency': 'PKR',
                 'url': url, 'availability': 'https://schema.org/InStock'}
        node = {'@type': 'Course', 'name': name, 'description': desc, 'provider': ORG_REF,
                'educationalLevel': lvl, 'inLanguage': 'de', 'url': url, 'offers': offer,
                'hasCourseInstance': {'@type': 'CourseInstance', 'courseMode': 'Online',
                                      'location': {'@type': 'VirtualLocation', 'name': 'Zoom'},
                                      'description': 'Live group classes on Zoom, ' + dur}}
        if 'B1' in name: node['hasCourseInstance']['courseWorkload'] = 'P2M'
        if 'Kids' in name:
            node['educationalLevel'] = 'A1'; node['audience'] = {'@type': 'PeopleAudience', 'suggestedMinAge': 12, 'suggestedMaxAge': 16}
            node['hasCourseInstance']['courseWorkload'] = 'P3M'
            offer['description'] = 'PKR 8,000 per month for 3 months (PKR 24,000 in total)'
            offer['priceSpecification'] = {'@type': 'UnitPriceSpecification', 'price': price, 'priceCurrency': 'PKR', 'billingDuration': 'P1M', 'unitText': 'month'}
        out.append(node)
    assert len(out) == 8, len(out)
    # B2 stays a plain fee line under the cards ("... B2 course fee: Rs. 50,000")
    m = re.search(r'B2 course fee:\s*<strong>Rs\. ([\d,]+)</strong>', s)
    assert m, 'B2 fee line not found'
    out.append({'@type': 'Course', 'name': 'German B2 Course', 'description': 'Live German B2 course on Zoom.', 'provider': ORG_REF,
                'educationalLevel': 'B2', 'inLanguage': 'de', 'url': SITE + '/courses',
                'offers': {'@type': 'Offer', 'category': 'Paid', 'price': m.group(1).replace(',', ''), 'priceCurrency': 'PKR',
                           'url': SITE + '/courses', 'availability': 'https://schema.org/InStock'},
                'hasCourseInstance': {'@type': 'CourseInstance', 'courseMode': 'Online', 'location': {'@type': 'VirtualLocation', 'name': 'Zoom'}}})
    return out

def faq(s, page):
    if page == 'index.html':
        qa = re.findall(r'<details[^>]*><summary>(.*?)<i[^>]*></i></summary><p class="ans">(.*?)</p></details>', s, re.S)
    else:
        sec = re.search(r'<section id="faq"[^>]*>(.*?)</section>', s, re.S).group(1)
        qa = re.findall(r'<h3>(.*?)</h3><p>(.*?)</p>', sec, re.S)
    assert qa, page
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': txt(q),
            'acceptedAnswer': {'@type': 'Answer', 'text': txt(a)}} for q, a in qa]}

def book(s, rel, desc):
    info = s[s.find('class="bk-info"'):]
    name = txt(re.search(r'<h1>(.*?)</h1>', info).group(1)); sub = txt(re.search(r'class="bk-sub">(.*?)</p>', info).group(1))
    pages = re.search(r'<b>Pages</b>(\d+)', info); age = re.search(r'<b>Age</b>(\d+)–(\d+)', info)
    cover = re.search(r'<img src="([^"]+)"', s[s.find('class="car-track"'):]).group(1)
    d = {'@type': 'Book', 'name': name, 'alternativeHeadline': sub, 'description': desc, 'url': clean_url(rel),
         'image': SITE + '/books/' + cover, 'inLanguage': ['de', 'en'], 'publisher': ORG_REF,
         'bookFormat': ['https://schema.org/Paperback', 'https://schema.org/EBook']}
    if pages: d['numberOfPages'] = int(pages.group(1))
    if age: d['audience'] = {'@type': 'PeopleAudience', 'suggestedMinAge': int(age.group(1)), 'suggestedMaxAge': int(age.group(2))}
    else: d['educationalLevel'] = 'A1'
    return d, name, sub

def article(s, rel, desc):
    pub = re.search(r'<meta name="dfa:published" content="([^"]+)"', s); pub = pub.group(1) if pub else datetime.date.today().isoformat()
    return {'@type': 'Article', 'headline': txt(re.search(r'<h1>(.*?)</h1>', s, re.S).group(1)), 'description': desc,
            'image': OG_IMAGE, 'datePublished': pub, 'dateModified': pub, 'inLanguage': 'en',
            'author': ORG_REF, 'publisher': {'@id': ORG_ID}, 'url': clean_url(rel),
            'mainEntityOfPage': {'@type': 'WebPage', '@id': clean_url(rel)}}

def rewrite_links(s, rel):
    d = pathlib.PurePosixPath(rel).parent
    def fix(m):
        url, frag = m.group(2), m.group(3) or ''
        if re.match(r'[a-z]+:|//|#', url): return m.group(0)
        path = url[1:] if url.startswith('/') else str(pathlib.PurePosixPath(*([] if str(d) == '.' else [str(d)]), url))
        # normalise ../
        parts = []
        for p in path.split('/'):
            if p == '..': parts and parts.pop()
            elif p not in ('', '.'): parts.append(p)
        path = '/'.join(parts)
        if not (ROOT / path).is_file() and (ROOT / pathlib.PurePosixPath(path).name).is_file() and str(d) == 'books':
            path = pathlib.PurePosixPath(path).name     # the old broken books/books.html links
        if not (ROOT / path).is_file(): return m.group(0)
        if path in PRIVATE: return m.group(0)        # app pages (account/admin/portal...): JS rewrites these hrefs, leave as is
        return m.group(1) + clean_url(path)[len(SITE):] + frag + '"'
    return re.sub(r'(href=")([^"#?]*\.html)(#[^"]*)?"', fix, s)

def head_block(rel, title, desc, graph, ogtype='website'):
    url = clean_url(rel)
    tags = [f'<link rel="canonical" href="{url}">',
            f'<meta property="og:type" content="{ogtype}">', '<meta property="og:site_name" content="Deutsch Für Alle">',
            f'<meta property="og:title" content="{attr(title)}">', f'<meta property="og:description" content="{attr(desc)}">',
            f'<meta property="og:url" content="{url}">', '<meta property="og:locale" content="en_GB">',
            f'<meta property="og:image" content="{OG_IMAGE}">', '<meta property="og:image:type" content="image/jpeg">',
            '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
            '<meta property="og:image:alt" content="Deutsch Für Alle logo: online German classes on Zoom">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{attr(title)}">', f'<meta name="twitter:description" content="{attr(desc)}">',
            f'<meta name="twitter:image" content="{OG_IMAGE}">']
    ld = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    return '<!--seo-->\n' + '\n'.join(tags) + f'\n<script type="application/ld+json">{ld}</script>\n<!--/seo-->'

def main():
    files = sorted(str(p.relative_to(ROOT)) for p in [*ROOT.glob('*.html'), *ROOT.glob('books/*.html'), *ROOT.glob('blog/*.html')])
    lk = ROOT / 'links/index.html'; ls = lk.read_text(encoding='utf-8')
    if 'name="robots"' not in ls:   # short hub page that refreshes to the dfa-links site: keep it out of the index
        lk.write_text(ls.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">', 1), encoding='utf-8'); print('updated links/index.html')
    public = []
    for rel in files:
        p = ROOT / rel; s = p.read_text(encoding='utf-8'); o = s
        s = rewrite_links(s, rel)
        if rel != 'whatsapp.html':
            s = s.replace(WA, '/whatsapp')
            s = re.sub(r'https://wa\.me/\d+', '/whatsapp', s)
            s = s.replace('href="https://wa.me/"', 'href="/whatsapp"')  # book pages had a number-less wa.me link
            s = re.sub(r'href="/whatsapp\?text=[^"]*"', lambda m: m.group(0).replace('+', '%2B'), s)  # keep "A1 + A2" literal
        s = s.replace('https://youtube.com/@deutschfuralle-o', 'https://www.youtube.com/@deutschfuraalle')
        if rel in NOINDEX_ADD and 'name="robots"' not in s:
            s = s.replace('<meta name="viewport"', '<meta name="robots" content="noindex">' + '<meta name="viewport"', 1)
        if rel == 'kids-books.html':
            s = s.replace(SITE + '/books.html', SITE + '/books')
        if rel.startswith('books/') or rel == 'verify.html':   # last .html hrefs on public pages; site.js/dfa-auth.js handle /account
            s = s.replace('href="../account.html"', 'href="/account"').replace('href="account.html"', 'href="/account"')
        if rel == 'contact.html':      # card titles become H2s with the same look (.cn, see style.css)
            s = re.sub(r'<div class="card"><h3>(WhatsApp|Email|Instagram)</h3>', r'<div class="card"><h2 class="cn">\1</h2>', s)
        if rel == 'exam-prep.html':
            s = s.replace('<div class="mk-cta ac-card"><h3>Want a teacher to check your writing and speaking?</h3>',
                          '<div class="mk-cta ac-card"><h2 class="cn">Want a teacher to check your writing and speaking?</h2>')
        if rel == 'courses.html':
            s = s.replace('<h3 style="margin-top:10px">', '<h2 class="cn" style="margin-top:10px">')
            s = re.sub(r'(<h2 class="cn"[^>]*>[^<]*)</h3>', r'\1</h2>', s)
        noindex = re.search(r'<meta name="robots" content="[^"]*noindex', s)
        if rel not in PRIVATE and not noindex:
            public.append(rel)
            t_new, d_new = TITLES.get(rel, (None, None))
            graph = [ORG]
            desc = d_new or html.unescape(re.search(r'<meta name="description" content="([^"]*)"', s).group(1))
            ogtype = 'website'
            if rel.startswith('books/'):
                b, name, sub = book(s, rel, desc); graph.append(b); ogtype = 'book'
                if not t_new:
                    t_new = f'{sub} – {name} Book'
                    if len(t_new) > 60: t_new = f'{sub} – {name}'
                    if len(t_new) > 60: t_new = f'{SHORT_SUB.get(sub, sub)} – {name}'
            if rel == 'courses.html': graph += courses(s)
            if rel in PAGE_COURSES: graph += [PAGE_COURSES[rel], faq(s, rel)]
            if rel in ('index.html', 'resources.html'): graph.append(faq(s, rel))
            if rel.startswith('blog/'):
                ogtype = 'article'
                graph.append(article(s, rel, desc)); graph.append(faq(s, rel))
            if rel == 'index.html':
                graph.append({'@type': 'WebSite', '@id': SITE + '/#website', 'url': SITE + '/', 'name': 'Deutsch Für Alle', 'publisher': {'@id': ORG_ID}})
            if t_new: s = re.sub(r'<title>.*?</title>', lambda m: f'<title>{html.escape(t_new, quote=False)}</title>', s, count=1)
            if d_new: s = re.sub(r'<meta name="description" content="[^"]*">', lambda m: f'<meta name="description" content="{attr(d_new)}">', s, count=1)
            title = html.unescape(re.search(r'<title>(.*?)</title>', s).group(1))
            assert len(title) <= 60, (rel, len(title), title)
            s = re.sub(r'\n?<!--seo-->.*?<!--/seo-->', '', s, flags=re.S)
            s = re.sub(r'<link rel="canonical"[^>]*>\n?', '', s)
            blk = head_block(rel, title, desc, graph, ogtype)
            s, n = re.subn(r'(<meta name="description" content="[^"]*">)', lambda m: m.group(1) + '\n' + blk, s, count=1)
            assert n == 1, rel
        if s != o: p.write_text(s, encoding='utf-8'); print('updated', rel)
    today = datetime.date.today().isoformat()
    def lastmod(rel):
        dirty = subprocess.run(['git', 'status', '--porcelain', '--', rel], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        d = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', rel], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return today if dirty or not d else d
    order = lambda r: (r != 'index.html', r.startswith('books/'), r.startswith('blog/'), r)
    urls = ''.join(f'  <url><loc>{clean_url(r)}</loc><lastmod>{lastmod(r)}</lastmod></url>\n' for r in sorted(public, key=order))
    (ROOT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '</urlset>\n', encoding='utf-8')
    (ROOT / 'robots.txt').write_text('# Cloudflare adds its managed rules (AI crawler blocks, Content-Signal) above these lines.\n'
                                     'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n', encoding='utf-8')
    print(len(public), 'public pages in sitemap.xml')

if __name__ == '__main__': main()
