// deno test tests/student-info-payfix.test.ts — student details on documents (DOB never shifts) and payment corrections.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isoDob, longDate, fromRegistration, pickDetails, effective, cleanOverrides, diff, addressLine } from "../supabase/functions/admission/student.ts";
import { recompute, checkCorrection, receiptPath, payStatus, feeRow, live } from "../supabase/functions/admission/payfix.ts";

const reg = { "First Name": "Aamir ", "Last Name": "Qasmi", "Date of Birth": "11 February 1995", "Email": "Aamir@Example.com", "Mobile Number": "0300 1234567", "CNIC": "12345-1234567-1", "Address": "Street 1", "City": "Karachi", "Country": "Pakistan" };

Deno.test("DOB is a calendar date: no day shift in any time zone", () => {
  assertEquals(isoDob("11 February 1995"), "1995-02-11");
  assertEquals(isoDob("11 Feb 1995"), "1995-02-11");
  assertEquals(isoDob("1995-02-11"), "1995-02-11");
  assertEquals(longDate("1995-02-11"), "11 February 1995");
  assertEquals(isoDob("31 February 1995"), "");
  assertEquals(isoDob("2/11/1995"), ""); // ambiguous M/D vs D/M is never guessed
  assertEquals(longDate("sometime"), "sometime");
});
Deno.test("registration answers map to document fields", () => {
  const r = fromRegistration(reg);
  assertEquals(r.full_name, "Aamir Qasmi");
  assertEquals(r.dob, "1995-02-11");
  assertEquals(r.email, "aamir@example.com");
  assertEquals(addressLine(r), "Street 1, Karachi, Pakistan");
});
Deno.test("a moved sheet row is not used for another student", () => {
  const rows = [{ sheet_row: 230, email: "aamir@example.com", data: reg, updated_at: "2026-11-23" }, { sheet_row: 221, email: "maleeha@example.com", data: {}, updated_at: "2026-11-24" }];
  assertEquals(pickDetails(rows, { sheet_row: 230, email: "maleeha@example.com" })?.sheet_row, 221);
  assertEquals(pickDetails(rows, { sheet_row: 230, email: "AAMIR@example.com" })?.sheet_row, 230);
  assertEquals(pickDetails(rows, { sheet_row: 230, email: "nobody@example.com" }), null);
});
Deno.test("overrides: staff edits win, unchanged values are not stored", () => {
  const r = fromRegistration(reg), e = { full_name: "Aamir Qasmi", email: "aamir@example.com", phone: "" };
  const c = cleanOverrides({ full_name: "Aamir Qasmi", dob: "12 Feb 1995", city: "Lahore", cnic: "" }, r, e);
  assertEquals(c.error, undefined);
  assertEquals(c.info, { dob: "1995-02-12", city: "Lahore" });
  const eff = effective(r, c.info, e);
  assertEquals(eff.dob, "1995-02-12"); assertEquals(eff.city, "Lahore"); assertEquals(eff.cnic, "12345-1234567-1");
  assertEquals(diff(effective(r, null, e), eff), { old: { dob: "1995-02-11", city: "Karachi" }, new: { dob: "1995-02-12", city: "Lahore" } });
  assertEquals(cleanOverrides({ dob: "2/11/1995" }, r, e).error, "Date of birth: pick a real date.");
  assert(cleanOverrides({ email: "not-an-email" }, r, e).error);
  assertEquals(cleanOverrides({ city: "Karachi" }, r, e).info, null);
});
Deno.test("correcting Aamir-style PKR 7 entry to 6,500 recomputes totals and labels", () => {
  const plan = [{ no: 1, amount: 6500, due: "2026-11-23" }, { no: 2, amount: 18500, due: "2026-12-31" }] as any;
  const pays = [{ id: 14, amount: 7, installment_no: 1, invoice_no: "INV-2026-0014" }];
  const before = recompute(pays, plan, 25000, 2);
  assertEquals(before.paid, 7);
  const after = recompute([{ ...pays[0], amount: 6500 }], plan, 25000, 2);
  assertEquals(after.paid, 6500); assertEquals(after.error, null); assertEquals(after.rows[0].is_final, false);
  assertEquals(payStatus(25000, after.paid), "Partially paid");
  assert(recompute([{ ...pays[0], amount: 26000 }], plan, 25000, 2).error);
});
Deno.test("voided payments stop counting but stay on record", () => {
  const pays = [{ id: 1, amount: 10000, installment_no: 1 }, { id: 2, amount: 15000, installment_no: 2, voided_at: "2026-11-25T00:00:00Z" }, { id: 3, amount: 15000, installment_no: 3 }];
  assertEquals(live(pays).map((p) => p.id), [1, 3]);
  const r = recompute(pays, null, 25000, 2);
  assertEquals(r.paid, 25000); assertEquals(r.rows.map((x) => x.before), [0, 10000]); assertEquals(r.rows[1].is_final, true);
  const f = feeRow({ student_id: "DFA-2026-0099", fee_total: 25000, amount_paid: 25000, payment_plan: "two" }, pays);
  assertEquals(f.payment_status, "Fully paid"); assertEquals(f.balance_due, 0); assertEquals(f.next_due_date, "");
  assertEquals(f.payments[1].amount, 0); assertEquals(f.payments[1].voided, true);
});
Deno.test("correction requests are checked", () => {
  assert(checkCorrection({ amount: 6500, paid_on: "2026-11-23", reason: "" }, "2026-11-25").error);
  assert(checkCorrection({ amount: 0, paid_on: "2026-11-23", reason: "typo" }, "2026-11-25").error);
  assert(checkCorrection({ amount: 6500, paid_on: "2026-11-30", reason: "typo" }, "2026-11-25").error);
  assertEquals(checkCorrection({ amount: "6500", paid_on: "2026-11-23", reason: " typed 7 " }, "2026-11-25"), { void: false, amount: 6500, paid_on: "2026-11-23", reason: "typed 7" });
  assertEquals(checkCorrection({ void: true, reason: "entered twice" }, "2026-11-25"), { void: true, reason: "entered twice" });
});
Deno.test("revised receipts keep the invoice number and the old file", () => {
  assertEquals(receiptPath("INV-2026-0014", 0), "receipts/INV-2026-0014.pdf");
  assertEquals(receiptPath("INV-2026-0014", 1), "receipts/INV-2026-0014-R1.pdf");
});
Deno.test("next due amount comes from the plan", () => {
  const plan = [{ no: 1, amount: 15000, due: "2026-11-20" }, { no: 2, amount: 10000, due: "2026-11-29" }];
  const f = feeRow({ student_id: "DFA-2026-0009", fee_total: 25000, amount_paid: 15000, installment_plan: plan }, [{ id: 1, amount: 15000, installment_no: 1 }]);
  assertEquals([f.installments, f.installments_paid, f.next_due_date, f.next_due_amount, f.payment_status], [2, 1, "2026-11-29", 10000, "Partially paid"]);
});
