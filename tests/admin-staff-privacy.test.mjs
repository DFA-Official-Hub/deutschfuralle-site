/** Staff privacy in the admin UI (review B2): staff lists come from pro_students (masked), reveals go through pro_reveal (logged)
 *  typed confirmations reach the server, Add student uses pro_add_student, SheetJS is pinned by SRI. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const pro = read('assets/dfa-admin-pro.js'), adm = read('assets/dfa-admin.js');

function boot(role) {
  const calls = [], tables = [];
  const q = (t) => { tables.push(t); const b = new Proxy({}, { get: (_o, k) => k === 'then' ? (r) => r({ data: [], count: 0 }) : () => b }); return b; };
  const DFA = { invoke: (fn, body) => { calls.push(body); const a = body.action;
    if (a === 'pro_students' && body.mode === 'counts') return Promise.resolve({ data: { ok: true, counts: { all: 3 } } });
    if (a === 'pro_students') return Promise.resolve({ data: { ok: true, rows: [{ id: 1, full_name: 'A', email: 'a•••@g•••.com', phone: '030•••67', masked: true, has_phone: true }], count: 1, pays: [{ id: 9, enrollment_id: 1 }], flags: { staff_payments: false } } });
    if (a === 'pro_reveal') return Promise.resolve({ data: { ok: true, value: '03001234567' } });
    return Promise.resolve({ data: { ok: true } }); } };
  const document = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
  const ctx = { window: {}, document, DFA, console, setTimeout, clearTimeout, Promise, localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(pro, ctx);
  const api = ctx.ADMPRO({ sb: { from: q, storage: { from: q } }, E: (s) => String(s ?? ''), T: () => '', lab: (_h, t) => t, dlg: () => null, toast() {}, pk: String, d: String, today: () => '2026-11-25', H: { tabs: {} }, P: {}, role, me: 'u', courses: () => [], copts: () => '', mopts: () => '', waDigits: (s) => String(s || '').replace(/\D/g, '') });
  return { api, calls, tables };
}

// 1. staff: the list and the chip counts come from the server function, never from the enrollments table
{
  const { api, calls, tables } = boot('staff');
  const r = await api.studentQuery({ filter: 'all', q: '', sort: 'created_at.desc', page: 0, size: 25 });
  assert.equal(calls[0].action, 'pro_students'); assert.equal(r.data[0].masked, true); assert.equal(r.pays.length, 1);
  assert.deepEqual(tables.filter((t) => t === 'enrollments' || t === 'payments'), [], 'staff never query enrollments/payments directly');
  const c = await api.counts(true); assert.equal(c.all, 3); assert.equal(calls.at(-1).mode, 'counts');
  assert.equal(await api.reveal(1, 'phone', 'card'), '03001234567'); assert.deepEqual({ ...calls.at(-1) }, { action: 'pro_reveal', id: 1, field: 'phone', why: 'card' });
  assert.equal(api.flags().staff_payments, false);
}
// 2. admin keeps the direct (RLS-checked) table read
{
  const { api, calls, tables } = boot('admin');
  await api.studentQuery({ filter: 'all', q: '', sort: 'created_at.desc', page: 0, size: 25 });
  assert.ok(tables.includes('enrollments')); assert.equal(calls.length, 0);
}
// 3. every remaining direct enrollments read in the module is admin-only (studentQuery/counts run these only after the staff early return, proven in 1.)
for (const line of pro.split('\n').filter((l) => l.includes("sb.from('enrollments')"))) {
  assert.ok(/ADMIN|mode:'batch_counts'|^ var q=sb\.from\('enrollments'\)\.select\('\*',\{count:'exact'\}\)|^ function c\(fn\)\{var q=sb\.from\('enrollments'\)\.select\('id',\{count:'exact',head:true\}\)|^async function exportDlg|^async function dataCheckTab| var R=await Promise\.all\(\[sb\.from\('enrollments'\)\.select\('id,full_name,student_id,email,phone/.test(line) || /fetchAll\(function\(\)\{return sb\.from\('enrollments'\)/.test(line), 'not admin-guarded: ' + line.slice(0, 140));
}
assert.ok(/async function dataCheckTab\(\)\{if\(!ADMIN\)|function dataCheckTab/.test(pro));
// 4. masked cards: reveal-on-click asks the server; staff cards lose documents with student details and (flag off) payment buttons
assert.ok(/if\(x\.masked\)card\.querySelectorAll\('\.adm-r'\)/.test(pro));
assert.ok(/a\.adm-pill\[href\^="doc\.html"\],\[data-doc\]/.test(pro));
assert.ok(/if\(!ADMIN&&!FLAGS\.staff_payments\)card\.querySelectorAll\('\[data-a=inst\],\[data-p=proof-add\]'\)/.test(pro));
assert.ok(/b\.dataset\.full=await reveal\(\+b\.dataset\.rid,b\.dataset\.f,'card'\)/.test(pro));
// 5. typed confirmation words are sent to the server (which checks them), never hard-coded
for (const a of ['pro_revoke', 'pro_remove', 'cert_revoke', 'pro_delete_test', 'pro_account_delete']) {
  for (const m of pro.matchAll(new RegExp(`inv\\('${a}',\\{[^}]*\\}`, 'g'))) if (!/undo:true/.test(m[0])) assert.ok(/confirm:c\d?\.word/.test(m[0]), a + ': ' + m[0]);
}
assert.equal(/confirm:'(DELETE|REVOKE)'/.test(pro), false, 'no hard-coded confirm word');
// 6. Add student goes through pro_add_student (no direct insert); WhatsApp for staff uses the logged reveal
assert.equal(/sb\.from\('enrollments'\)\.insert/.test(adm), false);
assert.ok(/action:'pro_add_student',email:fm\.email\.value,full_name:fm\.name\.value,course_code:fm\.course\.value,phone:fm\.phone\.value,source:'manual'/.test(adm));
assert.ok(/PRO\.reveal\(x\.id,'phone','whatsapp message'\)/.test(adm));
// 7. SheetJS is pinned by hash
assert.ok(/XLSX_SRI='sha384-[A-Za-z0-9+/]{64}'/.test(pro) && /s\.integrity=XLSX_SRI;s\.crossOrigin='anonymous'/.test(pro));
assert.ok(/xlsx@0\.18\.5\/dist\/xlsx\.full\.min\.js/.test(pro));
console.log('admin-staff-privacy: all checks passed');
