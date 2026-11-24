// Admin portal upgrade (WD-3): actions behind the "pro_" prefix, plus the activity log writer used by index.ts.
// Every caller is already signed in, confirmed and admin/staff (index.ts checks that and allowed() before calling).
import { cleanRef, applyDiscount, undoDiscount, planDue, parseOffsets, offsetsError, nextReminder, isPaused, proofPath, proofPathOk, PROOF_TYPES, PROOF_MAX, dashboard, type Role } from "./prologic.ts";
import { method as payMethod, type Inst } from "./plan.ts";

type Ctx = { json: (b: unknown, s?: number) => Response; today: () => string; pingSheets?: () => void };
const pkr = (n: number) => "PKR " + Number(n || 0).toLocaleString("en-US");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function actorName(db: any, uid: string | null): Promise<string | null> {
  if (!uid) return null;
  const p = (await db.from("profiles").select("full_name,username").eq("id", uid).maybeSingle()).data;
  return p ? (p.full_name || p.username || "Staff") : null;
}
/** Writes one activity row. Never throws (the action itself already succeeded). */
export async function logActivity(db: any, uid: string | null, enrollmentId: number | null, action: string, summary: string, details: Record<string, unknown> = {}) {
  try { await db.from("admin_activity").insert({ enrollment_id: enrollmentId || null, actor: uid, actor_name: await actorName(db, uid), action, summary: summary.slice(0, 500), details }); } catch (_) { /* best effort */ }
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

  // ---- dashboard -------------------------------------------------------------------------------
  if (a === "pro_dashboard") {
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
    let q = db.from("admin_activity").select("id,enrollment_id,actor_name,action,summary,details,created_at").order("created_at", { ascending: false }).limit(lim);
    if (id) q = q.eq("enrollment_id", id); else if (role !== "admin") q = q.not("enrollment_id", "is", null);
    if (body.before && !isNaN(Date.parse(body.before))) q = q.lt("created_at", body.before);
    if (body.from && ISO.test(body.from)) q = q.gte("created_at", body.from + "T00:00:00+05:00");
    if (body.to && ISO.test(body.to)) q = q.lte("created_at", body.to + "T23:59:59+05:00");
    if (body.kind) q = q.like("action", String(body.kind).replace(/[^a-z_]/g, "") + "%");
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
        const names = new Map(((ids.length ? (await db.from("profiles").select("id,full_name,username").in("id", ids)).data : []) || []).map((p: any) => [p.id, p.full_name || p.username]));
        const lbl: Record<string, string> = { student_info: "Student details changed", payment_correct: "Payment corrected", payment_void: "Payment voided" };
        rows = rows.concat((au.data || []).map((h: any) => ({ id: "a" + h.id, enrollment_id: h.enrollment_id, actor_name: names.get(h.changed_by) || null, action: h.kind, summary: (lbl[h.kind] || h.kind) + ": " + Object.keys(h.new_values || {}).map((k) => `${k} ${JSON.stringify((h.old_values || {})[k] ?? "")} → ${JSON.stringify(h.new_values[k])}`).join(", ").slice(0, 300) + (h.reason ? ` (${h.reason})` : ""), details: {}, created_at: h.changed_at, source: "audit" })));
      }
    }
    rows.sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at)));
    rows = rows.slice(0, lim);
    const eids = [...new Set(rows.map((x: any) => x.enrollment_id).filter(Boolean))];
    const en = new Map(((eids.length ? (await db.from("enrollments").select("id,full_name,student_id").in("id", eids)).data : []) || []).map((e: any) => [e.id, e]));
    return json({ ok: true, rows: rows.map((x: any) => ({ ...x, student: en.get(x.enrollment_id) || null })), more: rows.length === lim });
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
    return json({ ok: true, rows: (r.data || []).map((x: any) => ({ id: x.id, enrollment_id: x.enrollment_id, kind: x.kind, items: x.items, status: x.status, delivery: x.delivery, delivery_at: x.delivery_at, error: x.error, created_at: x.created_at, student: en.get(x.enrollment_id) || null })) });
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
      if (!(size > 0 && size <= PROOF_MAX)) return json({ error: "The file must be smaller than 5 MB." }, 400);
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
      if (ls.error || !(ls.data || []).some((f: any) => f.name === name)) return json({ error: "The upload did not arrive. Try again." }, 400);
      const ref = body.reference === undefined ? p.reference : cleanRef(body.reference);
      const r = await db.from("payments").update({ proof_file: path, reference: ref }).eq("id", pid); if (r.error) return json({ error: r.error.message }, 400);
      await logActivity(db, uid, p.enrollment_id, "payment_proof", `Payment ${p.invoice_no}: proof ${p.proof_file ? "replaced" : "uploaded"}${ref ? ", reference " + ref : ""}`);
      return json({ ok: true });
    }
    // pro_proof_url
    if (p.proof_file) { const s = await db.storage.from("documents").createSignedUrl(p.proof_file, 300); if (s.error) return json({ error: s.error.message }, 500); return json({ ok: true, url: s.data.signedUrl }); }
    if (/^https:\/\/drive\.google\.com\/(open\?id=|file\/d\/)[\w-]{15,}/.test(String(p.proof_url || ""))) return json({ ok: true, url: p.proof_url });
    return json({ error: "No proof file for this payment." }, 404);
  }

  // ---------------------------------------------- admin only below ---------------------------------
  if (role !== "admin") return json({ error: "Only an admin can do this." }, 403);

  if (a === "pro_revoke" || a === "pro_restore" || a === "pro_remove") {
    const e = (await db.from("enrollments").select("id,full_name,email,student_id,status").eq("id", id).maybeSingle()).data;
    if (!e) return json({ error: "Student not found." }, 404);
    const reason = String(body.reason || "").trim().slice(0, 300);
    if (reason.length < 3) return json({ error: "Write a short reason (it is kept in the activity log)." }, 400);
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

  if (a === "pro_adjust") {
    const kind = String(body.kind || ""); if (!["discount", "scholarship", "refund"].includes(kind)) return json({ error: "Pick discount, scholarship or refund." }, 400);
    const amount = Math.round(Number(body.amount)), reason = String(body.reason || "").trim(), appr = String(body.approved_by || "").trim();
    if (!(amount > 0 && amount <= 1000000)) return json({ error: "Enter the amount in whole rupees." }, 400);
    if (reason.length < 3) return json({ error: "Write the reason." }, 400);
    if (appr.length < 2) return json({ error: "Write who approved it." }, 400);
    const dt = ISO.test(String(body.date || "")) ? body.date : ctx.today();
    const e = (await db.from("enrollments").select("*").eq("id", id).maybeSingle()).data;
    if (!e || !e.invoice_no) return json({ error: "Use Payment received first; adjustments need an active student." }, 400);
    const row: Record<string, unknown> = { enrollment_id: id, kind, amount, reason: reason.slice(0, 500), approved_by: appr.slice(0, 80), adj_date: dt, created_by: uid, fee_before: e.fee_total, fee_after: e.fee_total };
    if (kind === "refund") {
      const prior = ((await db.from("fee_adjustments").select("amount").eq("enrollment_id", id).eq("kind", "refund").is("voided_at", null)).data || []).reduce((s: number, x: any) => s + x.amount, 0);
      const net = (Number(e.amount_paid) || 0) - prior;
      if (amount > net) return json({ error: `Refunds can't be more than what the student has paid (net ${pkr(net)}).` }, 400);
      row.method = payMethod(body.method); row.reference = cleanRef(body.reference);
    } else {
      const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
      const d = applyDiscount({ fee: e.fee_total, paid: e.amount_paid, plan, cut: amount });
      if (d.error) return json({ error: d.error }, 400);
      const bal = d.fee - (Number(e.amount_paid) || 0);
      const due = bal <= 0 ? null : d.plan ? planDue(d.plan, e.amount_paid) : (e.due_date ? String(e.due_date).slice(0, 10) : null);
      const patch: Record<string, unknown> = { fee_total: d.fee, installment_plan: d.plan, due_date: due, reminder_stage: bal <= 0 ? 3 : (due === (e.due_date ? String(e.due_date).slice(0, 10) : null) ? e.reminder_stage : 0) };
      if (plan && !d.plan) patch.payment_plan = bal > 0 ? "two" : "full";
      const up = await db.from("enrollments").update(patch).eq("id", id).eq("fee_total", e.fee_total).eq("amount_paid", e.amount_paid).select("id").maybeSingle();
      if (up.error || !up.data) return json({ error: up.error?.message || "A payment was just saved. Reload and try again." }, 409);
      row.fee_after = d.fee;
    }
    const ins = await db.from("fee_adjustments").insert(row).select("*").single();
    if (ins.error) return json({ error: ins.error.message }, 400);
    await logActivity(db, uid, id, "adjust_" + kind, `${kind[0].toUpperCase() + kind.slice(1)} ${pkr(amount)} (${ins.data.receipt_no}), approved by ${appr}: ${reason}` + (kind === "refund" ? "" : `. Total fee ${pkr(e.fee_total)} → ${pkr(row.fee_after as number)}`));
    ctx.pingSheets?.();
    return json({ ok: true, adjustment: ins.data });
  }
  if (a === "pro_adjust_void") {
    const adj = (await db.from("fee_adjustments").select("*").eq("id", Number(body.adjustment_id)).maybeSingle()).data;
    if (!adj || adj.voided_at) return json({ error: "Not found or already void." }, 404);
    const reason = String(body.reason || "").trim(); if (reason.length < 3) return json({ error: "Write the reason." }, 400);
    if (adj.kind !== "refund") {
      const e = (await db.from("enrollments").select("*").eq("id", adj.enrollment_id).maybeSingle()).data;
      const plan: Inst[] | null = Array.isArray(e.installment_plan) && e.installment_plan.length ? e.installment_plan : null;
      const u = undoDiscount({ fee: e.fee_total, plan, add: adj.amount });
      const due = u.plan ? planDue(u.plan, e.amount_paid) : (u.fee > e.amount_paid ? (e.due_date ? String(e.due_date).slice(0, 10) : null) : null);
      const up = await db.from("enrollments").update({ fee_total: u.fee, installment_plan: u.plan, due_date: due, reminder_stage: u.fee > e.amount_paid ? 0 : 3 }).eq("id", e.id).eq("fee_total", e.fee_total).select("id").maybeSingle();
      if (up.error || !up.data) return json({ error: up.error?.message || "Changed meanwhile. Reload." }, 409);
    }
    const r = await db.from("fee_adjustments").update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300) }).eq("id", adj.id).is("voided_at", null);
    if (r.error) return json({ error: r.error.message }, 400);
    await logActivity(db, uid, adj.enrollment_id, "adjust_void", `${adj.kind} ${adj.receipt_no} (${pkr(adj.amount)}) voided: ${reason}`);
    ctx.pingSheets?.();
    return json({ ok: true });
  }

  if (a === "pro_role_set") {
    const target = String(body.user_id || ""), r0 = String(body.role || "");
    if (!["user", "staff", "admin"].includes(r0)) return json({ error: "Pick user, staff or admin." }, 400);
    if (target === uid) return json({ error: "You can't change your own role. Ask another admin." }, 400);
    const cur = (await db.from("profiles").select("role,username").eq("id", target).maybeSingle()).data; if (!cur) return json({ error: "Account not found." }, 404);
    if (cur.role === "admin" && r0 !== "admin") { const n = (await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin")).count || 0; if (n <= 1) return json({ error: "At least one admin must remain." }, 400); }
    const up = await db.from("profiles").update({ role: r0 }).eq("id", target); if (up.error) return json({ error: up.error.message }, 400);
    await logActivity(db, uid, null, "role_changed", `${cur.username}: role ${cur.role} → ${r0}`, { user_id: target });
    return json({ ok: true, role: r0 });
  }
  if (a === "pro_accounts") {
    const prof = (await db.from("profiles").select("*").order("created_at", { ascending: false }).limit(2000)).data || [];
    const meta = new Map<string, any>(((await db.from("account_meta").select("*")).data || []).map((m: any) => [m.user_id, m]));
    const users = new Map<string, any>(); for (let page = 1; page <= 20; page++) { const r = await db.auth.admin.listUsers({ page, perPage: 200 }); const l = r.data?.users || []; for (const u of l) users.set(u.id, u); if (l.length < 200) break; }
    const enr = (await db.from("enrollments").select("email,status").limit(5000)).data || [];
    return json({ ok: true, me: uid, rows: prof.map((p: any) => { const u = users.get(p.id) || {}; const em = String(u.email || "").toLowerCase(); return { id: p.id, username: p.username, full_name: p.full_name, country: p.country, phone: p.phone, role: p.role, created_at: p.created_at, email: em, confirmed: !!u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at || null, is_test: !!meta.get(p.id)?.is_test, enrolled: enr.filter((x: any) => x.email === em).map((x: any) => x.status) }; }) });
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
    await logActivity(db, uid, null, "account_deleted", `TEST account ${pr?.username || target} deleted`, { user_id: target });
    const r = await db.auth.admin.deleteUser(target); if (r.error) return json({ error: r.error.message }, 400);
    return json({ ok: true });
  }
  if (a === "pro_mark_test") {
    const r = await db.from("student_meta").upsert({ enrollment_id: id, is_test: !!body.on }, { onConflict: "enrollment_id" }); if (r.error) return json({ error: r.error.message }, 400);
    await logActivity(db, uid, id, body.on ? "marked_test" : "unmarked_test", body.on ? "Marked as TEST record" : "TEST mark removed");
    return json({ ok: true });
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
    for (const e of es) await logActivity(db, uid, null, "test_deleted", `TEST record deleted: ${e.full_name || e.email}${e.student_id ? " (" + e.student_id + ")" : ""}`, { enrollment_id: e.id });
    const r = await db.from("enrollments").delete().in("id", es.map((e: any) => e.id)); if (r.error) return json({ error: r.error.message }, 400);
    let removed = 0; if (files.length) { const s = await db.storage.from("documents").remove(files); removed = s.data?.length || 0; }
    const cf = es.map((e: any) => e.certificate_file).filter((f: any) => typeof f === "string" && f && !/^https?:/.test(f));
    if (cf.length) { const s = await db.storage.from("certificates").remove(cf); removed += s.data?.length || 0; }
    ctx.pingSheets?.();
    return json({ ok: true, deleted: es.length, files: removed });
  }
  if (a === "pro_export_log") {
    // exports are built in the browser from data the admin can already read; this only records who exported what
    await logActivity(db, uid, null, "export", `Exported ${String(body.what || "data").slice(0, 40)}${body.from || body.to ? ` (${body.from || "…"} to ${body.to || "…"})` : ""}`);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
}
