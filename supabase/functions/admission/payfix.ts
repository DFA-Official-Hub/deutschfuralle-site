// Correcting or voiding a recorded payment, and the per-student fee summary for Google Sheets. Pure functions (tested).
import { payLabel, next as nextInst, planCount, type Inst } from "./plan.ts";
export type Pay = { id: number; amount: number; paid_on?: string | null; installment_no: number; invoice_no?: string | null; method?: string | null; voided_at?: string | null; installment_label?: string | null; is_final?: boolean | null; installments?: number | null; revision?: number | null; proof_url?: string | null };
/** Payments that count, in the order they were recorded. */
export const live = (pays: Pay[]) => pays.filter((p) => !p.voided_at).sort((a, b) => a.installment_no - b.installment_no);
/** Re-works every counted payment after a change: paid total, and for each payment the amount paid before it,
 *  its receipt label and whether it finished the fee. error when the payments add up to more than the fee. */
export function recompute(pays: Pay[], plan: Inst[] | null | undefined, feeTotal: number | null | undefined, legacyCount = 1) {
  const fee = Number(feeTotal) || 0, P = Array.isArray(plan) && plan.length ? plan : null, rows: { id: number; before: number; label: string | null; is_final: boolean; installments: number }[] = [];
  let cum = 0; const L = live(pays);
  for (let i = 0; i < L.length; i++) {
    const p = L[i], before = cum; cum += Number(p.amount) || 0;
    rows.push({ id: p.id, before, label: P ? payLabel(P, before, cum) || null : null, is_final: !fee || cum >= fee, installments: P ? P.length : Math.max(legacyCount, i + 1) });
  }
  if (fee && cum > fee) return { error: `The payments would add up to PKR ${cum.toLocaleString("en-US")}, which is more than the fee of PKR ${fee.toLocaleString("en-US")}.`, paid: cum, rows };
  return { paid: cum, rows, error: null as string | null };
}
/** Validates a correction request. */
export function checkCorrection(b: { void?: unknown; amount?: unknown; paid_on?: unknown; method?: unknown; reason?: unknown }, today: string): { error?: string; void: boolean; amount?: number; paid_on?: string; reason: string } {
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim().slice(0, 300), vd = b.void === true;
  if (reason.length < 3) return { error: "Write a short reason (for example: typed 7 instead of 7,000).", void: vd, reason };
  if (vd) return { void: true, reason };
  const amount = typeof b.amount === "number" ? b.amount : Number(b.amount);
  if (!(Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000)) return { error: "Enter the correct amount in whole rupees (more than 0). To cancel the payment completely, use Void instead.", void: false, reason };
  const d = String(b.paid_on || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) return { error: "Pick the date the money arrived.", void: false, reason };
  if (d > today) return { error: "The payment date can't be in the future.", void: false, reason };
  return { void: false, amount, paid_on: d, reason };
}
/** Storage path of a payment's receipt: same invoice number, revision suffix after a correction (the old file is kept). */
export const receiptPath = (inv: string, rev?: number | null) => `receipts/${inv}${rev ? `-R${rev}` : ""}.pdf`;
/** Status words used on the admin card and in Google Sheets. */
export function payStatus(fee: number, paid: number): "Fully paid" | "Partially paid" | "Not paid" | "No fee set" {
  if (!fee) return "No fee set";
  if (paid >= fee) return "Fully paid";
  return paid > 0 ? "Partially paid" : "Not paid";
}
/** Calendar day in Pakistan (UTC+5, no DST) of a timestamp: a registration at 02:00 PKT is still that day, not the previous UTC day. */
export const pkDay = (ts: unknown) => { const t = Date.parse(String(ts || "")); return isNaN(t) ? "" : new Date(t + 5 * 3600e3).toISOString().slice(0, 10); };
/** One student's fee summary for Google Sheets (Finance tracker + registration sheet). */
export function feeRow(e: any, pays: Pay[]) {
  const fee = Number(e.fee_total) || 0, paid = Number(e.amount_paid) || 0, plan = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
  const n = plan ? nextInst(plan, paid) : null, bal = Math.max(fee - paid, 0);
  const L = live(pays);
  return {
    student_id: e.student_id || "", name: e.full_name || "", email: e.email || "", course: e.courses?.name || e.course_label || "", batch: e.batch_code || "",
    registered: pkDay(e.created_at), status: e.status || "", invoice_no: e.invoice_no || "",
    fee_total: fee || null, amount_paid: paid, balance_due: fee ? bal : null,
    installments: planCount(e), installments_paid: plan ? (n ? n.no - 1 : plan.length) : L.length,
    next_due_date: bal > 0 ? (n ? n.due : e.due_date ? String(e.due_date).slice(0, 10) : "") : "",
    next_due_amount: bal > 0 ? (n ? n.left : bal) : 0,
    payment_status: payStatus(fee, paid),
    payments: pays.slice().sort((a, b) => a.installment_no - b.installment_no).map((p) => ({
      invoice_no: p.invoice_no || "", installment_no: p.installment_no, date: String(p.paid_on || "").slice(0, 10), amount: p.voided_at ? 0 : Number(p.amount) || 0,
      method: p.method || "", label: p.installment_label || "", voided: !!p.voided_at, revision: Number(p.revision) || 0, proof_url: p.proof_url || "",
    })),
  };
}
