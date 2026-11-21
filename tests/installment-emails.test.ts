// deno test tests/installment-emails.test.ts — email wording for custom installment plans.
import { reminder, welcome, receiptMail } from "../supabase/functions/admission/templates.ts";
import { assert, assertEquals } from "jsr:@std/assert@1";
const f = { name: "Sohail Khan", studentId: "DFA-2026-0012", course: "A1 + A2 Combined Program", batch: "A12-2611", total: "PKR 32,000", paid: "PKR 10,000", balance: "PKR 22,000", due: "11 December 2026" };
Deno.test("reminder shows the next installment when there is a plan", () => {
  const m = reminder(1, { ...f, next: "PKR 10,000 (installment 2 of 3)" });
  assert(m.text.includes("Next installment: PKR 10,000 (installment 2 of 3)\nDue date: 11 December 2026"));
});
Deno.test("reminder without a plan is unchanged", () => {
  const m = reminder(1, f);
  assert(!m.text.includes("Next installment"));
  assert(m.text.includes("Balance due: PKR 22,000\nDue date: 11 December 2026"));
});
Deno.test("welcome names the next installment", () => {
  const x = { fee: "PKR 32,000", studentId: "DFA-2026-0012", invoiceNo: "INV-2026-0040", batch: "A12-2611", courseEnd: "5 March 2027", paid: "PKR 10,000", balance: "PKR 22,000", due: "11 December 2026" };
  assert(welcome("Sohail", "A1 + A2", "21 November 2026", "20 March 2027", { ...x, next: "PKR 10,000 (installment 2 of 3)" }).text.includes("Your next installment of PKR 10,000 (installment 2 of 3) is due by 11 December 2026, and the total still open is PKR 22,000"));
  assert(welcome("Sohail", "A1 + A2", "21 November 2026", "20 March 2027", x).text.includes("The remaining PKR 22,000 is due by 11 December 2026"));
});
Deno.test("receipt mail", () => {
  assert(receiptMail("Sohail", "A1", "PKR 10,000", "INV-1", "PKR 12,000", "11 January 2027", "PKR 12,000 (installment 3 of 3)").text.includes("Your next installment of PKR 12,000 (installment 3 of 3) is due by 11 January 2027."));
  assertEquals(receiptMail("Sohail", "A1", "PKR 10,000", "INV-1", "", "").text.includes("paid in full"), true);
});
