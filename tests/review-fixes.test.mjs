/** node tests/review-fixes.test.mjs: source checks for the PR #11 review fixes (Head of Tech, 25 Nov 2026). */
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const idx = read('supabase/functions/admission/index.ts'), admin = read('assets/dfa-admin.js'), auth = read('assets/dfa-auth.js'), render = read('supabase/functions/admission/render.ts');
const mig = read('supabase/migrations/20261125090000_student_info_payment_corrections.sql'), dob = read('tools/registration-dob-fix.gs');
// 1) paid total kept by the database; correction uses an optimistic revision lock and no unconditional rollback
assert.match(mig, /create trigger payments_sync_amount_paid after insert or delete or update of amount, voided_at, enrollment_id on public\.payments/);
assert.match(mig, /for update;[\s\S]*voided_at is null/);
const pc = idx.slice(idx.indexOf('body.action === "payment_correct"'), idx.indexOf('body.action === "wa_links"'));
assert.ok(pc.includes('.eq("revision", rev).is("voided_at", null)'), 'revision lock on the corrected payment');
assert.ok(/c\.void \? \{ voided_at: nowIso, void_reason: c\.reason, revision: rev \+ 1, receipt_file: null \}/.test(pc), 'void bumps the revision and drops the old receipt file');
assert.ok(!/amount_paid: rc\.paid/.test(pc), 'the function no longer writes amount_paid itself');
assert.ok(!/update\(\{ amount: p\.amount/.test(pc), 'no unconditional rollback');
assert.ok(pc.includes('}, 500);') && pc.includes('409'), 'errors are reported');
assert.ok(pc.includes('paidNow !== sumNow'), 're-reads the sum and warns');
// 4) voided payments are not part of the plan lock
assert.ok(idx.includes('select("amount,paid_on,installment_no").eq("enrollment_id", id).is("voided_at", null)'));
assert.ok(admin.includes('P.lockedRows(cur,paid,livePays(pays))') && admin.includes('x.amount_paid,livePays(pays)).length'));
// 6) 48h links, no student name in the file name
assert.ok(idx.includes('const WA_LINK_HOURS = 48;') && idx.includes('const ttl = WA_LINK_HOURS * 3600'));
const wa = idx.slice(idx.indexOf('body.action === "wa_links"'), idx.indexOf('body.action === "set_due"'));
assert.ok(!/full_name/.test(wa.slice(wa.indexOf('const sign'))), 'download names carry no student name');
// 7) name edit redraws the certificate; clearing an override puts the old value back
assert.ok(idx.includes('if (certRedo) patch.certificate_file = null;'));
assert.ok(render.includes('e.certificate_file ? await db.storage.from("certificates").createSignedUrl(path, 3600) : { error: "rebuild" }'));
assert.ok(idx.includes('else if (prevOver.phone)') && idx.includes('else if (prevOver.full_name)'));
assert.ok(admin.includes('data-certw'), 'edit dialog warns about the issued certificate');
// 8) receipts after a correction: revision path, so the old file is never served again
assert.ok(idx.includes('let f = p.receipt_file || (p.invoice_no === e.invoice_no ? e.receipt_file : null);'));
// 9) students don't get staff notes
assert.ok(!auth.includes('void_reason'));
// 11) DOB fix reads the time zone once
assert.ok(dob.includes('var DFA_SHEET_TZ_ = null;') && !/forEach[\s\S]*openById/.test(dob.slice(dob.indexOf('function detailRow_'))));
console.log('review-fixes.test.mjs: OK');
