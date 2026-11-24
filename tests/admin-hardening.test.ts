// deno test tests/admin-hardening.test.ts — fixes from the Head of Tech review of PR #12 (B1, B2 and the money/security list).
import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@1";
import { searchOr, verifySvix, safeEqual, maskEmail, maskPhone, staffRow, staffPay, addStudentRow, confirmOk, sameJson, STAFF_ENR_COLS, allowed } from "../supabase/functions/admission/prologic.ts";
import { handlePro } from "../supabase/functions/admission/pro.ts";

const src = (p: string) => Deno.readTextFileSync(new URL("../" + p, import.meta.url));
const IDX = src("supabase/functions/admission/index.ts"), PRO = src("supabase/functions/admission/pro.ts"), LOGIC = src("supabase/functions/admission/prologic.ts");
const MIG = src("supabase/migrations/20261125130000_admin_portal_hardening.sql"), MIG0 = src("supabase/migrations/20261125120000_admin_portal_upgrade.sql");

// ---- a tiny fake of the supabase-js query builder: records calls, answers from a table of canned results
type Call = { table: string; op: string; args: unknown[]; chain: [string, unknown[]][] };
function fakeDb(answer: (c: Call) => any, storage: Record<string, any> = {}) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const c: Call = { table, op: "", args: [], chain: [] };
    const run = () => Promise.resolve(answer(c));
    const b: any = new Proxy({}, { get(_t, k: string) {
      if (k === "then") return (res: any, rej: any) => run().then(res, rej);
      return (...args: unknown[]) => {
        if (["select", "insert", "update", "upsert", "delete"].includes(k) && !c.op) { c.op = k; c.args = args; calls.push(c); }
        else c.chain.push([k, args]);
        if (k === "maybeSingle" || k === "single") return run();
        return b;
      };
    } });
    return b;
  };
  return { calls, from: builder, rpc: (fn: string, args: unknown) => { const c: Call = { table: "rpc:" + fn, op: "rpc", args: [args], chain: [] }; calls.push(c); return Promise.resolve(answer(c)); }, storage: { from: () => storage } };
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const ctx = { json, today: () => "2026-11-25" };
const staff = { id: "00000000-0000-0000-0000-00000000000b" };

Deno.test("B1: pro_add_student keeps only email, name, course, phone, source (repro fields are dropped)", async () => {
  const v = addStudentRow({ email: " Victim@T.L ", full_name: "Forged Person", course_code: "a1-normal", phone: "0300 1234567", source: "walk-in", status: "active", certificate_issued_at: "2026-11-25", amount_paid: 25000, fee_total: 25000, student_info: { cnic: "1" } });
  assertEquals(v.row, { email: "victim@t.l", full_name: "Forged Person", course_code: "a1-normal", phone: "03001234567", source: "walk-in" });
  assert(addStudentRow({ email: "bad", full_name: "X Y", course_code: "a1" }).error);
  assert(addStudentRow({ email: "a@b.co", full_name: "X", course_code: "a1" }).error);
  assertEquals(addStudentRow({ email: "a@b.co", full_name: "Xy", course_code: "a1", source: "hack" }).row?.source, "manual");
  let inserted: any = null;
  const db = fakeDb((c) => {
    if (c.table === "courses") return { data: { code: "a1-normal", name: "A1 Normal" } };
    if (c.table === "enrollments" && c.op === "select") return { data: [] };
    if (c.table === "enrollments" && c.op === "insert") { inserted = c.args[0]; return { data: { id: 7, student_id: "DFA-2026-0099", full_name: "Forged Person" } }; }
    if (c.table === "profiles") return { data: { full_name: "Staff One" } };
    return { data: null };
  });
  const r = await handlePro(db, { action: "pro_add_student", email: "victim@t.l", full_name: "Forged Person", course_code: "a1-normal", certificate_issued_at: "x", amount_paid: 25000, status: "active" }, staff, "staff", ctx);
  assertEquals(r!.status, 200);
  assertEquals(Object.keys(inserted).sort(), ["course_code", "course_label", "email", "full_name", "phone", "source", "status"]);
  assertEquals(inserted.status, "pending");
  assert(db.calls.some((c) => c.table === "admin_activity" && c.op === "insert"), "logged");
});

