// Admin portal upgrade (WD-3): actions behind the "pro_" prefix, plus the activity log writer used by index.ts.
// Every caller is already signed in, confirmed and admin/staff (index.ts checks that and allowed() before calling).
import { cleanRef, applyDiscount, undoDiscount, planDue, parseOffsets, offsetsError, nextReminder, isPaused, proofPath, proofPathOk, PROOF_TYPES, PROOF_MAX, dashboard, staffRow, staffPay, addStudentRow, searchOr, confirmOk, sameJson, STAFF_MAIL_ERR, STAFF_ENR_COLS, STAFF_PAY_COLS, allowed, denyMessage, PERM_KEYS, parsePerms, emptyPerms, type Role, type StaffPerms } from "./prologic.ts";
import { method as payMethod, type Inst } from "./plan.ts";
import { testConfirmOk, testConfirmWord, expectSidOk, actorLabel, activityKind, proofBytesOk, PROOF_MIN, adjustmentMail } from "./prologic.ts";

type Ctx = { json: (b: unknown, s?: number) => Response; today: () => string; pingSheets?: () => void; perms?: StaffPerms | null };
const pkr = (n: number) => "PKR " + Number(n || 0).toLocaleString("en-US");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function actorName(db: any, uid: string | null): Promise<string | null> {
  if (!uid) return null;
  const p = (await db.from("profiles").select("full_name,username").eq("id", uid).maybeSingle()).data;
  return actorLabel(p);
}
/** Sends one plain email and writes it to email_log (index.ts sets this once; tests can set a fake). */
export type Mailer = (db: any, e: { id: number; email: string }, kind: string, items: string[], subject: string, text: string, by: string | null) => Promise<{ status: string; error?: string }>;
let MAILER: Mailer | null = null;
export function setMailer(m: Mailer | null) { MAILER = m; }
/** Writes one activity row. Never throws (the action itself already succeeded). */
export async function logActivity(db: any, uid: string | null, enrollmentId: number | null, action: string, summary: string, details: Record<string, unknown> = {}) {
  try { await db.from("admin_activity").insert({ enrollment_id: enrollmentId || null, actor: uid, actor_name: await actorName(db, uid), action, summary: summary.slice(0, 500), details }); } catch (_) { /* best effort */ }
}
/** Maps errors from fee_adjust_apply / fee_adjust_void to plain messages (no SQL text). */
function adjErr(json: Ctx["json"], e: { code?: string; message?: string }): Response {
  const m = String(e?.message || "");
  if (e?.code === "40001" || /changed meanwhile/.test(m)) return json({ error: "A payment or fee change was just saved. Reload and try again." }, 409);
  if (/already void/.test(m)) return json({ error: "Already void." }, 409);
  if (e?.code === "23514" && /^DFA: /.test(m)) return json({ error: m.replace(/^DFA: /, "") }, 400);
  if (e?.code === "P0002") return json({ error: "Not found." }, 404);
  return json({ error: "Could not save. Try again." }, 400);
}
async function metaOf(db: any, ids: number[]): Promise<Map<number, any>> {
  if (!ids.length) return new Map();
  const r = (await db.from("student_meta").select("*").in("enrollment_id", ids)).data || [];
  return new Map<number, any>(r.map((m: any) => [m.enrollment_id, m]));
}
async function testIds(db: any): Promise<Set<number>> {
  return new Set(((await db.from("student_meta").select("enrollment_id").eq("is_test", true)).data || []).map((m: any) => m.enrollment_id));
}

