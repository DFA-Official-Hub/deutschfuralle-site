/** Per-staff permissions UI: Accounts panel, presets, can() gates, 360px, no password in the invite path. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const pro = read('assets/dfa-admin-pro.js'), adm = read('assets/dfa-admin.js');
const css = read('assets/dfa-admin-pro.css');
const fn = read('supabase/functions/admission/pro.ts');
const logic = read('supabase/functions/admission/prologic.ts');

const KEYS = ['view_students','see_contacts','edit_student_info','add_students','record_payments','open_payment_slips','discounts_refunds','batches','attendance','notes_tags','reminders','documents_emails','export','view_activity'];

// 1. every permission has a labelled switch in the Accounts panel
for (const k of KEYS) {
  assert.ok(pro.includes("['" + k + "','") || pro.includes('["' + k + '"'), 'PERM_UI missing ' + k);
  assert.ok(new RegExp("name=\"?" + k).test(pro) || pro.includes("name=\"'+k+'\"") || pro.includes("name=\"'+") , 'switch wiring for ' + k);
}
assert.ok(/PERM_UI=\[/.test(pro) && /function staffInviteDlg/.test(pro) && /function staffPermsDlg/.test(pro));
assert.ok(/id="acadd"/.test(pro) && /Add a staff member/.test(pro));
assert.ok(/data-pre="teacher"/.test(pro) && /data-pre="front_desk"/.test(pro) && /data-pre="clear"/.test(pro));
assert.ok(/name="disabled"/.test(pro) && /Disable this staff member/.test(pro));
assert.ok(/data-ac="perms"/.test(pro) && /Permissions/.test(pro));

// 2. invite uses the existing auth invite, never shows or logs a password or a magic link
assert.ok(/inviteUserByEmail/.test(fn));
assert.ok(/action === "pro_staff_invite"/.test(fn) || /a === "pro_staff_invite"/.test(fn));
assert.ok(/a === "pro_staff_perms"/.test(fn) && /a === "pro_staff_disable"/.test(fn));
assert.equal(/password/i.test(fn.slice(fn.indexOf('pro_staff_invite'), fn.indexOf('pro_staff_perms'))), false, 'invite path must not mention a password');
assert.ok(/Invited \$\{name\} as staff \(all permissions off\)/.test(fn));
assert.ok(/return json\(\{ ok: true, id, invited: true \}\)/.test(fn), 'invite response has no link or secret');
assert.ok(/They will get an email to set their own password\. No password is shown here/.test(pro));

// 3. presets match the server
assert.ok(/teacher: \{ view_students: true, batches: true, attendance: true, notes_tags: true \}/.test(logic));
assert.ok(/front_desk: \{/.test(logic) && /record_payments: true/.test(logic) && /open_payment_slips: true/.test(logic));

// 4. UI hides what the staff member cannot use; Accounts stays admin-only
assert.ok(/function can\(k\)\{if\(ADMIN\)return true;/.test(pro));
assert.ok(/can\('add_students'\)/.test(pro) && /can\('export'\)/.test(pro) && /can\('attendance'\)/.test(pro));
assert.ok(/can\('see_contacts'\)/.test(pro) && /can\('record_payments'\)/.test(pro) && /can\('open_payment_slips'\)/.test(pro));
assert.ok(/Staff access is off/.test(adm));
assert.ok(/PERMS\.view_students/.test(adm) && /PERMS\.reminders/.test(adm) && /PERMS\.view_activity/.test(adm));
assert.ok(/\['us','Accounts','accounts',1\]/.test(adm), 'Accounts remains admin-only');

// 5. 360px layout
assert.ok(/@media \(max-width:360px\)/.test(css));
assert.ok(/\.adm-perm input\[type=checkbox\]\{width:auto/.test(css), 'switches stay normal-sized against the global input style');

assert.ok(/\.adm-perms\{display:grid/.test(css));
assert.ok(/grid-template-columns:1fr/.test(css));

// 6. permission changes are audit-logged
assert.ok(/staff_invited/.test(fn) && /action, `Permissions for/.test(fn) || /"staff_perms"/.test(fn) || /permissions_changed|staff_perms|Permissions for \$\{who\}/.test(fn));
assert.ok(/staff_disabled|staff_enabled/.test(fn));

// 7. B20-2: Dashboard and Reviews need view_students; zero permissions show a no-access screen
assert.ok(/t\[0\]==='db'\|\|t\[0\]==='rv'\|\|t\[0\]==='en'\)return !!\(PERMS&&PERMS\.view_students\)/.test(adm));
assert.ok(/No access yet/.test(adm));
assert.ok(/CNIC, date of birth and address stay with admins/.test(pro));
assert.equal(/"view_fees"/.test(logic) || /view_fees\s*:/.test(logic), false, 'no view_fees permission key; dashboard uses view_students');
assert.ok(/pro_dashboard: "view_students"/.test(logic));

// 8. B20-3: the staff form does not post contact fields when contacts were not shown
assert.ok(/D\.contacts_shown===false&&\(F\.key==='email'\|\|F\.key==='phone'\)\)return/.test(adm));

// 9. B20-4: save response is shaped for staff; write is locked to the student_info that was read
const idx = read('supabase/functions/admission/index.ts');
const save = idx.slice(idx.indexOf('body.action === "student_info_save"'), idx.indexOf('body.action === "regen_docs"'));
assert.ok(save.includes('shapeStudentInfoSave({ ok: true, changed: Object.keys(ch.new), effective: after'));
assert.ok(save.includes('studentInfoLockUpdate(db, e.id, e.student_info, patch)') && save.includes('STUDENT_INFO_CONFLICT') && save.includes('409'));
assert.equal(save.includes('.eq("student_info"') || save.includes('.is("student_info"'), false, 'no PostgREST eq/is on student_info');

// 10. B20-4: a 409 conflict shows the message and a Reload button that reopens the details
assert.ok(/s\.data\.code==='conflict'\|\|err==='Record changed, reload'/.test(adm) && adm.includes("rb.textContent='Reload'") && /g\.close\(\);infoDlg\(id\)/.test(adm),
  '409 Record changed, reload is shown in the dialog with a Reload button that reopens the details');
assert.ok(read('admin.html').includes('dfa-admin.js?v=54'), 'admin.js cache-bust bumped after the 409 UI');


// Edge functions pin supabase-js to the npm specifier (jsonb values must not go through an unpinned client).
const walk = (d, acc = []) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) walk(p, acc); else if (n.name.endsWith('.ts')) acc.push(p); } return acc; };
for (const f of walk(path.join(root, 'supabase/functions'))) {
  const imps = [...read(path.relative(root, f)).matchAll(/from ["']([^"']*supabase-js[^"']*)["']/g)].map((m) => m[1]);
  for (const u of imps) assert.equal(u, 'npm:@supabase/supabase-js@2', f + ' must pin npm:@supabase/supabase-js@2');
}

console.log('staff-permissions-ui: all checks passed');
