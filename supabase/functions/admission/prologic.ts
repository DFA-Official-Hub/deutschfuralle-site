// Admin portal upgrade (WD-3): pure helpers, no I/O. Tested by tests/admin-pro.test.ts.
import { next as nextInst, status as instStatus, type Inst } from "./plan.ts";

/** Roles that may use the admin portal. */
export type Role = "admin" | "staff";
/** Existing admission actions staff may call. Everything else (activate, plans, corrections, certificates,
 *  settings, revoke, refunds, exports, test-data deletion…) is admin only. */
export const STAFF_ACTIONS = new Set([
  "status", "docs_status", "cert_file_admin", "cert_images_status", "email_log", "resend", "record_payment",
  "pro_activity", "pro_assign_batch", "pro_reminders", "pro_email_log", "pro_proof_upload", "pro_proof_attach", "pro_proof_url", "pro_payment_ref", "pro_dashboard",
  "pro_students", "pro_reveal", "pro_add_student",
]);
/** What staff see instead of raw provider / document errors (bounce texts usually contain the student's email). */
export const STAFF_MAIL_ERR = "Not delivered (an admin can see the details)";
export const STAFF_DOC_ERR = "Failed (an admin can see the details)";
/** Email log rows for the given role: admins get the raw error, staff only that something failed. */
export function redactMailRows<T extends { error?: unknown }>(rows: T[], role: string): T[] {
  return role === "admin" ? rows : rows.map((x) => ({ ...x, error: x.error ? STAFF_MAIL_ERR : null }));
}
/** docs_status / process_docs / resend answers for the given role: staff never get docs_error, last_error or error texts. */
export function redactDocs<T extends Record<string, any>>(r: T, role: string): T {
  if (role === "admin" || !r || typeof r !== "object") return r;
  const o: Record<string, any> = { ...r };
  if (o.docs_error) o.docs_error = STAFF_DOC_ERR;
  if (typeof o.error === "string" && o.error) o.error = STAFF_DOC_ERR;
  if (Array.isArray(o.jobs)) o.jobs = o.jobs.map((j: any) => ({ ...j, last_error: j?.last_error ? STAFF_DOC_ERR : null }));
  return o as T;
}
/** The payments_refund_guard trigger (migration 20261125140000), recognised by SQLSTATE + hint, not by message text. */
export function isRefundGuard(err: { code?: unknown; hint?: unknown } | null | undefined): boolean {
  return !!err && err.code === "23514" && err.hint === "DFA_REFUND_GUARD";
}
/** Money writes staff may only do when an admin switches site_settings.staff_payments to "on" (default off). */
export const STAFF_PAYMENT_ACTIONS = new Set(["record_payment", "pro_proof_upload", "pro_proof_attach", "pro_payment_ref", "pro_proof_url"]);
export function allowed(role: string | null | undefined, action: string, staffPayments = false): boolean {
  if (role === "admin") return true;
  if (role === "staff") return STAFF_ACTIONS.has(action) && (staffPayments || !STAFF_PAYMENT_ACTIONS.has(action));
  return false;
}

