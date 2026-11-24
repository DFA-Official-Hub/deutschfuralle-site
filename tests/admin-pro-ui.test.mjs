/** Node tests for the admin portal upgrade UI (assets/dfa-admin-pro.js + its wiring in dfa-admin.js / admin.html). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const pro = read('assets/dfa-admin-pro.js'), adm = read('assets/dfa-admin.js'), html = read('admin.html'), css = read('assets/dfa-admin-pro.css');
const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');

// 1. never leak the business WhatsApp number or the private Gmail address
const leak = String.fromCharCode(57, 50, 51, 49, 56, 50, 49, 54, 54, 52, 52, 51);
const privMail = ['deutsch', 'furaalle', '@', 'gmail.com'].join('');
for (const [n, s] of [['dfa-admin-pro.js', pro], ['dfa-admin.js', adm], ['admin.html', html], ['test', self]]) {
  assert.equal(s.includes(leak), false, `${n} must not contain blocked WA digits`);
  assert.equal(s.includes(privMail), false, `${n} must not contain the private Gmail address`);
}
assert.ok(pro.includes('contact.deutschfuralle@gmail.com'), 'printed receipts use the public contact email');
// wa.me links are only built from waDigits() (which refuses the business number)
for (const m of pro.matchAll(/wa\.me\/'\+(\w+)/g)) assert.equal(m[1], 'dig', 'wa.me link must use digits from A.waDigits');
assert.ok(/var dig=x&&A\.waDigits\(x\.phone\)/.test(pro));

// 2. every hint key used with T('…') / lab('…') exists
const hkeys = new Set();
for (const src of [pro, adm]) for (const m of src.matchAll(/^\s*([A-Za-z0-9_]+):'/gm)) hkeys.add(m[1]);
const used = new Set([...pro.matchAll(/\b(?:T|lab)\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]));
const missing = [...used].filter((k) => !hkeys.has(k));
assert.deepEqual(missing, [], 'hint keys without text: ' + missing.join(', '));
// every button/select/input written in the pro module carries a hint (title or T()) or is a plain checkbox/radio inside a labelled control
const ctrls = [...pro.matchAll(/<(button|select|input|textarea)\b[^>]*>/g)].map((m) => m[0]);
const bare = ctrls.filter((c) => !/onclick="print\(\)"|data-pg=/.test(c)).filter((c) => !/title=|'\+T\(|\+T\(|aria-label=|type="(radio|checkbox|hidden)"|data-full=|\[value=/.test(c) && !/class="adm-mask"/.test(c));
assert.deepEqual(bare, [], 'controls without a hint:\n' + bare.join('\n'));

// 3. wiring: admin.html loads the module before dfa-admin.js; the stylesheet survives build.py (has ?v=)
assert.ok(html.indexOf('dfa-admin-pro.js') > 0 && html.indexOf('dfa-admin-pro.js') < html.indexOf('dfa-admin.js?v='));
assert.match(html, /<link rel="stylesheet" href="assets\/dfa-admin-pro\.css\?v=\d+">/);
assert.ok(adm.includes("p.role!=='admin'&&p.role!=='staff'"), 'staff may open the portal');
assert.ok(/\['us','Accounts','accounts',1\]/.test(adm) && /\['sc','Security','security',1\]/.test(adm) && /\['st','Settings','settings',1\]/.test(adm), 'Accounts/Security/Settings are admin-only tabs');
assert.ok(adm.includes('<select id="enf" hidden aria-hidden'), 'hidden #enf keeps older enr(#enf.value) callers working');
assert.ok(/@media \(max-width:700px\)\{\.adm-tabs\{display:none!important\}/.test(css), 'mobile uses the section picker instead of the tab strip');

// 4. run the module with small stubs and test its pure helpers
const H = { tabs: {} };
const doc = { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } };
const ctx = { window: {}, document: doc, console, localStorage: { getItem: () => null, setItem() {} }, DFA: { invoke: async () => ({ data: { ok: true } }) }, Promise, Date, Math, JSON, String, Number, Object, Array, encodeURIComponent, setTimeout, clearTimeout };
vm.runInNewContext(pro, ctx);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const courses = [{ code: 'a1-normal', short_code: 'A1N', name: 'A1 Normal' }];
const api = ctx.window.ADMPRO({ sb: {}, E: esc, T: (k) => ` title="${esc(H[k] || k)}"`, lab: (k, t) => t, dlg() {}, toast() {}, pk: (n) => 'PKR ' + n, d: (x) => x, today: () => '2026-11-25', H, P: { METHODS: {} }, role: 'admin', me: 'u1', courses: () => courses, copts: () => '', mopts: () => '', waDigits: () => '' });
assert.ok(H.dbCollected && H.tabs.db, 'hints are merged into the shared hint table');
for (const k of ['db', 'bt', 'rm', 'ac', 'dq', 'us', 'rv']) assert.equal(typeof api.tabs[k], 'function', 'tab ' + k);
// CSV / Excel formula-injection guard
assert.equal(api.safeCell('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
assert.equal(api.safeCell('+92300'), "'+92300");
assert.equal(api.safeCell('@SUM(A1)'), "'@SUM(A1)");
assert.equal(api.safeCell(-500), -500, 'numbers stay numbers');
assert.equal(api.safeCell('Ali'), 'Ali');
const csv = api.toCsv([{ Name: 'A, "B"', Amount: 5, F: '=1+1' }]);
assert.equal(csv, '\ufeffName,Amount,F\r\n"A, ""B""",5,\'=1+1');
// batch code suggestion: course + YYMM, then slot, then -2
assert.equal(api.suggestCode('a1-normal', '2026-12-01', '18:30', []), 'A1N-2612');
assert.equal(api.suggestCode('a1-normal', '2026-12-01', '18:30', [{ id: 1, code: 'A1N-2612' }]), 'A1N-2612-1830');
assert.equal(api.suggestCode('a1-normal', '2026-12-01', '', [{ id: 1, code: 'A1N-2612' }]), 'A1N-2612-2');
assert.equal(api.suggestCode('a1-normal', '2026-12-01', '', [{ id: 1, code: 'A1N-2612' }], 1), 'A1N-2612', 'own code is not "taken"');
// phone normalisation for duplicate checks
assert.equal(api.normPhone('0300-1234567'), '923001234567');
assert.equal(api.normPhone('+92 300 1234567'), '923001234567');
assert.equal(api.normPhone('12'), '');
// masking: values are hidden until clicked; nothing raw is in the visible text
const m1 = api.mask('ali.khan@example.com', 'email');
assert.match(m1, />a•••@e•••\.com</);
assert.match(api.mask('03001234567', 'phone'), />030•••67</);
assert.match(api.mask('203.0.113.9', 'ip'), />203\.0\.•••\.•••</);
assert.equal(api.mask('', 'email'), '');
// payment proof chip only for a stored file or a real Drive file link
assert.equal(api.proofOk({ proof_file: 'payment-proofs/1/2-3.jpg' }), true);
assert.equal(api.proofOk({ proof_url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view' }), true);
assert.equal(api.proofOk({ proof_url: 'https://example.com/x.png' }), false);
assert.equal(api.proofOk({}), false);
assert.equal(api.histExtra({ id: 7, reference: 'TID9' }).includes('data-p="proof-view"'), false, 'no proof link without a file');
assert.ok(api.histExtra({ id: 7, reference: 'TID9' }).includes('Ref TID9'));
assert.equal(api.histExtra({ id: 7 }).includes('Add ref/proof'), true);
// staff build: no export button, no admin tabs from the module
const H2 = { tabs: {} };
const st = ctx.window.ADMPRO({ sb: {}, E: esc, T: (k) => ` title="${k}"`, lab: (k, t) => t, dlg() {}, toast() {}, pk: String, d: String, today: () => '2026-11-25', H: H2, P: { METHODS: {} }, role: 'staff', me: 'u2', courses: () => courses, copts: () => '', mopts: () => '', waDigits: () => '' });
assert.ok(/if\(!ADMIN\)return alert\('Only admins can export data\.'\)/.test(pro), 'export refuses staff');
assert.ok(st && typeof st.decorate === 'function');
console.log('admin-pro-ui tests passed');
