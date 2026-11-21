/** verify.html: dfa-auth.js must not treat the certificate ?code= as a PKCE auth callback (detectSessionInUrl off on /verify only).
 * links/index.html: kept in sync with tools/tracking-head.html by tools/add_tracking_head.py, except its one gtag config line. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(root, f), 'utf8');

function authOptions(pathname) {
  let opts = null;
  const ctx = { location: { pathname }, localStorage: { getItem: () => null }, sessionStorage: {},
    supabase: { createClient: (_u, _k, o) => { opts = o; throw new Error('stop'); } } };
  ctx.window = ctx;
  try { vm.runInNewContext(read('assets/dfa-auth.js'), ctx); } catch (e) { if (e.message !== 'stop') throw e; }
  return opts.auth;
}

test('dfa-auth: detectSessionInUrl is false on /verify only', () => {
  for (const p of ['/verify', '/verify.html', '/verify/']) assert.equal(authOptions(p).detectSessionInUrl, false, p);
  for (const p of ['/account.html', '/account', '/portal.html', '/', '/verify-something']) assert.equal(authOptions(p).detectSessionInUrl, true, p);
  assert.equal(authOptions('/account.html').flowType, 'pkce');
});

test('verify.html still loads dfa-auth (DFA.sb) and dfa-verify, which auto-checks ?code=', () => {
  const h = read('verify.html');
  assert.ok(h.indexOf('dfa-auth.js') > 0 && h.indexOf('dfa-auth.js') < h.indexOf('dfa-verify.js'));
  assert.match(read('assets/dfa-verify.js'), /new URLSearchParams\(location\.search\)\.get\('code'\);if\(q\)check\(q\)/);
});

test('links/index.html carries the current tracking head (only the gtag config line differs)', () => {
  const snip = read('tools/tracking-head.html').trimEnd();
  const tool = read('tools/add_tracking_head.py');
  const cfg = tool.match(/^CFG="(.*)"$/m)[1], linksCfg = tool.match(/^LINKS_CFG="(.*)"$/m)[1];
  assert.ok(snip.includes(cfg));
  const links = read('links/index.html');
  assert.ok(links.includes(snip.replace(cfg, linksCfg)), 'links/index.html head is stale: run python3 tools/add_tracking_head.py');
  assert.match(links, /gtag\('event','page_view',\{event_callback:/);   // why its config has send_page_view:false
  assert.ok(links.indexOf('window.DFA_SCRUB=cl') < links.indexOf("gtag('config'"));
});
