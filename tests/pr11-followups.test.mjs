/** node tests/pr11-followups.test.mjs: source checks for the PR #11 follow-ups. */
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const idx = read('supabase/functions/admission/index.ts'), render = read('supabase/functions/admission/render.ts');
const act = idx.slice(idx.indexOf('body.action === "activate"'), idx.indexOf('body.action === "build_doc"'));
assert.ok(!/amount_paid/.test(act.slice(0, act.indexOf('const up ='))), 'activate leaves amount_paid to the trigger');
const rp = idx.slice(idx.indexOf('body.action === "record_payment"'), idx.indexOf('body.action === "set_plan"'));
assert.ok(/const du = await db\.from\("enrollments"\)\.update\(upd\)\.eq\("id", id\)\.eq\("amount_paid", after\);\s*if \(du\.error\) warnings\.push\(/.test(rp), 'due-date update error becomes a warning');
assert.ok(rp.indexOf('const warnings') < rp.indexOf('const du ='), 'warnings exist before the update');
const si = idx.slice(idx.indexOf('body.action === "student_info_save"'), idx.indexOf('body.action === "regen_docs"'));
assert.ok(si.indexOf('savedRow(e, c.info, patch)') > si.indexOf('patch.phone = back'), 'audit values computed after the put-back');
assert.ok(si.includes('old_values: ch.old, new_values: ch.new') && si.includes('effective: after'));
assert.ok(!/full_name[^\n]*\.(png|pdf)`/.test(render) && render.includes('${e.certificate_no}_Certificate.png') && render.includes('${e.certificate_no}_Certificate.pdf'), 'certificate file names carry the number only');
console.log('pr11-followups.test.mjs: OK');
