// deno test tests/admin-qa2.test.ts — QA Tester recheck, round 2 (server side).
import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@1";
import { testConfirmOk, testConfirmWord, expectSidOk, actorLabel, activityKind, proofBytesOk, resendPlan, adjustmentMail, allowed } from "../supabase/functions/admission/prologic.ts";
import { handlePro, setMailer } from "../supabase/functions/admission/pro.ts";

const src = (p: string) => Deno.readTextFileSync(new URL("../" + p, import.meta.url));
const IDX = src("supabase/functions/admission/index.ts"), SEC = src("supabase/functions/security/index.ts");
const MIG = src("supabase/migrations/20261125210000_admin_qa_round2.sql");

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

// ---- 1. wrong student / TEST mark -------------------------------------------------------------------
Deno.test("QA2-1: TEST mark needs the typed Student ID; the server checks it against the enrollment id", async () => {
  assert(testConfirmOk("DFA-2026-0012", "dfa-2026-0012")); assert(testConfirmOk("DFA-2026-0012", " DFA-2026-0012 "));
  assertFalse(testConfirmOk("DFA-2026-0012", "DFA-2026-0013")); assertFalse(testConfirmOk("DFA-2026-0012", "")); assertFalse(testConfirmOk("DFA-2026-0012", "TEST"));
  assertEquals(testConfirmWord(null), "TEST"); assert(testConfirmOk(null, "test"));
  const e = { id: 7, student_id: "DFA-2026-0099", full_name: "TEST Card" };
  const db = fakeDb((c) => c.table === "enrollments" ? { data: e } : c.op === "rpc" ? { data: { ok: true } } : { data: null });
  const bad = await handlePro(db, { action: "pro_mark_test", id: 7, on: true, confirm: "DFA-2026-0012" }, { id: "a" }, "admin", ctx);
  assertEquals(bad!.status, 400); assertEquals((await bad!.json()).code, "confirm");
  assertFalse(db.calls.some((c) => c.op === "rpc" || c.table === "student_meta"));
  const ok = await handlePro(db, { action: "pro_mark_test", id: 7, on: true, confirm: "DFA-2026-0099" }, { id: "a" }, "admin", ctx);
  assertEquals(ok!.status, 200);
  const rpc = db.calls.find((c) => c.table === "rpc:set_test_mark")!; assertEquals((rpc.args[0] as any).p_enr, 7); assertEquals((rpc.args[0] as any).p_actor, "a");
  assertFalse(db.calls.some((c) => c.table === "student_meta"), "no direct student_meta write: set_test_mark writes the row and its audit row together");
});
Deno.test("QA2-1: set_test_mark errors map to plain messages (already marked)", async () => {
  const db = fakeDb((c) => c.table === "enrollments" ? { data: { id: 7, student_id: "S1", full_name: "X" } } : c.op === "rpc" ? { error: { code: "23514", message: "DFA: Already marked TEST" } } : { data: null });
  const r = await handlePro(db, { action: "pro_mark_test", id: 7, on: true, confirm: "S1" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 409); assertEquals((await r!.json()).error, "Already marked TEST");
});
Deno.test("QA2-1: a card bound to another student (expect_sid) changes nothing", async () => {
  assert(expectSidOk({ student_id: "A" }, "A")); assertFalse(expectSidOk({ student_id: "A" }, "B")); assert(expectSidOk({ student_id: "A" }, undefined)); assertFalse(expectSidOk(null, "A"));
  const db = fakeDb((c) => c.table === "enrollments" ? { data: { student_id: "DFA-2026-0012" } } : { data: null });
  const r = await handlePro(db, { action: "pro_tags", id: 12, tags: ["x"], expect_sid: "DFA-2026-0099" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 409); assertEquals((await r!.json()).code, "stale");
  assertFalse(db.calls.some((c) => ["update", "upsert", "insert", "delete", "rpc"].includes(c.op)));
});
Deno.test("QA2-1: only an admin marks TEST; the browser can't flip is_test directly", () => {
  assertFalse(allowed("staff", "pro_mark_test")); assert(allowed("admin", "pro_mark_test"));
  assertMatch(MIG, /TEST marks are changed only in the admin portal/);
  assertMatch(MIG, /revoke all on function public\.set_test_mark\(bigint, boolean, uuid, text\) from public, anon, authenticated;/);
  assertMatch(MIG, /grant execute on function public\.set_test_mark\(bigint, boolean, uuid, text\) to service_role;/);
});

// ---- 4. attendance --------------------------------------------------------------------------------
Deno.test("QA2-4: one summary row per save, and the Attendance filter matches it", async () => {
  assertMatch(MIG, /'attendance_saved'/); assertMatch(MIG, /dfa\.attendance_bulk/);
  assertEquals(activityKind("attendance"), { like: "attendance%" });
  assertEquals(activityKind("marked_test"), { in: ["marked_test", "unmarked_test"] }, "TEST marks filter shows unmarks too");
  assertEquals(activityKind(""), null);
  const db = fakeDb(() => ({ data: [] }));
  await handlePro(db, { action: "pro_activity", kind: "attendance" }, { id: "s" }, "staff", ctx);
  const q = db.calls.find((c) => c.table === "admin_activity")!;
  assert(q.chain.some(([k, a]) => k === "or" && String(a[0]).includes("action.eq.attendance_saved")), "staff see class-level attendance saves");
  assert(q.chain.some(([k, a]) => k === "like" && a[1] === "attendance%"));
});

// ---- 5. slips -------------------------------------------------------------------------------------
Deno.test("QA2-5: a 1×1 PNG or a tiny / fake file is refused, never saved", async () => {
  const png1 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
  assertMatch(proofBytesOk("image/png", png1, 300)!, /too small to read \(1×1/);
  assertMatch(proofBytesOk("image/png", png1, 67)!, /too small/);
  assertMatch(proofBytesOk("image/jpeg", png1, 5000)!, /not a real/);
  const big = new Uint8Array(24); big.set(png1); big[19] = 200; big[23] = 200;
  assertEquals(proofBytesOk("image/png", big, 5000), null);
  const path = "payment-proofs/1/9-1764000000000.png"; let removed: string[] = [];
  const body = new Uint8Array(400); body.set(png1);
  const storage = { list: () => Promise.resolve({ data: [{ name: "9-1764000000000.png", metadata: { size: 400, mimetype: "image/png" } }] }), remove: (p: string[]) => { removed = p; return Promise.resolve({ data: p }); }, download: () => Promise.resolve({ data: new Blob([body]) }) };
  const db = fakeDb((c) => c.table === "payments" && c.op === "select" ? { data: { id: 9, enrollment_id: 1, invoice_no: "INV-1" } } : { data: null }, storage);
  const r = await handlePro(db, { action: "pro_proof_attach", payment_id: 9, path }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 400); assertMatch((await r!.json()).error, /1×1/); assertEquals(removed, [path]);
  assertFalse(db.calls.some((c) => c.op === "update"));
  const up = await handlePro(db, { action: "pro_proof_upload", payment_id: 9, type: "image/png", size: 67 }, { id: "a" }, "admin", ctx);
  assertEquals(up!.status, 400);
});
Deno.test("QA2-5: a save that didn't stick is reported as a failure", async () => {
  const path = "payment-proofs/1/9-1764000000000.jpg"; const jpg = new Uint8Array(1000); jpg[0] = 0xff; jpg[1] = 0xd8;
  const storage = { list: () => Promise.resolve({ data: [{ name: "9-1764000000000.jpg", metadata: { size: 1000, mimetype: "image/jpeg" } }] }), remove: () => Promise.resolve({ data: [] }), download: () => Promise.resolve({ data: new Blob([jpg]) }) };
  const db = fakeDb((c) => c.table === "payments" && c.op === "select" ? { data: { id: 9, enrollment_id: 1, invoice_no: "INV-1" } } : c.op === "update" ? { data: null } : { data: null }, storage);
  assertEquals((await handlePro(db, { action: "pro_proof_attach", payment_id: 9, path }, { id: "a" }, "admin", ctx))!.status, 400);
});

// ---- 6. email log ---------------------------------------------------------------------------------
Deno.test("QA2-6: discount / refund receipts are emailed and logged; resend plans", async () => {
  assertEquals(resendPlan({ kind: "welcome" }), { kind: "welcome", items: ["admission", "receipt"] });
  assertEquals(resendPlan({ kind: "reminder-2" }), { kind: "reminder-2", items: ["reminder"] });
  assertEquals(resendPlan({ kind: "adjustment", items: ["ADJ:5", "DS-2026-0001"] }), { kind: "adjustment", items: ["ADJ:5"] });
  assertEquals(resendPlan({ kind: "resend", items: ["receipt", "reminder"] }), { kind: "resend", items: ["receipt"] });
  assertEquals(resendPlan({ kind: "weird" }), null);
  const m = adjustmentMail({ full_name: "TEST A", student_id: "S1" }, { kind: "refund", amount: 5000, receipt_no: "RF-2026-0001" }, 0);
  assertMatch(m.subject, /Refund receipt RF-2026-0001/); assertMatch(m.text, /PKR 5,000/); assertMatch(m.text, /contact\.deutschfuralle@gmail\.com/);
  assertFalse(/deutschfuraalle|whatsapp|wa\.me|\+92/i.test(m.text));
  const sent: any[] = []; setMailer(async (_db, e, kind, items, subject) => { sent.push({ e: e.id, kind, items, subject }); return { status: "sent" }; });
  const e = { id: 3, email: "t@test.local", full_name: "TEST A", student_id: "S1", invoice_no: "INV-1", fee_total: 25000, amount_paid: 25000, balance_due: 0, installment_plan: null };
  const db = fakeDb((c) => c.table === "enrollments" ? { data: e } : c.op === "rpc" ? { data: { id: 11, receipt_no: "RF-2026-0001", fee_after: 25000 } } : { data: null });
  const r = await handlePro(db, { action: "pro_adjust", id: 3, kind: "refund", amount: 1000, reason: "TEST refund", approved_by: "admin" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 200); assertEquals((await r!.json()).email.status, "sent");
  assertEquals(sent[0], { e: 3, kind: "adjustment", items: ["ADJ:11", "RF-2026-0001"], subject: "Refund receipt RF-2026-0001 – Deutsch Für Alle" });
  await handlePro(db, { action: "pro_adjust", id: 3, kind: "refund", amount: 1000, reason: "TEST refund", approved_by: "admin", email: false }, { id: "a" }, "admin", ctx);
  assertEquals(sent.length, 1, "unticked = no email");
  setMailer(null);
});
Deno.test("QA2-6: every email path logs; resend is admin-only; certify can email and logs skipped", () => {
  assertFalse(allowed("staff", "email_resend")); assertFalse(allowed("staff", "pro_adjust_mail"));
  assertMatch(IDX, /body\.action === "email_resend"/); assertMatch(IDX, /resendPlan\(row\)/);
  assertMatch(IDX, /logMail\(db, e0, "certificate", \["certificate"\], "skipped"/);
  assertMatch(IDX, /"reminder-manual"/); assertMatch(IDX, /setMailer\(async/);
});

// ---- 8. Who column ----------------------------------------------------------------------------------
Deno.test("QA2-8: Who shows the login name, not the brand name in full_name", async () => {
  assertEquals(actorLabel({ username: "zain", full_name: "Deutsch Für Alle" }), "zain");
  assertEquals(actorLabel({ username: null, full_name: "Ali" }), "Ali"); assertEquals(actorLabel(null), null);
  assertMatch(MIG, /coalesce\(nullif\(p\.username, ''\), nullif\(p\.full_name, ''\), 'Staff'\)/);
  const db = fakeDb((c) => c.table === "admin_activity" ? { data: [{ id: 1, enrollment_id: null, actor: "u1", actor_name: "Deutsch Für Alle", action: "export", summary: "x", created_at: "2026-11-25T00:00:00Z" }] }
    : c.table === "profiles" ? { data: [{ id: "u1", username: "zain", full_name: "Deutsch Für Alle" }] } : { data: [] });
  const r = await (await handlePro(db, { action: "pro_activity", kind: "export" }, { id: "a" }, "admin", ctx))!.json();
  assertEquals(r.rows[0].actor_name, "zain"); assertFalse("actor" in r.rows[0]);
});

// ---- 9. certificates ----------------------------------------------------------------------------------
Deno.test("QA2-9: revoke is admin-only and needs a reason; verify shows REVOKED", () => {
  assertFalse(allowed("staff", "cert_revoke"));
  assertMatch(IDX, /if \(!body\.undo && String\(body\.reason \|\| ""\)\.trim\(\)\.length < 3\)/);
  assertMatch(IDX, /revoked: true, certificate_no: e\.certificate_no, revoked_at/);
});

// ---- 2/3. speed ------------------------------------------------------------------------------------
Deno.test("QA2-2: security check reads in parallel, alert mail in the background, region header allowed", () => {
  assertMatch(SEC, /const \[roleR, vsR, devR, prefR\] = await Promise\.all/);
  assertMatch(SEC, /const \[okR, fR, ipR\] = await Promise\.all/);
  assertMatch(SEC, /bg\(\(async \(\) => \{\n\s+await send\(/);
  assertMatch(SEC, /x-region/); assertMatch(IDX, /x-region/);
});
Deno.test("QA2-1: the Student ID cross-check also guards non-pro actions (certify, activate, cert_*)", async () => {
  const db = fakeDb((c) => c.table === "enrollments" ? { data: { student_id: "DFA-2026-0012" } } : { data: null });
  const r = await handlePro(db, { action: "certify", id: 12, expect_sid: "DFA-2026-0099" }, { id: "a" }, "admin", ctx);
  assertEquals(r!.status, 409);
  const ok = await handlePro(db, { action: "certify", id: 12, expect_sid: "DFA-2026-0012" }, { id: "a" }, "admin", ctx);
  assertEquals(ok, null, "matching ID: index.ts carries on with the action");
});
Deno.test("QA2-8: a TEST tick on Add student is honoured for admins only, with one audit row via set_test_mark", async () => {
  const db = fakeDb((c) => c.table === "courses" ? { data: { code: "a1-normal", name: "A1" } } : c.table === "enrollments" && c.op === "insert" ? { data: { id: 50, student_id: null, full_name: "TEST Ali" } } : c.op === "rpc" ? { data: { ok: true } } : { data: [] });
  const body = { action: "pro_add_student", email: "t@test.local", full_name: "TEST Ali", course_code: "a1-normal", is_test: true };
  const r = await (await handlePro(db, body, { id: "a" }, "admin", ctx))!.json();
  assert(r.ok && r.is_test); assertEquals(db.calls.filter((c) => c.table === "rpc:set_test_mark").length, 1);
  const db2 = fakeDb((c) => c.table === "courses" ? { data: { code: "a1-normal", name: "A1" } } : c.table === "enrollments" && c.op === "insert" ? { data: { id: 51, student_id: null, full_name: "TEST Ali" } } : { data: [] });
  const r2 = await (await handlePro(db2, body, { id: "s" }, "staff", ctx))!.json();
  assertFalse(r2.is_test); assertFalse(db2.calls.some((c) => c.op === "rpc"));
});
