/** Login must never hang on "Please wait…", and staff/admins land on admin.html (assets/dfa-account.js). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'assets/dfa-account.js'), 'utf8');
const s0 = src.indexOf('function busy('), s1 = src.indexOf('async function done(');
assert.ok(s0 > 0 && s1 > s0, 'busy/wait/gateOrGo/done present');
const doneEnd = src.indexOf('\n', s1);
const code = src.slice(s0, src.indexOf('\n', src.indexOf('async function gateOrGo'))) + '\n' + src.slice(s1, doneEnd);
// fast fake timers: every timer fires on the next tick, so the 12 s / 4 s races resolve immediately
const fastTimeout = (fn) => setImmediate(fn);
function make(o) {
  const loc = { href: 'account.html' }, shown = [];
  const ctx = { setTimeout: fastTimeout, clearTimeout() {}, Promise, location: loc, safeNext: o.next || null, show: (v) => shown.push(v),
    document: { querySelector: (s) => (s === '.dfa-gate' && o.modal && o.modal()) ? {} : null },
    DFA: { gate: o.gate, profile: o.profile } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, loc, shown };
}
const never = () => new Promise(() => {});
// 1. a device check that never answers (and no code prompt open) does not block sign-in
{ const { ctx } = make({ gate: never }); assert.equal(await ctx.gateOrGo({}), true); }
// 2. while the email-code prompt is open we keep waiting for it
{ let n = 0; let resolve; const gp = new Promise((r) => { resolve = r; });
  const { ctx } = make({ gate: () => gp, modal: () => { n++; if (n === 3) resolve(false); return true; } });
  assert.equal(await ctx.gateOrGo({}), false, 'a refused gate is still respected'); assert.ok(n >= 3); }
// 3. after sign-in: ?next= wins, staff/admin go to admin.html, students see their profile, slow profile falls back to profile
{ const t = make({ gate: never, profile: async () => ({ role: 'admin' }), next: '/portal.html' }); await t.ctx.done(); assert.equal(t.loc.href, '/portal.html'); }
{ const t = make({ gate: never, profile: async () => ({ role: 'staff' }) }); await t.ctx.done(); assert.equal(t.loc.href, 'admin.html'); }
{ const t = make({ gate: never, profile: async () => ({ role: 'admin' }) }); await t.ctx.done(); assert.equal(t.loc.href, 'admin.html'); }
{ const t = make({ gate: never, profile: async () => ({ role: 'user' }) }); await t.ctx.done(); assert.deepEqual(t.shown, ['profile']); assert.equal(t.loc.href, 'account.html'); }
{ const t = make({ gate: never, profile: never }); await t.ctx.done(); assert.deepEqual(t.shown, ['profile']); }
// 4. the button shows progress instead of a frozen "Please wait…"
assert.ok(src.includes("'Still working…'") && src.includes("'Checking your device…'") && src.includes("'Signing in…'"));
assert.ok(/Promise\.race\(\[sb\.functions\.invoke\('security',\{body:\{action:'precheck'/.test(src), 'precheck is raced against a timer');
// 5. QA2 speed: lock check and sign-in start together; a locked account's session is closed at once; the profile loads during the device check
assert.ok(/var pcP=Promise\.race\(\[sb\.functions\.invoke\('security',\{body:\{action:'precheck',email:em\}\}\),wait\(8000,\{data:null\}\)\]\),siP=sb\.auth\.signInWithPassword\(/.test(src));
assert.ok(/if\(pc\.data&&pc\.data\.locked\)\{var r0=await siP;if\(r0&&r0\.data&&r0\.data\.session\)await sb\.auth\.signOut\(\{scope:'local'\}\)/.test(src));
assert.ok(/var pp=DFA\.profile\(\)\.catch\(function\(\)\{return null\}\);var g=await gateOrGo\(r\.data\.session\);[^\n]*await done\(pp\)/.test(src));
{ const t = make({ gate: never, profile: never }); await t.ctx.done(Promise.resolve({ role: 'admin' })); assert.equal(t.loc.href, 'admin.html', 'done() uses the profile that was loaded during the device check'); }
console.log('login-flow tests passed');
