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

// amounts must be real whole numbers up to 1,000,000 (no 1e15, no strings like '1e4')
assert.match(P.normalize([{ amount: 1e15, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, /Installment 1/);
assert.match(P.normalize([{ amount: '1e4', due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, /Installment 1/);
assert.match(P.normalize([{ amount: 1000001, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, /Installment 1/);
assert.equal(P.normalize([{ amount: 1000000, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, undefined);

// paid installments are locked (Head of Tech repro: 10k/10k/10k with 10,000 paid -> 5,000/12,500/12,500 must fail)
const t3 = [{ no: 1, amount: 10000, due: '2026-11-01' }, { no: 2, amount: 10000, due: '2026-12-01' }, { no: 3, amount: 10000, due: '2027-01-01' }];
const lk = P.lockedRows(t3, 10000);
assert.deepEqual(plain(lk), [{ amount: 10000, due: '2026-11-01' }]);
assert.match(P.checkLocked(lk, P.normalize([{ amount: 5000, due: '2026-11-01' }, { amount: 12500, due: '2026-12-01' }, { amount: 12500, due: '2027-01-01' }]).plan), /Installment 1 is already paid/);
assert.match(P.checkLocked(lk, P.normalize([{ amount: 10000, due: '2026-11-05' }, { amount: 20000, due: '2026-12-01' }]).plan), /Installment 1 is already paid/);
assert.equal(P.checkLocked(lk, P.normalize([{ amount: 10000, due: '2026-11-01' }, { amount: 5000, due: '2026-11-20' }, { amount: 15000, due: '2027-02-01' }]).plan), null);
assert.equal(P.lockedRows(t3, 15000).length, 1, 'a part-paid installment is not locked');
// legacy row (no plan): each recorded payment is a paid installment
const legacy = P.lockedRows(null, 20000, [{ amount: 20000, paid_on: '2026-11-12', installment_no: 1 }]);
assert.deepEqual(plain(legacy), [{ amount: 20000, due: '2026-11-12' }]);
assert.match(P.checkLocked(legacy, P.normalize([{ amount: 15000, due: '2026-11-12' }, { amount: 25000, due: '2026-12-12' }]).plan), /already paid/);
assert.equal(P.checkLocked(legacy, P.normalize([{ amount: 20000, due: '2026-11-12' }, { amount: 10000, due: '2026-12-12' }, { amount: 10000, due: '2027-01-12' }]).plan), null);
assert.match(P.checkLocked([{ amount: 1, due: '2026-11-01' }, { amount: 1, due: '2026-11-02' }], [{ no: 1, amount: 1, due: '2026-11-01' }]), /at least 2/);

// receipt labels follow the money, not the payment count (Head of Tech example)
assert.equal(P.payLabel(t3, 0, 10000), 'Installment 1 of 3');
assert.equal(P.payLabel(t3, 10000, 15000), 'Installment 2 of 3 (part payment)');
assert.equal(P.payLabel(t3, 15000, 20000), 'Installment 2 of 3 (final part)', '3rd payment finishing installment 2 is not "3 of 3"');
assert.equal(P.payLabel(t3, 25000, 30000), 'Installment 3 of 3 (final part)');
assert.equal(P.payLabel(t3, 12000, 18000), 'Installment 2 of 3 (part payment)', 'starts and ends inside installment 2');
const t4 = [{ amount: 10000 }, { amount: 10000 }, { amount: 10000 }, { amount: 10000 }];
assert.equal(P.payLabel(t4, 15000, 20000), 'Installment 2 of 4 (final part)');
assert.equal(P.payLabel(t4, 10000, 25000), 'Installments 2\u20133 of 4 (part payment)');
assert.equal(P.payLabel(t3, 20000, 30000), 'Installment 3 of 3');
assert.equal(P.payLabel(t3, 10000, 30000), 'Installments 2\u20133 of 3');
assert.equal(P.payLabel(t3, 15000, 30000), 'Installments 2\u20133 of 3 (final part)');
assert.equal(P.payLabel(null, 0, 100), '');
assert.deepEqual(Object.keys(P.METHODS), ['cash', 'bank', 'jazzcash', 'easypaisa', 'other']);

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
const T3 = ${JSON.stringify(t3)};
const out = { a: S.splitEven(40000, 3), b: S.splitEven(25000, 4), c: S.suggest(50000, 4, "2026-01-31"), d: S.normalize(${JSON.stringify(ali.plan)}),
 e: S.status(${JSON.stringify(ali.plan)}, 15000), f: S.next(${JSON.stringify(ali.plan)}, 20000), g: S.normalize([{amount:5,due:"2026-12-01"},{amount:5,due:"2026-11-01"}]),
 k: [S.normalize([{amount:1e15,due:"2026-11-21"},{amount:1,due:"2026-11-22"}]).error, S.normalize([{amount:"1e4",due:"2026-11-21"},{amount:1,due:"2026-11-22"}]).error],
 l: S.checkLocked(S.lockedRows(T3, 10000), S.normalize([{amount:5000,due:"2026-11-01"},{amount:12500,due:"2026-12-01"},{amount:12500,due:"2027-01-01"}]).plan),
 m: [S.payLabel(T3,0,10000), S.payLabel(T3,10000,15000), S.payLabel(T3,15000,20000), S.payLabel(T3,10000,30000), S.payLabel(T3,15000,30000), S.payLabel(T3,25000,30000), S.payLabel(T3,12000,18000)],
 q: [S.settle({ plan: T3, feeTotal: 30000, amount: 10000, sumAfter: 25000 }), S.settle({ plan: T3, feeTotal: 30000, amount: 10000, sumAfter: 35000 }), S.settle({ plan: null, feeTotal: 40000, amount: 20000, sumAfter: 40000 }), S.settle({ plan: T3, feeTotal: 30000, amount: 5000, sumAfter: 20000 }), S.settle({ plan: T3, feeTotal: 30000, amount: 10000, sumAfter: 0, readOk: false }), S.settle({ plan: T3, feeTotal: 30000, amount: 10000, sumAfter: 0 }), S.settle({ plan: T3, feeTotal: 30000, amount: 10000, sumAfter: 5000 })],
 o: S.lockedRows(null, 20000, [{amount:20000,paid_on:"2026-11-12",installment_no:1}]), p: [S.method("JazzCash"), S.method("card"), S.method("")],
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
assert.deepEqual(srv.k, [P.normalize([{ amount: 1e15, due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error, P.normalize([{ amount: '1e4', due: '2026-11-21' }, { amount: 1, due: '2026-11-22' }]).error]);
assert.equal(srv.l, P.checkLocked(P.lockedRows(t3, 10000), P.normalize([{ amount: 5000, due: '2026-11-01' }, { amount: 12500, due: '2026-12-01' }, { amount: 12500, due: '2027-01-01' }]).plan));
assert.deepEqual(srv.m, [P.payLabel(t3, 0, 10000), P.payLabel(t3, 10000, 15000), P.payLabel(t3, 15000, 20000), P.payLabel(t3, 10000, 30000), P.payLabel(t3, 15000, 30000), P.payLabel(t3, 25000, 30000), P.payLabel(t3, 12000, 18000)]);
assert.deepEqual(srv.m.slice(5), ['Installment 3 of 3 (final part)', 'Installment 2 of 3 (part payment)']);
// stale read: the admin page/edge function read amount_paid = 10,000, but another 5,000 payment landed before this 10,000 insert.
// settle() works from the sum of ALL payments after the insert (25,000), not the stale 10,000 + 10,000.
assert.deepEqual(srv.q[0], { before: 15000, after: 25000, fin: false, label: 'Installments 2\u20133 of 3 (part payment)', over: false, bad: false });
// stale read pushing the total above the fee -> over = true (the function deletes the inserted payment and returns 409)
assert.equal(srv.q[1].over, true); assert.equal(srv.q[1].before, 25000);
assert.deepEqual(srv.q[2], { before: 20000, after: 40000, fin: true, label: null, over: false, bad: false }, 'no plan: no label, is_final from the sum');
assert.deepEqual(srv.q[3], { before: 15000, after: 20000, fin: false, label: 'Installment 2 of 3 (final part)', over: false, bad: false });
// re-read failed / returned [] / sum smaller than this payment -> bad: no amount_paid write, no receipt
for (const k of [4, 5, 6]) { assert.equal(srv.q[k].bad, true, 'bad re-read ' + k); assert.equal(srv.q[k].over, false); }
assert.deepEqual(srv.o, plain(P.lockedRows(null, 20000, [{ amount: 20000, paid_on: '2026-11-12', installment_no: 1 }])));
assert.deepEqual(srv.p, ['jazzcash', null, null]);

// admin: course order (Ali, t84u)
const admin = read('assets/dfa-admin.js');
const s0 = admin.indexOf('var C_ORDER'), s1 = admin.indexOf('/* ---- custom installment plan editor');
const c2 = {}; vm.runInNewContext(admin.slice(s0, s1), c2);
const db = [['a1-crash', 30], ['a1-super', 45], ['a2-super', 45], ['a1-normal', 75], ['a2', 75], ['a2-normal', 75], ['b1', 75], ['b2', 75], ['c1', 75], ['a1-a2', 105]].map(([code, duration_days]) => ({ code, duration_days }));
assert.deepEqual(plain(c2.sortCourses(db).map((c) => c.code)), ['a1-normal', 'a1-super', 'a1-crash', 'a1-a2', 'a2-normal', 'a2-super', 'b1', 'b2', 'a2', 'c1']);

// admin: renamed button, plan wiring, hints on every button
assert.ok(!/>Record payment</.test(admin), 'old "Record payment" label is gone');
assert.ok(admin.includes("bt('inst','Add installment payment'") && admin.includes('<h3>Add an installment payment</h3>'));
assert.ok(admin.includes('<option value="custom">Custom plan (2 to 5 installments)</option>'));
assert.ok(admin.includes("action:'set_plan'") && admin.includes('installments:inst'));
const buttons = admin.match(/<button\b[\s\S]*?<\/button>/g) || [];
assert.ok(buttons.length > 10, 'found admin buttons'); // tab buttons are generated from TABS since WD-3
// student-card buttons come from bt(action, label, hint, …), which always adds the hint
assert.ok(/function bt\(a,txt,hint,cls,attrs\)\{return '<button[^}]*T\(hint\)/.test(admin), 'bt() adds a hint to every card button');
assert.ok((admin.match(/bt\('/g) || []).length >= 12, 'card buttons use bt()');
const noHint = buttons.filter((b) => !/title=|'\+T\(/.test(b) && !/value="(ok|cancel)"/.test(b));
assert.deepEqual(noHint, [], 'every admin button has a hint');
for (const k of ['info', 'fix', 'fixEdit', 'fixVoid', 'regen', 'waAdm', 'waRcpt', 'waCert', 'waPrev', 'pay', 'remove', 'certify', 'hold', 'release', 'crev', 'crestore', 'resend', 'wa', 'wacopy', 'inst', 'planEdit', 'revoke', 'show', 'plan', 'first', 'count', 'amt', 'due', 'sid', 'batch', 'inv', 'docs', 'sent', 'access', 'startPend'])
  assert.ok(new RegExp('\\b' + k + ":'").test(admin.slice(admin.indexOf('var H={'), admin.indexOf('function T('))), 'hint text for ' + k);
// all inputs/selects inside admin markup carry a title (direct or via T())
const fields = (admin.match(/<(input|select|textarea)\b[^>]*>/g) || []).filter((f) => !/type="checkbox" name="i"|role="switch"|name="em"/.test(f));
assert.deepEqual(fields.filter((f) => !/title=|'\+T\(/.test(f)), [], 'every admin field has a hint');

// server: activate/record_payment/set_plan use the plan
const idx = read('supabase/functions/admission/index.ts');
assert.ok(idx.includes('body.plan === "custom"') && idx.includes('installments: plan ? plan.length : two ? 2 : 1'));
assert.ok(idx.includes('installments: Math.max(planCount(e), n)'));
assert.ok(idx.includes('const nd = planDue(plan, after); upd.due_date = nd;'));
assert.ok(idx.includes('body.action === "set_plan"'));
// set_plan: server lock + conditional write; record_payment: label, method, safe amount_paid update; clear resets the schedule
const sp = idx.slice(idx.indexOf('body.action === "set_plan"'), idx.indexOf('body.action === "set_due"'));
assert.ok(sp.includes('checkLocked(lockedRows(e.installment_plan, paid, pays), np.plan!)'));
assert.ok(sp.includes('.eq("amount_paid", paid)') && sp.includes('"Reload, a payment was just recorded."') && sp.includes('409'));
assert.ok(/body\.clear[\s\S]*due_date: due, reminder_stage: open \? 0 : 3/.test(sp), 'clear resets due date + reminders');
const rp = idx.slice(idx.indexOf('body.action === "record_payment"'), idx.indexOf('body.action === "set_plan"'));
assert.ok(rp.includes('installment_label: plan ? payLabel(plan, before, after) : null') && rp.includes('method: payMethod(body.method)'));
assert.ok(rp.includes('const st = settle({ plan, feeTotal: e.fee_total, amount, readOk:'), 'record_payment settles from the sum of payments');
assert.ok(/if \(st\.over\) \{[\s\S]*from\("payments"\)\.delete\(\)\.eq\("id", ins\.data\.id\)[\s\S]*409/.test(rp), 'overpayment after a race is undone with 409');
assert.ok(rp.includes('update({ is_final: st.fin, installment_label: st.label })'), 'payment row fixed when label/is_final changed');
assert.ok(rp.includes('before = st.before; after = st.after;') && rp.includes('buildPaymentReceipt(db, e, ins.data, before)'), 'receipt uses the fresh before');
assert.ok(rp.includes('.eq("id", id).eq("amount_paid", after);') && !rp.includes('could not be updated'), 'due date/reminders set only while the total is unchanged; a newer request wins quietly (amount_paid is owned by the DB trigger)');
assert.ok(rp.includes('readOk: !rr.error && !!rr.data, sumAfter: Number(rr.data?.amount_paid)'), 'total re-read (set by the DB trigger) error is checked');
assert.ok(/if \(st\.bad\) return json\(\{ ok: true[^\n]*Payment saved; reload and check/.test(rp), 'bad re-read: ok + warning, before any amount_paid write');
assert.ok(rp.indexOf('if (st.bad)') < rp.indexOf('from("enrollments").update(upd)') && rp.indexOf('if (st.bad)') < rp.indexOf('buildPaymentReceipt'), 'bad re-read skips update and receipt');
assert.ok(!/amount_paid:\s*after/.test(rp), 'record_payment never writes amount_paid');
assert.ok(/const del = await db\.from\("payments"\)\.delete\(\)\.eq\("id", ins\.data\.id\);\s*if \(del\.error\) return json\(\{ error: [^\n]*still exists/.test(rp), 'rollback delete error says the row still exists');
assert.ok(sp.includes('reminder_stage: !due ? 3 : same ? (e.reminder_stage || 0) : 0'), 'set_plan keeps the reminder stage when the due date stays');
assert.ok(idx.includes('installment_label: plan ? payLabel(plan, 0, first) : null, method: payMethod(body.method)'));
assert.ok(read('supabase/functions/admission/docs.ts').includes('pay?.installment_label ?'));
// escaping of stored plan values
assert.ok(admin.includes("value=\"'+E(x.amount)+'\"") && admin.includes("value=\"'+E(x.due)+'\"") && admin.includes("E(pk(s.amount))"));
assert.ok(read('assets/dfa-portal.js').includes("E(f(s.amount))"));
assert.ok(admin.includes('dated before today'), 'past-date warning');
assert.ok(admin.includes('<select data-pm') && admin.includes('<select name="pm"') && admin.includes("method:f.pm.value||undefined") && admin.includes("method:tr.querySelector('[data-pm]').value||undefined"));
assert.ok(admin.includes("row('Payments',histHtml(PAYS[x.id],act),'hist')"));
assert.match(read('assets/style.css'), /\.adm-i\{[^}]*width:24px;height:24px/);
const mig = read('supabase/migrations/20261121120000_custom_installment_plan.sql');
assert.match(mig, /add column if not exists installment_plan jsonb/);
assert.match(mig, /'full'::text, 'two'::text, 'custom'::text/);
assert.match(mig, /add column if not exists installment_label text/);
assert.match(mig, /add column if not exists method text/);
assert.match(mig, /method is null or method = any \(array\['cash'::text, 'bank'::text, 'jazzcash'::text, 'easypaisa'::text, 'other'::text\]\)/);
assert.match(mig, /create unique index if not exists payments_enrollment_installment_no_key on public\.payments \(enrollment_id, installment_no\)/);
assert.ok(!/\bdrop (table|column)\b|\bdelete from\b|\btruncate\b/i.test(mig), 'migration is not destructive');


// portal shows the schedule; receipts use the plan count
const portal = read('assets/dfa-portal.js'), auth = read('assets/dfa-auth.js');
assert.ok(portal.includes('installment_plan,courses(') && portal.includes('ptSched('));
assert.ok(auth.includes('function receiptPills(id,pays,cls,inv,planN)') && auth.includes('planN||0'));
for (const f of ['admin.html', 'portal.html']) assert.match(read(f), /<script src="assets\/dfa-plan\.js\?v=3" defer><\/script>/);
assert.ok(auth.includes('paid_on,method,installment_label') && auth.includes("p.installment_label?'Receipt · '+p.installment_label"));
console.log('installment-plan: all checks passed');

// hidden (inactive) courses are left out of the admin course picker unless already selected
assert.ok(read('assets/dfa-admin.js').includes("COURSES.filter(function(c){return c.active!==false||c.code===sel})"));
