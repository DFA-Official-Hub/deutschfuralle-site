/** admin/portal/reader (private app pages, auth codes and ids in the URL): no analytics at all, i.e. no GoatCounter,
 * no GA4 (gtag), no Meta (fbq) and no dfa-track, and no GoatCounter hosts in the CSP. Public pages keep GoatCounter.
 * Run: node --test tests/*.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(root, f), 'utf8');
const cspOf = html => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  assert.ok(m, 'CSP meta present');
  return Object.fromEntries(m[1].split(';').map(s => s.trim()).filter(Boolean).map(d => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
};

for (const page of ['admin.html', 'portal.html', 'reader.html']) {
  const html = read(page);
  test(`${page}: zero goatcounter / zgo.at / count.js references`, () => {
    for (const re of [/goatcounter/i, /zgo\.at/i, /count\.js/i]) assert.ok(!re.test(html), `${page} matches ${re}`);
  });
  test(`${page}: no gtag, fbq or dfa-track`, () => {
    for (const re of [/gtag/i, /fbq/i, /dfa-track/i]) assert.ok(!re.test(html), `${page} matches ${re}`);
  });
  test(`${page}: CSP script-src / connect-src keep their other entries`, () => {
    const c = cspOf(html);
    assert.deepEqual(c['script-src'], ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://challenges.cloudflare.com',
      'https://static.cloudflareinsights.com', 'https://www.googletagmanager.com', 'https://connect.facebook.net']);
    assert.ok(c['connect-src'].includes('https://owmsddezprhrjiinznmq.supabase.co'));
    assert.ok(c['connect-src'].includes('wss://owmsddezprhrjiinznmq.supabase.co'));
  });
  test(`${page}: footer book links still present (attributes removed only)`, () => {
    for (const href of ['https://deutschfur.gumroad.com/l/rbvhw', 'https://www.amazon.com/stores/Ali-Siddique/author/B0HNV368NN',
      'https://www.amazon.com/dp/B0HNHL4PJW', 'https://www.amazon.com/dp/B0HNHL3T3R', 'https://www.etsy.com/listing/4596963198',
      'https://deutschfur.gumroad.com/l/zoulu', 'https://deutschfur.gumroad.com/l/tfrqgx'])
      assert.ok(html.includes(`<a href="${href}" target="_blank" rel="noopener">`), href);
  });
}

test('index.html (public) still loads GoatCounter count.js and allows it in the CSP', () => {
  const html = read('index.html');
  assert.match(html, /<script data-goatcounter="https:\/\/deutschfuralle\.goatcounter\.com\/count" async src="\/\/gc\.zgo\.at\/count\.js"><\/script>/);
  const c = cspOf(html);
  assert.ok(c['script-src'].includes('https://gc.zgo.at'));
  assert.ok(c['connect-src'].includes('https://*.goatcounter.com'));
});
