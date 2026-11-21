/** Node tests for utm_medium fill-in in assets/dfa-track.js. Run: node --test tests/
 * Each case runs the whole script in a sandbox (fake location, document.referrer, localStorage) and reads the
 * stored first-/last-touch records. "before" = what the pre-change script stored (checked against origin/main when
 * git is available), "after" = what this version stores. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(root, 'assets/dfa-track.js'), 'utf8');
let OLD = null;
try { OLD = execFileSync('git', ['show', 'origin/main:assets/dfa-track.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { }
if (OLD && OLD.includes('function mediumFor')) OLD = null;   // after merge, main already has the change: skip the "before" check

function run(src, { search = '', referrer = '', store = {} } = {}) {
  const ls = new Map(Object.entries(store));
  const doc = { referrer, addEventListener() {} };
  const ctx = {
    location: { search, pathname: '/' }, document: doc, URL, URLSearchParams, JSON, Date, String, RegExp, Math,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' },
  };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  const g = k => (ls.has(k) ? JSON.parse(ls.get(k)) : null);
  return { ft: g('dfa-ft'), lt: g('dfa-lt'), attr: ctx.DFAAttr };
}
const pick = r => r && { utm_source: r.utm_source, utm_medium: r.utm_medium };

// [name, input, before {source, medium}, after {source, medium}]
const CASES = [
  ['ChatGPT UTM with no medium -> ai_referral', { search: '?utm_source=chatgpt.com' },
    { utm_source: 'chatgpt.com', utm_medium: undefined }, { utm_source: 'chatgpt.com', utm_medium: 'ai_referral' }],
  ['explicit medium kept (facebook / paid_social)', { search: '?utm_source=facebook&utm_medium=paid_social' },
    { utm_source: 'facebook', utm_medium: 'paid_social' }, { utm_source: 'facebook', utm_medium: 'paid_social' }],
  ['Google organic referrer -> organic', { referrer: 'https://www.google.com/' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'organic' }],
  ['google.com.pk referrer -> organic', { referrer: 'https://www.google.com.pk/' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'organic' }],
  ['gemini.google.com referrer -> ai_referral (AI checked before search)', { referrer: 'https://gemini.google.com/' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'ai_referral' }],
  ['chatgpt.com referrer, no UTMs -> ai_referral', { referrer: 'https://chatgpt.com/' },
    { utm_source: 'chatgpt.com', utm_medium: 'referral' }, { utm_source: 'chatgpt.com', utm_medium: 'ai_referral' }],
  ['social referrer (l.facebook.com) -> social', { referrer: 'https://l.facebook.com/' },
    { utm_source: 'facebook', utm_medium: 'social' }, { utm_source: 'facebook', utm_medium: 'social' }],
  ['social referrer (t.co) -> social', { referrer: 'https://t.co/abc' },
    { utm_source: 't.co', utm_medium: 'referral' }, { utm_source: 't.co', utm_medium: 'social' }],
  ['unknown referrer -> referral', { referrer: 'https://example.org/page' },
    { utm_source: 'example.org', utm_medium: 'referral' }, { utm_source: 'example.org', utm_medium: 'referral' }],
  ['look-alike notchatgpt.com referrer -> referral', { referrer: 'https://notchatgpt.com/' },
    { utm_source: 'notchatgpt.com', utm_medium: 'referral' }, { utm_source: 'notchatgpt.com', utm_medium: 'referral' }],
  ['look-alike google.com.evil.example referrer -> referral (source unchanged)', { referrer: 'https://google.com.evil.example/' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'referral' }],
  ['look-alike utm_source=notchatgpt.com -> referral', { search: '?utm_source=notchatgpt.com' },
    { utm_source: 'notchatgpt.com', utm_medium: undefined }, { utm_source: 'notchatgpt.com', utm_medium: 'referral' }],
  ['look-alike utm_source=google.com.evil.example -> referral', { search: '?utm_source=google.com.evil.example' },
    { utm_source: 'google.com.evil.example', utm_medium: undefined }, { utm_source: 'google.com.evil.example', utm_medium: 'referral' }],
  ['bare name utm_source=ig -> social', { search: '?utm_source=ig' },
    { utm_source: 'ig', utm_medium: undefined }, { utm_source: 'ig', utm_medium: 'social' }],
  ['bare name utm_source=google -> organic', { search: '?utm_source=google' },
    { utm_source: 'google', utm_medium: undefined }, { utm_source: 'google', utm_medium: 'organic' }],
  ['self-referral ignored (www.deutschfuralle.com)', { referrer: 'https://www.deutschfuralle.com/courses' },
    { utm_source: 'direct', utm_medium: 'none' }, { utm_source: 'direct', utm_medium: 'none' }],
];

for (const [name, input, before, after] of CASES) {
  test(name, () => {
    const now = run(SRC, input);
    console.log(`  ${name}\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(pick(now.lt || now.ft))}`);
    assert.deepEqual(pick(now.lt || now.ft), after);
    assert.deepEqual(pick(now.ft), after, 'first touch written on first visit');
    if (OLD) { const was = run(OLD, input); assert.deepEqual(pick(was.lt || was.ft), before, 'before value matches origin/main'); }
  });
}

test('direct visit (no referrer, no UTMs) unchanged: direct/none, no last touch', () => {
  const now = run(SRC, {});
  console.log(`  direct\n    before: {"utm_source":"direct","utm_medium":"none"} (no dfa-lt)\n    after:  ${JSON.stringify(pick(now.ft))} (dfa-lt ${now.lt ? 'set' : 'not set'})`);
  assert.deepEqual(pick(now.ft), { utm_source: 'direct', utm_medium: 'none' });
  assert.equal(now.lt, null);
  if (OLD) { const was = run(OLD, {}); assert.deepEqual(was.ft && { s: was.ft.utm_source, m: was.ft.utm_medium, p: was.ft.landing_page }, { s: now.ft.utm_source, m: now.ft.utm_medium, p: now.ft.landing_page }); assert.equal(was.lt, null); }
});

test('first touch never overwritten; last touch updated; other fields untouched', () => {
  const ft = { utm_source: 'facebook', utm_medium: 'paid_social', landing_page: '/', ts: 'x' };
  const now = run(SRC, { search: '?utm_source=chatgpt.com&utm_campaign=spring', store: { 'dfa-ft': JSON.stringify(ft) } });
  assert.deepEqual(now.ft, ft);
  assert.equal(now.lt.utm_source, 'chatgpt.com');
  assert.equal(now.lt.utm_medium, 'ai_referral');
  assert.equal(now.lt.utm_campaign, 'spring');
  assert.equal(now.lt.landing_page, '/?utm_source=chatgpt.com&utm_campaign=spring');
});

test('mediumFor helper: exact host or subdomain only, AI first, ccTLDs, bare names', () => {
  const a = SRC.indexOf('  var TLD='), b = SRC.indexOf('  function clean(');
  assert.ok(a > 0 && b > a, 'helper block found');
  const ctx = {}; vm.runInNewContext(SRC.slice(a, b) + ';this.mediumFor=mediumFor;', ctx);
  const m = ctx.mediumFor;
  const expect = {
    'chatgpt.com': 'ai_referral', 'chat.openai.com': 'ai_referral', 'perplexity.ai': 'ai_referral', 'www.perplexity.ai': 'ai_referral',
    'gemini.google.com': 'ai_referral', 'copilot.microsoft.com': 'ai_referral', 'claude.ai': 'ai_referral', 'CHATGPT.COM': 'ai_referral',
    'https://chatgpt.com/c/1': 'ai_referral', 'notchatgpt.com': 'referral', 'chatgpt.com.evil.example': 'referral', 'microsoft.com': 'referral',
    'google.com': 'organic', 'www.google.co.uk': 'organic', 'google.com.pk': 'organic', 'google.de': 'organic', 'bing.com': 'organic',
    'duckduckgo.com': 'organic', 'search.yahoo.com': 'organic', 'yandex.ru': 'organic', 'yandex.com.tr': 'organic', 'baidu.com': 'organic',
    'ecosia.org': 'organic', 'google.com.evil.example': 'referral', 'notgoogle.com': 'referral', 'google.evil.example': 'referral', 'mybing.com': 'referral',
    'facebook.com': 'social', 'm.facebook.com': 'social', 'l.facebook.com': 'social', 'lm.facebook.com': 'social', 'fb.com': 'social',
    'instagram.com': 'social', 'threads.net': 'social', 'threads.com': 'social', 't.co': 'social', 'x.com': 'social', 'twitter.com': 'social',
    'linkedin.com': 'social', 'lnkd.in': 'social', 'youtube.com': 'social', 'm.youtube.com': 'social', 'youtu.be': 'social', 'tiktok.com': 'social',
    'pinterest.com': 'social', 'pinterest.co.uk': 'social', 'pk.pinterest.com': 'social', 'reddit.com': 'social', 'whatsapp.com': 'social',
    'wa.me': 'social', 'notfacebook.com': 'referral', 'facebook.com.evil.example': 'referral', 'xx.com': 'referral', 'tt.co': 'referral',
    'facebook': 'social', 'fb': 'social', 'ig': 'social', 'instagram': 'social', 'google': 'organic', 'chatgpt': 'ai_referral',
    'newsletter': 'referral', 'example.org': 'referral', '': 'referral',
  };
  for (const [k, v] of Object.entries(expect)) assert.equal(m(k), v, k);
});