Deno.test("B1: enrollment inserts can't carry a certificate or a paid amount; public verify needs active/expired", () => {
  assertMatch(MIG, /if tg_op = 'INSERT' then\s+--[^\n]*\n\s+--[^\n]*\n\s+new\.certificate_issued_at := null; new\.certificate_revoked_at := null; new\.amount_paid := 0;/);
  assertMatch(MIG, /drop policy if exists enr_staff_ins on public\.enrollments;/);
  assertFalse(/create policy enr_staff_ins/.test(MIG0 + MIG), "no staff insert policy anywhere");
  assertMatch(IDX, /if \(e\.status !== "active" && e\.status !== "expired"\) return json\(\{ found: false \}\);/);
});

Deno.test("B2: staff rows are masked and carry no student details; payments carry no files", () => {
  const e = { id: 1, full_name: "Ali", email: "ali.khan@gmail.com", phone: "03001234567", student_info: { cnic: "35202-1234567-1", dob: "1995-02-11", address: "x" }, notes: "secret", receipt_url: "https://drive.google.com/file/d/abc", admission_file: "a.pdf", status: "active" };
  const r = staffRow(e);
  assertEquals(r.email, "a•••@g•••.com"); assertEquals(r.phone, "030•••67"); assert(r.has_email && r.has_phone && r.masked);
  for (const k of ["student_info", "notes", "receipt_url", "admission_file", "receipt_file", "certificate_file", "certificate_code", "sheet_row", "source_ref"]) assertFalse(k in r, k);
  assertFalse(JSON.stringify(r).includes("35202") || JSON.stringify(r).includes("ali.khan") || JSON.stringify(r).includes("1234567"));
  assertFalse(/student_info|notes|receipt_url|certificate_code/.test(STAFF_ENR_COLS));
  const p = staffPay({ id: 1, amount: 5, receipt_file: "r.pdf", void_reason: "x", created_by: "u", proof_url: "https://evil.example/x" });
  assertFalse("receipt_file" in p); assertFalse("created_by" in p); assertEquals(p.proof_url, null);
  assertEquals(maskEmail(""), ""); assertEquals(maskPhone("123"), "•••");
});

Deno.test("B2: pro_students returns masked rows only; pro_reveal logs who looked", async () => {
  const db = fakeDb((c) => {
    if (c.table === "site_settings") return { data: { value: "off" } };
    if (c.table === "enrollments" && c.op === "select") return c.chain.some(([k]) => k === "range") ? { data: [{ id: 1, full_name: "A", email: "a@b.com", phone: "03001234567", student_info: { cnic: "1" } }], count: 1 } : { data: { id: 1, full_name: "A", email: "a@b.com", phone: "03001234567" } };
    if (c.table === "payments") return { data: [{ id: 9, enrollment_id: 1, amount: 100, receipt_file: "x.pdf" }] };
    if (c.table === "profiles") return { data: { full_name: "Staff One" } };
    return { data: null };
  });
  const r = await (await handlePro(db, { action: "pro_students", filter: "all", page: 0, size: 25 }, staff, "staff", ctx))!.json();
  assertEquals(r.rows[0].email, "a•••@b•••.com"); assertFalse("student_info" in r.rows[0]); assertFalse("receipt_file" in r.pays[0]); assertEquals(r.flags.staff_payments, false);
  const sel = db.calls.find((c) => c.table === "enrollments")!; assertEquals(sel.args[0], STAFF_ENR_COLS);
  const v = await (await handlePro(db, { action: "pro_reveal", id: 1, field: "phone" }, staff, "staff", ctx))!.json();
  assertEquals(v.value, "03001234567");
  const log = db.calls.find((c) => c.table === "admin_activity" && c.op === "insert")!; assertEquals((log.args[0] as any).action, "contact_shown"); assertEquals((log.args[0] as any).actor, staff.id);
  assertEquals((await handlePro(db, { action: "pro_reveal", id: 1, field: "student_info" }, staff, "staff", ctx))!.status, 400);
});

