// Fee installment plans (custom schedules), server side.
// Mirrors assets/dfa-plan.js; tests/installment-plan.test.mjs runs both on the same cases.
export type Inst = { no: number; amount: number; due: string };
export type InstStatus = Inst & { status: "paid" | "partial" | "due"; left: number; paid_on: string | null };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
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
    const x: any = list[i] || {}, a = Number(x.amount), d = String(x.due || "");
    if (!(a > 0) || Math.round(a) !== a) return { error: `Installment ${i + 1}: enter an amount in whole rupees.` };
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