// ---- staff privacy (B2): staff never get raw contacts or student details from the server ------------
export function maskEmail(v: unknown): string {
  const s = String(v || ""); const i = s.indexOf("@"); if (i < 1) return s ? "•••" : "";
  const dom = s.slice(i + 1), dot = dom.lastIndexOf(".");
  return s[0] + "•••@" + (dot > 0 ? dom[0] + "•••" + dom.slice(dot) : "•••");
}
export function maskPhone(v: unknown): string { const s = String(v || "").replace(/\s+/g, ""); if (!s) return ""; return s.length < 5 ? "•••" : s.slice(0, 3) + "•••" + s.slice(-2); }
/** Columns of enrollments a staff list may carry. No student_info (CNIC, DOB, address), notes, raw email/phone or files. */
export const STAFF_ENR_COLS = "id,full_name,student_id,course_code,course_label,batch_id,batch_code,status,payment_plan,fee_total,amount_paid,balance_due,due_date,created_at,start_date,end_date,activated_at,invoice_no,installment_plan,reminder_stage,source,last_docs_sent_at,last_docs_sent_items,certificate_no,certificate_issued_at,certificate_revoked_at,certificate_hold,docs_error,email,phone";
export const STAFF_PAY_COLS = "id,enrollment_id,invoice_no,installment_no,installments,is_final,amount,paid_on,method,installment_label,voided_at,revision,reference,proof_file,proof_url,created_at";
export function staffRow(e: any) {
  const o: any = {}; for (const k of STAFF_ENR_COLS.split(",")) if (k !== "email" && k !== "phone") o[k] = e[k] ?? null;
  o.email = maskEmail(e.email); o.phone = maskPhone(e.phone); o.has_email = !!e.email; o.has_phone = !!e.phone; o.masked = true;
  // docs_error can contain the student's email (provider bounce text); staff only see that it failed
  o.docs_error = e.docs_error ? STAFF_DOC_ERR : null;
  return o;
}
export function staffPay(p: any) {
  const o: any = {}; for (const k of STAFF_PAY_COLS.split(",")) o[k] = p[k] ?? null;
  if (o.proof_url && !/^https:\/\/drive\.google\.com\//.test(String(o.proof_url))) o.proof_url = null;
  return o;
}
/** PostgREST or-filter for the student search. Partial match on name, student ID, batch, invoice and certificate no.
 *  Staff: email/phone only on an exact full email or a full phone number (10+ digits), so masked contacts can't be
 *  rebuilt character by character through the search. Admins keep partial matching (they can read the table anyway). */
export function searchOr(v: string, role: string): string {
  const parts = ["full_name", "student_id", "batch_code", "invoice_no", "certificate_no"].map((k) => `${k}.ilike.*${v}*`);
  if (role === "admin") return [...parts, `email.ilike.*${v}*`, `phone.ilike.*${v}*`].join(",");
  const em = v.trim().toLowerCase();
  if (/^[^@\s"]+@[^@\s"]+\.[a-z]{2,}$/.test(em)) parts.push(`email.eq.${em}`);
  const d = v.replace(/\D/g, "");
  if (d.length >= 10 && d.length <= 15 && !/[a-z@]/i.test(v)) {
    const local = d.startsWith("92") ? "0" + d.slice(2) : d.startsWith("0") ? d : null, intl = d.startsWith("0") ? "92" + d.slice(1) : d;
    const vs = [...new Set([d, "+" + d, intl, "+" + intl, ...(local ? [local] : [])])];
    parts.push(`phone.in.(${vs.map((x) => `"${x}"`).join(",")})`);
  }
  return parts.join(",");
}
/** Whitelist for pro_add_student: email, name, course, phone, source. Returns the row or an error. */
export function addStudentRow(b: any): { row?: Record<string, unknown>; error?: string } {
  const email = String(b?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  const name = String(b?.full_name ?? b?.name ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
  if (name.length < 2) return { error: "Enter the student's name." };
  const course = String(b?.course_code ?? b?.course ?? "").trim();
  if (!/^[a-z0-9-]{1,40}$/.test(course)) return { error: "Pick a course." };
  const ph = String(b?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (ph && ph.replace(/\D/g, "").length < 10) return { error: "The phone number looks too short." };
  const src = ["manual", "walk-in", "whatsapp", "phone", "referral", "other"].includes(String(b?.source || "")) ? String(b.source) : "manual";
  return { row: { email, full_name: name, course_code: course, phone: ph || null, source: src } };
}
/** Typed confirmation words the server requires (UI asks for the same word). */
export const CONFIRM_WORDS: Record<string, string> = { pro_revoke: "REVOKE", pro_remove: "DELETE", cert_revoke: "REVOKE" };
export function confirmOk(action: string, body: any): boolean {
  const w = CONFIRM_WORDS[action]; if (!w) return true;
  if (action === "cert_revoke" && body?.undo) return true;
  return String(body?.confirm || "").trim().toUpperCase() === w;
}

// ---- reminders ---------------------------------------------------------------------------------
export const DEFAULT_OFFSETS: [number, number, number] = [-3, 0, 3];
/** "-3,0,3" → [-3,0,3]. Three whole days between -30 and +60, strictly increasing; anything else → default. */
export function parseOffsets(v: unknown): [number, number, number] {
  const a = String(v ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number);
  if (a.length !== 3 || a.some((x) => !Number.isInteger(x) || x < -30 || x > 60) || !(a[0] < a[1] && a[1] < a[2])) return [...DEFAULT_OFFSETS];
  return [a[0], a[1], a[2]];
}
export function offsetsError(v: unknown): string | null {
  const a = String(v ?? "").split(",").map((x) => x.trim()).map(Number);
  if (a.length !== 3 || a.some((x) => !Number.isInteger(x))) return "Enter three whole numbers of days, for example -3, 0, 3.";
  if (a.some((x) => x < -30 || x > 60)) return "Each reminder must be between 30 days before and 60 days after the due date.";
  if (!(a[0] < a[1] && a[1] < a[2])) return "Put the reminders in order: first, second, third.";
  return null;
}
const addD = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/** Which reminder (1-3) is due today for this due date, 0 = none yet. */
export function stageFor(today: string, due: string, offs: number[] = DEFAULT_OFFSETS): number {
  return today >= addD(due, offs[2]) ? 3 : today >= addD(due, offs[1]) ? 2 : today >= addD(due, offs[0]) ? 1 : 0;
}
/** Next reminder after the one already sent (stage), or null when all three went out. */
export function nextReminder(due: string | null, stage: number, today: string, offs: number[] = DEFAULT_OFFSETS): { stage: number; date: string } | null {
  if (!due) return null;
  for (let s = Math.max(stage, 0) + 1; s <= 3; s++) { const dt = addD(due, offs[s - 1]); return { stage: s, date: dt < today ? today : dt }; }
  return null;
}
export function isPaused(meta: { reminders_paused?: boolean; reminders_paused_until?: string | null } | null | undefined, today: string): boolean {
  if (!meta?.reminders_paused) return false;
  return !meta.reminders_paused_until || String(meta.reminders_paused_until).slice(0, 10) >= today;
}

// ---- discounts / scholarships -------------------------------------------------------------------
export function planDue(plan: Inst[] | null | undefined, paid: number): string | null { const n = Array.isArray(plan) && plan.length ? nextInst(plan, paid) : null; return n ? n.due : null; }
/** Lowers the total fee by `cut`. With a plan, open installments shrink from the last one backwards (paid parts never change);
 *  installments that drop to 0 are removed. A plan left with fewer than 2 installments is dropped (the due date stays). */
export function applyDiscount(o: { fee: number; paid: number; plan: Inst[] | null; cut: number }): { fee: number; plan: Inst[] | null; error?: string } {
  const fee = Math.round(o.fee || 0), paid = Math.max(Math.round(o.paid || 0), 0), cut = Math.round(o.cut || 0);
  if (!(cut > 0)) return { fee, plan: o.plan, error: "Enter the amount in whole rupees." };
  if (!fee) return { fee, plan: o.plan, error: "This student has no total fee yet. Use Payment received first." };
  if (fee - cut < paid) return { fee, plan: o.plan, error: `That is more than the open balance (PKR ${(fee - paid).toLocaleString("en-US")}). If money must go back to the student, record a refund instead.` };
  if (!Array.isArray(o.plan) || !o.plan.length) return { fee: fee - cut, plan: null };
  const st = instStatus(o.plan, paid);
  const rows = o.plan.map((r, i) => ({ amount: Number(r.amount) || 0, due: r.due, open: st[i].left }));
  let left = cut;
  for (let i = rows.length - 1; i >= 0 && left > 0; i--) { const take = Math.min(rows[i].open, left); rows[i].amount -= take; rows[i].open -= take; left -= take; }
  const kept = rows.filter((r) => r.amount > 0).map((r, i) => ({ no: i + 1, amount: r.amount, due: r.due }));
  return { fee: fee - cut, plan: kept.length >= 2 ? kept : null };
}
/** Undo of a discount: the amount goes back onto the last installment. */
export function undoDiscount(o: { fee: number; plan: Inst[] | null; add: number }): { fee: number; plan: Inst[] | null } {
  const add = Math.round(o.add || 0);
  if (!Array.isArray(o.plan) || !o.plan.length) return { fee: (o.fee || 0) + add, plan: null };
  const p = o.plan.map((r) => ({ ...r })); p[p.length - 1].amount += add;
  return { fee: (o.fee || 0) + add, plan: p };
}

// ---- payment proof upload ------------------------------------------------------------------------
export const PROOF_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const PROOF_MAX = 5 * 1024 * 1024;
export function proofPath(enrollmentId: number, paymentId: number, type: string, now = Date.now()): string | null {
  const ext = PROOF_TYPES[type]; if (!ext || !(enrollmentId > 0) || !(paymentId > 0)) return null;
  return `payment-proofs/${enrollmentId}/${paymentId}-${now}.${ext}`;
}
export function proofPathOk(p: unknown, enrollmentId: number, paymentId: number): boolean {
  return new RegExp(`^payment-proofs/${enrollmentId}/${paymentId}-\\d{10,14}\\.(jpg|png|webp|pdf)$`).test(String(p || ""));
}
export function cleanRef(v: unknown): string | null { const s = String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80); return s || null; }

// ---- Resend webhook (Svix signature) -------------------------------------------------------------
function b64(s: string): Uint8Array<ArrayBuffer> { const bin = atob(s); const u = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
/** Verifies a Svix-signed webhook (Resend). secret = "whsec_…". Rejects messages older/newer than 5 minutes. */
/** Constant-time compare of two byte arrays (length is not secret: Svix signatures are always 32 bytes). */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
/** Verifies a Svix-signed webhook (Resend). secret = "whsec_…". Rejects messages older/newer than 5 minutes.
 *  Never throws: a malformed secret or signature just fails verification (the caller answers a plain 403). */
export async function verifySvix(secret: string, id: string, ts: string, body: string, sigHeader: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !id || !ts || !sigHeader) return false;
  const t = Number(ts); if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300) return false;
  let mac: Uint8Array;
  try {
    const key = await crypto.subtle.importKey("raw", b64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  } catch (_) { return false; }
  let ok = false;
  for (const p of sigHeader.split(" ")) {
    const [v, s] = p.split(","); if (v !== "v1" || !s) continue;
    let got: Uint8Array; try { got = b64(s); } catch (_) { continue; }
    if (safeEqual(got, mac)) ok = true; // no early exit
  }
  return ok;
}
export function deliveryFrom(type: string): "delivered" | "bounced" | "complained" | "delayed" | null {
  return ({ "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained", "email.delivery_delayed": "delayed" } as Record<string, any>)[type] || null;
}

// ---- dashboard ----------------------------------------------------------------------------------
export type Pay = { enrollment_id: number; amount: number; paid_on: string; method?: string | null; voided_at?: string | null };
export type Adj = { enrollment_id: number; kind: string; amount: number; adj_date: string; voided_at?: string | null };
export type Enr = { id: number; status: string; fee_total: number | null; amount_paid: number; balance_due: number | null; due_date: string | null; created_at: string; full_name?: string | null; installment_plan?: Inst[] | null };
/** Fee figures for the dashboard. Test records (testIds) are left out. Dates are PKT calendar days (YYYY-MM-DD). */
export function dashboard(o: { today: string; enr: Enr[]; pays: Pay[]; adjs: Adj[]; testIds?: Set<number> }) {
  const test = o.testIds || new Set<number>(), t = o.today, month = t.slice(0, 7);
  const prevMonth = (() => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); })();
  const in7 = addD(t, 7);
  const live = o.pays.filter((p) => !p.voided_at && !test.has(p.enrollment_id));
  const refunds = o.adjs.filter((a) => a.kind === "refund" && !a.voided_at && !test.has(a.enrollment_id));
  const sumBy = (k: string) => live.filter((p) => String(p.paid_on).slice(0, 7) === k).reduce((s, p) => s + (Number(p.amount) || 0), 0) - refunds.filter((a) => String(a.adj_date).slice(0, 7) === k).reduce((s, a) => s + a.amount, 0);
  const months: { month: string; net: number }[] = [];
  { const [y, m] = month.split("-").map(Number); for (let i = 5; i >= 0; i--) { const k = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7); months.push({ month: k, net: sumBy(k) }); } }
  const byMethod: Record<string, number> = {};
  for (const p of live) if (String(p.paid_on).slice(0, 7) === month) { const k = p.method || "not set"; byMethod[k] = (byMethod[k] || 0) + (Number(p.amount) || 0); }
  const owing = o.enr.filter((e) => !test.has(e.id) && (e.status === "active" || e.status === "expired") && (e.balance_due || 0) > 0);
  const overdue = owing.filter((e) => e.due_date && e.due_date < t).map((e) => ({ id: e.id, days: Math.round((Date.parse(t) - Date.parse(String(e.due_date))) / 864e5) })).sort((a, b) => b.days - a.days);
  const soon = owing.filter((e) => e.due_date && e.due_date >= t && e.due_date <= in7).map((e) => ({ id: e.id, due: e.due_date as string })).sort((a, b) => a.due.localeCompare(b.due));
  const real = o.enr.filter((e) => !test.has(e.id));
  return {
    collected_month: sumBy(month), collected_prev: sumBy(prevMonth), refunds_month: refunds.filter((a) => String(a.adj_date).slice(0, 7) === month).reduce((s, a) => s + a.amount, 0),
    outstanding: owing.reduce((s, e) => s + (e.balance_due || 0), 0), overdue_total: overdue.reduce((s, x) => s + (o.enr.find((e) => e.id === x.id)?.balance_due || 0), 0),
    overdue, soon, months, by_method: byMethod,
    pending: real.filter((e) => e.status === "pending").length, active: real.filter((e) => e.status === "active").length,
    new_month: real.filter((e) => new Date(Date.parse(e.created_at) + 5 * 3600e3).toISOString().slice(0, 7) === month).length,
  };
}

/** Same JSON value (key order of objects ignored; null, undefined and [] count as "no plan"). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => v == null || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? v.map(norm) : typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as any)[k])])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
