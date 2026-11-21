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
// "before" = assets/dfa-track.js on origin/main. Fails loudly if origin/main can't be read (run `git fetch origin` first).
// Once this change is on main, "before" is the parent of the commit that introduced mediumFor, so the check keeps working.
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let OLD, BEFORE_REF = 'origin/main';
try { OLD = git('show', `${BEFORE_REF}:assets/dfa-track.js`); }
catch (e) { throw new Error(`cannot read origin/main:assets/dfa-track.js for the "before" check; run \`git fetch origin\` first (${String(e.stderr || e.message).trim()})`); }
if (OLD.includes('function mediumFor')) {
  const intro = git('log', '--reverse', '--format=%H', '-S', 'function mediumFor', 'origin/main', '--', 'assets/dfa-track.js').trim().split('\n')[0];
  if (!intro) throw new Error('origin/main has mediumFor but its introducing commit was not found');
  BEFORE_REF = intro + '^'; OLD = git('show', `${BEFORE_REF}:assets/dfa-track.js`);
}
assert.ok(!OLD.includes('function mediumFor'), 'before script must be the pre-change version');
console.log(`before = ${BEFORE_REF}:assets/dfa-track.js`);

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
const AA = pkg => `android-app://${pkg}/`;

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
  ['android-app Google search app referrer -> organic', { referrer: AA('com.google.android.googlequicksearchbox') },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'organic' }],
  ['android-app Facebook (com.facebook.katana) referrer -> social', { referrer: AA('com.facebook.katana') },
    { utm_source: 'facebook', utm_medium: 'social' }, { utm_source: 'facebook', utm_medium: 'social' }],
  ['android-app Instagram (com.instagram.android) referrer -> social', { referrer: AA('com.instagram.android') },
    { utm_source: 'instagram', utm_medium: 'social' }, { utm_source: 'instagram', utm_medium: 'social' }],
  ['android-app LinkedIn (com.linkedin.android) referrer -> social', { referrer: AA('com.linkedin.android') },
    { utm_source: 'linkedin', utm_medium: 'social' }, { utm_source: 'linkedin', utm_medium: 'social' }],
  ['android-app Twitter/X (com.twitter.android) referrer -> social', { referrer: AA('com.twitter.android') },
    { utm_source: 'com.twitter.android', utm_medium: 'referral' }, { utm_source: 'com.twitter.android', utm_medium: 'social' }],
  ['android-app TikTok (com.zhiliaoapp.musically) referrer -> social', { referrer: AA('com.zhiliaoapp.musically') },
    { utm_source: 'com.zhiliaoapp.musically', utm_medium: 'referral' }, { utm_source: 'com.zhiliaoapp.musically', utm_medium: 'social' }],
  ['android-app YouTube (com.google.android.youtube) referrer -> social (source unchanged)', { referrer: AA('com.google.android.youtube') },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'social' }],
  ['android-app Pinterest (com.pinterest) referrer -> social', { referrer: AA('com.pinterest') },
    { utm_source: 'pinterest', utm_medium: 'social' }, { utm_source: 'pinterest', utm_medium: 'social' }],
  ['android-app unknown package referrer -> referral', { referrer: AA('com.example.reader') },
    { utm_source: 'com.example.reader', utm_medium: 'referral' }, { utm_source: 'com.example.reader', utm_medium: 'referral' }],
  ['trailing-dot referrer www.google.com. -> organic', { referrer: 'https://www.google.com./' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'organic' }],
  ['trailing-dot referrer m.facebook.com. -> social', { referrer: 'https://m.facebook.com./' },
    { utm_source: 'facebook', utm_medium: 'social' }, { utm_source: 'facebook', utm_medium: 'social' }],
  ['trailing-dot utm_source=google.com. -> organic', { search: '?utm_source=google.com.' },
    { utm_source: 'google.com.', utm_medium: undefined }, { utm_source: 'google.com.', utm_medium: 'organic' }],
  ['medium-only ?utm_medium=email + Google referrer -> email kept', { search: '?utm_medium=email', referrer: 'https://www.google.com/' },
    { utm_source: 'google', utm_medium: 'organic' }, { utm_source: 'google', utm_medium: 'email' }],
  ['self-referral ignored (www.deutschfuralle.com)', { referrer: 'https://www.deutschfuralle.com/courses' },
    { utm_source: 'direct', utm_medium: 'none' }, { utm_source: 'direct', utm_medium: 'none' }],
];

for (const [name, input, before, after] of CASES) {
  test(name, () => {
    const now = run(SRC, input);
    console.log(`  ${name}\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(pick(now.lt || now.ft))}`);
    assert.deepEqual(pick(now.lt || now.ft), after);
    assert.deepEqual(pick(now.ft), after, 'first touch written on first visit');
    const was = run(OLD, input); assert.deepEqual(pick(was.lt || was.ft), before, `before value matches ${BEFORE_REF}`);
  });
}

test('direct visit (no referrer, no UTMs) unchanged: direct/none, no last touch', () => {
  const now = run(SRC, {});
  console.log(`  direct\n    before: {"utm_source":"direct","utm_medium":"none"} (no dfa-lt)\n    after:  ${JSON.stringify(pick(now.ft))} (dfa-lt ${now.lt ? 'set' : 'not set'})`);
  assert.deepEqual(pick(now.ft), { utm_source: 'direct', utm_medium: 'none' });
  assert.equal(now.lt, null);
  const was = run(OLD, {}); assert.deepEqual(was.ft && { s: was.ft.utm_source, m: was.ft.utm_medium, p: was.ft.landing_page }, { s: now.ft.utm_source, m: now.ft.utm_medium, p: now.ft.landing_page }); assert.equal(was.lt, null);
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
  const a = SRC.indexOf('  var TLD='), b = SRC.indexOf('  // android-app://');
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
    'www.google.com.': 'organic', 'm.facebook.com.': 'social', 'chatgpt.com.': 'ai_referral', 'notchatgpt.com.': 'referral',
    'newsletter': 'referral', 'example.org': 'referral', '': 'referral',
  };
  for (const [k, v] of Object.entries(expect)) assert.equal(m(k), v, k);
});

test('appHost helper: known packages, reversed leading domain otherwise', () => {
  const a = SRC.indexOf('  var TLD='), b = SRC.indexOf('  function clean(');
  const ctx = {}; vm.runInNewContext(SRC.slice(a, b) + ';this.appHost=appHost;this.mediumFor=mediumFor;', ctx);
  const expect = {
    'com.google.android.googlequicksearchbox': ['google.com', 'organic'], 'com.google.android.youtube': ['youtube.com', 'social'],
    'com.google.android.apps.bard': ['gemini.google.com', 'ai_referral'], 'com.openai.chatgpt': ['chatgpt.com', 'ai_referral'],
    'com.facebook.katana': ['facebook.com', 'social'], 'com.instagram.android': ['instagram.com', 'social'], 'com.linkedin.android': ['linkedin.com', 'social'],
    'com.twitter.android': ['x.com', 'social'], 'com.zhiliaoapp.musically': ['tiktok.com', 'social'], 'com.pinterest': ['pinterest.com', 'social'],
    'com.reddit.frontpage': ['reddit.com', 'social'], 'com.whatsapp': ['whatsapp.com', 'social'], 'com.example.reader': ['example.com', 'referral'],
  };
  for (const [pkg, [host, med]] of Object.entries(expect)) { assert.equal(ctx.appHost(pkg), host, pkg); assert.equal(ctx.mediumFor(ctx.appHost(pkg)), med, pkg); }
});
