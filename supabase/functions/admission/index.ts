import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { savedRow } from "./student.ts";
import { confirmation, welcome, reminder, docsMail, receiptMail, type FeeInfo } from "./templates.ts";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { certificateUrls, certificatePdfUrls } from "./render.ts";
import { buildOne, signed, buildPaymentReceipt, fileBytes, docData, warmDocAssets, loadDetails } from "./docs.ts";
import { fromRegistration, effective, cleanOverrides, diff as infoDiff, FIELDS as INFO_FIELDS, label as infoLabel } from "./student.ts";
import { recompute, checkCorrection, live as livePays, feeRow, payStatus, type Pay } from "./payfix.ts";
import { handlePro, logActivity } from "./pro.ts";
import { withAudit } from "./audit.ts";
import { allowed, denyMessage, parsePerms, parseOffsets, stageFor, isPaused, cleanRef, verifySvix, deliveryFrom, confirmOk, CONFIRM_WORDS, redactDocs, redactMailRows, isRefundGuard, shapeStudentInfoGet, shapeStudentInfoSave, staffInfoSaveError, mergeStaffStudentInfo, studentInfoWriteConflict, STUDENT_INFO_CONFLICT, type StaffPerms } from "./prologic.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { normalize as normPlan, next as nextInst, planCount, lockedRows, checkLocked, payLabel, settle, method as payMethod, type Inst } from "./plan.ts";
const CERT_SEL = "id,full_name,course_label,start_date,end_date,status,student_id,batch_code,certificate_no,certificate_code,certificate_issued_at,certificate_revoked_at,certificate_file,courses(name,level,duration_days)";
async function imagesOn(db: any) { const { data } = await db.from("site_settings").select("value").eq("key", "certificate_images_public").maybeSingle(); return data?.value === "on"; }
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
let CUR: any = null; // service-role client of the current request
async function sendingOn() {
  if (!env("RESEND_API_KEY") && !env("ADMISSION_SMTP_PASS")) return false;
  if (env("SEND_EMAILS") === "on") return true;
  if (env("SEND_EMAILS") === "off_forced") return false;
  const { data } = await CUR.from("site_settings").select("value").eq("key", "send_emails").maybeSingle();
  return data?.value === "on";
}
const safeN = (x: unknown) => String(x || "Student").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const docName = (e: any, kind: string) => kind === "receipt" ? `${e.invoice_no}_${safeN(e.full_name)}_Fee_Receipt.pdf` : `${e.student_id}_${safeN(e.full_name)}_Admission_Form.pdf`;
const pkr = (n: number) => "PKR " + Number(n || 0).toLocaleString("en-US");
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const ENR_SEL = "*,courses(name,level,duration_days,fee_pkr,old_fee_pkr)";
const WA_LINK_HOURS = 48; // WhatsApp document links stop working after this many hours (the portal keeps the files)
/** Tells the Google Sheets script to pull the fee summary now (optional; it also pulls every 10 minutes).
 *  FEES_SYNC_URL = the Apps Script web app URL. Nothing secret is sent; the script then calls fees_feed with its own token. */