Deno.test("B2: staff activity hides old/new values of student-detail edits; export stays admin-only", async () => {
  const db = fakeDb((c) => {
    if (c.table === "admin_activity") return { data: [] };
    if (c.table === "enrollment_audit") return { data: [{ id: 1, enrollment_id: 1, kind: "student_info", reason: "typo", old_values: { cnic: "35202-1" }, new_values: { cnic: "35202-2" }, changed_by: null, changed_at: "2026-11-25T00:00:00Z" }] };
    return { data: [] };
  });
  const st = await (await handlePro(db, { action: "pro_activity", id: 1 }, staff, "staff", ctx))!.json();
  assertFalse(JSON.stringify(st).includes("35202")); assertMatch(st.rows[0].summary, /cnic/);
  const ad = await (await handlePro(db, { action: "pro_activity", id: 1 }, { id: "a" }, "admin", ctx))!.json();
  assert(JSON.stringify(ad).includes("35202-2"));
  assertEquals((await handlePro(db, { action: "pro_export_log", what: "students" }, staff, "staff", ctx))!.status, 403);
  assertFalse(allowed("staff", "pro_export_log")); assertFalse(allowed("staff", "export"));
  for (const t of ["enr_staff_select", "pay_staff_select", "elog_staff_select", "act_staff_select", "audit_staff_select"]) {
    assertMatch(MIG, new RegExp(`drop policy if exists ${t} `)); assertFalse(new RegExp(`create policy ${t}`).test(MIG0 + MIG), t);
  }
});

Deno.test("webhook: constant-time compare; malformed secret or signature never throws", async () => {
  assert(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))); assertFalse(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))); assertFalse(safeEqual(new Uint8Array([1]), new Uint8Array([1, 2])));
  assertFalse(await verifySvix("whsec_%%%not-base64%%%", "m", "1764000000", "{}", "v1,abc", 1764000000), "malformed secret = false, no throw");
  const secret = "whsec_" + btoa("k".repeat(32));
  assertFalse(await verifySvix(secret, "m", "1764000000", "{}", "v1,%%% v1 v2,xx", 1764000000), "malformed signature = false");
  assertFalse(/s === mac/.test(LOGIC), "no string === compare of the MAC");
  assertMatch(IDX, /catch \(_\) \{ return json\(\{ error: "bad request" \}, 400\); \}/);
});

