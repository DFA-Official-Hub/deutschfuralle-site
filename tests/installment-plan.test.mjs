/** Custom installment plans: assets/dfa-plan.js (browser) and supabase/functions/admission/plan.ts (server) must agree.
    Also checks the admin course order, the renamed payment button and that every admin control has a hint. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const ctx = {}; ctx.globalThis = ctx; vm.runInNewContext(read('assets/dfa-plan.js'), ctx);
const P = ctx.DFA_PLAN;
const plain = (x) => JSON.parse(JSON.stringify(x));

// even split, rounded, remainder on the last installment
assert.deepEqual(plain(P.splitEven(40000, 3)), [13000, 13000, 14000]);
assert.deepEqual(plain(P.splitEven(40000, 2)), [20000, 20000]);
assert.deepEqual(plain(P.splitEven(25000, 4)), [6000, 6000, 6000, 7000]);
assert.deepEqual(plain(P.splitEven(18000, 4)), [4500, 4500, 4500, 4500]);
assert.deepEqual(plain(P.splitEven(50000, 5)), [10000, 10000, 10000, 10000, 10000]);
assert.deepEqual(plain(P.splitEven(15000, 4)), [3500, 3500, 3500, 4500]);
for (const t of [15000, 18000, 25000, 30000, 40000, 50000, 60000, 24000]) for (let n = 2; n <= 5; n++) {
  const a = P.splitEven(t, n); assert.equal(a.length, n); assert.equal(a.reduce((x, y) => x + y, 0), t, `sum ${t}/${n}`); assert.ok(a.every((x) => x > 0));
}
// dates: first on the start date, then monthly; month-end clamping
assert.deepEqual(plain(P.suggestDates('2026-11-21', 4)), ['2026-11-21', '2026-12-21', '2027-01-21', '2027-02-21']);
assert.equal(P.addMonths('2026-01-31', 1), '2026-02-28');
assert.equal(P.addMonths('2028-01-31', 1), '2028-02-29');
assert.equal(P.addMonths('2026-12-15', 2), '2027-02-15');
assert.deepEqual(plain(P.suggest(40000, 3, '2026-11-21')), [{ no: 1, amount: 13000, due: '2026-11-21' }, { no: 2, amount: 13000, due: '2026-12-21' }, { no: 3, amount: 14000, due: '2027-01-21' }]);

// validation
assert.match(P.normalize([{ amount: 1000, due: '2026-11-21' }]).error, /2 to 5/);
assert.match(P.normalize(Array(6).fill({ amount: 1, due: '2026-11-21' })).error, /2 to 5/);
assert.match(P.normalize([{ amount: 0, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, /Installment 1/);
assert.match(P.normalize([{ amount: 10.5, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, /whole rupees/);
assert.match(P.normalize([{ amount: 10, due: '2026-02-30' }, { amount: 1, due: '2026-11-22' }]).error, /due date/);
assert.match(P.normalize([{ amount: 10, due: '2026-12-01' }, { amount: 1, due: '2026-11-22' }]).error, /in order/);
// Ali's example: 10k now, 10k after 20 days, 12k a month later
const ali = P.normalize([{ amount: 10000, due: '2026-11-21' }, { amount: 10000, due: '2026-12-11' }, { amount: 12000, due: '2027-01-11' }]);
assert.equal(ali.error, undefined); assert.equal(ali.total, 32000); assert.equal(ali.plan.length, 3);

// status: payments fill installments in order
const st = P.status(ali.plan, 15000, [{ amount: 10000, paid_on: '2026-11-21', installment_no: 1 }, { amount: 5000, paid_on: '2026-12-05', installment_no: 2 }]);
assert.deepEqual(plain(st.map((s) => [s.status, s.left, s.paid_on])), [['paid', 0, '2026-11-21'], ['partial', 5000, null], ['due', 12000, null]]);
assert.deepEqual(plain(P.next(ali.plan, 15000)), { no: 2, due: '2026-12-11', left: 5000, of: 3 });
assert.deepEqual(plain(P.next(ali.plan, 20000)), { no: 3, due: '2027-01-11', left: 12000, of: 3 });
assert.equal(P.next(ali.plan, 32000), null);
assert.deepEqual(plain(P.status(ali.plan, 22000, [{ amount: 10000, paid_on: '2026-11-21', installment_no: 1 }, { amount: 12000, paid_on: '2026-12-10', installment_no: 2 }]).map((s) => s.paid_on)), ['2026-11-21', '2026-12-10', null]);

// server copy behaves the same (deno runs plan.ts)
let deno = 'deno'; try { execFileSync(deno, ['--version']); } catch { deno = path.join(process.env.HOME || '', '.deno/bin/deno'); }
const script = `import * as S from "${path.join(root, 'supabase/functions/admission/plan.ts')}";
const out = { a: S.splitEven(40000, 3), b: S.splitEven(25000, 4), c: S.suggest(50000, 4, "2026-01-31"), d: S.normalize(${JSON.stringify(ali.plan)}),
 e: S.status(${JSON.stringify(ali.plan)}, 15000), f: S.next(${JSON.stringify(ali.plan)}, 20000), g: S.normalize([{amount:5,due:"2026-12-01"},{amount:5,due:"2026-11-01"}]),
 h: S.planCount({ payment_plan: "two" }), i: S.planCount({ installment_plan: ${JSON.stringify(ali.plan)} }), j: S.planCount({ payment_plan: "full" }) };
console.log(JSON.stringify(out));`;
const srv = JSON.parse(execFileSync(deno, ['eval', '--ext=ts', script], { encoding: 'utf8' }));
assert.deepEqual(srv.a, plain(P.splitEven(40000, 3)));
assert.deepEqual(srv.b, plain(P.splitEven(25000, 4)));
assert.deepEqual(srv.c, plain(P.suggest(50000, 4, '2026-01-31')));
assert.deepEqual(srv.d, plain(ali));
assert.deepEqual(srv.e, plain(P.status(ali.plan, 15000)));
assert.deepEqual(srv.f, plain(P.next(ali.plan, 20000)));
assert.deepEqual(srv.g, plain(P.normalize([{ amount: 5, due: '2026-12-01' }, { amount: 5, due: '2026-11-01' }])));
assert.deepEqual([srv.h, srv.i, srv.j], [2, 3, 1]);

// admin: course order (Ali, t84u)
const admin = read('assets/dfa-admin.js');
const s0 = admin.indexOf('var C_ORDER'), s1 = admin.indexOf('/* ---- custom installment plan editor');
const c2 = {}; vm.runInNewContext(admin.slice(s0, s1), c2);
const db = [['a1-crash', 30], ['a1-super', 45], ['a2-super', 45], ['a1-normal', 75], ['a2', 75], ['a2-normal', 75], ['b1', 75], ['b2', 75], ['c1', 75], ['a1-a2', 105]].map(([code, duration_days]) => ({ code, duration_days }));
assert.deepEqual(plain(c2.sortCourses(db).map((c) => c.code)), ['a1-normal', 'a1-super', 'a1-crash', 'a1-a2', 'a2-normal', 'a2-super', 'b1', 'b2', 'a2', 'c1']);

// admin: renamed button, plan wiring, hints on every button
assert.ok(!/>Record payment</.test(admin), 'old "Record payment" label is gone');
assert.ok(admin.includes('>Add installment payment</button>') && admin.includes('<h3>Add an installment payment</h3>'));
assert.ok(admin.includes('<option value="custom">Custom plan (2 to 5 installments)</option>'));
assert.ok(admin.includes("action:'set_plan'") && admin.includes('installments:inst'));
const buttons = admin.match(/<button\b[\s\S]*?<\/button>/g) || [];
assert.ok(buttons.length > 25, 'found admin buttons');
const noHint = buttons.filter((b) => !/title=|'\+T\(/.test(b) && !/value="(ok|cancel)"/.test(b));
assert.deepEqual(noHint, [], 'every admin button has a hint');
for (const k of ['pay', 'remove', 'certify', 'hold', 'release', 'crev', 'crestore', 'resend', 'wa', 'wacopy', 'inst', 'planEdit', 'revoke', 'show', 'plan', 'first', 'count', 'amt', 'due', 'sid', 'batch', 'inv', 'docs', 'sent', 'access', 'startPend'])
  assert.ok(new RegExp('\\b' + k + ":'").test(admin.slice(admin.indexOf('var H={'), admin.indexOf('function T('))), 'hint text for ' + k);
// all inputs/selects inside admin markup carry a title (direct or via T())
const fields = (admin.match(/<(input|select)\b[^>]*>/g) || []).filter((f) => !/type="checkbox" name="i"|role="switch"|name="em"/.test(f));
assert.deepEqual(fields.filter((f) => !/title=|'\+T\(/.test(f)), [], 'every admin field has a hint');

// server: activate/record_payment/set_plan use the plan
const idx = read('supabase/functions/admission/index.ts');
assert.ok(idx.includes('body.plan === "custom"') && idx.includes('installments: plan ? plan.length : two ? 2 : 1'));
assert.ok(idx.includes('installments: Math.max(planCount(e), n)'));
assert.ok(idx.includes('upd.due_date = planDue(e.installment_plan, after)'));
assert.ok(idx.includes('body.action === "set_plan"'));
const mig = read('supabase/migrations/20261121120000_custom_installment_plan.sql');
assert.match(mig, /add column if not exists installment_plan jsonb/);
assert.match(mig, /'full'::text, 'two'::text, 'custom'::text/);

// portal shows the schedule; receipts use the plan count
const portal = read('assets/dfa-portal.js'), auth = read('assets/dfa-auth.js');
assert.ok(portal.includes('installment_plan,courses(') && portal.includes('ptSched('));
assert.ok(auth.includes('function receiptPills(id,pays,cls,inv,planN)') && auth.includes('planN||0'));
for (const f of ['admin.html', 'portal.html']) assert.match(read(f), /<script src="assets\/dfa-plan\.js\?v=1" defer><\/script>/);
console.log('installment-plan: all checks passed');