function pingSheets() {
  const url = env("FEES_SYNC_URL"); if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return;
  const p = fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ping: "fees", at: Date.now() }) }).then((r) => r.body?.cancel()).catch(() => {});
  try { EdgeRuntime.waitUntil(p); } catch (_) { /* older runtimes */ }
}
function feeInfo(e: any): FeeInfo {
  const n = Array.isArray(e.installment_plan) ? nextInst(e.installment_plan, e.amount_paid) : null;
  return { name: e.full_name || "", studentId: e.student_id || "–", course: e.courses?.name || e.course_label || "your course", batch: e.batch_code || "", total: pkr(e.fee_total), paid: pkr(e.amount_paid), balance: pkr(e.balance_due), due: e.due_date ? fmt(e.due_date) : "on request", next: n ? `${pkr(n.left)} (installment ${n.no} of ${n.of})` : undefined };
}
/** Custom plan: due date of the first installment that is not fully paid (null when paid in full). */
function planDue(plan: Inst[] | null | undefined, paid: number): string | null { const n = Array.isArray(plan) ? nextInst(plan, paid) : null; return n ? n.due : null; }
/** "PKR 10,000 (installment 2 of 4)" for the next open installment of a custom plan, else "". */
function nextText(e: any): string { const n = Array.isArray(e.installment_plan) ? nextInst(e.installment_plan, e.amount_paid) : null; return n ? `${pkr(n.left)} (installment ${n.no} of ${n.of})` : ""; }
let qrCache: Uint8Array | null = null;
async function loadPaymentQr(db: any) {
  if (qrCache) return qrCache;
  const r = await db.storage.from("documents").download("internal/dfa-raast-qr.jpg");
  if (r.error || !r.data) throw new Error("Payment QR is not configured on the server.");
  qrCache = new Uint8Array(await r.data.arrayBuffer());
  return qrCache;
}
async function qrAttachment(db: any) {
  return { filename: "DFA Raast QR.jpg", content: await loadPaymentQr(db), contentType: "image/jpeg" };
}
// Per-request state (requests run concurrently in one isolate, so no module-level "last id"):
// lastId = Resend message id of the last email this request sent, stored on email_log for the delivery webhook.
const MAIL_CTX = new AsyncLocalStorage<{ lastId: string | null }>();
async function logMail(db: any, e: any, kind: string, items: string[], status: string, by: string | null, error?: string) {
  const st = MAIL_CTX.getStore(); const pid = status === "sent" ? (st?.lastId ?? null) : null; if (st) st.lastId = null;
  await db.from("email_log").insert({ enrollment_id: e.id, kind, items, to_email: e.email, status, error: error ? error.slice(0, 300) : null, sent_by: by, provider_id: pid });
  if (status === "sent") await db.from("enrollments").update({ last_docs_sent_at: new Date().toISOString(), last_docs_sent_items: items.join(", ") }).eq("id", e.id);
}
/** Signed URL for one installment receipt (builds it if missing). */
async function receiptByInv(db: any, e: any, inv: string) {
  const pays = (await db.from("payments").select("*").eq("enrollment_id", e.id).order("installment_no")).data || [];
  let before = 0, p: any = null;
  for (const x of pays) { if (x.invoice_no === inv) { p = x; break; } if (!x.voided_at) before += Number(x.amount) || 0; }
  if (!p) return null;
  let f = p.receipt_file || (p.invoice_no === e.invoice_no ? e.receipt_file : null);
  if (!f) f = (await buildPaymentReceipt(db, e, p, before)).rp;
  return await signed(db, f, `${p.invoice_no}_${safeN(e.full_name)}_Fee_Receipt.pdf`);
}
/** Email the chosen documents (admission, receipt, certificate, reminder) to the student. */
async function resendDocs(db: any, id: number, want: string[], by: string | null) {
  const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data;
  if (!e) return { error: "Not found", code: 404 };
  if (!e.invoice_no) return { error: "Documents are created when you click Payment received.", code: 400 };
  if (!(await sendingOn())) return { error: "Email sending is switched off.", code: 400 };
  const att: any[] = [], names: string[] = [];
  for (const k of ["admission", "receipt"] as const) {
    if (want.includes(k) && !(k === "admission" ? e.admission_file : e.receipt_file)) { await buildOne(db, e, k); return { retry: true, built: k }; }
  }
  if (want.includes("admission")) { att.push({ filename: `DFA Confirmation of Registration ${e.student_id}.pdf`, content: await fileBytes(db, "documents", e.admission_file), contentType: "application/pdf" }); names.push("Confirmation of Registration (admission form)"); }
  if (want.includes("receipt")) {
    const pays = (await db.from("payments").select("*").eq("enrollment_id", id).order("installment_no")).data || [];
    let before = 0;
    for (const p of pays.length ? pays.filter((x: any) => !x.voided_at) : [{ invoice_no: e.invoice_no, receipt_file: e.receipt_file }]) {
      let f = p.receipt_file || (p.invoice_no === e.invoice_no ? e.receipt_file : null); if (!f && p.id) { await buildPaymentReceipt(db, e, p, before); return { retry: true, built: p.invoice_no }; }
      before += Number(p.amount) || 0;
      att.push({ filename: `DFA Fee Receipt ${p.invoice_no}.pdf`, content: await fileBytes(db, "documents", f), contentType: "application/pdf" }); names.push(`Fee receipt ${p.invoice_no}`);
    }
  }
  if (want.includes("certificate")) {
    if (!e.certificate_no || e.certificate_revoked_at) return { error: "No valid certificate issued yet.", code: 400 };
    if (!(await imagesOn(db))) return { error: "Certificates for students are switched off (Admin > Settings).", code: 400 };
    const c = (await db.from("enrollments").select(CERT_SEL).eq("id", id).maybeSingle()).data;
    const u = await certificateUrls(db, c); const r = await fetch(u.url); if (!r.ok) return { error: "Could not load the certificate image.", code: 500 };
    att.push({ filename: `DFA Certificate ${e.certificate_no}.png`, content: new Uint8Array(await r.arrayBuffer()), contentType: "image/png" }); names.push(`Course Participation Certificate ${e.certificate_no}`);
  }
  const rem = want.includes("reminder") && e.balance_due > 0;
  if (want.includes("reminder") && !rem) return { error: "No balance is due for this student.", code: 400 };
  if (!names.length && !rem) return { error: "Pick at least one item.", code: 400 };
  if (rem) att.push(await qrAttachment(db));
  const m = names.length ? docsMail(e.full_name, e.courses?.name || e.course_label || "course", names, rem ? feeInfo(e) : null, e.student_id) : reminder(0, feeInfo(e));
  const items = [...want.filter((w) => ["admission", "receipt", "certificate"].includes(w)), ...(rem ? ["reminder"] : [])];
  try { const r = await send(e.email, m.subject, m.text, att); await logMail(db, e, "resend", items, r, by); return { ok: true, email: r, items, sent_at: new Date().toISOString() }; }
  catch (x) { await logMail(db, e, "resend", items, "error", by, String((x as Error).message || x)); return { error: "Sending failed: " + String((x as Error).message || x), code: 500 }; }
}
/** Daily: reminders around the due date (default 3 days before, on the day, 3 days after; set in the admin portal), then stop. */
async function runReminders(db: any) {
  if (!(await sendingOn())) return { off: true };
  const t = todayPk(), out: any[] = [];
  const rows = (await db.from("enrollments").select(ENR_SEL).in("status", ["active"]).gt("balance_due", 0).not("due_date", "is", null).lt("reminder_stage", 3)).data || [];
  // Admin portal: schedule (days around the due date) and per-student pause; TEST records never get reminders.
  const offs = parseOffsets((await db.from("site_settings").select("value").eq("key", "reminder_offsets").maybeSingle()).data?.value);
  const metas = rows.length ? new Map((((await db.from("student_meta").select("enrollment_id,reminders_paused,reminders_paused_until,is_test").in("enrollment_id", rows.map((e: any) => e.id))).data) || []).map((m: any) => [m.enrollment_id, m])) : new Map();
  for (const e of rows) {
    const mt: any = metas.get(e.id); if (mt?.is_test || isPaused(mt, t)) continue;
    const due = String(e.due_date).slice(0, 10);
    const stage = stageFor(t, due, offs);
    if (!stage || stage <= e.reminder_stage) continue;
    const m = reminder(stage, feeInfo(e));
    try { const r = await send(e.email, m.subject, m.text, [await qrAttachment(db)], { listUnsubscribe: true, idempotencyKey: `reminder/${e.id}/${stage}/${t}` }); await logMail(db, e, "reminder-" + stage, ["reminder"], r, null); if (r === "sent") await db.from("enrollments").update({ reminder_stage: stage }).eq("id", e.id); out.push({ id: e.id, stage, r }); }
    catch (x) { await logMail(db, e, "reminder-" + stage, ["reminder"], "error", null, String((x as Error).message || x)); out.push({ id: e.id, stage, error: true }); }
  }
  return { ok: true, today: t, sent: out };
}
function textToHtml(text: string) {
  const esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#0d1712;max-width:640px;margin:0 auto;padding:16px"><div style="white-space:pre-wrap">${linked}</div><p style="margin-top:24px;font-size:13px;color:#5d6b63">Deutsch Für Alle · <a href="https://www.deutschfuralle.com">deutschfuralle.com</a></p></body></html>`;
}
type MailAtt = { filename: string; content: Uint8Array; contentType?: string };
type SendOpts = { idempotencyKey?: string; listUnsubscribe?: boolean };
const RESEND_FROM = () => env("RESEND_FROM") || "Deutsch Für Alle <admission@mail.deutschfuralle.com>";
/** Reply-To on the Resend path stays on the From domain (Cloudflare Email Routing forwards it to the Gmail inbox); avoids FREEMAIL_FORGED_REPLYTO. */
const RESEND_REPLY = () => { const r = env("RESEND_REPLY_TO"); return r && /@mail\.deutschfuralle\.com>?$/i.test(r.trim()) ? r.trim() : "admission@mail.deutschfuralle.com"; };
/** SMTP fallback until 2026-11-12. Set RESEND_SMTP_FALLBACK=off to disable early. TODO(2026-11-12): remove nodemailer + ADMISSION_SMTP_* after one stable week on Resend. */
function smtpFallbackOn() { return env("RESEND_SMTP_FALLBACK") !== "off"; }
async function sendViaSmtp(to: string, subject: string, text: string, attachments: MailAtt[], opts: SendOpts) {
  const user = env("ADMISSION_SMTP_USER") || "admission.deutschfuralle@gmail.com";
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: env("ADMISSION_SMTP_PASS") } });
  const headers: Record<string, string> = {};
  if (opts.listUnsubscribe) headers["List-Unsubscribe"] = "<mailto:admission.deutschfuralle@gmail.com?subject=unsubscribe>";
  await transport.sendMail({
    from: `"Deutsch Für Alle" <${user}>`,
    replyTo: user,
    to,
    subject,
    text,
    html: textToHtml(text),
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    headers,
  });
  return "sent" as const;
}
async function sendViaResend(to: string, subject: string, text: string, attachments: MailAtt[], opts: SendOpts) {
  const key = env("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY missing");
  const body: Record<string, unknown> = {
    from: RESEND_FROM(),
    to: [to],
    subject,
    text,
    html: textToHtml(text),
    reply_to: RESEND_REPLY(),
  };
  if (attachments.length) {
    body.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: encodeBase64(a.content),
      ...(a.contentType ? { content_type: a.contentType } : {}),
    }));
  }
  if (opts.listUnsubscribe) {
    body.headers = { "List-Unsubscribe": "<mailto:admission@mail.deutschfuralle.com?subject=unsubscribe>" };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey.slice(0, 256);
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = (await res.text()).replace(key, "[redacted]").slice(0, 400);
    throw new Error(`Resend ${res.status}: ${err}`);
  }
  let mid: string | null = null; try { mid = String((await res.json())?.id || "") || null; } catch (_) { mid = null; }
  const st = MAIL_CTX.getStore(); if (st) st.lastId = mid;
  return "sent" as const;
}
async function send(to: string, subject: string, text: string, attachments: MailAtt[] = [], opts: SendOpts = {}) {
  if (!(await sendingOn())) return "off";
  if (env("RESEND_API_KEY")) {
    try { return await sendViaResend(to, subject, text, attachments, opts); }
    catch (x) {
      if (smtpFallbackOn() && env("ADMISSION_SMTP_PASS")) return await sendViaSmtp(to, subject, text, attachments, opts);
      throw x;
    }
  }
  if (env("ADMISSION_SMTP_PASS")) return await sendViaSmtp(to, subject, text, attachments, opts);
  return "off";
}
/** Resolve student phone from registration_details / profiles and persist on enrollments.phone. */
async function fillEnrollmentPhone(db: any, id: number) {
  const e = (await db.from("enrollments").select("id,email,sheet_row,phone").eq("id", id).maybeSingle()).data;
  if (!e) return null;
  const usable = (p: string) => { const d = String(p || "").replace(/\D+/g, ""); return d.length >= 10 && d.length <= 15 && !/^0+$/.test(d) ? String(p).trim() : ""; };
  if (usable(e.phone)) return usable(e.phone);
  const fromData = (data: any) => { for (const k of Object.keys(data || {})) if (/mobile|phone/i.test(k)) { const v = usable(data[k]); if (v) return v; } return ""; };
  let phone = "";
  if (e.sheet_row || e.email) phone = fromData(await loadDetails(db, e)); // sheet row only counts when the email matches
  if (!phone && e.email) {
    const byEmail = (await db.from("registration_details").select("data").ilike("email", e.email.trim()).limit(3)).data || [];
    for (const r of byEmail) { phone = fromData(r.data); if (phone) break; }
  }
  if (!phone && e.email) {
    try {
      const { data: ulist } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const u = (ulist?.users || []).find((x: any) => String(x.email || "").toLowerCase() === String(e.email).toLowerCase());
      if (u?.id) phone = usable(((await db.from("profiles").select("phone").eq("id", u.id).maybeSingle()).data || {}).phone || "");
    } catch (_) { /* best effort */ }
  }
  if (phone) await db.from("enrollments").update({ phone }).eq("id", id);
  return phone || null;
}
function courseFrom(course: string, level: string): string | null {
  const c = `${course} ${level}`.toLowerCase();
  const lv = level.toLowerCase();
  if (/combined|a1\s*\+\s*a2|a1\s*(&|and|-)\s*a2/.test(c)) return "a1-a2";
  const isA2 = /\ba2\b/.test(course.toLowerCase()) || (!/\ba1\b/.test(course.toLowerCase()) && /\ba2\b/.test(lv));
  if (/crash/.test(c)) return "a1-crash";
  if (/super/.test(c)) return isA2 ? "a2-super" : "a1-super";
  if (/normal/.test(c)) return isA2 ? "a2-normal" : "a1-normal";
  if (/\bc1\b/.test(c)) return "c1";
  if (/\bb2\b/.test(c)) return "b2";
  if (/\bb1\b/.test(c)) return "b1";
  if (/\ba2\b/.test(c)) return "a2";
  return null;
}
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Enqueue document + welcome jobs (idempotent via unique enrollment_id+kind). */
async function enqueueDocJobs(db: any, enrollmentId: number) {
  const rows = ["admission", "receipt", "welcome"].map((kind) => ({ enrollment_id: enrollmentId, kind, status: "pending", attempts: 0, last_error: null, updated_at: new Date().toISOString() }));
  const r = await db.from("doc_jobs").upsert(rows, { onConflict: "enrollment_id,kind", ignoreDuplicates: true });
  if (r.error) console.error("enqueueDocJobs", r.error.message);
}
/** Process the next pending/error doc job for one enrollment. One PDF or one email per call (CPU limit). */
async function processNextDocJob(db: any, enrollmentId: number, by: string | null) {
  const e = (await db.from("enrollments").select(ENR_SEL).eq("id", enrollmentId).maybeSingle()).data;
  if (!e || !e.invoice_no) return { error: "Not activated yet.", code: 400 };
  // Skip jobs whose artifacts already exist (idempotent recovery after partial success).
  if (e.admission_file) await db.from("doc_jobs").update({ status: "done", updated_at: new Date().toISOString(), last_error: null }).eq("enrollment_id", enrollmentId).eq("kind", "admission").neq("status", "done");
  if (e.receipt_file) await db.from("doc_jobs").update({ status: "done", updated_at: new Date().toISOString(), last_error: null }).eq("enrollment_id", enrollmentId).eq("kind", "receipt").neq("status", "done");
  if (e.welcome_sent_at) await db.from("doc_jobs").update({ status: "done", updated_at: new Date().toISOString(), last_error: null }).eq("enrollment_id", enrollmentId).eq("kind", "welcome").neq("status", "done");

  const job = (await db.from("doc_jobs").select("*").eq("enrollment_id", enrollmentId).in("status", ["pending", "error"]).order("id").limit(1).maybeSingle()).data;
  if (!job) {
    const left = (await db.from("doc_jobs").select("kind,status,last_error").eq("enrollment_id", enrollmentId)).data || [];
    const pending = left.filter((j: any) => j.status === "pending" || j.status === "running" || j.status === "error");
    return { ok: true, done: true, jobs: left, ready: !pending.length && !!(e.admission_file && e.receipt_file) };
  }
  await db.from("doc_jobs").update({ status: "running", attempts: (job.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("id", job.id);
  try {
    if (job.kind === "admission" || job.kind === "receipt") {
      if ((job.kind === "admission" ? e.admission_file : e.receipt_file)) {
        await db.from("doc_jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
        return { ok: true, step: job.kind, existed: true };
      }
      await buildOne(db, e, job.kind);
      await db.from("doc_jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { ok: true, step: job.kind };
    }
    // welcome
    if (e.welcome_sent_at) {
      await db.from("doc_jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { ok: true, step: "welcome", email: "already sent" };
    }
    if (!e.admission_file || !e.receipt_file) {
      const msg = "Documents are not ready yet.";
      await db.from("doc_jobs").update({ status: "pending", last_error: msg, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { error: msg, code: 409, step: "welcome" };
    }
    const d = docData(e, null, null);
    const m = welcome(e.full_name, e.courses?.name || e.course_label || "your course", fmt(e.start_date), fmt(e.end_date), { fee: String(d.feeText).replace(/ \(.*$/, ""), studentId: e.student_id, invoiceNo: e.invoice_no, batch: e.batch_code, courseEnd: d.end, paid: pkr(e.amount_paid), balance: e.balance_due > 0 ? pkr(e.balance_due) : "", due: e.due_date ? fmt(e.due_date) : "the date we agreed", next: nextText(e) });
    const att = [{ filename: `DFA Confirmation of Registration ${e.student_id}.pdf`, content: await fileBytes(db, "documents", e.admission_file), contentType: "application/pdf" }, { filename: `DFA Fee Receipt ${e.invoice_no}.pdf`, content: await fileBytes(db, "documents", e.receipt_file), contentType: "application/pdf" }];
    let r = "off";
    try { r = await send(e.email, m.subject, m.text, att); }
    catch (x) {
      const err = String((x as Error).message || x).slice(0, 300);
      await logMail(db, e, "welcome", ["admission", "receipt"], "error", by, err);
      await db.from("doc_jobs").update({ status: "error", last_error: err, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { error: "Sending failed: " + err, code: 500, step: "welcome" };
    }
    if (r === "sent") { await db.from("enrollments").update({ welcome_sent_at: new Date().toISOString() }).eq("id", enrollmentId); await logMail(db, e, "welcome", ["admission", "receipt"], "sent", by); }
    if (r === "off") await db.from("doc_jobs").update({ status: "skipped", last_error: "emails off", updated_at: new Date().toISOString() }).eq("id", job.id);
    else await db.from("doc_jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: true, step: "welcome", email: r };
  } catch (x) {
    const err = String((x as Error).message || x).slice(0, 300);
    await db.from("enrollments").update({ docs_error: err }).eq("id", enrollmentId);
    await db.from("doc_jobs").update({ status: "error", last_error: err, updated_at: new Date().toISOString() }).eq("id", job.id);
    return { error: err, code: 500, step: job.kind };
  }
}
async function docsStatus(db: any, enrollmentId: number) {
  const e = (await db.from("enrollments").select("id,admission_file,receipt_file,welcome_sent_at,docs_error,invoice_no").eq("id", enrollmentId).maybeSingle()).data;
  const jobs = (await db.from("doc_jobs").select("kind,status,attempts,last_error,updated_at").eq("enrollment_id", enrollmentId).order("id")).data || [];
  return {
    ok: true,
    invoice_no: e?.invoice_no || null,
    admission: !!e?.admission_file,
    receipt: !!e?.receipt_file,
    welcome_sent: !!e?.welcome_sent_at,
    docs_error: e?.docs_error || null,
    jobs,
    ready: !!(e?.admission_file && e?.receipt_file),
  };
}

async function cleanupDocJobs(db: any, days = 30) {
  const cut = new Date(Date.now() - Math.max(1, days) * 864e5).toISOString();
  const r = await db.from("doc_jobs").delete().in("status", ["done", "skipped", "error"]).lt("updated_at", cut);
  return { ok: !r.error, error: r.error?.message || null, older_than: cut };
}

Deno.serve((req) => MAIL_CTX.run({ lastId: null }, () => serveReq(req)));
const serveReq = withAudit(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  CUR = db;
  let body: any = {}, raw = "";
  try { raw = await req.text(); body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  try {
    if (req.headers.get("svix-id")) {
      // Resend webhook: delivered / bounced / complained for emails we sent (RESEND_WEBHOOK_SECRET = the endpoint's signing secret).
      // Any failure here (bad/malformed secret or signature, odd payload) is a plain 4xx with no error text.
      try {
        const ok = await verifySvix(env("RESEND_WEBHOOK_SECRET"), req.headers.get("svix-id") || "", req.headers.get("svix-timestamp") || "", raw, req.headers.get("svix-signature") || "");
        if (!ok) return json({ error: "forbidden" }, 403);
        const st = deliveryFrom(String(body?.type || "")), mid = String(body?.data?.email_id || "");
        if (st && mid) await db.from("email_log").update({ delivery: st, delivery_at: new Date().toISOString(), ...(st === "bounced" ? { error: String(body.data?.bounce?.message || "Bounced").slice(0, 300) } : {}) }).eq("provider_id", mid);
        return json({ ok: true });
      } catch (_) { return json({ error: "bad request" }, 400); }
    }
    if (body.action === "intake") {
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "no email" }, 400);
      if ((await db.rpc("is_disposable_email", { addr: email })).data) { await db.from("login_events").insert({ email, kind: "signup_blocked", detail: "registration form: disposable email" }); return json({ ok: false, error: "disposable email", blocked: true }, 422); }
      const name = `${body.first_name || ""} ${body.last_name || ""}`.trim().slice(0, 120);
      const strip = (x: unknown) => String(x || "").replace(/\s*[–—-]\s*PKR[\s\S]*$/i, "").trim();
      body.course = strip(body.course); body.level = strip(body.level);
      const receipt = /^https:\/\/(drive|docs)\.google\.com\//.test(String(body.receipt_url || "")) ? String(body.receipt_url).slice(0, 300) : null;
      const code = courseFrom(String(body.course || ""), String(body.level || ""));
      const { data: c } = code ? await db.from("courses").select("name,fee_pkr,old_fee_pkr").eq("code", code).maybeSingle() : { data: null };
      const label = c?.name || (body.course ? String(body.course).slice(0, 120) : (body.level ? `German ${String(body.level).trim()}` : null));
      const ins = await db.from("enrollments").upsert({ email, full_name: name || null, course_code: code, course_label: label, receipt_url: receipt, sheet_row: Number(body.sheet_row) > 1 ? Math.floor(Number(body.sheet_row)) : null, source: "form", source_ref: String(body.ref || "").slice(0, 120) || null, phone: (String(body.phone || body.mobile || "").trim().slice(0, 30) || null) }, { onConflict: "source_ref", ignoreDuplicates: true }).select("id,confirmation_sent_at,student_id,batch_code").maybeSingle();
      if (ins.error) return json({ error: ins.error.message }, 500);
      if (!ins.data) {
        const ex = await db.from("enrollments").select("student_id,batch_code").eq("source_ref", String(body.ref || "").slice(0, 120)).maybeSingle();
        return json({ ok: true, duplicate: true, student_id: ex.data?.student_id || null, batch_code: ex.data?.batch_code || null });
      }
      const m = confirmation(name, code, label, body.level, c?.fee_pkr, c?.old_fee_pkr);
      const r = await send(email, m.subject, m.text);
      if (r === "sent") await db.from("enrollments").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", ins.data.id);
      return json({ ok: true, id: ins.data.id, email: r, student_id: ins.data.student_id, batch_code: ins.data.batch_code });
    }
    if (body.action === "verify") {
      // Public: check a DFA course-completion certificate by its verification code. No contact details returned.
      const code = String(body.code || "").trim().toUpperCase();
      if (!/^[A-F0-9]{12}$/.test(code)) return json({ found: false });
      const { data: e } = await db.from("enrollments").select("full_name,course_label,start_date,end_date,certificate_no,certificate_issued_at,certificate_revoked_at,status,courses(name,level,duration_days)").eq("certificate_code", code).maybeSingle();
      if (!e || !e.certificate_no) return json({ found: false });
      if (e.certificate_revoked_at || e.status === "revoked") return json({ found: false, revoked: true });
      // only a real (active or finished) enrollment can verify: pending/forged rows never do
      if (e.status !== "active" && e.status !== "expired") return json({ found: false });
      const tk = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const au = tk && tk.split(".").length === 3 ? (await db.auth.getUser(tk)).data?.user : null;
      const adm = au ? (await db.from("profiles").select("role").eq("id", au.id).maybeSingle()).data?.role === "admin" : false;
      const ownE = (await db.from("enrollments").select("email").eq("certificate_code", code).maybeSingle()).data?.email || "";
      const mine = !!(au?.email_confirmed_at && au.email && ownE && au.email.toLowerCase() === String(ownE).toLowerCase());
      // Certificates not released to students yet: only an admin may confirm a code.
      if (!adm && !(await imagesOn(db))) return json({ found: false, unreleased: true });
      const c: any = e.courses;
      // Public verify: details only. The image/PDF is served only to the owner (my_cert_file) or an admin (cert_file_admin).
      return json({ found: true, mine, admin: adm, name: e.full_name || "", course: c?.name || e.course_label || "", level: c?.level || "", start_date: e.start_date, end_date: c?.duration_days && e.start_date ? new Date(Date.parse(e.start_date + "T00:00:00Z") + c.duration_days * 864e5).toISOString().slice(0, 10) : e.end_date, certificate_no: e.certificate_no, issued_at: e.certificate_issued_at });
    }
    if (body.action === "cert_file_sync") {
      // Apps Script: get a certificate image link to save a copy in Drive (only once images are switched on).
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      if (!(await imagesOn(db))) return json({ off: true });
      const { data: e } = await db.from("enrollments").select(CERT_SEL).eq("certificate_code", String(body.code || "").toUpperCase()).maybeSingle();
      if (!e || !e.certificate_no || e.certificate_revoked_at) return json({ error: "not found" }, 404);
      return json(await certificateUrls(db, e));
    }
    if (body.action === "details_sync") {
      // Apps Script: copies registration form answers (keyed by sheet row) so the documents can show them.
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const list = (Array.isArray(body.rows) ? body.rows : []).filter((r: any) => Number(r.sheet_row) > 1).slice(0, 2000)
        .map((r: any) => ({ sheet_row: Math.floor(Number(r.sheet_row)), email: String(r.email || "").toLowerCase().slice(0, 200), data: r.data || {}, updated_at: new Date().toISOString() }));
      if (list.length) { const r = await db.from("registration_details").upsert(list, { onConflict: "sheet_row" }); if (r.error) return json({ error: r.error.message }, 500); }
      return json({ ok: true, saved: list.length });
    }
    if (body.action === "docs_list") {
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const rows = (await db.from("enrollments").select("sheet_row,email,student_id,invoice_no,admission_file,receipt_file").not("sheet_row", "is", null).not("admission_file", "is", null)).data || [];
      const want = new Set((Array.isArray(body.need) ? body.need : []).map((n: any) => Number(n)));
      const out: any[] = [];
      for (const r of rows) {
        if (want.size && !want.has(r.sheet_row)) continue;
        out.push({ sheet_row: r.sheet_row, email: r.email, student_id: r.student_id, invoice_no: r.invoice_no,
          admission: (await signed(db, r.admission_file, "a.pdf")).url, receipt: (await signed(db, r.receipt_file, "r.pdf")).url });
      }
      return json({ rows: out });
    }
    if (body.action === "numbers") {
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const r = await db.from("enrollments").select("sheet_row,email,student_id,batch_code,invoice_no,certificate_no,certificate_code,certificate_revoked_at,certificate_hold").not("sheet_row", "is", null).order("sheet_row");
      if (r.error) return json({ error: r.error.message }, 500);
      return json({ rows: r.data || [] });
    }
    if (body.action === "fees_feed") {
      // Apps Script (Google Sheets): one fee summary per student + their payments. Read-only.
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const es = (await db.from("enrollments").select(ENR_SEL).not("student_id", "is", null).order("id")).data || [];
      const ps = (await db.from("payments").select("id,enrollment_id,amount,paid_on,installment_no,invoice_no,method,voided_at,installment_label,revision,proof_url")).data || [];
      const by = new Map<number, any[]>(); for (const p of ps) { const l = by.get(p.enrollment_id) || []; l.push(p); by.set(p.enrollment_id, l); }
      return json({ generated_at: new Date().toISOString(), rows: es.map((e: any) => ({ ...feeRow(e, by.get(e.id) || []), sheet_row: e.sheet_row })) });
    }
    if (body.action === "sync_courses") {
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      let updated = 0; const unknown: string[] = [];
      for (const x of Array.isArray(body.courses) ? body.courses.slice(0, 50) : []) {
        const code = courseFrom(String(x.name || "").replace(/\s*[–—-]\s*PKR[\s\S]*$/i, "").trim(), "");
        const fee = Math.round(Number(x.fee)), old = x.old_fee ? Math.round(Number(x.old_fee)) : null, days = Math.round(Number(x.days));
        if (!code || !(fee > 0)) { unknown.push(String(x.name || "")); continue; }
        const patch: Record<string, unknown> = { fee_pkr: fee, old_fee_pkr: old && old > fee ? old : null };
        if (days > 0 && days < 1000) patch.duration_days = days;
        const r = await db.from("courses").update(patch).eq("code", code);
        if (r.error) return json({ error: r.error.message }, 500);
        updated++;
      }
      return json({ ok: true, updated, unknown });
    }
    if (body.action === "export") {
      const tok = env("AUTOMATION_TOKEN");
      if (!tok || req.headers.get("x-intake-token") !== tok) return json({ error: "forbidden" }, 403);
      const users: any[] = [];
      for (let page = 1; page < 50; page++) {
        const { data, error: ue } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (ue) return json({ error: "users: " + ue.message }, 500);
        users.push(...(data?.users || [])); if (!data || data.users.length < 1000) break;
      }
      const byId = new Map(users.map((u) => [u.id, u]));
      const pr = await db.from("profiles").select("*").order("created_at");
      if (pr.error) return json({ error: "profiles: " + pr.error.message }, 500);
      const profiles = pr.data || [];
      const accounts = profiles.map((p: any) => { const u: any = byId.get(p.id) || {}; return { email: u.email || "", username: p.username, full_name: p.full_name, country: p.country, phone: p.phone, role: p.role, created_at: p.created_at, email_confirmed: !!u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at || "" }; });
      const names = new Map(profiles.map((p: any) => [p.id, p.username]));
      const reviews = ((await db.from("reviews").select("*").order("created_at")).data || []).map((r: any) => ({ id: r.id, book_slug: r.book_slug, username: r.username, email: (byId.get(r.user_id) as any)?.email || "", rating: r.rating, comment: r.comment, created_at: r.created_at, updated_at: r.updated_at, hidden: r.hidden, verified_buyer: r.verified_buyer }));
      const students = ((await db.from("enrollments").select("*").order("created_at")).data || []).map((e: any) => ({ id: e.id, email: e.email, full_name: e.full_name, course_code: e.course_code, course_label: e.course_label, status: e.status, start_date: e.start_date, end_date: e.end_date, source: e.source, created_at: e.created_at, activated_at: e.activated_at, receipt_url: e.receipt_url, student_id: e.student_id, batch_code: e.batch_code, invoice_no: e.invoice_no, invoiced_at: e.invoiced_at, certificate_no: e.certificate_no, certificate_code: e.certificate_code, certificate_issued_at: e.certificate_issued_at, certificate_hold: e.certificate_hold, certificate_revoked_at: e.certificate_revoked_at, sheet_row: e.sheet_row, admission_file: e.admission_file, receipt_file: e.receipt_file, confirmation_sent_at: e.confirmation_sent_at, welcome_sent_at: e.welcome_sent_at }));
      const exams = ((await db.from("exam_attempts").select("*").order("created_at")).data || []).map((x: any) => ({ id: x.id, username: names.get(x.user_id) || "", email: (byId.get(x.user_id) as any)?.email || "", exam_slug: x.exam_slug, score: x.score, max_score: x.max_score, created_at: x.created_at }));
      return json({ generated_at: new Date().toISOString(), Accounts: accounts, Reviews: reviews, Students: students, "Exam Results": exams });
    }
    // scheduled job / internal calls (token kept in site_settings, readable by the service role only)
    const ct = req.headers.get("x-cron-token");
    if (ct) {
      const s = (await db.from("site_settings").select("value").eq("key", "cron_token").maybeSingle()).data;
      if (!s?.value || s.value !== ct) return json({ error: "forbidden" }, 403);
      if (body.action === "reminders") { try { await cleanupDocJobs(db, 30); } catch (_) {} return json(await runReminders(db)); }
      if (body.action === "resend") { const r: any = await resendDocs(db, Number(body.id), Array.isArray(body.items) ? body.items.map(String) : [], null); return json(r, r.code || 200); }
            if (body.action === "status") return json({ sending: (await sendingOn()) ? "on" : "off", resend: !!env("RESEND_API_KEY"), smtp: !!env("ADMISSION_SMTP_PASS"), smtp_fallback: smtpFallbackOn() });
      if (body.action === "deliverability_test") {
        const to = String(body.to || "").trim().toLowerCase();
        const allow = to === "contact.deutschfuralle@gmail.com" || to === "admission@mail.deutschfuralle.com" || to.endsWith("@mail-tester.com") || to.endsWith(".mail-tester.com");
        if (!allow) return json({ error: "deliverability_test only allows contact.deutschfuralle@gmail.com or mail-tester.com" }, 400);
        const sid = "DFA-2026-TEST";
        const m = docsMail("TEST Student", "A1 Crash Course", ["Confirmation of Registration (admission form)", "Fee receipt INV-2026-TEST"], null, sid);
        // Body is full text (not link/attachment-only). Tiny text attachment proves multipart still has text/html body.
        const note = new TextEncoder().encode("Deutsch Für Alle — test attachment for deliverability check. This email also has a full plain-text and HTML body.\n");
        try {
          const r = await send(to, m.subject, m.text + "\n\n(This is a deliverability test message for Deutsch Für Alle. No student action is required.)", [{ filename: "dfa-deliverability-note.txt", content: note, contentType: "text/plain" }], { idempotencyKey: `deliverability/${to}/${Date.now()}` });
          return json({ ok: true, email: r, to, subject: m.subject });
        } catch (x) { return json({ error: "Sending failed: " + String((x as Error).message || x) }, 500); }
      } if (body.action === "render_test") { const e = (await db.from("enrollments").select(ENR_SEL).eq("id", Number(body.id)).maybeSingle()).data; const t0 = Date.now(); const r = await buildOne(db, e, body.kind === "receipt" ? "receipt" : "admission", true); return json({ ok: true, ms: Date.now() - t0, bytes: r.bytes.length }); }
      if (body.action === "docs_status") return json(await docsStatus(db, Number(body.id)));
      if (body.action === "process_docs") { await enqueueDocJobs(db, Number(body.id)); const r: any = await processNextDocJob(db, Number(body.id), null); return json(r, r.code || 200); }
      if (body.action === "build_doc") {
        const e = (await db.from("enrollments").select(ENR_SEL).eq("id", Number(body.id)).maybeSingle()).data;
        if (!e || !e.invoice_no) return json({ error: "Not activated yet." }, 400);
        const kind = body.kind === "receipt" ? "receipt" : "admission";
        if ((kind === "receipt" ? e.receipt_file : e.admission_file) && !body.rebuild) return json({ ok: true, kind, existed: true });
        try { await buildOne(db, e, kind); return json({ ok: true, kind }); }
        catch (x) { const m = String((x as Error).message || x).slice(0, 300); await db.from("enrollments").update({ docs_error: m }).eq("id", e.id); return json({ error: m }, 500); }
      }
      if (body.action === "settings_get") { const se = (await db.from("site_settings").select("value").eq("key", "send_emails").maybeSingle()).data; return json({ certificates: await imagesOn(db), emails: se?.value === "on", resend: !!env("RESEND_API_KEY"), smtp: !!env("ADMISSION_SMTP_PASS"), smtp_fallback: smtpFallbackOn(), forced: env("SEND_EMAILS") || null }); }
      if (body.action === "cleanup_doc_jobs") return json(await cleanupDocJobs(db, Number(body.days) > 0 ? Number(body.days) : 30));
      if (body.action === "put_internal_file") {
        // NOTE: content_type must be one of the documents bucket's allowed MIME types (application/pdf, image/jpeg,
        // image/png, image/webp; migration 20261125130000). Anything else (incl. the octet-stream default) is refused by storage.
        const path = String(body.path || "");
        if (!path.startsWith("internal/") || path.includes("..")) return json({ error: "path must be under internal/" }, 400);
        const bytes = decodeBase64(String(body.content_base64 || ""));
        if (!bytes.length) return json({ error: "empty file" }, 400);
        const up = await db.storage.from("documents").upload(path, bytes, { contentType: String(body.content_type || "application/octet-stream"), upsert: true });
        if (up.error) return json({ error: up.error.message }, 500);
        return json({ ok: true, path, bytes: bytes.length });
      }
      if (body.action === "purge_docs") {
        // Storage API delete. Only removes paths that no enrollment/payment still references.
        const paths = (Array.isArray(body.paths) ? body.paths : []).map((x: any) => String(x || "")).filter(Boolean);
        if (!paths.length || paths.length > 20) return json({ error: "paths required (max 20)" }, 400);
        if (paths.some((p: string) => p.includes("..") || p.startsWith("/"))) return json({ error: "invalid path" }, 400);
        const linked: string[] = [];
        for (const path of paths) {
          const a = (await db.from("enrollments").select("id").eq("admission_file", path).limit(1)).data || [];
          const b = (await db.from("enrollments").select("id").eq("receipt_file", path).limit(1)).data || [];
          const c = (await db.from("enrollments").select("id").eq("certificate_file", path).limit(1)).data || [];
          const pay = (await db.from("payments").select("id").eq("receipt_file", path).limit(1)).data || [];
          if (a.length || b.length || c.length || pay.length) linked.push(path);
        }
        if (linked.length) return json({ error: "refusing to delete paths still linked to enrollments/payments", linked }, 409);
        const rem = await db.storage.from("documents").remove(paths);
        if (rem.error) return json({ error: rem.error.message }, 500);
        return json({ ok: true, removed: paths });
      }
      if (body.action === "admin_gate_test") {
        // Ephemeral non-admin JWT must receive 403 for process_docs / docs_status (bypasses login captcha via admin generateLink).
        const email = `qa.gate.${Date.now()}@example.com`;
        const password = `QaGate-${crypto.randomUUID()}!aA1`;
        const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "TEST Gate QA" } });
        if (created.error || !created.data.user) return json({ error: "createUser: " + (created.error?.message || "failed") }, 500);
        const uid = created.data.user.id;
        try {
          await db.from("profiles").upsert({ id: uid, username: `qa_gate_${Date.now()}`, full_name: "TEST Gate QA", role: "student" });
          const anonKey = env("SUPABASE_ANON_KEY");
          if (!anonKey) throw new Error("SUPABASE_ANON_KEY missing");
          const client = createClient(env("SUPABASE_URL"), anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const link = await db.auth.admin.generateLink({ type: "magiclink", email });
          if (link.error) return json({ error: "generateLink: " + link.error.message, uid }, 500);
          const emailOtp = (link.data as any)?.properties?.email_otp || (link.data as any)?.email_otp;
          const tokenHash = (link.data as any)?.properties?.hashed_token;
          let session = null as any;
          if (emailOtp) {
            const v = await client.auth.verifyOtp({ email, token: String(emailOtp), type: "email" });
            if (v.error) return json({ error: "verifyOtp: " + v.error.message, uid }, 500);
            session = v.data.session;
          } else if (tokenHash) {
            const v = await client.auth.verifyOtp({ token_hash: String(tokenHash), type: "email" });
            if (v.error) return json({ error: "verifyOtp hash: " + v.error.message, uid }, 500);
            session = v.data.session;
          } else {
            return json({ error: "generateLink returned no otp/token_hash", uid, keys: Object.keys((link.data as any)?.properties || {}) }, 500);
          }
          if (!session?.access_token) return json({ error: "no access_token", uid }, 500);
          const token = session.access_token;
          const results: Record<string, number> = {};
          for (const action of ["process_docs", "docs_status"]) {
            const res = await fetch(`${env("SUPABASE_URL")}/functions/v1/admission`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey },
              body: JSON.stringify({ action, id: 1 }),
            });
            results[action] = res.status;
          }
          return json({ ok: true, results, expect: { process_docs: 403, docs_status: 403 }, pass: results.process_docs === 403 && results.docs_status === 403 });
        } finally {
          await db.from("profiles").delete().eq("id", uid);
          await db.auth.admin.deleteUser(uid);
        }
      }
      return json({ error: "unknown action" }, 400);
    }
    // admin actions need a logged-in admin
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") || "").replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Please log in again." }, 401);
    if (body.action === "my_doc") {
      // Student: own admission form / fee receipt (matched by confirmed email), only after payment.
      if (!u.user.email_confirmed_at) return json({ error: "Please confirm your email first." }, 403);
      const { data: e } = await db.from("enrollments").select("*,courses(name,level,duration_days,fee_pkr,old_fee_pkr)").eq("id", Number(body.id)).eq("email", String(u.user.email || "").toLowerCase()).maybeSingle();
      if (!e || !e.invoice_no || !["active", "expired"].includes(e.status)) return json({ error: "Your documents are not ready yet." }, 404);
      const kind = body.kind === "receipt" ? "receipt" : "admission";
      if (kind === "receipt" && body.inv && body.inv !== e.invoice_no) { try { const r = await receiptByInv(db, e, String(body.inv)); return r ? json({ ok: true, name: e.full_name, ...r }) : json({ error: "Receipt not found." }, 404); } catch (_) { return json({ error: "Could not prepare the receipt. Please contact us." }, 500); } }
      if (!(kind === "receipt" ? e.receipt_file : e.admission_file)) { try { await buildOne(db, e, kind); } catch (_) { return json({ error: "Could not prepare the document. Please contact us." }, 500); } }
      const path = kind === "receipt" ? e.receipt_file : e.admission_file;
      if (!path) return json({ error: "Your documents are not ready yet." }, 404);
      return json({ ok: true, name: e.full_name, ...(await signed(db, path, docName(e, kind))) });
    }
    if (body.action === "my_cert_file") {
      if (!u.user.email_confirmed_at || !(await imagesOn(db))) return json({ error: "Your certificate will be available here once it is released." }, 403);
      const { data: e } = await db.from("enrollments").select(CERT_SEL).eq("email", String(u.user.email || "").toLowerCase()).eq("certificate_no", String(body.no || "")).is("certificate_revoked_at", null).maybeSingle();
      if (!e) return json({ error: "Certificate not found." }, 404);
      try { return json({ ok: true, ...(body.fmt === "pdf" ? await certificatePdfUrls(db, e) : await certificateUrls(db, e)), code: e.certificate_code, no: e.certificate_no, name: e.full_name }); } catch (x) { return json({ error: "Could not prepare the certificate: " + String((x as Error).message || x) }, 500); }
    }
    if (body.action === "my_certificates") {
      // Student portal: the logged-in student's own certificates (matched by their confirmed email).
      if (!u.user.email_confirmed_at) return json({ certificates: [] });
      const { data: rows } = await db.from("enrollments").select(CERT_SEL).eq("email", String(u.user.email || "").toLowerCase()).not("certificate_no", "is", null).is("certificate_revoked_at", null);
      const on = await imagesOn(db), out: any[] = [];
      for (const e of rows || []) {
        let img: any = null; if (on) { try { img = await certificateUrls(db, e); } catch (_) { img = null; } }
        out.push({ certificate_no: e.certificate_no, course: (e.courses as any)?.name || e.course_label, code: on ? e.certificate_code : null, released: on, image: img });
      }
      return json({ certificates: out });
    }
    const { data: p } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
    const role = p?.role === "admin" || p?.role === "staff" ? p.role : null;
    if (!role) return json({ error: "forbidden" }, 403);
    let perms: StaffPerms | null = null;
    if (role === "staff") {
      const row = (await db.from("staff_permissions").select("*").eq("user_id", u.user.id).maybeSingle()).data;
      perms = parsePerms(row);
    }
    if (!allowed(role, String(body.action || ""), perms)) return json({ error: role === "staff" ? denyMessage(String(body.action || ""), perms) : "Only an admin can do this. Ask an admin, or ask for admin access." }, 403);
    if (!confirmOk(String(body.action || ""), body)) return json({ error: `Type ${CONFIRM_WORDS[String(body.action)]} to confirm.`, code: "confirm" }, 400);
    {
      // Security: admin actions need a confirmed sign-in (device/email check) and the 2FA code when an authenticator app is set up.
      const tk = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      let cl: any = {}; try { let x = tk.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "="; cl = JSON.parse(atob(x)); } catch (_) { cl = {}; }
      const totp = ((u.user as any).factors || []).some((f: any) => f.status === "verified");
      if (totp && cl.aal !== "aal2") return json({ error: "Please enter your two-step verification code (reload the page).", code: "aal2" }, 403);
      const vs = cl.session_id ? (await db.from("verified_sessions").select("session_id").eq("session_id", cl.session_id).maybeSingle()).data : null;
      if (!vs) return json({ error: "Please confirm this sign-in first: reload the page and enter the code we emailed you.", code: "verify_session" }, 403);
    }
    { const pr = await handlePro(db, body, u.user, role, { json, today: todayPk, pingSheets, perms }); if (pr) return pr; }
    if (body.action === "activate") {
      const id = Number(body.id);
      const patch: Record<string, unknown> = { status: "active", activated_by: u.user.id };
      if (body.course_code) patch.course_code = String(body.course_code);
      if (body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) patch.start_date = body.start_date;
      const pre = (await db.from("enrollments").select("course_code,receipt_url").eq("id", id).maybeSingle()).data;
      const cc = (await db.from("courses").select("fee_pkr").eq("code", String(body.course_code || pre?.course_code || "")).maybeSingle()).data;
      let total = Math.round(Number(body.fee_total)) > 0 ? Math.round(Number(body.fee_total)) : Number(cc?.fee_pkr) || 0;
      const custom = body.plan === "custom", two = body.plan === "two";
      let plan: Inst[] | null = null;
      if (custom) {
        // Admin-chosen schedule (2-5 installments). The agreed total is the sum of the installments; installment 1 is the payment received now.
        const np = normPlan(body.installments);
        if (np.error) return json({ error: np.error }, 400);
        plan = np.plan!; total = np.total!;
      }
      let first = custom ? plan![0].amount : two ? (Math.round(Number(body.first_amount)) > 0 ? Math.round(Number(body.first_amount)) : Math.ceil(total / 2)) : total;
      if (total && first > total) first = total;
      patch.fee_total = total || null; patch.payment_plan = custom ? "custom" : two ? "two" : "full"; patch.installment_plan = plan; patch.reminder_stage = 0;
      const up = await db.from("enrollments").update(patch).eq("id", id).eq("status", "pending").select("*,courses(name)").maybeSingle();
      if (up.error) return json({ error: up.error.message }, 400);
      if (!up.data) return json({ error: "Not found or not pending" }, 404);
      let due: string | null = null;
      if (plan) due = planDue(plan, first);
      else if (first < total) { due = body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : (up.data.start_date && up.data.end_date ? addD(up.data.start_date, Math.round(((Date.parse(up.data.end_date) - Date.parse(up.data.start_date)) / 864e5 - 15) / 2)) : null); }
      await db.from("enrollments").update({ activated_by: u.user.id, due_date: due }).eq("id", id);
      if (first > 0) {
        const existing = (await db.from("payments").select("id").eq("enrollment_id", id).eq("installment_no", 1).maybeSingle()).data;
        if (!existing) {
          const ins = await db.from("payments").insert({ enrollment_id: id, amount: first, paid_on: todayPk(), proof_url: pre?.receipt_url || null, invoice_no: up.data.invoice_no, installment_no: 1, installments: plan ? plan.length : two ? 2 : 1, is_final: first >= total, installment_label: plan ? payLabel(plan, 0, first) : null, method: payMethod(body.method), reference: cleanRef(body.reference), created_by: u.user.id });
          if (ins.error && !/duplicate|unique/i.test(ins.error.message || "")) return json({ error: ins.error.message }, 400);
        }
      }
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data || up.data;
      await enqueueDocJobs(db, id);
      try { await fillEnrollmentPhone(db, id); } catch (_) { /* phone is best-effort */ }
      // Warm WASM/fonts in the background so the first build_doc is less likely to hit the CPU limit on a cold isolate.
      try { EdgeRuntime.waitUntil(warmDocAssets()); } catch (_) { /* older runtimes */ }
      // Documents + welcome are processed in separate requests (process_docs / build_doc) to stay inside the 2s CPU limit.
      pingSheets();
      return json({ ok: true, enrollment: e, next: ["admission", "receipt", "welcome"], jobs: "queued" });
    }
    if (body.action === "build_doc") {
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", Number(body.id)).maybeSingle()).data;
      if (!e || !e.invoice_no) return json({ error: "Not activated yet." }, 400);
      const kind = body.kind === "receipt" ? "receipt" : "admission";
      if ((kind === "receipt" ? e.receipt_file : e.admission_file) && !body.rebuild) return json({ ok: true, kind, existed: true });
      try { await buildOne(db, e, kind); return json({ ok: true, kind }); }
      catch (x) { const m = String((x as Error).message || x).slice(0, 300); await db.from("enrollments").update({ docs_error: m }).eq("id", e.id); return json({ error: "Could not create the " + (kind === "receipt" ? "fee receipt" : "admission form") + ": " + m }, 500); }
    }
    if (body.action === "welcome") {
      const id = Number(body.id);
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data;
      if (!e || !e.invoice_no) return json({ error: "Not activated yet." }, 400);
      if (e.welcome_sent_at && !body.force) return json({ ok: true, email: "already sent" });
      if (!e.admission_file || !e.receipt_file) return json({ error: "Documents are not ready yet." }, 409);
      const d = docData(e, null, null);
      const m = welcome(e.full_name, e.courses?.name || e.course_label || "your course", fmt(e.start_date), fmt(e.end_date), { fee: String(d.feeText).replace(/ \(.*$/, ""), studentId: e.student_id, invoiceNo: e.invoice_no, batch: e.batch_code, courseEnd: d.end, paid: pkr(e.amount_paid), balance: e.balance_due > 0 ? pkr(e.balance_due) : "", due: e.due_date ? fmt(e.due_date) : "the date we agreed", next: nextText(e) });
      const att = [{ filename: `DFA Confirmation of Registration ${e.student_id}.pdf`, content: await fileBytes(db, "documents", e.admission_file), contentType: "application/pdf" }, { filename: `DFA Fee Receipt ${e.invoice_no}.pdf`, content: await fileBytes(db, "documents", e.receipt_file), contentType: "application/pdf" }];
      let r = "off"; try { r = await send(e.email, m.subject, m.text, att, { idempotencyKey: `welcome/${e.id}/${e.invoice_no || e.id}` }); } catch (x) { await logMail(db, e, "welcome", ["admission", "receipt"], "error", u.user.id, String((x as Error).message || x)); return json({ error: "Sending failed: " + String((x as Error).message || x) }, 500); }
      if (r === "sent") { await db.from("enrollments").update({ welcome_sent_at: new Date().toISOString() }).eq("id", id); await logMail(db, e, "welcome", ["admission", "receipt"], "sent", u.user.id); }
      return json({ ok: true, email: r });
    }
    if (body.action === "certify") {
      const id = Number(body.id);
      const up = await db.from("enrollments").update({ certificate_issued_at: new Date().toISOString() }).eq("id", id).in("status", ["active", "expired"]).is("certificate_no", null).select("id,certificate_no,certificate_code").maybeSingle();
      if (up.error) return json({ error: up.error.message }, 400);
      if (!up.data) return json({ error: "Not found, not paid yet, or certificate already issued" }, 404);
      return json({ ok: true, certificate_no: up.data.certificate_no, certificate_code: up.data.certificate_code });
    }
    if (body.action === "doc_file_admin") {
      const { data: e } = await db.from("enrollments").select("*,courses(name,level,duration_days,fee_pkr,old_fee_pkr)").eq("id", Number(body.id)).maybeSingle();
      if (!e || !e.invoice_no) return json({ error: "Documents are created when you click Payment received." }, 404);
      const kind = body.kind === "receipt" ? "receipt" : "admission";
      if (kind === "receipt" && body.inv && body.inv !== e.invoice_no) { try { const r = await receiptByInv(db, e, String(body.inv)); return r ? json({ ok: true, name: e.full_name, ...r }) : json({ error: "Receipt not found." }, 404); } catch (x) { return json({ error: "Could not create the receipt: " + String((x as Error).message || x) }, 500); } }
      if (!(kind === "receipt" ? e.receipt_file : e.admission_file) || body.rebuild) { try { await buildOne(db, e, kind); } catch (x) { return json({ error: "Could not create the document: " + String((x as Error).message || x) }, 500); } }
      const path = kind === "receipt" ? e.receipt_file : e.admission_file;
      if (!path) return json({ error: "Document file missing." }, 404);
      return json({ ok: true, name: e.full_name, ...(await signed(db, path, docName(e, kind))) });
    }
    if (body.action === "cert_file_admin") {
      // Admin preview works even before images are switched on for students.
      const { data: e } = await db.from("enrollments").select(CERT_SEL).eq("id", Number(body.id)).maybeSingle();
      if (!e || !e.certificate_no) return json({ error: "No certificate yet" }, 404);
      try { return json({ ok: true, ...(body.fmt === "pdf" ? await certificatePdfUrls(db, e) : await certificateUrls(db, e)), public: await imagesOn(db), code: e.certificate_code, no: e.certificate_no, name: e.full_name }); } catch (x) { return json({ error: "Could not create the certificate image: " + String((x as Error).message || x) }, 500); }
    }
    if (body.action === "cert_images_status") return json({ public: await imagesOn(db) });
    if (body.action === "settings_get") { const se = (await db.from("site_settings").select("value").eq("key", "send_emails").maybeSingle()).data; return json({ certificates: await imagesOn(db), emails: se?.value === "on", resend: !!env("RESEND_API_KEY"), smtp: !!env("ADMISSION_SMTP_PASS"), smtp_fallback: smtpFallbackOn(), forced: env("SEND_EMAILS") || null }); }
    if (body.action === "set_emails") { const v = body.on ? "on" : "off"; await db.from("site_settings").upsert({ key: "send_emails", value: v, updated_at: new Date().toISOString() }); return json({ ok: true, emails: v === "on" }); }
    if (body.action === "cert_images") {
      const v = body.on ? "on" : "off";
      await db.from("site_settings").upsert({ key: "certificate_images_public", value: v, updated_at: new Date().toISOString() });
      return json({ ok: true, public: v === "on" });
    }
    if (body.action === "cert_hold") {
      const up = await db.from("enrollments").update({ certificate_hold: !!body.hold }).eq("id", Number(body.id)).select("id").maybeSingle();
      if (up.error || !up.data) return json({ error: up.error?.message || "Not found" }, 400);
      return json({ ok: true, hold: !!body.hold });
    }
    if (body.action === "cert_revoke") {
      const up = await db.from("enrollments").update({ certificate_revoked_at: body.undo ? null : new Date().toISOString(), certificate_hold: !body.undo }).eq("id", Number(body.id)).not("certificate_no", "is", null).select("id").maybeSingle();
      if (up.error || !up.data) return json({ error: up.error?.message || "No certificate to revoke" }, 400);
      return json({ ok: true });
    }
    if (body.action === "status") return json({ sending: (await sendingOn()) ? "on" : "off" });
    if (body.action === "docs_status") return json(redactDocs(await docsStatus(db, Number(body.id)), role));
    if (body.action === "process_docs") {
      const id = Number(body.id);
      await enqueueDocJobs(db, id);
      const r: any = await processNextDocJob(db, id, u.user.id);
      return json(r, r.code || 200);
    }
    if (body.action === "resend") { const r: any = await resendDocs(db, Number(body.id), Array.isArray(body.items) ? body.items.map(String) : [], u.user.id); return json(redactDocs(r, role), r.code || 200); }
    if (body.action === "email_log") {
      const r = await db.from("email_log").select("kind,items,status,created_at,error").eq("enrollment_id", Number(body.id)).order("created_at", { ascending: false }).limit(20);
      return json({ log: redactMailRows(r.data || [], role) });
    }
    if (body.action === "record_payment") {
      const id = Number(body.id), amount = Math.round(Number(body.amount));
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data;
      if (!e || !e.invoice_no || !["active", "expired"].includes(e.status)) return json({ error: "Activate the student first (Payment received)." }, 400);
      if (!(amount > 0)) return json({ error: "Enter the amount received." }, 400);
      if (e.fee_total && amount > e.balance_due) return json({ error: `That is more than the balance due (${pkr(e.balance_due)}).` }, 400);
      const paidOn = body.paid_on && /^\d{4}-\d{2}-\d{2}$/.test(body.paid_on) ? body.paid_on : todayPk();
      const proof = /^https:\/\//.test(String(body.proof_url || "")) ? String(body.proof_url).slice(0, 400) : null;
      const n = ((await db.from("payments").select("id", { count: "exact", head: true }).eq("enrollment_id", id)).count || 0) + 1;
      let before = Number(e.amount_paid) || 0; const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
      let after = before + amount; const fin = !e.fee_total || after >= e.fee_total;
      // installment_no is the payment's running number (unique per student, so two saves at the same moment can't both win);
      // with a plan the receipt label says which installment(s) the money covers.
      const ins = await db.from("payments").insert({ enrollment_id: id, amount, paid_on: paidOn, proof_url: proof, installment_no: n, installments: Math.max(planCount(e), n), is_final: fin, installment_label: plan ? payLabel(plan, before, after) : null, method: payMethod(body.method), reference: cleanRef(body.reference), created_by: u.user.id }).select("*").single();
      if (ins.error) return json({ error: /duplicate|unique/i.test(ins.error.message || "") ? "Another payment was just saved for this student. Reload the page and check before adding it again." : ins.error.message }, ins.error && /duplicate|unique/i.test(ins.error.message || "") ? 409 : 400);
      // The database keeps amount_paid = sum of live payments (trigger payments_sync_amount_paid), so read the total it just set.
      const rr = await db.from("enrollments").select("amount_paid").eq("id", id).maybeSingle();
      const st = settle({ plan, feeTotal: e.fee_total, amount, readOk: !rr.error && !!rr.data, sumAfter: Number(rr.data?.amount_paid) });
      // Re-read failed or can't include this payment: don't send a receipt from a wrong total.
      if (st.bad) return json({ ok: true, payment: ins.data, email: "not sent", warning: "Payment saved; reload and check" + (rr.error ? " (" + rr.error.message + ")" : "") + "." });
      if (st.over) {
        // Another payment landed meanwhile and this one would take the total above the fee: undo it (the trigger re-totals on delete).
        const del = await db.from("payments").delete().eq("id", ins.data.id);
        if (del.error) return json({ error: "This payment would take the total above the fee, but it could not be removed: the payment row " + (ins.data.invoice_no || ins.data.id) + " still exists. Reload, check the payments and delete the extra one before doing anything else. (" + del.error.message + ")" }, 500);
        return json({ error: "Another payment was just saved for this student, and this one would take the total above the fee. Reload the page and check the balance." }, 409);
      }
      before = st.before; after = st.after;
      if (st.fin !== ins.data.is_final || (st.label || null) !== (ins.data.installment_label || null)) {
        const fx = await db.from("payments").update({ is_final: st.fin, installment_label: st.label }).eq("id", ins.data.id).select("*").maybeSingle();
        if (fx.data) ins.data = fx.data; else { ins.data.is_final = st.fin; ins.data.installment_label = st.label; }
      }
      // Custom plan: the next unpaid installment's date becomes the due date, so reminders follow the schedule.
      // Reminders restart only when the due date moves; a part payment towards the same installment keeps the reminder stage.
      // amount_paid is owned by the database; only the due date and reminder stage are set here, and only while the
      // total is still the one this request saw. If it changed, a newer request (or a correction) already set them.
      const upd: Record<string, unknown> = { reminder_stage: st.fin ? 3 : 0 };
      if (plan) { const nd = planDue(plan, after); upd.due_date = nd; if (!st.fin && nd === (e.due_date ? String(e.due_date).slice(0, 10) : null)) upd.reminder_stage = e.reminder_stage || 0; e.due_date = nd; }
      const warnings: string[] = [];
      const du = await db.from("enrollments").update(upd).eq("id", id).eq("amount_paid", after);
      if (du.error) warnings.push("Payment saved, but the due date and reminders were not saved: " + du.error.message + ". Reload and check the due date.");
      e.amount_paid = after; e.balance_due = Math.max((e.fee_total || 0) - after, 0);
      let rc: any = null; try { rc = await buildPaymentReceipt(db, e, ins.data, before); } catch (x) { return json({ ok: true, payment: ins.data, warning: [...warnings, "Payment saved, but the receipt could not be created: " + String((x as Error).message || x)].join(" ") }); }
      let mail = "not sent";
      if (body.email !== false) {
        const m = receiptMail(e.full_name, e.courses?.name || e.course_label || "course", pkr(amount), ins.data.invoice_no, e.balance_due > 0 ? pkr(e.balance_due) : "", e.due_date ? fmt(e.due_date) : "", nextText(e));
        try { mail = await send(e.email, m.subject, m.text, [{ filename: `DFA Fee Receipt ${ins.data.invoice_no}.pdf`, content: rc.receipt, contentType: "application/pdf" }]); await logMail(db, e, "payment", ["receipt"], mail, u.user.id); }
        catch (x) { mail = "error"; await logMail(db, e, "payment", ["receipt"], "error", u.user.id, String((x as Error).message || x)); }
      }
      pingSheets();
      return json({ ok: true, payment: ins.data, balance_due: e.balance_due, email: mail, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
    }
    if (body.action === "set_plan") {
      // Change the schedule of an active student. The total must stay the same (documents already show it),
      // and installments that are already paid can't change (checked here, not only in the admin page).
      const id = Number(body.id);
      const e = (await db.from("enrollments").select("id,status,fee_total,amount_paid,invoice_no,installment_plan,start_date,end_date,due_date,reminder_stage").eq("id", id).maybeSingle()).data;
      if (!e || !e.invoice_no || !["active", "expired"].includes(e.status)) return json({ error: "Activate the student first (Payment received)." }, 400);
      const paid = Number(e.amount_paid) || 0, open = (e.fee_total || 0) > paid;
      if (body.clear) {
        // Back to the standard schedule: one open balance due around the middle of the course.
        const due = open && e.start_date && e.end_date ? addD(e.start_date, Math.round(((Date.parse(e.end_date) - Date.parse(e.start_date)) / 864e5 - 15) / 2)) : null;
        const up = await db.from("enrollments").update({ installment_plan: null, payment_plan: open ? "two" : "full", due_date: due, reminder_stage: open ? 0 : 3 }).eq("id", id).eq("amount_paid", paid).select("id").maybeSingle();
        if (!up.data) return json({ error: "Reload, a payment was just recorded." }, 409);
        pingSheets(); return json({ ok: true, cleared: true, due_date: due });
      }
      const np = normPlan(body.installments);
      if (np.error) return json({ error: np.error }, 400);
      if (e.fee_total && np.total !== e.fee_total) return json({ error: `The installments add up to ${pkr(np.total!)}, but the fee is ${pkr(e.fee_total)}. Make them match.` }, 400);
      const pays = Array.isArray(e.installment_plan) && e.installment_plan.length ? [] : ((await db.from("payments").select("amount,paid_on,installment_no").eq("enrollment_id", id).is("voided_at", null).order("installment_no")).data || []);
      const lockErr = checkLocked(lockedRows(e.installment_plan, paid, pays), np.plan!);
      if (lockErr) return json({ error: lockErr }, 400);
      const due = planDue(np.plan!, paid);
      const same = due === (e.due_date ? String(e.due_date).slice(0, 10) : null);
      const up = await db.from("enrollments").update({ installment_plan: np.plan, payment_plan: "custom", due_date: due, reminder_stage: !due ? 3 : same ? (e.reminder_stage || 0) : 0 }).eq("id", id).eq("amount_paid", paid).select("id").maybeSingle();
      if (up.error) return json({ error: up.error.message }, 400);
      if (!up.data) return json({ error: "Reload, a payment was just recorded." }, 409);
      pingSheets(); return json({ ok: true, due_date: due });
    }
    if (body.action === "student_info_get") {
      // What the documents will show, where each value comes from (registration form or staff edit), and the change history.
      // Staff: contacts only with see_contacts (masked otherwise); CNIC, DOB and address stay admin-only; history values redacted; every view is logged.
      const e = (await db.from("enrollments").select("id,full_name,email,phone,sheet_row,student_info,student_id,certificate_no,certificate_revoked_at").eq("id", Number(body.id)).maybeSingle()).data;
      if (!e) return json({ error: "Student not found." }, 404);
      const reg = fromRegistration(await loadDetails(db, e));
      const hist = (await db.from("enrollment_audit").select("kind,reason,old_values,new_values,changed_at,changed_by,payment_id").eq("enrollment_id", e.id).order("changed_at", { ascending: false }).limit(30)).data || [];
      const ids = [...new Set(hist.map((h: any) => h.changed_by).filter(Boolean))];
      const names = new Map(((ids.length ? (await db.from("profiles").select("id,username,full_name").in("id", ids)).data : []) || []).map((p: any) => [p.id, p.full_name || p.username || "Admin"]));
      const raw = { ok: true, fields: INFO_FIELDS.map((f) => ({ key: f, label: infoLabel(f) })), registration: reg, has_registration: Object.values(reg).some(Boolean), overrides: e.student_info || {}, effective: effective(reg, e.student_info, e), login_email: e.email, has_certificate: !!(e.certificate_no && !e.certificate_revoked_at), history: hist.map((h: any) => ({ ...h, changed_by: names.get(h.changed_by) || "Admin" })) };
      if (role === "staff") {
        const see = !!(perms && perms.see_contacts);
        await logActivity(db, u.user.id, e.id, "info_viewed", see ? "Student details viewed (contacts shown)" : "Student details viewed", { see_contacts: see });
      }
      return json(shapeStudentInfoGet(raw, role, perms));
    }
    if (body.action === "student_info_save") {
      const e = (await db.from("enrollments").select("id,full_name,email,phone,sheet_row,student_info,student_id,invoice_no,certificate_no,certificate_revoked_at").eq("id", Number(body.id)).maybeSingle()).data;
      if (!e) return json({ error: "Student not found." }, 404);
      const blocked = staffInfoSaveError(body, role, e.email);
      if (blocked) return json({ error: blocked }, 403);
      const reg = fromRegistration(await loadDetails(db, e));
      // Staff: merge only allowed keys into the current overrides so a name fix cannot wipe CNIC/DOB/address.
      // Admin: the form posts every field, so cleanOverrides still replaces the whole object.
      const c = role === "staff"
        ? mergeStaffStudentInfo(e.student_info, body.info && typeof body.info === "object" ? body.info : {}, { seeContacts: !!(perms && perms.see_contacts) }, reg, e)
        : cleanOverrides(body.info && typeof body.info === "object" ? body.info : {}, reg, e);
      if (c.error) return json({ error: c.error }, c.error.startsWith("You cannot change") ? 403 : 400);
      const before = effective(reg, e.student_info, e);
      if (JSON.stringify(e.student_info || null) === JSON.stringify(c.info) && !Object.keys(infoDiff(before, effective(reg, c.info, savedRow(e, c.info, {}))).new).length) return json({ ok: true, unchanged: true });
      const patch: Record<string, unknown> = { student_info: c.info };
      // Name and mobile also live on the enrollment (certificates, emails, WhatsApp button). The login email never changes here.
      // Clearing an override puts back the registration form value (or, without one, the value from before the first edit).
      const prevOver = (e.student_info || {}) as Record<string, string>;
      const before1 = async (k: string) => {
        const h = (await db.from("enrollment_audit").select("old_values,new_values").eq("enrollment_id", e.id).eq("kind", "student_info").order("changed_at", { ascending: true }).limit(50)).data || [];
        const first = h.find((x: any) => x.new_values && k in x.new_values); return first ? String(first.old_values?.[k] || "") : "";
      };
      if (c.info?.full_name) { if (c.info.full_name !== e.full_name) patch.full_name = c.info.full_name; }
      else if (prevOver.full_name) { const back = reg.full_name || await before1("full_name"); if (back && back !== e.full_name) patch.full_name = back; }
      if (c.info?.phone) { if (c.info.phone !== e.phone) patch.phone = c.info.phone; }
      else if (prevOver.phone) { const back = reg.phone || await before1("phone"); if ((back || null) !== (e.phone || null)) patch.phone = back || null; }
      // What the documents show now, including a name or mobile put back when its override was cleared (audit + response).
      const after = effective(reg, c.info, savedRow(e, c.info, patch));
      const ch = infoDiff(before, after);
      // The certificate shows the name: drop the cached image so the image and PDF are made again with the new name.
      const certRedo = !!(patch.full_name && e.certificate_no && !e.certificate_revoked_at);
      if (certRedo) patch.certificate_file = null;
      // Optimistic lock on the student_info we read: a concurrent save must not silently overwrite (staff and admin).
      let uq = db.from("enrollments").update(patch).eq("id", e.id);
      uq = e.student_info == null ? uq.is("student_info", null) : uq.eq("student_info", e.student_info);
      const up = await uq.select("id").maybeSingle();
      if (studentInfoWriteConflict(up)) return json({ error: STUDENT_INFO_CONFLICT, code: "conflict" }, 409);
      if (up.error || !up.data) return json({ error: up.error?.message || "Could not save." }, 400);
      await db.from("enrollment_audit").insert({ enrollment_id: e.id, kind: "student_info", reason: String(body.reason || "").trim().slice(0, 300) || null, old_values: ch.old, new_values: ch.new, changed_by: u.user.id });
      pingSheets();
      return json(shapeStudentInfoSave({ ok: true, changed: Object.keys(ch.new), effective: after, regen: !!e.invoice_no || certRedo, certificate: certRedo }, role, perms));
    }
    if (body.action === "regen_docs") {
      // Rebuilds ONE document per call (CPU limit): admission form first, then each counted payment's receipt. The page calls again with done[] until remaining is 0.
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", Number(body.id)).maybeSingle()).data;
      if (!e || !e.invoice_no) return json({ error: "Documents are created when you click Payment received." }, 400);
      const pays = livePays(((await db.from("payments").select("*").eq("enrollment_id", e.id)).data || []) as Pay[]);
      const targets = [...(body.receipts_only ? [] : ["admission"]), ...pays.map((p) => "receipt:" + p.invoice_no), ...(!body.receipts_only && e.certificate_no && !e.certificate_revoked_at && !e.certificate_file ? ["certificate"] : [])];
      const done = new Set((Array.isArray(body.done) ? body.done : []).map(String));
      const t = targets.find((x) => !done.has(x));
      if (!t) return json({ ok: true, remaining: 0 });
      try {
        if (t === "admission") await buildOne(db, e, "admission");
        else if (t === "certificate") await certificatePdfUrls(db, (await db.from("enrollments").select(CERT_SEL).eq("id", e.id).maybeSingle()).data);
        else {
          const inv = t.slice(8); let before = 0, p: any = null;
          for (const x of pays) { if (x.invoice_no === inv) { p = x; break; } before += Number(x.amount) || 0; }
          if (p.invoice_no === e.invoice_no) await buildOne(db, e, "receipt"); else await buildPaymentReceipt(db, e, p, before);
        }
      } catch (x) { return json({ error: "Could not create " + (t === "admission" ? "the admission form" : t === "certificate" ? "the certificate" : "receipt " + t.slice(8)) + ": " + String((x as Error).message || x).slice(0, 200) }, 500); }
      return json({ ok: true, built: t, remaining: targets.filter((x) => !done.has(x)).length - 1 });
    }
    if (body.action === "payment_correct") {
      // Admin: fix or void a payment entered by mistake. Same invoice number; the receipt is re-issued as "Revised" (INV-…-R<n>.pdf, the old PDF is kept).
      const id = Number(body.id), pid = Number(body.payment_id);
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data;
      if (!e || !e.invoice_no || !["active", "expired"].includes(e.status)) return json({ error: "Only paid (active) students have payments to correct." }, 400);
      const all = ((await db.from("payments").select("*").eq("enrollment_id", id).order("installment_no")).data || []) as any[];
      const p = all.find((x) => x.id === pid);
      if (!p) return json({ error: "Payment not found." }, 404);
      if (p.voided_at) return json({ error: "This payment is already void." }, 400);
      const c = checkCorrection(body, todayPk());
      if (c.error) return json({ error: c.error }, 400);
      const meth = c.void ? p.method : body.method === undefined ? p.method : payMethod(body.method);
      if (!c.void && c.amount === Number(p.amount) && c.paid_on === String(p.paid_on || "").slice(0, 10) && (meth || null) === (p.method || null)) return json({ error: "Nothing changed. Edit the amount, date or method, or void the payment." }, 400);
      const nowIso = new Date().toISOString();
      const next = all.map((x) => x.id === pid ? { ...x, amount: c.void ? x.amount : c.amount, paid_on: c.void ? x.paid_on : c.paid_on, voided_at: c.void ? nowIso : null } : x);
      const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
      const rc = recompute(next, plan, e.fee_total, planCount(e));
      if (rc.error) return json({ error: rc.error + " Check the amount." }, 400);
      const oldPaid = Number(e.amount_paid) || 0, fee = Number(e.fee_total) || 0;
      // 1) the payment itself. Optimistic lock on revision: if anyone corrected this payment meanwhile, nothing is written.
      //    The revision goes up for a void too, so the receipt is re-issued with the VOID stamp (INV-…-R<n>.pdf) and the old file is no longer served.
      //    The student's paid total is kept by the database (trigger payments_sync_amount_paid = sum of non-voided payments).
      const rev = Number(p.revision) || 0;
      const pp: Record<string, unknown> = c.void ? { voided_at: nowIso, void_reason: c.reason, revision: rev + 1, receipt_file: null } : { amount: c.amount, paid_on: c.paid_on, method: meth, revision: rev + 1, receipt_file: null };
      const u1 = await db.from("payments").update(pp).eq("id", pid).eq("revision", rev).is("voided_at", null).select("id").maybeSingle();
      if (u1.error) {
        // payments_refund_guard (migration 20261125140000): the payment can't drop below the live refunds
        if (isRefundGuard(u1.error)) return json({ error: "This payment has refunds against it. Void the refund first.", code: "refund_guard" }, 409);
        return json({ error: "Could not update the payment: " + u1.error.message }, 500);
      }
      if (!u1.data) return json({ error: "This payment was changed by someone else just now. Reload the page and check it before correcting again." }, 409);
      // 2) re-read what the database now holds (another payment may have landed at the same moment)
      const now = (await db.from("enrollments").select("amount_paid,due_date,reminder_stage").eq("id", id).maybeSingle()).data;
      const sumNow = (((await db.from("payments").select("amount,voided_at").eq("enrollment_id", id)).data || []) as any[]).filter((x) => !x.voided_at).reduce((t, x) => t + (Number(x.amount) || 0), 0);
      const paidNow = Number(now?.amount_paid ?? sumNow) || 0;
      const warnings: string[] = [];
      if (paidNow !== rc.paid) warnings.push(`Another payment was saved for this student at the same moment: the paid total is now ${pkr(paidNow)} (not ${pkr(rc.paid)}). Reload and check.`);
      if (paidNow !== sumNow) warnings.push(`The paid total (${pkr(paidNow)}) does not match the payments (${pkr(sumNow)}). Reload and check before doing anything else.`);
      if (fee && sumNow > fee) warnings.push(`The payments now add up to ${pkr(sumNow)}, more than the fee of ${pkr(fee)}.`);
      const due = plan ? planDue(plan, paidNow) : fee && paidNow >= fee ? null : (now?.due_date ? String(now.due_date).slice(0, 10) : null);
      const fin = !!fee && paidNow >= fee, oldDue = now?.due_date ? String(now.due_date).slice(0, 10) : null;
      const w = await db.from("enrollments").update({ due_date: due, reminder_stage: fin ? 3 : due === oldDue ? (now?.reminder_stage || 0) : 0, ...(p.invoice_no === e.invoice_no ? { receipt_file: null } : {}) }).eq("id", id).select("id").maybeSingle();
      if (w.error) warnings.push("The due date could not be updated: " + w.error.message);
      // 3) later receipts show "paid earlier" and the balance, so they are re-issued too (labels recomputed)
      for (const r of rc.rows) {
        const x = all.find((y) => y.id === r.id); if (!x || x.id === pid) continue;
        const later = x.installment_no > p.installment_no;
        const lab = (r.label || null) !== (x.installment_label || null) || r.is_final !== !!x.is_final;
        if (!later && !lab) continue;
        await db.from("payments").update({ installment_label: r.label, is_final: r.is_final, installments: r.installments, revision: (Number(x.revision) || 0) + 1, receipt_file: null }).eq("id", x.id).eq("revision", Number(x.revision) || 0);
        if (x.invoice_no === e.invoice_no) await db.from("enrollments").update({ receipt_file: null }).eq("id", id);
      }
      const mine = rc.rows.find((r) => r.id === pid);
      if (mine) await db.from("payments").update({ installment_label: mine.label, is_final: mine.is_final, installments: mine.installments }).eq("id", pid);
      await db.from("enrollment_audit").insert({ enrollment_id: id, payment_id: pid, kind: c.void ? "payment_void" : "payment_correct", reason: c.reason,
        old_values: { invoice_no: p.invoice_no, amount: p.amount, paid_on: String(p.paid_on || "").slice(0, 10), method: p.method, student_paid_total: oldPaid },
        new_values: c.void ? { invoice_no: p.invoice_no, voided: true, student_paid_total: paidNow, receipt_revision: rev + 1 } : { invoice_no: p.invoice_no, amount: c.amount, paid_on: c.paid_on, method: meth, student_paid_total: paidNow, receipt_revision: rev + 1 },
        changed_by: u.user.id });
      pingSheets();
      return json({ ok: true, amount_paid: paidNow, balance_due: Math.max(fee - paidNow, 0), status: payStatus(fee, paidNow), due_date: due, regen: true, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
    }
    if (body.action === "wa_links") {
      // Admin: download links for the WhatsApp message. wa.me can't attach files, so these are signed links that stop working after WA_LINK_HOURS.
      // File names carry only the document number (no student name), in case a link is forwarded.
      const id = Number(body.id), want = (Array.isArray(body.items) ? body.items : []).map(String);
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data;
      if (!e || !e.invoice_no) return json({ error: "Documents are created when you click Payment received." }, 400);
      const ttl = WA_LINK_HOURS * 3600, links: any[] = [];
      const sign = async (bucket: string, path: string, name: string) => (await db.storage.from(bucket).createSignedUrl(path, ttl, { download: name })).data?.signedUrl || null;
      if (want.includes("admission")) {
        if (!e.admission_file) { await buildOne(db, e, "admission"); return json({ retry: true, built: "admission" }); }
        links.push({ kind: "admission", label: "Admission form", url: await sign("documents", e.admission_file, `${e.student_id}_Admission_Form.pdf`) });
      }
      if (want.includes("receipt")) {
        const pays = livePays(((await db.from("payments").select("*").eq("enrollment_id", id)).data || []) as Pay[]);
        const p: any = pays[pays.length - 1];
        let f = p ? p.receipt_file || (p.invoice_no === e.invoice_no ? e.receipt_file : null) : e.receipt_file;
        if (!f) { if (p) { let before = 0; for (const x of pays) { if (x.id === p.id) break; before += Number(x.amount) || 0; } if (p.invoice_no === e.invoice_no) await buildOne(db, e, "receipt"); else await buildPaymentReceipt(db, e, p, before); } else await buildOne(db, e, "receipt"); return json({ retry: true, built: "receipt" }); }
        const inv = p?.invoice_no || e.invoice_no;
        links.push({ kind: "receipt", label: "Fee receipt " + inv, url: await sign("documents", f, `${inv}_Fee_Receipt.pdf`) });
      }
      if (want.includes("certificate")) {
        if (!e.certificate_no || e.certificate_revoked_at) return json({ error: "No valid certificate has been issued yet." }, 400);
        const c = (await db.from("enrollments").select(CERT_SEL).eq("id", id).maybeSingle()).data;
        await certificatePdfUrls(db, c); // makes sure the PDF exists
        links.push({ kind: "certificate", label: "Certificate " + e.certificate_no, url: await sign("certificates", `${e.certificate_no}.pdf`, `${e.certificate_no}_Certificate.pdf`) });
      }
      if (links.some((l) => !l.url)) return json({ error: "Could not create a download link. Try again." }, 500);
      const exp = new Date(Date.now() + ttl * 1000 + 5 * 3600e3).toISOString().slice(0, 10);
      return json({ ok: true, links, expires: fmt(exp), hours: WA_LINK_HOURS, portal: "https://www.deutschfuralle.com/portal.html" });
    }
    if (body.action === "set_due") {
      const d = String(body.due_date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "Pick a date." }, 400);
      await db.from("enrollments").update({ due_date: d, reminder_stage: 0 }).eq("id", Number(body.id));
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "Server error: " + String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
