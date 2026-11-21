/** Sign-up conversion hand-over: account.html (private, no analytics) sets localStorage 'dfa-pending-signup' = {m:'email',ts};
 * assets/dfa-track.js fires GA4 sign_up once on the next PUBLIC page (Meta CompleteRegistration only with consent) and removes it.
 * Run: node --test tests/*.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACK = readFileSync(path.join(root, 'assets/dfa-track.js'), 'utf8');
const ACCOUNT = readFileSync(path.join(root, 'assets/dfa-account.js'), 'utf8');
const K = 'dfa-pending-signup';
const DAY = 864e5;
const plain = v => JSON.parse(JSON.stringify(v));   // sandbox objects come from another realm

function load({ pathname = '/', store, consent = true, fbq = true, gtag = true } = {}) {
  const calls = { gtag: [], fbq: [] };
  const ctx = {
    location: { search: '', pathname, href: 'https://www.deutschfuralle.com' + pathname }, document: { referrer: '', addEventListener() {} },
    URL, URLSearchParams, JSON, Date, Math, String, RegExp, setTimeout, clearTimeout,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
    DFAConsent: { granted: () => consent },
  };
  ctx.window = ctx;
  if (gtag) ctx.gtag = (...a) => calls.gtag.push(a);
  if (fbq) ctx.fbq = (...a) => calls.fbq.push(a);
  vm.runInNewContext(TRACK, ctx);
  return { calls, ctx };
}
const flag = (ts = Date.now(), m = 'email') => JSON.stringify({ m, ts });
const signups = c => c.gtag.filter(a => a[0] === 'event' && a[1] === 'sign_up');
const regs = c => c.fbq.filter(a => a[0] === 'track' && a[1] === 'CompleteRegistration');

test('fresh flag fires GA4 sign_up and Meta CompleteRegistration exactly once, then is removed', () => {
  const store = new Map([[K, flag()]]);
  const a = load({ store });
  assert.equal(signups(a.calls).length, 1);
  assert.equal(regs(a.calls).length, 1);
  assert.equal(store.has(K), false);
  const b = load({ store });                     // second page load
  assert.equal(signups(b.calls).length, 0);
  assert.equal(regs(b.calls).length, 0);
  console.log(`  before: ${K}=${flag(1)} | after 1st load: gtag ${JSON.stringify(signups(a.calls)[0])}, fbq ${JSON.stringify(regs(a.calls)[0])} | 2nd load: nothing`);
});

test('never fires on private paths; the flag is left for a public page', () => {
  for (const p of ['/account.html', '/account', '/admin.html', '/portal.html', '/portal/', '/portal/index.html', '/reader', '/doc.html']) {
    const store = new Map([[K, flag()]]);
    const r = load({ pathname: p, store });
    assert.equal(signups(r.calls).length + regs(r.calls).length, 0, p);
    assert.equal(store.has(K), true, p);
  }
});

test('no consent: GA4 still fires, no fbq, flag not kept', () => {
  const store = new Map([[K, flag()]]);
  const r = load({ store, consent: false });
  assert.equal(signups(r.calls).length, 1);
  assert.equal(r.calls.fbq.length, 0);
  assert.equal(store.has(K), false);
});

test('expired (8 days) flag is dropped without firing', () => {
  const store = new Map([[K, flag(Date.now() - 8 * DAY)]]);
  const r = load({ store });
  assert.equal(signups(r.calls).length + regs(r.calls).length, 0);
  assert.equal(store.has(K), false);
});

test('malformed flags are dropped without firing', () => {
  for (const raw of ['{bad', '"x"', 'null', '{"m":"email"}', JSON.stringify({ m: 'google', ts: Date.now() }), flag(Date.now() + DAY), JSON.stringify({ m: 'email', ts: String(Date.now()) })]) {
    const store = new Map([[K, raw]]);
    const r = load({ store });
    assert.equal(signups(r.calls).length + regs(r.calls).length, 0, raw);
    assert.equal(store.has(K), false, raw);
  }
});

test('event params carry no email, id or user fields', () => {
  const store = new Map([[K, JSON.stringify({ m: 'email', ts: Date.now(), email: 'a@b.c', id: 'u1' })]]);   // extra junk must not leak
  const r = load({ store });
  assert.deepEqual(plain(signups(r.calls)[0][2]), { method: 'email' });
  const reg = regs(r.calls)[0];
  assert.deepEqual(plain(reg[2]), {});
  assert.deepEqual(Object.keys(reg[3]), ['eventID']);
  assert.ok(!/@|"u1"|user|"email":|"id":/i.test(JSON.stringify([signups(r.calls), regs(r.calls)])));
});

test('gtag not defined yet: sign_up is queued on dataLayer for gtag.js', () => {
  const store = new Map([[K, flag()]]);
  const r = load({ store, gtag: false, fbq: false });
  const q = plain((r.ctx.dataLayer || []).map(a => Array.from(a)));
  assert.deepEqual(q.find(a => a[1] === 'sign_up'), ['event', 'sign_up', { method: 'email' }]);
});

test('account.html sign-up handler sets only {m,ts} and calls no gtag/fbq/DFATrack', () => {
  assert.ok(!/gtag\(|fbq\(|DFATrack/.test(ACCOUNT), 'dfa-account.js has no analytics calls');
  const a = ACCOUNT.indexOf('var r=await sb.auth.signUp('), b = ACCOUNT.indexOf("app.innerHTML='<h2>Check your inbox", a);
  assert.ok(a > 0 && b > a);
  const handler = ACCOUNT.slice(a, b);
  const m = handler.match(/try\{localStorage\.setItem\('dfa-pending-signup'.*?\}catch\(x\)\{\}/);
  assert.ok(m, 'flag set in the signUp success path');
  assert.ok(handler.indexOf(m[0]) > handler.indexOf('if(r.error)return'), 'flag only after a successful signUp');
  const store = new Map();
  vm.runInNewContext(m[0], { localStorage: { setItem: (k, v) => store.set(k, v) }, JSON, Date });
  const v = JSON.parse(store.get(K));
  assert.deepEqual(Object.keys(v).sort(), ['m', 'ts']);
  assert.equal(v.m, 'email');
  assert.ok(Math.abs(Date.now() - v.ts) < 5000);
});
