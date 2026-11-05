import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { confirmation, welcome, reminder, docsMail, receiptMail, type FeeInfo } from "./templates.ts";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { certificateUrls, certificatePdfUrls } from "./render.ts";
import { buildOne, signed, buildPaymentReceipt, fileBytes, docData, warmDocAssets } from "./docs.ts";
const CERT_SEL = "id,full_name,course_label,start_date,end_date,status,student_id,batch_code,certificate_no,certificate_code,certificate_issued_at,certificate_revoked_at,certificate_file,courses(name,level,duration_days)";
async function imagesOn(db: any) { const { data } = await db.from("site_settings").select("value").eq("key", "certificate_images_public").maybeSingle(); return data?.value === "on"; }
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
let CUR: any = null; // service-role client of the current request
async function sendingOn() {
  if (!env("ADMISSION_SMTP_PASS")) return false;
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
function feeInfo(e: any): FeeInfo {
  return { name: e.full_name || "", studentId: e.student_id || "–", course: e.courses?.name || e.course_label || "your course", batch: e.batch_code || "", total: pkr(e.fee_total), paid: pkr(e.amount_paid), balance: pkr(e.balance_due), due: e.due_date ? fmt(e.due_date) : "on request" };
}
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
async function logMail(db: any, e: any, kind: string, items: string[], status: string, by: string | null, error?: string) {
  await db.from("email_log").insert({ enrollment_id: e.id, kind, items, to_email: e.email, status, error: error ? error.slice(0, 300) : null, sent_by: by });
  if (status === "sent") await db.from("enrollments").update({ last_docs_sent_at: new Date().toISOString(), last_docs_sent_items: items.join(", ") }).eq("id", e.id);
}
/** Signed URL for one installment receipt (builds it if missing). */
async function receiptByInv(db: any, e: any, inv: string) {
  const pays = (await db.from("payments").select("*").eq("enrollment_id", e.id).order("installment_no")).data || [];
  let before = 0, p: any = null;
  for (const x of pays) { if (x.invoice_no === inv) { p = x; break; } before += Number(x.amount) || 0; }
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
    for (const p of pays.length ? pays : [{ invoice_no: e.invoice_no, receipt_file: e.receipt_file }]) {
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
  const m = names.length ? docsMail(e.full_name, e.courses?.name || e.course_label || "course", names, rem ? feeInfo(e) : null) : reminder(0, feeInfo(e));
  const items = [...want.filter((w) => ["admission", "receipt", "certificate"].includes(w)), ...(rem ? ["reminder"] : [])];
  try { const r = await send(e.email, m.subject, m.text, att); await logMail(db, e, "resend", items, r, by); return { ok: true, email: r, items, sent_at: new Date().toISOString() }; }
  catch (x) { await logMail(db, e, "resend", items, "error", by, String((x as Error).message || x)); return { error: "Sending failed: " + String((x as Error).message || x), code: 500 }; }
}
/** Daily: reminders 3 days before, on, and 3 days after the due date (then stop). */
async function runReminders(db: any) {
  if (!(await sendingOn())) return { off: true };
  const t = todayPk(), out: any[] = [];
  const rows = (await db.from("enrollments").select(ENR_SEL).in("status", ["active"]).gt("balance_due", 0).not("due_date", "is", null).lt("reminder_stage", 3)).data || [];
  for (const e of rows) {
    const due = String(e.due_date).slice(0, 10);
    const stage = t >= addD(due, 3) ? 3 : t >= due ? 2 : t >= addD(due, -3) ? 1 : 0;
    if (!stage || stage <= e.reminder_stage) continue;
    const m = reminder(stage, feeInfo(e));
    try { const r = await send(e.email, m.subject, m.text, [await qrAttachment(db)]); await logMail(db, e, "reminder-" + stage, ["reminder"], r, null); if (r === "sent") await db.from("enrollments").update({ reminder_stage: stage }).eq("id", e.id); out.push({ id: e.id, stage, r }); }
    catch (x) { await logMail(db, e, "reminder-" + stage, ["reminder"], "error", null, String((x as Error).message || x)); out.push({ id: e.id, stage, error: true }); }
  }
  return { ok: true, today: t, sent: out };
}
async function send(to: string, subject: string, text: string, attachments: { filename: string; content: Uint8Array; contentType: string }[] = []) {
  if (!(await sendingOn())) return "off";
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env("ADMISSION_SMTP_USER") || "admission.deutschfuralle@gmail.com", pass: env("ADMISSION_SMTP_PASS") } });
  await t.sendMail({ from: `"Deutsch Für Alle Admissions" <${env("ADMISSION_SMTP_USER") || "admission.deutschfuralle@gmail.com"}>`, to, subject, text, attachments: attachments.map((a) => ({ ...a, content: a.content })) });
  return "sent";
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
    const m = welcome(e.full_name, e.courses?.name || e.course_label || "your course", fmt(e.start_date), fmt(e.end_date), { fee: String(d.feeText).replace(/ \(.*$/, ""), studentId: e.student_id, invoiceNo: e.invoice_no, batch: e.batch_code, courseEnd: d.end, paid: pkr(e.amount_paid), balance: e.balance_due > 0 ? pkr(e.balance_due) : "", due: e.due_date ? fmt(e.due_date) : "the date we agreed" });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  CUR = db;
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  try {
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
      const ins = await db.from("enrollments").upsert({ email, full_name: name || null, course_code: code, course_label: label, receipt_url: receipt, sheet_row: Number(body.sheet_row) > 1 ? Math.floor(Number(body.sheet_row)) : null, source: "form", source_ref: String(body.ref || "").slice(0, 120) || null }, { onConflict: "source_ref", ignoreDuplicates: true }).select("id,confirmation_sent_at,student_id,batch_code").maybeSingle();
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
      if (body.action === "status") return json({ sending: (await sendingOn()) ? "on" : "off", smtp: !!env("ADMISSION_SMTP_PASS") });
      if (body.action === "render_test") { const e = (await db.from("enrollments").select(ENR_SEL).eq("id", Number(body.id)).maybeSingle()).data; const t0 = Date.now(); const r = await buildOne(db, e, body.kind === "receipt" ? "receipt" : "admission", true); return json({ ok: true, ms: Date.now() - t0, bytes: r.bytes.length }); }
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
      if (body.action === "settings_get") { const se = (await db.from("site_settings").select("value").eq("key", "send_emails").maybeSingle()).data; return json({ certificates: await imagesOn(db), emails: se?.value === "on", smtp: !!env("ADMISSION_SMTP_PASS"), forced: env("SEND_EMAILS") || null }); }
      if (body.action === "cleanup_doc_jobs") return json(await cleanupDocJobs(db, Number(body.days) > 0 ? Number(body.days) : 30));
      if (body.action === "put_internal_file") {
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
      return json({ ok: true, name: e.full_name, ...(await signed(db, kind === "receipt" ? e.receipt_file : e.admission_file, docName(e, kind))) });
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
    if (p?.role !== "admin") return json({ error: "forbidden" }, 403);
    {
      // Security: admin actions need a confirmed sign-in (device/email check) and the 2FA code when an authenticator app is set up.
      const tk = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      let cl: any = {}; try { let x = tk.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "="; cl = JSON.parse(atob(x)); } catch (_) { cl = {}; }
      const totp = ((u.user as any).factors || []).some((f: any) => f.status === "verified");
      if (totp && cl.aal !== "aal2") return json({ error: "Please enter your two-step verification code (reload the page).", code: "aal2" }, 403);
      const vs = cl.session_id ? (await db.from("verified_sessions").select("session_id").eq("session_id", cl.session_id).maybeSingle()).data : null;
      if (!vs) return json({ error: "Please confirm this sign-in first: reload the page and enter the code we emailed you.", code: "verify_session" }, 403);
    }
    if (body.action === "activate") {
      const id = Number(body.id);
      const patch: Record<string, unknown> = { status: "active", activated_by: u.user.id };
      if (body.course_code) patch.course_code = String(body.course_code);
      if (body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) patch.start_date = body.start_date;
      const pre = (await db.from("enrollments").select("course_code,receipt_url").eq("id", id).maybeSingle()).data;
      const cc = (await db.from("courses").select("fee_pkr").eq("code", String(body.course_code || pre?.course_code || "")).maybeSingle()).data;
      const total = Math.round(Number(body.fee_total)) > 0 ? Math.round(Number(body.fee_total)) : Number(cc?.fee_pkr) || 0;
      const two = body.plan === "two";
      let first = two ? (Math.round(Number(body.first_amount)) > 0 ? Math.round(Number(body.first_amount)) : Math.ceil(total / 2)) : total;
      if (total && first > total) first = total;
      patch.fee_total = total || null; patch.amount_paid = first; patch.payment_plan = two ? "two" : "full"; patch.reminder_stage = 0;
      const up = await db.from("enrollments").update(patch).eq("id", id).eq("status", "pending").select("*,courses(name)").maybeSingle();
      if (up.error) return json({ error: up.error.message }, 400);
      if (!up.data) return json({ error: "Not found or not pending" }, 404);
      let due: string | null = null;
      if (first < total) { due = body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : (up.data.start_date && up.data.end_date ? addD(up.data.start_date, Math.round(((Date.parse(up.data.end_date) - Date.parse(up.data.start_date)) / 864e5 - 15) / 2)) : null); }
      await db.from("enrollments").update({ activated_by: u.user.id, due_date: due }).eq("id", id);
      if (first > 0) {
        const existing = (await db.from("payments").select("id").eq("enrollment_id", id).eq("installment_no", 1).maybeSingle()).data;
        if (!existing) {
          const ins = await db.from("payments").insert({ enrollment_id: id, amount: first, paid_on: todayPk(), proof_url: pre?.receipt_url || null, invoice_no: up.data.invoice_no, installment_no: 1, installments: two ? 2 : 1, is_final: first >= total, created_by: u.user.id });
          if (ins.error && !/duplicate|unique/i.test(ins.error.message || "")) return json({ error: ins.error.message }, 400);
        }
      }
      const e = (await db.from("enrollments").select(ENR_SEL).eq("id", id).maybeSingle()).data || up.data;
      await enqueueDocJobs(db, id);
      // Warm WASM/fonts in the background so the first build_doc is less likely to hit the CPU limit on a cold isolate.
      try { EdgeRuntime.waitUntil(warmDocAssets()); } catch (_) { /* older runtimes */ }
      // Documents + welcome are processed in separate requests (process_docs / build_doc) to stay inside the 2s CPU limit.
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
      const m = welcome(e.full_name, e.courses?.name || e.course_label || "your course", fmt(e.start_date), fmt(e.end_date), { fee: String(d.feeText).replace(/ \(.*$/, ""), studentId: e.student_id, invoiceNo: e.invoice_no, batch: e.batch_code, courseEnd: d.end, paid: pkr(e.amount_paid), balance: e.balance_due > 0 ? pkr(e.balance_due) : "", due: e.due_date ? fmt(e.due_date) : "the date we agreed" });
      const att = [{ filename: `DFA Confirmation of Registration ${e.student_id}.pdf`, content: await fileBytes(db, "documents", e.admission_file), contentType: "application/pdf" }, { filename: `DFA Fee Receipt ${e.invoice_no}.pdf`, content: await fileBytes(db, "documents", e.receipt_file), contentType: "application/pdf" }];
      let r = "off"; try { r = await send(e.email, m.subject, m.text, att); } catch (x) { await logMail(db, e, "welcome", ["admission", "receipt"], "error", u.user.id, String((x as Error).message || x)); return json({ error: "Sending failed: " + String((x as Error).message || x) }, 500); }
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
      return json({ ok: true, name: e.full_name, ...(await signed(db, kind === "receipt" ? e.receipt_file : e.admission_file, docName(e, kind))) });
    }
    if (body.action === "cert_file_admin") {
      // Admin preview works even before images are switched on for students.
      const { data: e } = await db.from("enrollments").select(CERT_SEL).eq("id", Number(body.id)).maybeSingle();
      if (!e || !e.certificate_no) return json({ error: "No certificate yet" }, 404);
      try { return json({ ok: true, ...(body.fmt === "pdf" ? await certificatePdfUrls(db, e) : await certificateUrls(db, e)), public: await imagesOn(db), code: e.certificate_code, no: e.certificate_no, name: e.full_name }); } catch (x) { return json({ error: "Could not create the certificate image: " + String((x as Error).message || x) }, 500); }
    }
    if (body.action === "cert_images_status") return json({ public: await imagesOn(db) });
    if (body.action === "settings_get") { const se = (await db.from("site_settings").select("value").eq("key", "send_emails").maybeSingle()).data; return json({ certificates: await imagesOn(db), emails: se?.value === "on", smtp: !!env("ADMISSION_SMTP_PASS"), forced: env("SEND_EMAILS") || null }); }
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
    if (body.action === "docs_status") return json(await docsStatus(db, Number(body.id)));
    if (body.action === "process_docs") {
      const id = Number(body.id);
      await enqueueDocJobs(db, id);
      const r: any = await processNextDocJob(db, id, u.user.id);
      return json(r, r.code || 200);
    }
    if (body.action === "resend") { const r: any = await resendDocs(db, Number(body.id), Array.isArray(body.items) ? body.items.map(String) : [], u.user.id); return json(r, r.code || 200); }
    if (body.action === "email_log") {
      const r = await db.from("email_log").select("kind,items,status,created_at,error").eq("enrollment_id", Number(body.id)).order("created_at", { ascending: false }).limit(20);
      return json({ log: r.data || [] });
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
      const before = Number(e.amount_paid) || 0, after = before + amount, fin = !e.fee_total || after >= e.fee_total;
      const ins = await db.from("payments").insert({ enrollment_id: id, amount, paid_on: paidOn, proof_url: proof, installment_no: n, installments: Math.max(e.payment_plan === "two" ? 2 : 1, n), is_final: fin, created_by: u.user.id }).select("*").single();
      if (ins.error) return json({ error: ins.error.message }, 400);
      await db.from("enrollments").update({ amount_paid: after, reminder_stage: fin ? 3 : 0 }).eq("id", id);
      e.amount_paid = after; e.balance_due = Math.max((e.fee_total || 0) - after, 0);
      let rc: any = null; try { rc = await buildPaymentReceipt(db, e, ins.data, before); } catch (x) { return json({ ok: true, payment: ins.data, warning: "Payment saved, but the receipt could not be created: " + String((x as Error).message || x) }); }
      let mail = "not sent";
      if (body.email !== false) {
        const m = receiptMail(e.full_name, e.courses?.name || e.course_label || "course", pkr(amount), ins.data.invoice_no, e.balance_due > 0 ? pkr(e.balance_due) : "", e.due_date ? fmt(e.due_date) : "");
        try { mail = await send(e.email, m.subject, m.text, [{ filename: `DFA Fee Receipt ${ins.data.invoice_no}.pdf`, content: rc.receipt, contentType: "application/pdf" }]); await logMail(db, e, "payment", ["receipt"], mail, u.user.id); }
        catch (x) { mail = "error"; await logMail(db, e, "payment", ["receipt"], "error", u.user.id, String((x as Error).message || x)); }
      }
      return json({ ok: true, payment: ins.data, balance_due: e.balance_due, email: mail });
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
