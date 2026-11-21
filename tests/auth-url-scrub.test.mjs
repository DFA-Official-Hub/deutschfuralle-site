/** Auth-URL privacy in the shared tracking head (tools/tracking-head.html, copied into every public page).
 * Runs the REAL head scripts, the REAL GoatCounter count.js (tests/fixtures/goatcounter-count.js, ISC, copied from
 * gc.zgo.at/count.js) and assets/dfa-track.js in a sandbox, then reads what GA4 (dataLayer), GoatCounter (hit URL p/q/r),
 * Meta (location.href / document.referrer, which fbevents.js reads) and dfa-track (stored landing_page) would get.
 * Run: node --test tests/*.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(root, f), 'utf8');
const HEAD = read('tools/tracking-head.html');
const INLINE = [...HEAD.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);   // [0] scrub + consent, [1] gtag config
const COUNT = read('tests/fixtures/goatcounter-count.js');
const TRACK = read('assets/dfa-track.js');

function page(href, { referrer = '', canonical = null } = {}) {
  const u = new URL(href);
  const loc = { hostname: u.hostname, protocol: u.protocol };
  const set = h => { const x = new URL(h, u); Object.assign(loc, { href: x.href, pathname: x.pathname, search: x.search, hash: x.hash, origin: x.origin }); };
  set(href);
  let replaced = 0;
  const ls = new Map();
  const doc = {
    referrer, title: 'T', body: null, addEventListener() {},   // body null: count.js waits for DOMContentLoaded, so no auto-count in the sandbox
    querySelector: s => s.includes('canonical') ? (canonical ? { href: canonical } : null)
      : s === 'script[data-goatcounter]' ? { dataset: { goatcounter: 'https://deutschfuralle.goatcounter.com/count' } } : null,
    querySelectorAll: () => [],
    createElement: () => { const a = {}; Object.defineProperty(a, 'href', { set(v) { const x = new URL(v, loc.href); a.hostname = x.hostname; a.pathname = x.pathname; a.search = x.search; } }); return a; },
  };
  const ctx = {
    location: loc, document: doc, screen: { width: 390 }, navigator: {}, console, URL, URLSearchParams, JSON, Date, Math, String, RegExp,
    history: { state: null, replaceState(_s, _t, h) { replaced++; set(h); } },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    sessionStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => 'x' },
  };
  ctx.window = ctx; ctx.parent = { location: loc }; ctx.self = ctx;
  for (const s of INLINE) vm.runInNewContext(s, ctx);
  vm.runInNewContext(COUNT, ctx);
  vm.runInNewContext(TRACK, ctx);
  const dl = ctx.dataLayer.map(a => Array.from(a));
  const cfg = dl.find(a => a[0] === 'config')[2];
  const setv = dl.find(a => a[0] === 'set' && typeof a[1] === 'object')[1];
  const hit = new URL(ctx.goatcounter.url());
  const lt = ls.has('dfa-lt') ? JSON.parse(ls.get('dfa-lt')) : null, ft = JSON.parse(ls.get('dfa-ft'));
  return { replaced, bar: loc.href, cfg, setv, gc: { p: hit.searchParams.get('p'), q: hit.searchParams.get('q'), r: hit.searchParams.get('r') },
    hitUrl: hit.href.replace(/rnd=[^&]+/, 'rnd=…'), meta: { dl: loc.href, rl: referrer }, landing: (lt || ft).landing_page };
}
const SECRET = /code=|access_token|refresh_token|token_hash|type=|provider_token/;
function noSecrets(r) {
  for (const v of [r.bar, r.cfg.page_location, r.cfg.page_referrer, r.setv.page_location, r.setv.page_referrer, r.gc.p, r.gc.q, r.gc.r || '', r.meta.dl, r.landing])
    assert.ok(!SECRET.test(v || ''), `leaked: ${v}`);
}
const show = (name, before, r) => console.log(`  ${name}\n    before: ${before}\n    after:  bar=${r.bar} | GA4 page_location=${r.cfg.page_location} page_referrer=${JSON.stringify(r.cfg.page_referrer)} | GoatCounter p=${r.gc.p} q=${JSON.stringify(r.gc.q)} | Meta dl=${r.meta.dl} | dfa-track landing=${r.landing}\n    GoatCounter hit: ${r.hitUrl}`);

test('homepage ?code=abc&utm_source=x: code gone everywhere, utm_source kept', () => {
  const href = 'https://www.deutschfuralle.com/?code=abc&utm_source=x';
  const r = page(href, { canonical: 'https://www.deutschfuralle.com/' });
  show('homepage ?code=abc&utm_source=x', href, r);
  noSecrets(r);
  assert.equal(r.bar, 'https://www.deutschfuralle.com/?utm_source=x');
  assert.equal(r.cfg.page_location, 'https://www.deutschfuralle.com/?utm_source=x');
  assert.equal(r.setv.page_location, 'https://www.deutschfuralle.com/?utm_source=x');
  assert.equal(r.gc.p, '/');                     // canonical path, as before
  assert.equal(r.gc.q, '?utm_source=x');         // count.js sends location.search as q: now clean, utm kept
  assert.equal(r.meta.dl, 'https://www.deutschfuralle.com/?utm_source=x');
  assert.equal(r.landing, '/?utm_source=x');
  assert.equal(r.replaced, 1);
});

test('homepage #access_token&refresh_token&type=recovery (Supabase implicit hash): fully scrubbed', () => {
  const href = 'https://www.deutschfuralle.com/#access_token=AAA&expires_at=1&expires_in=3600&refresh_token=RRR&token_type=bearer&type=recovery';
  const r = page(href, { canonical: 'https://www.deutschfuralle.com/' });
  show('homepage #access_token…&type=recovery', href, r);
  noSecrets(r);
  assert.equal(r.bar, 'https://www.deutschfuralle.com/');
  assert.equal(r.cfg.page_location, 'https://www.deutschfuralle.com/');
  assert.equal(r.gc.q, null);
});

test('token_hash + type in the query (custom email template) is scrubbed', () => {
  const r = page('https://www.deutschfuralle.com/?token_hash=TH&type=recovery', { canonical: 'https://www.deutschfuralle.com/' });
  noSecrets(r);
  assert.equal(r.bar, 'https://www.deutschfuralle.com/');
});

test('normal URL unchanged, no replaceState', () => {
  const href = 'https://www.deutschfuralle.com/courses?utm_source=fb&utm_medium=social#faq';
  const r = page(href, { canonical: 'https://www.deutschfuralle.com/courses', referrer: 'https://www.google.com/' });
  show('normal URL', href, r);
  assert.equal(r.replaced, 0);
  assert.equal(r.bar, href);
  assert.equal(r.cfg.page_location, href.replace(/#.*$/, ''));   // GA4 page_location without fragment, as gtag does by default
  assert.equal(r.cfg.page_referrer, 'https://www.google.com/');
  assert.equal(r.gc.p, '/courses');
  assert.equal(r.gc.q, '?utm_source=fb&utm_medium=social');
});

test('gclid and fbclid kept', () => {
  const href = 'https://www.deutschfuralle.com/?gclid=G1&fbclid=F1&code=zzz';
  const r = page(href, { canonical: 'https://www.deutschfuralle.com/' });
  show('gclid/fbclid', href, r);
  noSecrets(r);
  assert.equal(r.bar, 'https://www.deutschfuralle.com/?gclid=G1&fbclid=F1');
  assert.equal(r.gc.q, '?gclid=G1&fbclid=F1');
});

test('referrer with auth params is scrubbed for GA4 and GoatCounter', () => {
  const r = page('https://www.deutschfuralle.com/courses', { canonical: 'https://www.deutschfuralle.com/courses', referrer: 'https://www.deutschfuralle.com/account.html?mode=reset&code=abc' });
  assert.equal(r.cfg.page_referrer, 'https://www.deutschfuralle.com/account.html?mode=reset');
  assert.equal(r.gc.r, 'https://www.deutschfuralle.com/account.html?mode=reset');
});

test('verify.html keeps the certificate ?code= in the address bar; GA4 and GoatCounter path get the clean URL', () => {
  const r = page('https://www.deutschfuralle.com/verify.html?code=DFA-CERT-1&access_token=x');
  assert.equal(r.bar, 'https://www.deutschfuralle.com/verify.html?code=DFA-CERT-1');
  assert.equal(r.cfg.page_location, 'https://www.deutschfuralle.com/verify.html');
  assert.equal(r.gc.p, '/verify.html');
});

test('every page with the tracking head carries the current scrub block, before gtag config', () => {
  const files = [...readdirSync(root).filter(f => f.endsWith('.html')), ...['books', 'blog', 'links'].flatMap(d => readdirSync(path.join(root, d)).filter(f => f.endsWith('.html')).map(f => `${d}/${f}`))];
  const scrub = INLINE[0].slice(0, INLINE[0].indexOf("gtag('consent'"));
  let n = 0;
  for (const f of files) {
    const h = read(f);
    if (!/gtag\('config'/.test(h)) continue;
    n++;
    assert.ok(h.includes(scrub), `${f}: scrub block missing or outdated`);
    assert.ok(h.indexOf(scrub) < h.indexOf("gtag('config'"), `${f}: scrub must run before gtag config`);
    assert.ok(h.indexOf(scrub) < h.indexOf('count.js') || !h.includes('count.js'), `${f}: scrub before count.js`);
    assert.match(h, /page_location:window\.DFA_CLEAN_URL,page_referrer:window\.DFA_CLEAN_REF/, f);
  }
  assert.ok(n >= 30, `pages with tracking head: ${n}`);
});