Deno.test("typed confirmations are checked on the server", async () => {
  assertFalse(confirmOk("pro_revoke", {})); assert(confirmOk("pro_revoke", { confirm: "revoke" })); assertFalse(confirmOk("pro_remove", { confirm: "REVOKE" })); assert(confirmOk("pro_remove", { confirm: "DELETE" }));
  assertFalse(confirmOk("cert_revoke", {})); assert(confirmOk("cert_revoke", { undo: true })); assert(confirmOk("pro_restore", {}));
  const db = fakeDb((c) => c.table === "enrollments" ? { data: { id: 1, status: "active", full_name: "A" } } : { data: null });
  const r = await handlePro(db, { action: "pro_revoke", id: 1, reason: "left the course" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 400); assertFalse(db.calls.some((c) => c.op === "update"), "nothing changed");
  assertMatch(IDX, /if \(!confirmOk\(String\(body\.action \|\| ""\), body\)\)/);
});

Deno.test("money: discounts and voids go through one SQL call; void restores the plan it removed", async () => {
  assertMatch(PRO, /db\.rpc\("fee_adjust_apply"/); assertMatch(PRO, /db\.rpc\("fee_adjust_void"/);
  assertFalse(/from\("fee_adjustments"\)\.insert/.test(PRO), "no separate insert"); assertFalse(/from\("fee_adjustments"\)\.update/.test(PRO), "no separate void update");
  const plan = [{ amount: 10000, due: "2026-11-01" }, { amount: 10000, due: "2026-12-01" }, { amount: 5000, due: "2027-01-01" }];
  let voidArgs: any = null;
  const db = fakeDb((c) => {
    if (c.table === "fee_adjustments") return { data: { id: 3, enrollment_id: 1, kind: "discount", amount: 15000, receipt_no: "DS-2026-0001", plan_before: plan, plan_after: null, voided_at: null } };
    if (c.table === "enrollments") return { data: { id: 1, fee_total: 10000, amount_paid: 10000, installment_plan: null, due_date: null } };
    if (c.table === "rpc:fee_adjust_void") { voidArgs = c.args[0]; return { data: { id: 3 } }; }
    return { data: null };
  });
  const r = await handlePro(db, { action: "pro_adjust_void", adjustment_id: 3, reason: "wrong student" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 200);
  assertEquals(voidArgs.p_patch.fee_total, 25000); assertEquals(voidArgs.p_patch.installment_plan, plan); assertEquals(voidArgs.p_expect_fee, 10000);
  assert(sameJson(null, [])); assert(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })); assertFalse(sameJson(plan, null));
  // already void (two clicks at once): the second call is refused by the SQL function, shown as a plain message
  const db2 = fakeDb((c) => c.table === "rpc:fee_adjust_void" ? { error: { code: "P0001", message: "DFA: already void" } } : c.table === "fee_adjustments" ? { data: { id: 4, enrollment_id: 1, kind: "refund", amount: 1, voided_at: null } } : { data: null });
  assertEquals((await handlePro(db2, { action: "pro_adjust_void", adjustment_id: 4, reason: "dup" }, { id: "a" }, "admin", ctx))!.status, 409);
  // over-refund refused by the DB (row lock) comes back as a 400 with the net amount, no SQL text
  const db3 = fakeDb((c) => c.table === "rpc:fee_adjust_apply" ? { error: { code: "23514", message: "DFA: Refunds can't be more than what the student has paid (net PKR 4,000)." } } : c.table === "enrollments" ? { data: { id: 1, invoice_no: "INV-1", fee_total: 25000, amount_paid: 10000 } } : { data: null });
  const r3 = await handlePro(db3, { action: "pro_adjust", id: 1, kind: "refund", amount: 9000, reason: "left", approved_by: "Ali" }, { id: "a" }, "admin", ctx);
  assertEquals(r3!.status, 400); assertEquals((await r3!.json()).error, "Refunds can't be more than what the student has paid (net PKR 4,000).");
  assertMatch(MIG, /for no key update;/); assertMatch(MIG, /where id = p_id and voided_at is null returning \* into a;/);
});

Deno.test("last admin, private helpers, attendance deletes, staff payment flag, storage limits", () => {
  assertMatch(MIG, /pg_advisory_xact_lock\(hashtext\('dfa:last-admin'\)\)/); assertFalse(/count: "exact", head: true \}\)\.eq\("role", "admin"\)/.test(PRO), "no count-then-update");
  assertMatch(MIG, /revoke all on function private\.actor_name\(uuid\) from public, anon, authenticated;/);
  assertMatch(MIG, /create policy att_admin_del on public\.attendance for delete/); assertMatch(MIG, /create trigger attendance_delete_log after delete on public\.attendance/);
  assertMatch(MIG, /\('staff_payments', 'off'\)/);
  assertMatch(MIG, /file_size_limit = 10485760, allowed_mime_types = array\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\] where id = 'documents'/);
});

