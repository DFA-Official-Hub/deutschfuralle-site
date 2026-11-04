// DFA lead forms. Public: register (registration.html form, Turnstile, table registration_leads), submit (Turnstile + disposable-email check), score (needs the row's edit token), clone (same person starts another paper: copies the contact details of a row they hold the edit token for into a new row for that exam).
// Private: GET ?csv=1&key=<site_settings.leads_csv_key> returns all mock exam rows as CSV for the Google Sheet (IMPORTDATA); add &table=registration for registration_leads.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const LEVELS = ["Beginner", "A1", "A2", "B1", "B2+"];
const GOALS = ["Study in Germany", "Job", "Ausbildung", "Nursing", "Exam prep", "Hobby", "Other"];
const EXAMS: Record<string, string> = { "a1-mock-1": "A1 Mock 1", "a1-mock-2": "A1 Mock 2", "a1-mock-3": "A1 Mock 3", "a1-mock-4": "A1 Mock 4", "a1-mock-5": "A1 Mock 5" };
const t = (x: unknown, n = 120) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const pkt = (d: string | null) => d ? new Date(new Date(d).getTime() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
const cell = (v: unknown) => { let s = String(v ?? ""); if (/^[=@]/.test(s)) s = " " + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const COURSES = ["Free Demo Class","A1 Crash Course","A1 Super Intensive Course","A1 Normal Track Course","German A2 Course","A1 + A2 Combined Program","B1 / B2 (ask for details)"];
const TIMINGS = ["12PM to 1PM","4:30PM to 5:30PM","8:30PM to 9:30PM","10:30PM to 11:30PM"];
const normPhone = (p: string) => { let d = p.replace(/[^\d+]/g, ""); if (d.startsWith("00")) d = "+" + d.slice(2); if (/^03\d{9}$/.test(d)) d = "+92" + d.slice(1); if (/^92\d{10}$/.test(d)) d = "+" + d; return d; };
const utm = (v: unknown) => t(v, 100).toLowerCase().replace(/[^a-z0-9._-]/g, "") || null;
// First-touch attribution from the browser (assets/dfa-track.js DFAAttr.first()) plus the shared event_id; same shape for both lead tables.
const attribution = (b: any) => { const ft = (b && typeof b.first_touch === "object" && b.first_touch) || {};
  return { utm_source: utm(ft.utm_source), utm_medium: utm(ft.utm_medium), utm_campaign: utm(ft.utm_campaign), utm_content: utm(ft.utm_content),
    landing_page: t(ft.landing_page, 300) || null, first_touch_at: ft.ts && !isNaN(Date.parse(ft.ts)) ? ft.ts : null,
    gclid: t(ft.gclid, 200) || null, fbclid: t(ft.fbclid, 200) || null,
    event_id: /^[0-9a-f-]{36}$/.test(t(b?.event_id, 40)) ? t(b.event_id, 40) : crypto.randomUUID() }; };

async function verifyTurnstile(req: Request, db: any, token: string): Promise<boolean> {
  const secret = env("TURNSTILE_SECRET_KEY") || (await db.from("site_settings").select("value").eq("key", "turnstile_secret").maybeSingle()).data?.value || "";
  if (!secret) return true;              // same behaviour as the mock form today
  if (!token) return false;
  try { const fd = new FormData(); fd.append("secret", secret); fd.append("response", token);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(); if (ip) fd.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return !!j.success && (!j.hostname || /(^|\.)deutschfuralle\.com$/.test(j.hostname));
  } catch (_) { return false; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const u = new URL(req.url);
  if (req.method === "GET") {
    const key = (await db.from("site_settings").select("value").eq("key", "leads_csv_key").maybeSingle()).data?.value;
    if (!key || u.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });
    const ATTR_HEAD = ["Form Type", "utm_source", "utm_medium", "utm_campaign", "utm_content", "Landing Page", "First Touch (PKT)", "gclid", "fbclid", "Event ID"];
    const attrCells = (r: any) => [r.form_type, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.landing_page, pkt(r.first_touch_at), r.gclid, r.fbclid, r.event_id];
    const csv = (all: unknown[][]) => new Response(all.map((r) => r.map(cell).join(",")).join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
    if (u.searchParams.get("table") === "registration") {
      const { data, error } = await db.from("registration_leads").select("*").order("created_at", { ascending: true }).limit(20000);
      if (error) return new Response("error", { status: 500 });
      const head = ["Submitted (PKT)", "Name", "Phone / WhatsApp", "Email", "Course", "Timing", "Message", "Sent via", "Marketing consent", "Page", "Lead ID", ...ATTR_HEAD];
      const rows = (data || []).map((r: any) => [pkt(r.created_at), r.name + (r.is_test ? " (TEST)" : ""), r.phone, r.email ?? "", r.course, r.timing, r.message ?? "", r.send_via === "mail" ? "Email" : "WhatsApp", r.consent ? "Yes" : "No", r.page ?? "", r.id, ...attrCells(r)]);
      return csv(u.searchParams.get("h") === "0" ? rows : [head, ...rows]);
    }
    const { data, error } = await db.from("mock_exam_leads").select("*").order("created_at", { ascending: true }).limit(20000);
    if (error) return new Response("error", { status: 500 });
    const head = ["Submitted (PKT)", "Exam", "First name", "Last name", "Email", "Phone / WhatsApp", "Country", "City", "German level", "Goal", "Heard about us", "Marketing consent", "Logged-in student", "Score (/100)", "Finished (PKT)", "Hören", "Lesen", "Schreiben", "Sprechen", "Lead ID", "AI Schreiben T2 (/10)", "Student e-mail (Schreiben T2)", "AI Sprechen (/15)", "Sprechen transcripts", ...ATTR_HEAD];
    const rows = (data || []).map((r: any) => [pkt(r.created_at), r.exam + (r.is_test ? " (TEST)" : ""), r.first_name, r.last_name, r.email, r.phone, r.country, r.city, r.level, r.goal, r.heard_from, r.consent ? "Yes" : "No", r.user_id ? "Yes" : "No", r.score ?? "", pkt(r.finished_at), r.score_detail?.H ?? "", r.score_detail?.L ?? "", r.score_detail?.S ?? "", r.score_detail?.P ?? "", r.id, r.writing_ai_score ?? "", r.writing_text ?? "", r.speaking_ai_score ?? "", ["p1","p2","p3"].filter((k) => r.speaking_ai_feedback?.[k]).map((k) => k.toUpperCase() + " (" + r.speaking_ai_feedback[k].total + "/" + r.speaking_ai_feedback[k].max + "): " + (r.speaking_ai_feedback[k].transcript || "")).join(" | "), ...attrCells(r)]);
    const all = u.searchParams.get("h") === "0" ? rows : [head, ...rows];
    return csv(all);
  }
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  try {
    if (b.action === "score") {
      const id = t(b.id, 40), tok = t(b.token, 40), sc = Math.round(Number(b.score));
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(tok) || !(sc >= 0 && sc <= 100)) return json({ error: "bad request" }, 400);
      const d = b.detail || {}; const n = (x: unknown) => { const v = Number(x); return v >= 0 && v <= 25 ? v : null; };
      const { data, error } = await db.from("mock_exam_leads").update({ score: sc, score_detail: { H: n(d.H), L: n(d.L), S: n(d.S), P: n(d.P) }, finished_at: new Date().toISOString() }).eq("id", id).eq("edit_token", tok).select("id");
      // Row gone (e.g. deleted test lead) or wrong token: answer 200 so browsers do not log a 404; the page then forgets the stale lead.
      if (error || !data?.length) return json({ ok: false, gone: true, error: "not found" });
      return json({ ok: true });
    }
    if (b.action === "clone") {
      const id = t(b.id, 40), tok = t(b.token, 40), exam = EXAMS[t(b.exam, 30)];
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(tok) || !exam) return json({ error: "bad request" }, 400);
      const { data: src } = await db.from("mock_exam_leads").select("first_name,last_name,email,phone,country,city,level,goal,heard_from,consent,consent_text,user_id,is_test").eq("id", id).eq("edit_token", tok).maybeSingle();
      if (!src) return json({ ok: false, gone: true, error: "not found" });
      const since = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await db.from("mock_exam_leads").select("id", { count: "exact", head: true }).eq("email", src.email).gte("created_at", since);
      if ((count || 0) >= 12) return json({ error: "Please wait a little and try again." }, 429);
      const { data, error } = await db.from("mock_exam_leads").insert({ ...src, exam, page: t(b.page, 200), user_agent: t(req.headers.get("user-agent"), 200) }).select("id,edit_token").single();
      if (error) return json({ error: "We could not save your details right now. Please try again in a minute." }, 500);
      return json({ ok: true, id: data.id, token: data.edit_token });
    }
    if (b.action === "register") {
      if (t(b.hp)) return json({ error: "Sorry, something went wrong. Please try again." }, 400);
      const name = t(b.name, 120), phone = normPhone(t(b.phone, 30)), course = t(b.course, 60), timing = t(b.timing, 40);
      if (!name || !/^\+\d{8,15}$/.test(phone)) return json({ error: "Please enter your name and WhatsApp number with country code." }, 400);
      if (!COURSES.includes(course) || !TIMINGS.includes(timing)) return json({ error: "Please choose a course and timing." }, 400);
      if (!(await verifyTurnstile(req, db, t(b.captcha, 3000)))) return json({ error: "The security check did not go through. Please try it once more." }, 400);
      const since = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await db.from("registration_leads").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
      if ((count || 0) >= 5) return json({ ok: true, throttled: true });  // never block the WhatsApp redirect
      const a = attribution(b);
      const { error } = await db.from("registration_leads").insert({
        form_type: "Registration", name, phone, course, timing, message: t(b.message, 500) || null,
        consent: b.consent === true, consent_text: t(b.consent_text, 300) || null, send_via: b.via === "mail" ? "mail" : "wa",
        ...a, page: t(b.page, 200), user_agent: t(req.headers.get("user-agent"), 200), is_test: /\bTEST\b/.test(name),
      });
      if (error) return json({ error: "save failed" }, 500);
      return json({ ok: true, event_id: a.event_id });
    }
    if (b.action !== "submit") return json({ error: "unknown action" }, 400);
    if (t(b.hp)) return json({ error: "Sorry, something went wrong. Please try again." }, 400);
    const f = { first_name: t(b.first_name, 60), last_name: t(b.last_name, 60), email: t(b.email, 160).toLowerCase(), phone: t(b.phone, 30) || null, country: t(b.country, 60), city: t(b.city, 80) || null, level: t(b.level, 20), goal: t(b.goal, 40), heard_from: t(b.heard_from, 120) || null };
    if (!f.first_name || !f.last_name || !f.country) return json({ error: "Please fill in all required fields." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(f.email)) return json({ error: "Please check your email address." }, 400);
    if (f.phone && !/^\+?[0-9 ()-]{6,24}$/.test(f.phone)) return json({ error: "Please check your phone number (digits only, with country code)." }, 400);
    if (!LEVELS.includes(f.level) || !GOALS.includes(f.goal)) return json({ error: "Please choose your level and goal." }, 400);
    if (b.consent !== true) return json({ error: "Please tick the box to continue." }, 400);
    if ((await db.rpc("is_disposable_email", { addr: f.email })).data) return json({ error: "Please use your real email address. Temporary inboxes are not accepted.", blocked: true }, 422);
    if (!(await verifyTurnstile(req, db, t(b.captcha, 3000)))) return json({ error: t(b.captcha, 3000) ? "The security check did not go through. Please try it once more." : "Please complete the security check, then press the button again." }, 400);
    // light flood guard: max 5 forms per email per hour
    const since = new Date(Date.now() - 3600e3).toISOString();
    const { count } = await db.from("mock_exam_leads").select("id", { count: "exact", head: true }).eq("email", f.email).gte("created_at", since);
    if ((count || 0) >= 5) return json({ error: "You have sent this form a few times already. Please wait a little and try again." }, 429);
    let user_id: string | null = null;
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ") && auth.split(".").length === 3) { try { const { data } = await db.auth.getUser(auth.slice(7)); user_id = data?.user?.id || null; } catch (_) { /* anon */ } }
    const exam = EXAMS[t(b.exam, 30)] || "A1 Mock 1";
    const isTest = /\bTEST\b/.test(f.first_name + " " + f.last_name);
    const { data, error } = await db.from("mock_exam_leads").insert({ ...f, ...attribution(b), exam, consent: true, consent_text: t(b.consent_text, 300), user_id, page: t(b.page, 200), user_agent: t(req.headers.get("user-agent"), 200), is_test: isTest }).select("id,edit_token").single();
    if (error) return json({ error: "We could not save your details right now. Please try again in a minute." }, 500);
    return json({ ok: true, id: data.id, token: data.edit_token });
  } catch (_) { return json({ error: "Something went wrong. Please try again." }, 500); }
});
