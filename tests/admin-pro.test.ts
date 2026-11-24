// deno test tests/admin-pro.test.ts — admin portal upgrade (WD-3): roles, reminders, discounts, proof paths, webhook signature, dashboard, activity summaries.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { allowed, denyMessage, emptyPerms, parsePerms, applyPreset, PERM_KEYS, parseOffsets, offsetsError, stageFor, nextReminder, isPaused, applyDiscount, undoDiscount, planDue, proofPath, proofPathOk, cleanRef, verifySvix, deliveryFrom, dashboard, shapeStudentInfoGet, shapeStudentInfoSave, staffInfoSaveError, mergeStaffStudentInfo, redactInfoRecord, studentInfoLockUpdate, studentInfoWriteConflict, STUDENT_INFO_CONFLICT, STUDENT_INFO_LOCK_RPC, maskEmail, maskPhone, type PermKey } from "../supabase/functions/admission/prologic.ts";
import { summarize } from "../supabase/functions/admission/audit.ts";

const on = (...ks: PermKey[]) => { const p = emptyPerms(); for (const k of ks) p[k] = true; return p; };
Deno.test("staff actions are off by default and follow per-staff permissions; admin-only stays admin-only", () => {
  assert(allowed("staff", "status", emptyPerms()), "portal shell stays available");
  assertFalse(allowed("staff", "pro_dashboard"), "all-off staff cannot open the dashboard");
  assertFalse(allowed("staff", "pro_dashboard", emptyPerms()));
  assertFalse(allowed("staff", "pro_dashboard", { ...emptyPerms(), disabled: true }), "disabled staff are blocked");
  const map: [string, PermKey][] = [
    ["pro_dashboard", "view_students"], ["pro_students", "view_students"], ["pro_reveal", "see_contacts"],
    ["student_info_get", "edit_student_info"], ["student_info_save", "edit_student_info"],
    ["pro_add_student", "add_students"], ["record_payment", "record_payments"],
    ["pro_proof_upload", "record_payments"], ["pro_proof_attach", "record_payments"], ["pro_payment_ref", "record_payments"],
    ["pro_proof_url", "open_payment_slips"], ["pro_adjust", "discounts_refunds"], ["pro_adjust_void", "discounts_refunds"],
    ["pro_assign_batch", "batches"], ["pro_reminders", "reminders"],
    ["docs_status", "documents_emails"], ["resend", "documents_emails"], ["email_log", "documents_emails"], ["pro_email_log", "documents_emails"], ["cert_file_admin", "documents_emails"],
    ["pro_export_log", "export"], ["pro_activity", "view_activity"],
  ];
  for (const [a, k] of map) {
    assertFalse(allowed("staff", a), a + " off by default");
    assertFalse(allowed("staff", a, emptyPerms()), a + " empty perms");
    assert(allowed("staff", a, on(k)), a + " when " + k + " is on");
    const other = PERM_KEYS.find((x) => x !== k)!;
    assertFalse(allowed("staff", a, on(other)), a + " not granted by " + other);
  }
  for (const a of ["activate", "cert_revoke", "cert_hold", "certify", "set_plan", "payment_correct", "set_emails", "cert_images", "settings_get", "pro_revoke", "pro_delete_test", "pro_role_set", "pro_accounts", "pro_staff_invite", "pro_staff_perms", "pro_staff_disable", "doc_file_admin", "wa_links"]) {
    assertFalse(allowed("staff", a, on(...PERM_KEYS)), a + " stays admin-only even with every flag on");
  }
  assert(allowed("admin", "pro_delete_test")); assert(allowed("admin", "pro_staff_invite", emptyPerms()));
  assertFalse(allowed("user", "record_payment", on("record_payments"))); assertFalse(allowed(null, "status"));
  assertEquals(denyMessage("record_payment", emptyPerms()), "Recording payments is switched off for you. Ask an admin.");
  assertEquals(denyMessage("pro_proof_url", emptyPerms()), "Opening payment slips is switched off for you. Ask an admin.");
  assertEquals(denyMessage("pro_students", { ...emptyPerms(), disabled: true }), "Your staff access is switched off. Please contact an admin.");
  const t = applyPreset("teacher"), d = applyPreset("front_desk");
  assert(t.view_students && t.batches && t.attendance && t.notes_tags && !t.record_payments && !t.see_contacts);
  assert(d.see_contacts && d.record_payments && d.open_payment_slips && d.add_students && !d.discounts_refunds && !d.export && !d.view_activity);
  assertFalse(parsePerms(null).view_students); assert(parsePerms({ view_students: true, disabled: 1 }).disabled);
});
Deno.test("B20-1: staff student_info_get masks contacts without see_contacts, hides CNIC/DOB/address, redacts history; save rejects login_email", () => {
  const raw = {
    ok: true,
    fields: [
      { key: "full_name", label: "Full name" }, { key: "dob", label: "Date of birth" }, { key: "cnic", label: "CNIC / ID" },
      { key: "email", label: "Email" }, { key: "phone", label: "Mobile" }, { key: "address", label: "Address" },
      { key: "gender", label: "Gender" },
    ],
    registration: { full_name: "Ali Khan", dob: "1995-02-11", cnic: "35202-1234567-1", email: "ali.khan@gmail.com", phone: "03001234567", address: "Street 1, Lahore" },
    overrides: { email: "ali.new@gmail.com", cnic: "35202-9999999-1" },
    effective: { full_name: "Ali Khan", dob: "1995-02-11", cnic: "35202-9999999-1", email: "ali.new@gmail.com", phone: "03001234567", address: "Street 1, Lahore", gender: "Male" },
    login_email: "ali.khan@gmail.com",
    history: [{ kind: "student_info", reason: "typo", old_values: { cnic: "35202-1", email: "old@x.com" }, new_values: { cnic: "35202-2", email: "new@x.com" }, changed_by: "Admin" }],
  };
  const masked = shapeStudentInfoGet(raw, "staff", on("edit_student_info"));
  assertFalse(JSON.stringify(masked).includes("35202"), "CNIC never leaves for staff");
  assertFalse(JSON.stringify(masked).includes("1995-02-11"), "DOB stays admin-only");
  assertFalse(JSON.stringify(masked).includes("Street 1"), "address stays admin-only");
  assertFalse((masked.fields || []).some((f: any) => ["dob", "cnic", "address"].includes(f.key)));
  assertEquals(masked.effective.full_name, "Ali Khan");
  assertEquals(masked.effective.email, maskEmail("ali.new@gmail.com"));
  assertEquals(masked.effective.phone, maskPhone("03001234567"));
  assertEquals(masked.login_email, maskEmail("ali.khan@gmail.com"));
  assertFalse(masked.contacts_shown);
  const mh = masked.history!; assertEquals(mh[0].old_values.email, "•••");
  assertFalse("cnic" in (mh[0].old_values || {}));
  assertFalse(JSON.stringify(mh).includes("old@x.com"));

  const shown = shapeStudentInfoGet(raw, "staff", on("edit_student_info", "see_contacts"));
  assertEquals(shown.effective.email, "ali.new@gmail.com");
  assertEquals(shown.login_email, "ali.khan@gmail.com");
  assert(shown.contacts_shown);
  assertFalse(JSON.stringify(shown).includes("35202"), "CNIC stays hidden even with see_contacts");
  assertEquals(shown.history![0].new_values.email, "•••", "history values stay redacted, like pro_activity");

  const admin = shapeStudentInfoGet(raw, "admin", null);
  assertEquals(admin.effective.cnic, "35202-9999999-1");
  assertEquals(admin.history![0].old_values.cnic, "35202-1");

  assertEquals(staffInfoSaveError({ login_email: "x@y.com", info: { full_name: "A" } }, "staff", "ali.khan@gmail.com"), "You cannot change the login email.");
  assertEquals(staffInfoSaveError({ login_email: "a•••@g•••.com" }, "staff", "ali.khan@gmail.com"), null, "a masked login email is not a change");
  assertEquals(staffInfoSaveError({ login_email: "ali.khan@gmail.com" }, "staff", "ali.khan@gmail.com"), null);
  assertEquals(staffInfoSaveError({ login_email: "x@y.com" }, "admin", "ali.khan@gmail.com"), null, "admins are not blocked by this guard");
});
Deno.test("B20-3: a staff name-only save keeps CNIC/DOB/address; masked contacts are unchanged; a real contact change is 403", () => {
  const reg = { full_name: "Ali Khan", dob: "1995-02-11", cnic: "35202-1234567-1", email: "ali.khan@gmail.com", phone: "03001234567", address: "Street 1, Lahore" };
  const current = { cnic: "35202-9999999-1", dob: "1994-01-01", address: "Staff must not wipe this", email: "ali.new@gmail.com", full_name: "Ali Khan" };
  const e = { full_name: "Ali Khan", email: "ali.khan@gmail.com", phone: "03001234567" };

  const nameOnly = mergeStaffStudentInfo(current, { full_name: "Ayesha Khan" }, { seeContacts: false }, reg, e);
  assertEquals(nameOnly.error, undefined);
  assertEquals(nameOnly.info?.full_name, "Ayesha Khan");
  assertEquals(nameOnly.info?.cnic, "35202-9999999-1");
  assertEquals(nameOnly.info?.dob, "1994-01-01");
  assertEquals(nameOnly.info?.address, "Staff must not wipe this");
  assertEquals(nameOnly.info?.email, "ali.new@gmail.com");

  const masked = mergeStaffStudentInfo(current, { full_name: "Ayesha Khan", email: maskEmail("ali.new@gmail.com"), phone: maskPhone("03001234567") }, { seeContacts: false }, reg, e);
  assertEquals(masked.error, undefined);
  assertEquals(masked.info?.full_name, "Ayesha Khan");
  assertEquals(masked.info?.cnic, "35202-9999999-1");
  assertEquals(masked.info?.email, "ali.new@gmail.com", "masked contacts posted without see_contacts stay as they are");

  const real = mergeStaffStudentInfo(current, { full_name: "Ayesha Khan", email: "hacker@x.com" }, { seeContacts: false }, reg, e);
  assertEquals(real.error, "You cannot change contact details. Ask an admin.");
  assertEquals(real.info, null);

  const cnicTry = mergeStaffStudentInfo(current, { full_name: "Ayesha Khan", cnic: "35202-0000000-1" }, { seeContacts: true }, reg, e);
  assertEquals(cnicTry.error, "You cannot change the CNIC, date of birth or address. Ask an admin.");

  const keepSame = mergeStaffStudentInfo(current, { cnic: "35202-9999999-1", full_name: "Ayesha Khan" }, { seeContacts: true }, reg, e);
  assertEquals(keepSame.error, undefined);
  assertEquals(keepSame.info?.cnic, "35202-9999999-1");

  const withContacts = mergeStaffStudentInfo(current, { email: "desk@x.com" }, { seeContacts: true }, reg, e);
  assertEquals(withContacts.error, undefined);
  assertEquals(withContacts.info?.email, "desk@x.com");
  assertEquals(withContacts.info?.cnic, "35202-9999999-1");

  const stray = redactInfoRecord({ CNIC: "35202-1234567-1", Email: "ali.khan@gmail.com", full_name: "Ali Khan", DOB: "1995-02-11", Address: "Street 1" }, false);
  assertFalse(JSON.stringify(stray).includes("35202"), "allowlist drops overrides.CNIC");
  assertFalse(JSON.stringify(stray).includes("1995-02-11"));
  assertFalse(JSON.stringify(stray).includes("Street 1"));
  assertEquals(stray.full_name, "Ali Khan");
  assertEquals(stray.email, maskEmail("ali.khan@gmail.com"));
  assertFalse("cnic" in stray || "CNIC" in stray || "dob" in stray || "DOB" in stray);
});
Deno.test("B20-4: a staff name-only save's effective has no CNIC/DOB/address or raw contacts; a stale write is 409", () => {
  const after = { full_name: "Ayesha Khan", cnic: "35202-9999999-1", dob: "1994-01-01", address: "Staff must not wipe this", city: "Lahore", state: "Punjab", country: "PK", email: "ali.new@gmail.com", phone: "03001234567" };
  const payload = { ok: true, changed: ["full_name"], effective: after, regen: false, certificate: false };

  const staff = shapeStudentInfoSave(payload, "staff", on("edit_student_info"));
  assertEquals(staff.effective.full_name, "Ayesha Khan");
  assertFalse("cnic" in staff.effective || "dob" in staff.effective || "address" in staff.effective || "city" in staff.effective || "state" in staff.effective || "country" in staff.effective);
  assertFalse(JSON.stringify(staff.effective).includes("ali.new@gmail.com"));
  assertFalse(JSON.stringify(staff.effective).includes("03001234567"));
  assertEquals(staff.effective.email, maskEmail("ali.new@gmail.com"));
  assertEquals(staff.effective.phone, maskPhone("03001234567"));
  assertEquals(staff.contacts_shown, false);

  const withSee = shapeStudentInfoSave(payload, "staff", on("edit_student_info", "see_contacts"));
  assertEquals(withSee.effective.email, "ali.new@gmail.com");
  assertEquals(withSee.effective.phone, "03001234567");
  assertFalse("cnic" in withSee.effective || "dob" in withSee.effective || "address" in withSee.effective);
  assertEquals(withSee.contacts_shown, true);

  const admin = shapeStudentInfoSave(payload, "admin", null);
  assertEquals(admin.effective.cnic, "35202-9999999-1");
  assertEquals(admin.effective.email, "ali.new@gmail.com");

  assertEquals(STUDENT_INFO_CONFLICT, "Record changed, reload");
  assertEquals(studentInfoWriteConflict({ data: null, error: null }), true);
  assertEquals(studentInfoWriteConflict({ data: undefined, error: undefined }), true);
  assertEquals(studentInfoWriteConflict({ data: { id: 1 }, error: null }), false);
  assertEquals(studentInfoWriteConflict({ data: null, error: { message: "fail" } }), false);
});
Deno.test("B20-5: student_info_save calls the lock RPC and maps 0 rows to 409", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: [], error: null }); } };
  const expect = { full_name: "Ayesha Khan", address: '12, "Quoted" Road, Lahore' };
  const patch = { student_info: { ...expect, full_name: "Ayesha Khan 2" }, full_name: "Ayesha Khan 2" };
  const up = await studentInfoLockUpdate(db, 42, expect, patch);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, STUDENT_INFO_LOCK_RPC);
  assertEquals(calls[0].args, { p_id: 42, p_expect: expect, p_patch: patch });
  assertEquals(studentInfoWriteConflict(up), true, "empty set is a conflict");
  assertEquals(studentInfoWriteConflict({ data: null, error: null }), true);
  assertEquals(studentInfoWriteConflict({ data: [{ id: 42, full_name: "Ayesha Khan 2" }], error: null }), false);
  assertEquals(studentInfoWriteConflict({ data: [], error: { message: "fail" } }), false, "an RPC error is not a silent conflict");
  const src = await Deno.readTextFile(new URL("../supabase/functions/admission/index.ts", import.meta.url));
  const save = src.slice(src.indexOf('body.action === "student_info_save"'), src.indexOf('body.action === "regen_docs"'));
  assert(save.includes("studentInfoLockUpdate(db, e.id, e.student_info, patch)"));
  assertFalse(save.includes('.eq("student_info"') || save.includes('.is("student_info"'), "no PostgREST eq/is on the jsonb object");
  assert(save.includes("STUDENT_INFO_CONFLICT") && save.includes("409"));
});
Deno.test("reminder schedule parsing and stages", () => {
  assertEquals(parseOffsets("-3,0,3"), [-3, 0, 3]); assertEquals(parseOffsets(" -5, -1 ,2"), [-5, -1, 2]);
  assertEquals(parseOffsets("3,0,-3"), [-3, 0, 3]); assertEquals(parseOffsets("x"), [-3, 0, 3]); assertEquals(parseOffsets("-40,0,3"), [-3, 0, 3]);
  assert(offsetsError("3,0,-3")); assert(offsetsError("1,2")); assertEquals(offsetsError("-7,0,7"), null);
  assertEquals(stageFor("2026-12-07", "2026-12-10"), 1); assertEquals(stageFor("2026-12-06", "2026-12-10"), 0);
  assertEquals(stageFor("2026-12-10", "2026-12-10"), 2); assertEquals(stageFor("2026-12-13", "2026-12-10"), 3);
  assertEquals(stageFor("2026-12-03", "2026-12-10", [-7, 0, 7]), 1);
  assertEquals(nextReminder("2026-12-10", 0, "2026-12-01"), { stage: 1, date: "2026-12-07" });
  assertEquals(nextReminder("2026-12-10", 1, "2026-12-08"), { stage: 2, date: "2026-12-10" });
  assertEquals(nextReminder("2026-12-10", 1, "2026-12-12"), { stage: 2, date: "2026-12-12" }, "late: goes out on the next run");
  assertEquals(nextReminder("2026-12-10", 3, "2026-12-12"), null); assertEquals(nextReminder(null, 0, "2026-12-12"), null);
  assert(isPaused({ reminders_paused: true }, "2026-12-01")); assert(isPaused({ reminders_paused: true, reminders_paused_until: "2026-12-05" }, "2026-12-05"));
  assertFalse(isPaused({ reminders_paused: true, reminders_paused_until: "2026-12-04" }, "2026-12-05")); assertFalse(isPaused(null, "2026-12-05"));
});
Deno.test("discount without a plan lowers the fee; never below what is paid", () => {
  assertEquals(applyDiscount({ fee: 25000, paid: 10000, plan: null, cut: 5000 }), { fee: 20000, plan: null });
  assertEquals(applyDiscount({ fee: 25000, paid: 10000, plan: null, cut: 15000 }), { fee: 10000, plan: null });
  assert(applyDiscount({ fee: 25000, paid: 10000, plan: null, cut: 15001 }).error?.includes("refund"));
  assert(applyDiscount({ fee: 0, paid: 0, plan: null, cut: 100 }).error);
});
Deno.test("discount with a plan shrinks open installments from the last one; paid ones stay", () => {
  const plan = [{ no: 1, amount: 10000, due: "2026-11-01" }, { no: 2, amount: 10000, due: "2026-12-01" }, { no: 3, amount: 10000, due: "2027-01-01" }];
  assertEquals(applyDiscount({ fee: 30000, paid: 10000, plan, cut: 4000 }).plan, [{ no: 1, amount: 10000, due: "2026-11-01" }, { no: 2, amount: 10000, due: "2026-12-01" }, { no: 3, amount: 6000, due: "2027-01-01" }]);
  const r = applyDiscount({ fee: 30000, paid: 10000, plan, cut: 12000 });
  assertEquals(r.fee, 18000); assertEquals(r.plan, [{ no: 1, amount: 10000, due: "2026-11-01" }, { no: 2, amount: 8000, due: "2026-12-01" }]);
  assertEquals(applyDiscount({ fee: 30000, paid: 15000, plan, cut: 15000 }).plan, [{ no: 1, amount: 10000, due: "2026-11-01" }, { no: 2, amount: 5000, due: "2026-12-01" }], "half-paid installment keeps its paid part");
  assertEquals(applyDiscount({ fee: 30000, paid: 10000, plan, cut: 20000 }).plan, null, "one installment left: plan dropped");
  assertEquals(planDue(r.plan, 10000), "2026-12-01"); assertEquals(planDue(r.plan, 18000), null);
  assertEquals(undoDiscount({ fee: 18000, plan: r.plan, add: 12000 }), { fee: 30000, plan: [{ no: 1, amount: 10000, due: "2026-11-01" }, { no: 2, amount: 20000, due: "2026-12-01" }] });
});
Deno.test("payment proof paths and references", () => {
  const p = proofPath(12, 34, "image/png", 1764000000000)!;
  assertEquals(p, "payment-proofs/12/34-1764000000000.png"); assert(proofPathOk(p, 12, 34));
  assertFalse(proofPathOk(p, 12, 35)); assertFalse(proofPathOk("payment-proofs/12/34-1764000000000.png/../x", 12, 34)); assertFalse(proofPathOk("../internal/dfa-raast-qr.jpg", 12, 34));
  assertEquals(proofPath(12, 34, "text/html"), null);
  assertEquals(cleanRef("  TID 123\n "), "TID 123"); assertEquals(cleanRef(""), null); assertEquals(cleanRef("x".repeat(100))!.length, 80);
});
Deno.test("Resend (Svix) webhook signature", async () => {
  const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef"), id = "msg_1", ts = "1764000000", body = '{"type":"email.bounced","data":{"email_id":"abc"}}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("0123456789abcdef0123456789abcdef"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
  assert(await verifySvix(secret, id, ts, body, `v1,${sig}`, 1764000100));
  assert(await verifySvix(secret, id, ts, body, `v1,bad v1,${sig}`, 1764000100));
  assertFalse(await verifySvix(secret, id, ts, body + " ", `v1,${sig}`, 1764000100), "body changed");
  assertFalse(await verifySvix(secret, id, ts, body, `v1,${sig}`, 1764001000), "too old");
  assertFalse(await verifySvix("", id, ts, body, `v1,${sig}`, 1764000100), "no secret configured = webhook off");
  assertEquals(deliveryFrom("email.bounced"), "bounced"); assertEquals(deliveryFrom("email.sent"), null);
});
Deno.test("dashboard: month collected minus refunds, outstanding, overdue, next 7 days; test records left out", () => {
  const enr = [
    { id: 1, status: "active", fee_total: 25000, amount_paid: 10000, balance_due: 15000, due_date: "2026-11-20", created_at: "2026-11-02T10:00:00Z" },
    { id: 2, status: "active", fee_total: 40000, amount_paid: 20000, balance_due: 20000, due_date: "2026-11-28", created_at: "2026-10-30T20:00:00Z" },
    { id: 3, status: "active", fee_total: 25000, amount_paid: 25000, balance_due: 0, due_date: null, created_at: "2026-11-03T10:00:00Z" },
    { id: 4, status: "active", fee_total: 25000, amount_paid: 7, balance_due: 24993, due_date: "2026-11-01", created_at: "2026-11-01T10:00:00Z" },
    { id: 5, status: "pending", fee_total: null, amount_paid: 0, balance_due: 0, due_date: null, created_at: "2026-11-24T10:00:00Z" },
  ];
  const pays = [{ enrollment_id: 1, amount: 10000, paid_on: "2026-11-05", method: "bank" }, { enrollment_id: 2, amount: 20000, paid_on: "2026-10-31" }, { enrollment_id: 3, amount: 25000, paid_on: "2026-11-10", method: "cash" }, { enrollment_id: 3, amount: 999, paid_on: "2026-11-11", voided_at: "2026-11-12" }, { enrollment_id: 4, amount: 7, paid_on: "2026-11-01" }];
  const adjs = [{ enrollment_id: 3, kind: "refund", amount: 5000, adj_date: "2026-11-20" }, { enrollment_id: 1, kind: "discount", amount: 1000, adj_date: "2026-11-20" }];
  const d = dashboard({ today: "2026-11-25", enr, pays, adjs, testIds: new Set([4]) });
  assertEquals(d.collected_month, 10000 + 25000 - 5000); assertEquals(d.collected_prev, 20000); assertEquals(d.refunds_month, 5000);
  assertEquals(d.outstanding, 35000); assertEquals(d.overdue, [{ id: 1, days: 5 }]); assertEquals(d.soon, [{ id: 2, due: "2026-11-28" }]);
  assertEquals(d.by_method, { bank: 10000, cash: 25000 }); assertEquals(d.pending, 1); assertEquals(d.new_month, 3, "Oct 30 20:00 UTC is Oct 31 in PKT; the test record is left out");
  assertEquals(d.months.length, 6); assertEquals(d.months[5], { month: "2026-11", net: 30000 });
});
Deno.test("activity summaries for existing actions", () => {
  assertEquals(summarize("record_payment", { id: 1 }, { ok: true, payment: { amount: 5000, invoice_no: "INV-2026-0050", method: "bank", reference: "TID9" }, email: "sent" }), "Installment payment PKR 5,000 (INV-2026-0050) by bank, ref TID9. Receipt email: sent");
  assertEquals(summarize("cert_revoke", { undo: false }, { ok: true }), "Certificate revoked");
  assertEquals(summarize("cert_revoke", { undo: false, reason: "Did not attend" }, { ok: true }), "Certificate revoked: Did not attend");
  assertEquals(summarize("resend", { items: ["admission"] }, { retry: true }), null, "retries are not logged");
  assertEquals(summarize("resend", { items: ["admission"] }, { error: "x" }), null);
  assertEquals(summarize("regen_docs", { done: [] }, { ok: true, remaining: 2 }), null);
  assertEquals(summarize("regen_docs", { done: ["admission"] }, { ok: true, remaining: 0 }), "Admission form and receipts rebuilt");
  assertEquals(summarize("docs_status", {}, { ok: true }), null);
});
