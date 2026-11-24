// deno test tests/admin-pro.test.ts — admin portal upgrade (WD-3): roles, reminders, discounts, proof paths, webhook signature, dashboard, activity summaries.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { allowed, parseOffsets, offsetsError, stageFor, nextReminder, isPaused, applyDiscount, undoDiscount, planDue, proofPath, proofPathOk, cleanRef, verifySvix, deliveryFrom, dashboard } from "../supabase/functions/admission/prologic.ts";
import { summarize } from "../supabase/functions/admission/audit.ts";

Deno.test("staff may resend and use their lists, but not revoke, refund, activate or change settings; payments only behind the flag", () => {
  for (const a of ["resend", "docs_status", "pro_assign_batch", "pro_activity", "pro_dashboard", "pro_students", "pro_reveal", "pro_add_student"]) assert(allowed("staff", a), a);
  for (const a of ["record_payment", "pro_proof_upload", "pro_proof_attach", "pro_payment_ref"]) { assertFalse(allowed("staff", a), a + " off by default"); assert(allowed("staff", a, true), a + " when switched on"); }
  for (const a of ["student_info_get", "doc_file_admin", "wa_links"]) assertFalse(allowed("staff", a), a + " (student details / documents with CNIC)");
  for (const a of ["activate", "cert_revoke", "cert_hold", "certify", "set_plan", "payment_correct", "set_emails", "cert_images", "settings_get", "pro_revoke", "pro_adjust", "pro_delete_test", "pro_role_set", "pro_accounts", "student_info_save"]) assertFalse(allowed("staff", a), a);
  assert(allowed("admin", "pro_delete_test")); assertFalse(allowed("user", "record_payment")); assertFalse(allowed(null, "status"));
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
