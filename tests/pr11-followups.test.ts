// deno test -A tests/pr11-followups.test.ts — PR #11 follow-ups: cleared overrides in the audit, VOID receipts.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { effective, diff, savedRow } from "../supabase/functions/admission/student.ts";
import { docData, receiptSvg, voidNote } from "../supabase/functions/admission/docs.ts";

const reg = { full_name: "", phone: "" } as any;
const e = { full_name: "QA Renamed", email: "qa@x.invalid", phone: "+920000000001" };

Deno.test("clearing overrides: audit and response show the values put back", () => {
  const before = effective(reg, { full_name: "QA Renamed", phone: "+920000000001" }, e);
  const patch = { student_info: null, full_name: "QA Test", phone: "+920000000000" };
  const after = effective(reg, null, savedRow(e, null, patch));
  assertEquals([after.full_name, after.phone], ["QA Test", "+920000000000"]);
  const ch = diff(before, after);
  assertEquals(ch.old, { full_name: "QA Renamed", phone: "+920000000001" });
  assertEquals(ch.new, { full_name: "QA Test", phone: "+920000000000" });
});
Deno.test("savedRow: a mobile cleared to nothing, and an edit without a patch", () => {
  assertEquals(savedRow(e, null, { phone: null }).phone, null);
  assertEquals(savedRow(e, { full_name: "New Name" } as any, {}).full_name, "New Name");
  assertEquals(savedRow(e, null, {}).full_name, "QA Renamed");
});
Deno.test("VOID receipt: no PAID stamp, balance after the void", () => {
  const enr = { fee_total: 25000, amount_paid: 10000, due_date: "2027-01-02", invoice_no: "INV-1", student_id: "S", courses: { fee_pkr: 25000, old_fee_pkr: 36000 } };
  const pay = { invoice_no: "INV-2", amount: 5000, before: 10000, paid_on: "2026-11-25", voided_at: "2026-11-25T10:00:00Z", revision: 2, installment_no: 2, installments: 2 };
  const d = docData(enr, null, pay);
  assert(d.voided);
  assertEquals(d.payNote, "Void, not counted · Balance due PKR 15,000 by 2 January 2027");
  const img = { logo: "L", logoW: "L", stamp: "STAMP.png", sign: "S" };
  const svg = receiptSvg(d, img);
  assert(!svg.includes("STAMP.png"), "PAID stamp hidden");
  assert(svg.includes("TOTAL (VOID, NOT PAID)") && svg.includes(">VOID</text>"));
  const ok = receiptSvg(docData(enr, null, { ...pay, voided_at: null }), img);
  assert(ok.includes("STAMP.png") && ok.includes(">TOTAL PAID<"), "normal receipt keeps the stamp");
  assertEquals(voidNote(25000, 25000), "Void, not counted · Fee paid in full");
});
