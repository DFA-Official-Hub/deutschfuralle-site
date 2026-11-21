/** admin/portal/reader: GoatCounter records the page path only (no query, no hash), and the pages load no GA4/Meta/dfa-track.
 * Run: node --test tests/*.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERRIDE = "<script>window.goatcounter = { path: function () { return location.pathname || '/'; } };</script>";
const COUNT = /<script data-goatcounter="https:\/\/deutschfuralle\.goatcounter\.com\/count" async src="\/\/gc\.zgo\.at\/count\.js"><\/script>/;

for (const page of ['admin.html', 'portal.html', 'reader.html']) {
  const html = readFileSync(path.join(root, page), 'utf8');

  test(`${page}: path override sits immediately before count.js`, () => {
    const m = html.match(COUNT);
    assert.ok(m, 'count.js tag present');
    assert.equal(html.split(OVERRIDE).length - 1, 1, 'override present exactly once');
    assert.equal(html.indexOf(OVERRIDE) + OVERRIDE.length, m.index, 'override is directly before count.js');
    assert.ok(!/data-goatcounter-settings/.test(html), 'no data-goatcounter-settings that could replace window.goatcounter.path');
  });

  test(`${page}: CSP allows the inline script ('unsafe-inline', no nonce/hash)`, () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
    const src = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src '));
    assert.ok(src.split(/\s+/).includes("'unsafe-inline'"), src);
    assert.ok(!/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(src), src);
  });

  test(`${page}: no gtag, fbq or dfa-track`, () => {
    assert.ok(!/dfa-track/.test(html), 'dfa-track');
    assert.ok(!/gtag\(|googletagmanager\.com\/gtag\/js/.test(html), 'gtag');
    assert.ok(!/fbq\(|fbevents\.js/.test(html), 'fbq');
  });

  test(`${page}: path() returns pathname only`, () => {
    const code = OVERRIDE.replace(/^<script>|<\/script>$/g, '');
    for (const [loc, want] of [[{ pathname: '/portal.html', search: '?code=abc', hash: '#x' }, '/portal.html'],
                               [{ pathname: '/reader', search: '?id=42&token=z', hash: '' }, '/reader'],
                               [{ pathname: '', search: '?q=1', hash: '#h' }, '/']]) {
      const ctx = { location: loc }; ctx.window = ctx;
      vm.runInNewContext(code, ctx);
      // count.js calls path(p) with its own default (pathname + search); the result must ignore it
      const got = ctx.goatcounter.path('/portal.html?code=abc');
      assert.equal(got, want);
      assert.ok(!got.includes('?') && !got.includes('#'));
    }
  });
}
