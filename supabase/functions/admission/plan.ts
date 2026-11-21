// Fee installment plans (custom schedules), server side.
// Mirrors assets/dfa-plan.js; tests/installment-plan.test.mjs runs both on the same cases.
export type Inst = { no: number; amount: number; due: string };
export type InstStatus = Inst & { status: "paid" | "partial" | "due"; left: number; paid_on: string | null };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_AMOUNT = 1_000_000;
export function isDate(s: unknown): boolean {
  const v = String(s || ""); if (!ISO.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z"); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
/** Same calendar day k months later; clamps to the month's last day. */
export function addMonths(d: string, k: number): string {
  const [y, m0, day] = d.split("-").map(Number); const m = m0 - 1 + k, yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yy, mm, Math.min(day, last))).toISOString().slice(0, 10);
}
/** Even split rounded down to 1,000 (or 500 for small shares); the remainder goes on the last installment. */
export function splitEven(total: number, n: number): number[] {
  total = Math.round(Number(total) || 0); n = Math.round(Number(n) || 0); if (n < 1) return []; if (total <= 0) return Array(n).fill(0);
  const share = total / n, unit = share >= 10000 ? 1000 : share >= 1000 ? 500 : 1; let base = Math.floor(share / unit) * unit; if (base <= 0) base = Math.floor(share) || 0;
  const out: number[] = []; for (let i = 0; i < n - 1; i++) out.push(base); out.push(total - base * (n - 1)); return out;
}
export function suggestDates(start: string, n: number): string[] { const out: string[] = []; for (let i = 0; i < n; i++) out.push(addMonths(start, i)); return out; }
export function suggest(total: number, n: number, start: string): Inst[] { const a = splitEven(total, n), d = suggestDates(start, n); return a.map((x, i) => ({ no: i + 1, amount: x, due: d[i] })); }
/** Validates an admin-entered schedule. */
export function normalize(list: unknown): { plan: Inst[]; total: number; error?: undefined } | { error: string; plan?: undefined; total?: undefined } {
  if (!Array.isArray(list)) return { error: "Add the installments." };
  if (list.length < 2 || list.length > 5) return { error: "Pick 2 to 5 installments." };
  const out: Inst[] = []; let total = 0;
  for (let i = 0; i < list.length; i++) {
    const x = (list[i] || {}) as Record<string, unknown>, a = typeof x.amount === "number" ? x.amount : NaN, d = String(x.due || "");
    if (!(Number.isSafeInteger(a) && a > 0 && a <= MAX_AMOUNT)) return { error: `Installment ${i + 1}: enter an amount in whole rupees.` };
    if (!isDate(d)) return { error: `Installment ${i + 1}: pick a due date.` };
    if (i && d < out[i - 1].due) return { error: `Installment ${i + 1} is due before installment ${i}. Put the dates in order.` };
    out.push({ no: i + 1, amount: a, due: d }); total += a;
  }
  return { plan: out, total };
}
/** Status of each installment from the total paid so far (payments fill installments in order). */
export function status(plan: Inst[] | null | undefined, paid: number, pays?: { amount: number; paid_on?: string | null; installment_no?: number }[]): InstStatus[] {
  paid = Math.max(Number(paid) || 0, 0);
  const ps = (pays || []).slice().sort((a, b) => (a.installment_no || 0) - (b.installment_no || 0)); let need = 0;
  return (plan || []).map((x) => {
    need += Number(x.amount) || 0;
    const left = Math.max(Math.min(need - paid, Number(x.amount) || 0), 0), st = left <= 0 ? "paid" : left < x.amount ? "partial" : "due";
    let on: string | null = null;
    if (st === "paid" && ps.length) { let cum = 0; for (const p of ps) { cum += Number(p.amount) || 0; if (cum >= need) { on = p.paid_on ? String(p.paid_on).slice(0, 10) : null; break; } } }
    return { no: x.no, amount: x.amount, due: x.due, status: st, left, paid_on: on } as InstStatus;
  });
}
/** First installment that is not fully paid, or null when everything is paid. */
export function next(plan: Inst[] | null | undefined, paid: number): { no: number; due: string; left: number; of: number } | null {
  const s = status(plan, paid); for (const x of s) if (x.status !== "paid") return { no: x.no, due: x.due, left: x.left, of: s.length }; return null;
}
/** Installment count shown on receipts ("Receipt n of N"). */
export function planCount(e: { payment_plan?: string | null; installment_plan?: Inst[] | null }): number {
  if (Array.isArray(e.installment_plan) && e.installment_plan.length) return e.installment_plan.length;
  return e.payment_plan === "two" ? 2 : 1;
}
/** Installments that are already paid and so may not change. With a plan: the fully paid ones under that plan.
    Legacy rows (no plan): every recorded payment, in order, as one paid installment (amount, date paid). */