Deno.test("proof slip: size and type are read from storage, not from the browser", async () => {
  let removed: string[] = [];
  const path = "payment-proofs/1/9-1764000000000.jpg";
  const storage = { list: () => Promise.resolve({ data: [{ name: "9-1764000000000.jpg", metadata: { size: 9 * 1024 * 1024, mimetype: "image/jpeg" } }] }), remove: (p: string[]) => { removed = p; return Promise.resolve({ data: p }); } };
  const db = fakeDb((c) => c.table === "payments" && c.op === "select" ? { data: { id: 9, enrollment_id: 1, invoice_no: "INV-1" } } : { data: null }, storage);
  const r = await handlePro(db, { action: "pro_proof_attach", payment_id: 9, path, size: 1000, type: "image/jpeg" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 400); assertEquals(removed, [path]); assertFalse(db.calls.some((c) => c.op === "update"));
  storage.list = () => Promise.resolve({ data: [{ name: "9-1764000000000.jpg", metadata: { size: 1000, mimetype: "text/html" } }] });
  assertEquals((await handlePro(db, { action: "pro_proof_attach", payment_id: 9, path }, { id: "a" }, "admin", ctx))!.status, 400);
  storage.list = () => Promise.resolve({ data: [{ name: "9-1764000000000.jpg", metadata: { size: 1000, mimetype: "image/jpeg" } }] });
  assertEquals((await handlePro(db, { action: "pro_proof_attach", payment_id: 9, path }, { id: "a" }, "admin", ctx))!.status, 200);
});

Deno.test("bounce tracking: Resend id is kept per request (no shared LAST_ID)", async () => {
  assertFalse(/let LAST_ID/.test(IDX)); assertMatch(IDX, /new AsyncLocalStorage<\{ lastId: string \| null \}>\(\)/); assertMatch(IDX, /MAIL_CTX\.run\(\{ lastId: null \}/);
  // the mechanism: two overlapping requests each see only their own id
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const als = new AsyncLocalStorage<{ lastId: string | null }>();
  const req = (id: string, wait: number) => als.run({ lastId: null }, async () => { als.getStore()!.lastId = id; await new Promise((r) => setTimeout(r, wait)); return als.getStore()!.lastId; });
  assertEquals(await Promise.all([req("A", 30), req("B", 5)]), ["A", "B"]);
});

Deno.test("R2-2: staff search matches contacts only on the exact full email or a full phone number", () => {
  const st = searchOr("ali", "staff");
  assert(st.includes("full_name.ilike.*ali*") && st.includes("student_id.ilike.*ali*") && st.includes("certificate_no.ilike.*ali*"));
  assertFalse(/email|phone/.test(st), "no partial contact match");
  assertFalse(/email|phone/.test(searchOr("0300123", "staff")), "7 digits: no phone match");
  assertFalse(/email|phone/.test(searchOr("ali@gm", "staff")), "partial email: no email match");
  assertMatch(searchOr("Ali.Khan@Gmail.com", "staff"), /email\.eq\.ali\.khan@gmail\.com/);
  const ph = searchOr("0300 1234567", "staff");
  assertMatch(ph, /phone\.in\.\("03001234567","\+03001234567","923001234567","\+923001234567"\)/);
  assertFalse(/ilike\.\*0300/.test(ph.replace(/^.*phone/, "")), "phone is exact only");
  assert(searchOr("ali", "admin").includes("email.ilike.*ali*"), "admins keep partial matching");
});

Deno.test("staff payment slips behind the flag and logged; staff email log hides raw errors; payment void guard mapped to 409", async () => {
  assertFalse(allowed("staff", "pro_proof_url")); assert(allowed("staff", "pro_proof_url", true));
  const db = fakeDb((c) => c.table === "payments" ? { data: { id: 9, enrollment_id: 1, invoice_no: "INV-1", proof_url: "https://drive.google.com/file/d/abcdefghijklmnopqrstu/view" } } : c.table === "profiles" ? { data: { full_name: "Staff One" } } : { data: null });
  const r = await handlePro(db, { action: "pro_proof_url", payment_id: 9 }, staff, "staff", ctx);
  assertEquals(r!.status, 200);
  const log = db.calls.find((c) => c.table === "admin_activity" && c.op === "insert")!; assertEquals((log.args[0] as any).action, "payment_proof_opened");
  const db2 = fakeDb((c) => c.table === "email_log" ? { data: [{ id: 1, enrollment_id: 1, kind: "docs", status: "error", error: "550 mailbox ali.khan@gmail.com unknown" }] } : { data: [] });
  const st = await (await handlePro(db2, { action: "pro_email_log" }, staff, "staff", ctx))!.json();
  assertFalse(JSON.stringify(st).includes("ali.khan")); assertEquals(st.rows[0].error, "Not delivered (an admin can see the details)");
  const ad = await (await handlePro(db2, { action: "pro_email_log" }, { id: "a" }, "admin", ctx))!.json();
  assert(JSON.stringify(ad).includes("550 mailbox"));
  assertMatch(IDX, /if \(\/refunds against it\/i\.test\(u1\.error\.message \|\| ""\)\) return json\(\{ error: "This payment has refunds against it\. Void the refund first\.", code: "refund_guard" \}, 409\);/);
  assertMatch(IDX, /content_type must be one of the documents bucket's allowed MIME types/);
  const M3 = src("supabase/migrations/20261125140000_payment_refund_guard.sql");
  assertMatch(M3, /security definer set search_path to ''/); assertMatch(M3, /for no key update;/); assertMatch(M3, /before update of voided_at, amount on public\.payments/);
});