export async function handlePro(db: any, body: any, user: { id: string; email?: string }, role: Role, ctx: Ctx): Promise<Response | null> {
  const { json } = ctx, a = String(body.action || ""), uid = user.id;
  if (!a.startsWith("pro_")) return null;
  const id = Number(body.id);
  // QA2: the browser sends the Student ID shown on the card; a card that re-rendered under the cursor can't change someone else
  if (id > 0 && body.expect_sid) {
    const ck = (await db.from("enrollments").select("student_id").eq("id", id).maybeSingle()).data;
    if (!expectSidOk(ck, body.expect_sid)) return json({ error: "The list changed under your click. Nothing was changed. Reload and try again.", code: "stale" }, 409);
  }

  // ---- dashboard -------------------------------------------------------------------------------
  if (a === "pro_dashboard") {
    if (role === "staff" && !allowed("staff", "pro_dashboard", ctx.perms)) return json({ error: denyMessage("pro_dashboard", ctx.perms) }, 403);
    const t = ctx.today(), [y, m] = t.split("-").map(Number), from = new Date(Date.UTC(y, m - 7, 1)).toISOString().slice(0, 10);
    const [enr, pays, adjs, tests] = await Promise.all([
      db.from("enrollments").select("id,full_name,student_id,batch_code,phone,email,status,fee_total,amount_paid,balance_due,due_date,created_at,installment_plan").limit(5000),
      db.from("payments").select("*").gte("paid_on", from).limit(20000),
      db.from("fee_adjustments").select("enrollment_id,kind,amount,adj_date,voided_at").limit(5000),
      testIds(db),
    ]);
    if (enr.error) return json({ error: enr.error.message }, 500);
    const out = dashboard({ today: t, enr: enr.data || [], pays: pays.data || [], adjs: adjs.data || [], testIds: tests });
    const by = new Map((enr.data || []).map((e: any) => [e.id, e]));
    const pick = (e: any) => ({ id: e.id, name: e.full_name, student_id: e.student_id, batch: e.batch_code, balance: e.balance_due, due: e.due_date, has_phone: !!e.phone, plan: e.installment_plan });
    return json({ ok: true, today: t, ...out, overdue: out.overdue.map((x) => ({ ...pick(by.get(x.id)), days: x.days })), soon: out.soon.map((x) => pick(by.get(x.id))), tests: tests.size });
  }

  // ---- activity log (per student or global) -----------------------------------------------------
  if (a === "pro_activity") {
    const lim = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
    let q = db.from("admin_activity").select("id,enrollment_id,actor,actor_name,action,summary,details,created_at").order("created_at", { ascending: false }).limit(lim);
    if (id) q = q.eq("enrollment_id", id); else if (role !== "admin") q = q.or("enrollment_id.not.is.null,action.eq.attendance_saved");
    if (body.before && !isNaN(Date.parse(body.before))) q = q.lt("created_at", body.before);
    if (body.from && ISO.test(body.from)) q = q.gte("created_at", body.from + "T00:00:00+05:00");
    if (body.to && ISO.test(body.to)) q = q.lte("created_at", body.to + "T23:59:59+05:00");
    const kf = activityKind(body.kind);
    if (kf?.in) q = q.in("action", kf.in); else if (kf?.like) q = q.like("action", kf.like);
    const r = await q; if (r.error) return json({ error: r.error.message }, 500);
    let rows = (r.data || []).map((x: any) => ({ ...x, source: "activity" }));
    // student-details edits and payment corrections (enrollment_audit, from PR #11) are part of the same story
    if (!body.kind || /^(student_info|payment)/.test(String(body.kind))) {
      let aq = db.from("enrollment_audit").select("id,enrollment_id,kind,reason,old_values,new_values,changed_by,changed_at").order("changed_at", { ascending: false }).limit(lim);
      if (id) aq = aq.eq("enrollment_id", id);
      if (body.before && !isNaN(Date.parse(body.before))) aq = aq.lt("changed_at", body.before);
      const au = await aq;
      if (!au.error) {
        const ids = [...new Set((au.data || []).map((h: any) => h.changed_by).filter(Boolean))];
        const names = new Map(((ids.length ? (await db.from("profiles").select("id,full_name,username").in("id", ids)).data : []) || []).map((p: any) => [p.id, actorLabel(p)]));
        const lbl: Record<string, string> = { student_info: "Student details changed", payment_correct: "Payment corrected", payment_void: "Payment voided" };
        rows = rows.concat((au.data || []).map((h: any) => ({ id: "a" + h.id, enrollment_id: h.enrollment_id, actor_name: names.get(h.changed_by) || null, action: h.kind, summary: (lbl[h.kind] || h.kind) + ": " + (role === "admin" ? Object.keys(h.new_values || {}).map((k) => `${k} ${JSON.stringify((h.old_values || {})[k] ?? "")} → ${JSON.stringify(h.new_values[k])}`).join(", ") : Object.keys(h.new_values || {}).join(", ")).slice(0, 300) + (h.reason ? ` (${h.reason})` : ""), details: {}, created_at: h.changed_at, source: "audit" })));
      }
    }
    rows.sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at)));
    rows = rows.slice(0, lim);
    const eids = [...new Set(rows.map((x: any) => x.enrollment_id).filter(Boolean))];
    const aids = [...new Set(rows.map((x: any) => x.actor).filter(Boolean))];
    const [enR, prR] = await Promise.all([
      eids.length ? db.from("enrollments").select("id,full_name,student_id").in("id", eids) : { data: [] },
      aids.length ? db.from("profiles").select("id,username,full_name").in("id", aids) : { data: [] },
    ]);
    const en = new Map(((enR as any).data || []).map((e: any) => [e.id, e]));
    const who = new Map(((prR as any).data || []).map((p: any) => [p.id, actorLabel(p)]));
    return json({ ok: true, rows: rows.map(({ actor, ...x }: any) => ({ ...x, actor_name: (actor && who.get(actor)) || x.actor_name, student: en.get(x.enrollment_id) || null })), more: rows.length === lim });
  }

  // ---- staff lists (B2): masked contacts, no student details, no files -----------------------------
  if (a === "pro_students") {
    const t = ctx.today();
    const flt = (q: any, f: string) => f === "fee pending" ? q.gt("balance_due", 0).in("status", ["active", "expired"]) : f === "overdue" ? q.gt("balance_due", 0).in("status", ["active", "expired"]).lt("due_date", t) : (f === "all" || f === "test" || !f) ? q : q.eq("status", f);
    const perms = role === "staff" ? (ctx.perms || emptyPerms()) : null;
    const flag = !!(perms && perms.record_payments);
    if (body.mode === "counts") {
      const c = async (f: string) => (await flt(db.from("enrollments").select("id", { count: "exact", head: true }), f)).count || 0;
      const [all, pending, active, fee, overdue, expired, revoked] = await Promise.all(["all", "pending", "active", "fee pending", "overdue", "expired", "revoked"].map(c));
      const test = (await db.from("student_meta").select("enrollment_id", { count: "exact", head: true }).eq("is_test", true)).count || 0;
      return json({ ok: true, counts: { all, pending, active, "fee pending": fee, overdue, expired, revoked, test } });
    }
    if (body.mode === "batch_counts") {
      const r = (await db.from("enrollments").select("batch_id").not("batch_id", "is", null).neq("status", "revoked").limit(10000)).data || [];
      const by: Record<string, number> = {}; for (const e of r) by[e.batch_id] = (by[e.batch_id] || 0) + 1;
      const un = (await db.from("enrollments").select("id", { count: "exact", head: true }).is("batch_id", null).in("status", ["active", "expired"])).count || 0;
      return json({ ok: true, by, unassigned: un });
    }
    const size = Math.min(Math.max(Number(body.size) || 25, 1), 500), page = Math.max(Number(body.page) || 0, 0);
    let ids: number[] | null = null;
    if (body.filter === "test" || body.tag) {
      let mq = db.from("student_meta").select("enrollment_id"); if (body.filter === "test") mq = mq.eq("is_test", true); if (body.tag) mq = mq.contains("tags", [String(body.tag).slice(0, 40)]);
      ids = ((await mq).data || []).map((m: any) => m.enrollment_id); if (!ids!.length) return json({ ok: true, rows: [], count: 0, pays: [], flags: { staff_payments: flag, perms } });
    }
    let q = db.from("enrollments").select(STAFF_ENR_COLS, { count: "exact" }); q = flt(q, String(body.filter || "all")); if (ids) q = q.in("id", ids);
    if (Array.isArray(body.ids)) q = q.in("id", body.ids.map(Number).filter((x: number) => x > 0).slice(0, 500));
    const v = String(body.q || "").replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
    if (v) q = q.or(searchOr(v, role));
    if (body.batch === "none") q = q.is("batch_id", null); else if (Number(body.batch) > 0) q = q.eq("batch_id", Number(body.batch));
    if (Array.isArray(body.status) && body.status.length) q = q.in("status", body.status.map(String).slice(0, 5));
    const SORT = ["created_at.desc", "created_at.asc", "full_name.asc", "due_date.asc", "balance_due.desc"];
    const [col, dir] = (SORT.includes(String(body.sort)) ? String(body.sort) : "created_at.desc").split(".");
    q = q.order(col, { ascending: dir === "asc", nullsFirst: false }); if (col !== "created_at") q = q.order("created_at", { ascending: false });
    const r = await q.range(page * size, page * size + size - 1); if (r.error) return json({ error: r.error.message }, 500);
    const rows = (r.data || []).map(staffRow), eids = rows.map((e: any) => e.id);
    const pays = body.pays === false || !eids.length ? [] : ((await db.from("payments").select(STAFF_PAY_COLS).in("enrollment_id", eids).order("installment_no")).data || []).map(staffPay);
    return json({ ok: true, rows, count: r.count || 0, pays, flags: { staff_payments: flag, perms } });
  }
  if (a === "pro_reveal") {
    // one contact of one student, on click; always logged with who looked
    const field = body.field === "email" ? "email" : body.field === "phone" ? "phone" : null; if (!field) return json({ error: "Pick email or phone." }, 400);
    const e = (await db.from("enrollments").select("id,full_name,student_id,email,phone").eq("id", id).maybeSingle()).data;
    if (!e) return json({ error: "Student not found." }, 404);
    const why = String(body.why || "").replace(/[^a-z_ ]/gi, "").slice(0, 40);
    await logActivity(db, uid, e.id, "contact_shown", `${field === "email" ? "Email" : "Phone"} shown${why ? " (" + why + ")" : ""}`, { field });
    return json({ ok: true, value: e[field] || "" });
  }
  if (a === "pro_add_student") {
    // the only way staff add a student: whitelisted columns, always pending, nothing issued or paid (B1)
    const v = addStudentRow(body); if (v.error) return json({ error: v.error }, 400);
    const c = (await db.from("courses").select("code,name").eq("code", v.row!.course_code).maybeSingle()).data; if (!c) return json({ error: "Pick a course." }, 400);
    const dup = (await db.from("enrollments").select("id,status").eq("email", v.row!.email).eq("course_code", c.code).neq("status", "revoked").limit(1)).data || [];
    if (dup.length && !body.force) return json({ error: "This email is already registered for this course.", code: "duplicate" }, 409);
    const ins = await db.from("enrollments").insert({ ...v.row, course_label: c.name, status: "pending" }).select("id,student_id,full_name").single();
    if (ins.error) return json({ error: ins.error.message }, 400);
    await logActivity(db, uid, ins.data.id, "student_added", `Added ${ins.data.full_name} as pending (${c.code}, ${v.row!.source})`);
    let is_test = false;
    if (body.is_test === true && role === "admin") {
      // the creator ticked "TEST record" in the same form, so this is the confirmation; still one audit row
      const t = await db.rpc("set_test_mark", { p_enr: ins.data.id, p_on: true, p_actor: uid, p_reason: "ticked when the record was added" });
      is_test = !t.error;
    }
    ctx.pingSheets?.();
    return json({ ok: true, id: ins.data.id, student_id: ins.data.student_id, is_test });
  }

  // ---- batches -----------------------------------------------------------------------------------
  if (a === "pro_assign_batch") {
    const ids = (Array.isArray(body.ids) ? body.ids : [id]).map(Number).filter((x: number) => x > 0).slice(0, 200);
    if (!ids.length) return json({ error: "Pick at least one student." }, 400);
    const bid = body.batch_id === null || body.batch_id === "" || body.batch_id === undefined ? null : Number(body.batch_id);
    let b: any = null;
    if (bid) {
      b = (await db.from("batches").select("*").eq("id", bid).maybeSingle()).data;
      if (!b) return json({ error: "Batch not found." }, 404);
      if (b.status === "cancelled" || b.status === "finished") return json({ error: `Batch ${b.code} is ${b.status}. Pick another batch.` }, 400);
      const cur = (await db.from("enrollments").select("id", { count: "exact", head: true }).eq("batch_id", bid).neq("status", "revoked").not("id", "in", `(${ids.join(",")})`)).count || 0;
      if (b.capacity && cur + ids.length > b.capacity && !body.force) return json({ error: `Batch ${b.code} has ${b.capacity} seats and ${cur} are taken. Adding ${ids.length} would go over.`, code: "full", taken: cur, capacity: b.capacity }, 409);
      const wrong = (await db.from("enrollments").select("id,full_name,course_code").in("id", ids)).data?.filter((e: any) => e.course_code && e.course_code !== b.course_code) || [];
      if (wrong.length && !body.force) return json({ error: `${wrong.map((e: any) => e.full_name).join(", ")} ${wrong.length > 1 ? "are" : "is"} on another course than batch ${b.code}.`, code: "course" }, 409);
    }
    const before = (await db.from("enrollments").select("id,batch_code").in("id", ids)).data || [];
    const up = await db.from("enrollments").update({ batch_id: bid }).in("id", ids).select("id,batch_code");
    if (up.error) return json({ error: up.error.message }, 400);
    for (const e of up.data || []) { const o = before.find((x: any) => x.id === e.id); await logActivity(db, uid, e.id, "batch_assigned", bid ? `Batch ${o?.batch_code || "–"} → ${e.batch_code}` : `Removed from batch ${o?.batch_code || ""} (now ${e.batch_code || "–"})`, { batch_id: bid }); }
    ctx.pingSheets?.();
    return json({ ok: true, updated: (up.data || []).length });
  }

  // ---- reminders ---------------------------------------------------------------------------------
  if (a === "pro_reminders") {
    const t = ctx.today();
    const offs = parseOffsets((await db.from("site_settings").select("value").eq("key", "reminder_offsets").maybeSingle()).data?.value);
    const emails = (await db.from("site_settings").select("value").eq("key", "send_emails").maybeSingle()).data?.value === "on";
    const rows = (await db.from("enrollments").select("id,full_name,student_id,email,status,balance_due,due_date,reminder_stage,installment_plan,amount_paid").in("status", ["active", "expired"]).gt("balance_due", 0).order("due_date", { ascending: true, nullsFirst: false }).limit(1000)).data || [];
    const ids = rows.map((e: any) => e.id), meta = await metaOf(db, ids);
    const logs = ids.length ? ((await db.from("email_log").select("enrollment_id,kind,status,delivery,created_at").in("enrollment_id", ids).like("kind", "reminder%").order("created_at", { ascending: false }).limit(3000)).data || []) : [];
    const last = new Map<number, any>(); for (const l of logs) if (!last.has(l.enrollment_id)) last.set(l.enrollment_id, l);
    return json({ ok: true, today: t, offsets: offs, emails, rows: rows.map((e: any) => {
      const mt = meta.get(e.id), paused = isPaused(mt, t), nx = e.status === "active" ? nextReminder(e.due_date ? String(e.due_date).slice(0, 10) : null, e.reminder_stage || 0, t, offs) : null;
      return { id: e.id, name: e.full_name, student_id: e.student_id, balance: e.balance_due, due: e.due_date, stage: e.reminder_stage || 0, status: e.status, last: last.get(e.id) || null, next: paused || !emails ? null : nx, paused, paused_until: mt?.reminders_paused_until || null, pause_reason: mt?.pause_reason || null, test: !!mt?.is_test };
    }) });
  }
  if (a === "pro_reminder_settings") {
    const err = offsetsError(body.offsets); if (err) return json({ error: err }, 400);
    const v = parseOffsets(body.offsets).join(",");
    const r = await db.from("site_settings").upsert({ key: "reminder_offsets", value: v, updated_at: new Date().toISOString() }); if (r.error) return json({ error: r.error.message }, 400);
    await logActivity(db, uid, null, "reminder_schedule", `Reminder schedule set to ${v.split(",").map((x) => (+x === 0 ? "on the due date" : +x < 0 ? `${-x} days before` : `${x} days after`)).join(", ")}`);
    return json({ ok: true, offsets: v });
  }
  if (a === "pro_email_log") {
    const lim = Math.min(Number(body.limit) || 200, 1000);
    let q = db.from("email_log").select("*").order("created_at", { ascending: false }).limit(lim);
    if (id) q = q.eq("enrollment_id", id);
    if (body.status === "problem") q = q.or("status.eq.error,delivery.eq.bounced,delivery.eq.complained");
    if (body.kind) q = q.like("kind", String(body.kind).replace(/[^a-z-]/g, "") + "%");
    const r = await q; if (r.error) return json({ error: r.error.message }, 500);
    const eids = [...new Set((r.data || []).map((x: any) => x.enrollment_id).filter(Boolean))];
    const en = new Map(((eids.length ? (await db.from("enrollments").select("id,full_name,student_id").in("id", eids)).data : []) || []).map((e: any) => [e.id, e]));
    return json({ ok: true, rows: (r.data || []).map((x: any) => ({ id: x.id, enrollment_id: x.enrollment_id, kind: x.kind, items: x.items, status: x.status, delivery: x.delivery, delivery_at: x.delivery_at, error: role === "admin" ? x.error : (x.error ? STAFF_MAIL_ERR : null), created_at: x.created_at, student: en.get(x.enrollment_id) || null })) });
  }

  // ---- payment reference + proof file -----------------------------------------------------------
  if (a === "pro_payment_ref" || a === "pro_proof_upload" || a === "pro_proof_attach" || a === "pro_proof_url") {
    const pid = Number(body.payment_id);
    const p = (await db.from("payments").select("id,enrollment_id,invoice_no,reference,proof_file,proof_url").eq("id", pid).maybeSingle()).data;
    if (!p) return json({ error: "Payment not found." }, 404);
    if (a === "pro_payment_ref") {
      const ref = cleanRef(body.reference), meth = body.method === undefined ? undefined : payMethod(body.method);
      const patch: Record<string, unknown> = { reference: ref }; if (meth !== undefined && role === "admin") patch.method = meth;
      const r = await db.from("payments").update(patch).eq("id", pid); if (r.error) return json({ error: r.error.message }, 400);
      await logActivity(db, uid, p.enrollment_id, "payment_reference", `Payment ${p.invoice_no}: reference ${ref || "(removed)"}${patch.method !== undefined ? ", method " + (patch.method || "not set") : ""}`);
      return json({ ok: true, reference: ref });
    }
    if (a === "pro_proof_upload") {
      const type = String(body.type || ""), size = Number(body.size) || 0;
      if (!PROOF_TYPES[type]) return json({ error: "Upload a photo (JPG, PNG, WebP) or a PDF." }, 400);
      if (!(size > 0 && size <= PROOF_MAX)) return json({ error: size > PROOF_MAX ? "The file must be smaller than 5 MB." : "This file is empty. Pick the photo or PDF of the slip." }, 400);
      if (size < PROOF_MIN) return json({ error: "This file is too small to be a payment slip. Pick the photo or PDF of the slip.", code: "tiny" }, 400);
      const path = proofPath(p.enrollment_id, pid, type)!;
      const r = await db.storage.from("documents").createSignedUploadUrl(path);
      if (r.error) return json({ error: r.error.message }, 500);
      return json({ ok: true, path, token: r.data.token, signed_url: r.data.signedUrl });
    }
    if (a === "pro_proof_attach") {
      const path = String(body.path || "");
      if (!proofPathOk(path, p.enrollment_id, pid)) return json({ error: "Upload the file again." }, 400);
      const dir = path.slice(0, path.lastIndexOf("/")), name = path.slice(path.lastIndexOf("/") + 1);
      const ls = await db.storage.from("documents").list(dir, { search: name });
      const f = (ls.data || []).find((x: any) => x.name === name);
      if (ls.error || !f) return json({ error: "The upload did not arrive. Try again." }, 400);
      // the browser's claimed size/type are not trusted: check what storage actually holds
      const sz = Number(f.metadata?.size), mt = String(f.metadata?.mimetype || "");
      if (!(sz > 0 && sz <= PROOF_MAX) || !PROOF_TYPES[mt] || PROOF_TYPES[mt] !== path.slice(path.lastIndexOf(".") + 1)) {
        await db.storage.from("documents").remove([path]);
        return json({ error: !(sz > 0 && sz <= PROOF_MAX) ? "The file must be smaller than 5 MB." : "Upload a photo (JPG, PNG, WebP) or a PDF." }, 400);
      }
      // QA2: tiny / fake images (e.g. a 1×1 PNG) are refused, never "saved" without a usable slip
      const dl = await db.storage.from("documents").download(path);
      const head = dl.data ? new Uint8Array(await dl.data.slice(0, 32).arrayBuffer()) : new Uint8Array(0);
      const bad = dl.error ? "The upload did not arrive. Try again." : proofBytesOk(mt, head, sz);
      if (bad) { await db.storage.from("documents").remove([path]); return json({ error: bad, code: "bad_file" }, 400); }
      const ref = body.reference === undefined ? p.reference : cleanRef(body.reference);
      const r = await db.from("payments").update({ proof_file: path, reference: ref }).eq("id", pid).select("id,proof_file").maybeSingle();
      if (r.error || r.data?.proof_file !== path) return json({ error: r.error?.message || "The slip was not saved. Try again." }, 400);
      await logActivity(db, uid, p.enrollment_id, "payment_proof", `Payment ${p.invoice_no}: proof ${p.proof_file ? "replaced" : "uploaded"}${ref ? ", reference " + ref : ""}`);
      return json({ ok: true, proof_file: path, has_proof: true });
    }
    // pro_proof_url (staff only with open_payment_slips, checked in index.ts); every open is logged
    await logActivity(db, uid, p.enrollment_id, "payment_proof_opened", `Payment ${p.invoice_no}: slip opened`, { payment_id: pid });
    if (p.proof_file) { const s = await db.storage.from("documents").createSignedUrl(p.proof_file, 300); if (s.error) return json({ error: s.error.message }, 500); return json({ ok: true, url: s.data.signedUrl }); }
    if (/^https:\/\/drive\.google\.com\/(open\?id=|file\/d\/)[\w-]{15,}/.test(String(p.proof_url || ""))) return json({ ok: true, url: p.proof_url });
    return json({ error: "No proof file for this payment." }, 404);
  }

  if (a === "pro_adjust") {
    if (role === "staff" && !allowed("staff", "pro_adjust", ctx.perms)) return json({ error: denyMessage("pro_adjust", ctx.perms) }, 403);
    const kind = String(body.kind || ""); if (!["discount", "scholarship", "refund"].includes(kind)) return json({ error: "Pick discount, scholarship or refund." }, 400);
    const amount = Math.round(Number(body.amount)), reason = String(body.reason || "").trim(), appr = String(body.approved_by || "").trim();
    if (!(amount > 0 && amount <= 1000000)) return json({ error: "Enter the amount in whole rupees." }, 400);
    if (reason.length < 3) return json({ error: "Write the reason." }, 400);
    if (appr.length < 2) return json({ error: "Write who approved it." }, 400);
    const dt = ISO.test(String(body.date || "")) ? body.date : ctx.today();
    const e = (await db.from("enrollments").select("*").eq("id", id).maybeSingle()).data;
    if (!e || !e.invoice_no) return json({ error: "Use Payment received first; adjustments need an active student." }, 400);
    const row: Record<string, unknown> = { enrollment_id: id, kind, amount, reason: reason.slice(0, 500), approved_by: appr.slice(0, 80), adj_date: dt, created_by: uid };
    const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
    let patch: Record<string, unknown> | null = null;
    if (kind === "refund") {
      row.method = payMethod(body.method); row.reference = cleanRef(body.reference);
    } else {
      const d = applyDiscount({ fee: e.fee_total, paid: e.amount_paid, plan, cut: amount });
      if (d.error) return json({ error: d.error }, 400);
      const bal = d.fee - (Number(e.amount_paid) || 0);
      const due = bal <= 0 ? null : d.plan ? planDue(d.plan, e.amount_paid) : (e.due_date ? String(e.due_date).slice(0, 10) : null);
      patch = { fee_total: d.fee, installment_plan: d.plan, due_date: due, reminder_stage: bal <= 0 ? 3 : (due === (e.due_date ? String(e.due_date).slice(0, 10) : null) ? e.reminder_stage : 0) };
      if (plan && !d.plan) patch.payment_plan = bal > 0 ? "two" : "full";
    }
    // one transaction: the record and the fee change land together; refunds are checked under a row lock (refund_guard)
    const ins = await db.rpc("fee_adjust_apply", { p_row: row, p_expect_fee: e.fee_total, p_expect_paid: e.amount_paid, p_expect_plan: e.installment_plan ?? null, p_patch: patch });
    if (ins.error) return adjErr(json, ins.error);
    const adj: any = ins.data;
    await logActivity(db, uid, id, "adjust_" + kind, `${kind[0].toUpperCase() + kind.slice(1)} ${pkr(amount)} (${adj.receipt_no}), approved by ${appr}: ${reason}` + (kind === "refund" ? "" : `. Total fee ${pkr(e.fee_total)} → ${pkr(adj.fee_after)}`));
    ctx.pingSheets?.();
    let email: { status: string; error?: string } | null = null;
    if (body.email !== false && MAILER && e.email) {
      const now = (await db.from("enrollments").select("balance_due").eq("id", id).maybeSingle()).data;
      const m = adjustmentMail(e, { kind, amount, receipt_no: adj.receipt_no, reason, adj_date: dt }, Number(now?.balance_due ?? e.balance_due) || 0);
      try { email = await MAILER(db, e, "adjustment", ["ADJ:" + adj.id, adj.receipt_no || kind], m.subject, m.text, uid); } catch (x) { email = { status: "error", error: String((x as Error)?.message || x) }; }
    }
    return json({ ok: true, adjustment: adj, email });
  }
  if (a === "pro_adjust_void") {
    if (role === "staff" && !allowed("staff", "pro_adjust_void", ctx.perms)) return json({ error: denyMessage("pro_adjust_void", ctx.perms) }, 403);
    const adj = (await db.from("fee_adjustments").select("*").eq("id", Number(body.adjustment_id)).maybeSingle()).data;
    if (!adj || adj.voided_at) return json({ error: "Not found or already void." }, 404);
    const reason = String(body.reason || "").trim(); if (reason.length < 3) return json({ error: "Write the reason." }, 400);
    let expFee: number | null = null, expPlan: unknown = null, patch: Record<string, unknown> | null = null;
    if (adj.kind !== "refund") {
      const e = (await db.from("enrollments").select("*").eq("id", adj.enrollment_id).maybeSingle()).data;
      if (!e) return json({ error: "Student not found." }, 404);
      const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
      // plan untouched since the discount: put back the exact plan it replaced; otherwise add the amount back to the open installments
      const back = sameJson(plan, adj.plan_after) && (adj.plan_before || adj.plan_after) ? { fee: (Number(e.fee_total) || 0) + adj.amount, plan: (adj.plan_before as Inst[] | null) } : undoDiscount({ fee: e.fee_total, plan, add: adj.amount });
      const owes = back.fee > (Number(e.amount_paid) || 0);
      const due = back.plan ? planDue(back.plan, e.amount_paid) : (owes ? (e.due_date ? String(e.due_date).slice(0, 10) : null) : null);
      patch = { fee_total: back.fee, installment_plan: back.plan, due_date: due, reminder_stage: owes ? 0 : 3, ...(back.plan && !plan ? { payment_plan: "custom" } : {}) };
      expFee = e.fee_total; expPlan = e.installment_plan ?? null;
    }
    const r = await db.rpc("fee_adjust_void", { p_id: adj.id, p_reason: reason.slice(0, 300), p_expect_fee: expFee, p_expect_plan: expPlan, p_patch: patch });
    if (r.error) return adjErr(json, r.error);
    await logActivity(db, uid, adj.enrollment_id, "adjust_void", `${adj.kind} ${adj.receipt_no} (${pkr(adj.amount)}) voided: ${reason}` + (adj.kind !== "refund" && patch ? `. Total fee back to ${pkr(patch.fee_total as number)}${patch.installment_plan && adj.plan_before ? ", installment plan restored" : ""}` : ""));
    ctx.pingSheets?.();
    return json({ ok: true });
  }

  if (a === "pro_export_log") {
    if (role === "staff" && !allowed("staff", "pro_export_log", ctx.perms)) return json({ error: denyMessage("pro_export_log", ctx.perms) }, 403);
    // exports are built in the browser from data this person can already see; this only records who exported what
    await logActivity(db, uid, null, "export", `Exported ${String(body.what || "data").slice(0, 40)}${body.from || body.to ? ` (${body.from || "…"} to ${body.to || "…"})` : ""}`);
    return json({ ok: true });
  }
  // ---------------------------------------------- admin only below ---------------------------------
  if (role !== "admin") return json({ error: "Only an admin can do this." }, 403);

  if (a === "pro_revoke" || a === "pro_restore" || a === "pro_remove") {
    const e = (await db.from("enrollments").select("id,full_name,email,student_id,status").eq("id", id).maybeSingle()).data;
    if (!e) return json({ error: "Student not found." }, 404);
    const reason = String(body.reason || "").trim().slice(0, 300);
    if (reason.length < 3) return json({ error: "Write a short reason (it is kept in the activity log)." }, 400);
    if (!confirmOk(a, body)) return json({ error: `Type ${a === "pro_revoke" ? "REVOKE" : "DELETE"} to confirm.`, code: "confirm" }, 400);
    if (a === "pro_remove") {
      if (e.status !== "pending") return json({ error: "Only a pending registration can be removed. Revoke an active student instead." }, 400);
      await logActivity(db, uid, null, "student_removed", `Removed pending registration ${e.full_name || e.email}${e.student_id ? " (" + e.student_id + ")" : ""}: ${reason}`, { enrollment_id: e.id });
      const r = await db.from("enrollments").delete().eq("id", id).eq("status", "pending"); if (r.error) return json({ error: r.error.message }, 400);
      return json({ ok: true });
    }
    const to = a === "pro_revoke" ? "revoked" : "active";
    if (a === "pro_revoke" && e.status !== "active" && e.status !== "expired") return json({ error: "Only an active student can be revoked." }, 400);
    if (a === "pro_restore" && e.status !== "revoked") return json({ error: "This student is not revoked." }, 400);
    const r = await db.from("enrollments").update({ status: to }).eq("id", id).eq("status", e.status).select("id,end_date").maybeSingle();
    if (r.error || !r.data) return json({ error: r.error?.message || "It changed meanwhile. Reload." }, 409);
    await logActivity(db, uid, id, a === "pro_revoke" ? "revoked" : "restored", (a === "pro_revoke" ? "Access revoked: " : "Access restored: ") + reason);
    ctx.pingSheets?.();
    return json({ ok: true, status: to, end_date: r.data.end_date });
  }

  if (a === "pro_role_set") {
    const target = String(body.user_id || ""), r0 = String(body.role || "");
    if (!["user", "staff", "admin"].includes(r0)) return json({ error: "Pick user, staff or admin." }, 400);
    if (target === uid) return json({ error: "You can't change your own role. Ask another admin." }, 400);
    const cur = (await db.from("profiles").select("role,username").eq("id", target).maybeSingle()).data; if (!cur) return json({ error: "Account not found." }, 404);
    // the last-admin rule is enforced in the DB (profiles_keep_one_admin, serialised), so two demotions can't race
    const up = await db.from("profiles").update({ role: r0 }).eq("id", target).eq("role", cur.role).select("id").maybeSingle();
    if (up.error) return json({ error: /at least one admin/i.test(up.error.message) ? "At least one admin must remain." : up.error.message }, 400);
    if (!up.data) return json({ error: "The role changed meanwhile. Reload." }, 409);
    await logActivity(db, uid, null, "role_changed", `${cur.username}: role ${cur.role} → ${r0}`, { user_id: target });
    return json({ ok: true, role: r0 });
  }
  if (a === "pro_accounts") {
    const prof = (await db.from("profiles").select("*").order("created_at", { ascending: false }).limit(2000)).data || [];
    const meta = new Map<string, any>(((await db.from("account_meta").select("*")).data || []).map((m: any) => [m.user_id, m]));
    const staffP = new Map<string, any>(((await db.from("staff_permissions").select("*")).data || []).map((m: any) => [m.user_id, m]));
    const users = new Map<string, any>(); for (let page = 1; page <= 20; page++) { const r = await db.auth.admin.listUsers({ page, perPage: 200 }); const l = r.data?.users || []; for (const u of l) users.set(u.id, u); if (l.length < 200) break; }
    const enr = (await db.from("enrollments").select("email,status").limit(5000)).data || [];
    return json({ ok: true, me: uid, rows: prof.map((p: any) => { const u = users.get(p.id) || {}; const em = String(u.email || "").toLowerCase(); const sp = p.role === "staff" ? parsePerms(staffP.get(p.id)) : null; return { id: p.id, username: p.username, full_name: p.full_name, country: p.country, phone: p.phone, role: p.role, created_at: p.created_at, email: em, confirmed: !!u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at || null, is_test: !!meta.get(p.id)?.is_test, enrolled: enr.filter((x: any) => x.email === em).map((x: any) => x.status), perms: sp, disabled: !!(sp && sp.disabled) }; }) });
  }
  if (a === "pro_account_test") {
    const target = String(body.user_id || ""); if (target === uid) return json({ error: "That's your own account." }, 400);
    const r = await db.from("account_meta").upsert({ user_id: target, is_test: !!body.on, updated_at: new Date().toISOString() }); if (r.error) return json({ error: r.error.message }, 400);
    const un = (await db.from("profiles").select("username").eq("id", target).maybeSingle()).data?.username || target;
    await logActivity(db, uid, null, body.on ? "account_marked_test" : "account_unmarked_test", `Account ${un} ${body.on ? "marked" : "no longer marked"} as TEST`, { user_id: target });
    return json({ ok: true });
  }
  if (a === "pro_account_delete") {
    const target = String(body.user_id || "");
    if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);
    if (target === uid) return json({ error: "You can't delete your own account." }, 400);
    const m = (await db.from("account_meta").select("is_test").eq("user_id", target).maybeSingle()).data;
    if (!m?.is_test) return json({ error: "Mark the account as TEST first. Only TEST accounts can be deleted here." }, 400);
    const pr = (await db.from("profiles").select("username,role").eq("id", target).maybeSingle()).data;
    if (pr?.role === "admin") return json({ error: "Admin accounts can't be deleted here. Change the role first." }, 400);
    const u = (await db.auth.admin.getUserById(target)).data?.user;
    if (u?.email) { const live = (await db.from("enrollments").select("id,status").eq("email", String(u.email).toLowerCase())).data || []; const tm = await metaOf(db, live.map((x: any) => x.id)); if (live.some((x: any) => !tm.get(x.id)?.is_test)) return json({ error: "This login belongs to a student record that is not marked TEST. Mark or delete that record first." }, 400); }
    await logActivity(db, uid, null, "account_deleted", `TEST account ${pr?.username || target} deleted${body.reason ? ". Reason: " + String(body.reason).slice(0, 300) : ""}`, { user_id: target });
    const r = await db.auth.admin.deleteUser(target); if (r.error) return json({ error: r.error.message }, 400);
    return json({ ok: true });
  }
  if (a === "pro_adjust_mail") {
    // QA2: email a discount / scholarship / refund receipt again (from the email log's Resend)
    const adj = (await db.from("fee_adjustments").select("*").eq("id", Number(body.adjustment_id)).eq("enrollment_id", id).maybeSingle()).data;
    const e = (await db.from("enrollments").select("id,email,full_name,student_id,balance_due").eq("id", id).maybeSingle()).data;
    if (!adj || !e) return json({ error: "Not found." }, 404);
    if (adj.voided_at) return json({ error: "This adjustment was voided, so its receipt is not sent again." }, 400);
    if (!MAILER || !e.email) return json({ error: "Email sending is not available." }, 400);
    const m = adjustmentMail(e, adj, Number(e.balance_due) || 0);
    const r = await MAILER(db, e, "adjustment", ["ADJ:" + adj.id, adj.receipt_no || adj.kind], m.subject, m.text, uid);
    return r.status === "error" ? json({ error: "Sending failed: " + (r.error || "unknown") }, 500) : json({ ok: true, email: r.status });
  }
  if (a === "pro_mark_test") {
    // QA2: the admin types the Student ID shown in the dialog; the server checks it against this enrollment id
    const e = (await db.from("enrollments").select("id,student_id,full_name").eq("id", id).maybeSingle()).data;
    if (!e) return json({ error: "Student not found." }, 404);
    if (!testConfirmOk(e.student_id, body.confirm)) return json({ error: `Type ${testConfirmWord(e.student_id)} (the Student ID of ${e.full_name || "this record"}) to confirm.`, code: "confirm" }, 400);
    const r = await db.rpc("set_test_mark", { p_enr: id, p_on: !!body.on, p_actor: uid, p_reason: body.reason ? String(body.reason).slice(0, 300) : null });
    if (r.error) return json({ error: r.error.code === "23514" ? String(r.error.message || "").replace(/^DFA: /, "") : r.error.code === "P0002" ? "Student not found." : "Could not save. Try again." }, r.error.code === "23514" ? 409 : 400);
    return json({ ok: true, is_test: !!body.on, student_id: e.student_id, name: e.full_name });
  }
  if (a === "pro_delete_test") {
    if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((x: number) => x > 0).slice(0, 50);
    if (!ids.length) return json({ error: "Pick the TEST records to delete." }, 400);
    const meta = await metaOf(db, ids), notTest = ids.filter((x: number) => !meta.get(x)?.is_test);
    if (notTest.length) return json({ error: "Only records marked TEST can be deleted. Not marked: " + notTest.join(", ") }, 400);
    const es = (await db.from("enrollments").select("id,full_name,email,student_id,admission_file,receipt_file,certificate_file").in("id", ids)).data || [];
    const ps = (await db.from("payments").select("receipt_file,proof_file").in("enrollment_id", ids)).data || [];
    const files = [...es.flatMap((e: any) => [e.admission_file, e.receipt_file]), ...ps.flatMap((p: any) => [p.receipt_file, p.proof_file])].filter((f) => typeof f === "string" && f && !/^https?:/.test(f));
    for (const e of es) await logActivity(db, uid, null, "test_deleted", `TEST record deleted: ${e.full_name || e.email}${e.student_id ? " (" + e.student_id + ")" : ""}${body.reason ? ". Reason: " + String(body.reason).slice(0, 300) : ""}`, { enrollment_id: e.id });
    const r = await db.from("enrollments").delete().in("id", es.map((e: any) => e.id)); if (r.error) return json({ error: r.error.message }, 400);
    let removed = 0; if (files.length) { const s = await db.storage.from("documents").remove(files); removed = s.data?.length || 0; }
    const cf = es.map((e: any) => e.certificate_file).filter((f: any) => typeof f === "string" && f && !/^https?:/.test(f));
    if (cf.length) { const s = await db.storage.from("certificates").remove(cf); removed += s.data?.length || 0; }
    ctx.pingSheets?.();
    return json({ ok: true, deleted: es.length, files: removed });
  }
  if (a === "pro_staff_invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.full_name || "").trim().slice(0, 100);
    if (!name || name.length < 2) return json({ error: "Enter the staff member's name." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || email.length > 120) return json({ error: "Enter a valid email address." }, 400);
    // already has a login? don't invite again — the admin can change the role on the list
    for (let page = 1; page <= 20; page++) {
      const r = await db.auth.admin.listUsers({ page, perPage: 200 });
      const hit = (r.data?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email);
      if (hit) return json({ error: "This email already has a login. Change their role to staff in the list below." }, 409);
      if ((r.data?.users || []).length < 200) break;
    }
    const inv = await db.auth.admin.inviteUserByEmail(email, { data: { full_name: name } });
    if (inv.error) return json({ error: "Could not send the invite. Try again." }, 400);
    const id = inv.data?.user?.id;
    if (!id) return json({ error: "Could not create the account. Try again." }, 400);
    // invite creates the auth user (and handle_new_user creates the profile). Promote to staff (all perms off).
    const up = await db.from("profiles").update({ role: "staff", full_name: name }).eq("id", id);
    if (up.error) return json({ error: up.error.message }, 400);
    await logActivity(db, uid, null, "staff_invited", `Invited ${name} as staff (all permissions off)`, { user_id: id });
    return json({ ok: true, id, invited: true });
  }
  if (a === "pro_staff_perms") {
    const target = String(body.user_id || "");
    if (!target) return json({ error: "Pick a staff member." }, 400);
    const pr = (await db.from("profiles").select("role,username,full_name").eq("id", target).maybeSingle()).data;
    if (!pr) return json({ error: "Account not found." }, 404);
    if (pr.role !== "staff") return json({ error: "Permissions can only be set on a staff account." }, 400);
    const cur = parsePerms((await db.from("staff_permissions").select("*").eq("user_id", target).maybeSingle()).data);
    const next = emptyPerms();
    next.disabled = typeof body.disabled === "boolean" ? !!body.disabled : cur.disabled;
    const src = body.perms && typeof body.perms === "object" ? body.perms : body;
    for (const k of PERM_KEYS) next[k] = typeof src[k] === "boolean" ? !!src[k] : cur[k];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: uid, disabled: next.disabled };
    for (const k of PERM_KEYS) patch[k] = next[k];
    const up = await db.from("staff_permissions").upsert({ user_id: target, ...patch });
    if (up.error) return json({ error: up.error.message }, 400);
    const changed: string[] = [];
    for (const k of PERM_KEYS) if (cur[k] !== next[k]) changed.push(`${k} ${cur[k] ? "on" : "off"} → ${next[k] ? "on" : "off"}`);
    if (cur.disabled !== next.disabled) changed.push(`disabled ${cur.disabled ? "on" : "off"} → ${next.disabled ? "on" : "off"}`);
    const who = pr.full_name || pr.username;
    await logActivity(db, uid, null, "staff_permissions", changed.length ? `Permissions for ${who}: ${changed.join(", ")}`.slice(0, 500) : `Permissions for ${who} saved (no change)`, { user_id: target, before: cur, after: next });
    return json({ ok: true, perms: next, disabled: next.disabled });
  }
  if (a === "pro_staff_disable") {
    const target = String(body.user_id || "");
    if (!target) return json({ error: "Pick a staff member." }, 400);
    if (target === uid) return json({ error: "You can't disable your own access here." }, 400);
    const pr = (await db.from("profiles").select("role,username,full_name").eq("id", target).maybeSingle()).data;
    if (!pr || pr.role !== "staff") return json({ error: "That account is not a staff member." }, 400);
    const on = !!body.on;
    const now = new Date().toISOString();
    const exist = (await db.from("staff_permissions").select("user_id").eq("user_id", target).maybeSingle()).data;
    const up = exist
      ? await db.from("staff_permissions").update({ disabled: on, updated_at: now, updated_by: uid }).eq("user_id", target)
      : await db.from("staff_permissions").insert({ user_id: target, disabled: on, updated_at: now, updated_by: uid });
    if (up.error) return json({ error: up.error.message }, 400);
    const who = pr.full_name || pr.username;
    await logActivity(db, uid, null, on ? "staff_disabled" : "staff_enabled", `${who} ${on ? "disabled" : "enabled"}`, { user_id: target });
    return json({ ok: true, disabled: on });
  }

  return json({ error: "unknown action" }, 400);
}