export function lockedRows(plan: Inst[] | null | undefined, paid: number, pays?: { amount: number; paid_on?: string | null; installment_no?: number }[]): { amount: number; due: string }[] {
  if (Array.isArray(plan) && plan.length) return status(plan, paid).filter((x) => x.status === "paid").map((x) => ({ amount: x.amount, due: x.due }));
  return (pays || []).slice().sort((a, b) => (a.installment_no || 0) - (b.installment_no || 0)).map((p) => ({ amount: Number(p.amount) || 0, due: String(p.paid_on || "").slice(0, 10) }));
}
/** Error text when a new plan changes a paid installment, else null. */
export function checkLocked(locked: { amount: number; due: string }[], next: Inst[]): string | null {
  if (locked.length > next.length) return `The plan needs at least ${locked.length} installments, because ${locked.length} are already paid.`;
  for (let i = 0; i < locked.length; i++) if (next[i].amount !== locked[i].amount || next[i].due !== locked[i].due) return `Installment ${i + 1} is already paid, so its amount and date can't change.`;
  return null;
}
/** Receipt label for a payment that moves the paid total from `before` to `after` on a plan.
    "Installment 2 of 3" (exactly one installment), "Installment 2 of 3 (part payment)" (installment still unfinished),
    "Installment 2 of 3 (final part)" (finishes an installment that an earlier payment started), "Installments 2–3 of 3". */
export function payLabel(plan: Inst[] | null | undefined, before: number, after: number): string {
  const n = (plan || []).length; if (!n) return "";
  let cum = 0, a = -1, b = -1, startExact = false, endExact = false;
  for (let i = 0; i < n; i++) {
    const lo = cum; cum += Number(plan![i].amount) || 0;
    if (a < 0 && before < cum) { a = i; startExact = before === lo; }
    if (a >= 0 && b < 0 && after <= cum) { b = i; endExact = after === cum; }
  }
  if (a < 0) return "";
  if (b < 0) { b = n - 1; endExact = true; }
  const tag = !endExact ? " (part payment)" : !startExact ? " (final part)" : "";
  return a === b ? `Installment ${a + 1} of ${n}${tag}` : `Installments ${a + 1}–${b + 1} of ${n}${tag}`;
}
/** After a payment row is inserted: work everything out from the sum of ALL payments (the record of truth),
    never from the enrollment row read before the insert (it may be stale if another payment landed meanwhile).
    bad = true when the re-read failed (readOk false) or the sum can't include this payment (sum < amount): don't trust it,
    don't touch amount_paid and don't send a receipt. over = true when the total is now above the fee (undo the insert). */
export function settle(o: { plan: Inst[] | null | undefined; feeTotal: number | null | undefined; amount: number; sumAfter: number; readOk?: boolean }): { before: number; after: number; fin: boolean; label: string | null; over: boolean; bad: boolean } {
  const fee = Number(o.feeTotal) || 0, amt = Number(o.amount) || 0, after = Number(o.sumAfter) || 0;
  const bad = o.readOk === false || !Number.isFinite(Number(o.sumAfter)) || after < amt;
  if (bad) return { before: 0, after: 0, fin: false, label: null, over: false, bad: true };
  const before = after - amt, plan = Array.isArray(o.plan) && o.plan.length ? o.plan : null;
  return { before, after, fin: !fee || after >= fee, label: plan ? payLabel(plan, before, after) : null, over: !!fee && after > fee, bad: false };
}
export const METHODS = ["cash", "bank", "jazzcash", "easypaisa", "other"] as const;
export function method(v: unknown): string | null { const m = String(v || "").toLowerCase(); return (METHODS as readonly string[]).includes(m) ? m : null; }
