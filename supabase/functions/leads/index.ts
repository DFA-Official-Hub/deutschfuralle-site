// DFA mock exam lead form. Public: submit (Turnstile + disposable-email check), score (needs the row's edit token).
// Private: GET ?csv=1&key=<site_settings.leads_csv_key> returns all rows as CSV for the Google Sheet (IMPORTDATA).
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const LEVELS = ["Beginner", "A1", "A2", "B1", "B2+"];
const GOALS = ["Study in Germany", "Job", "Ausbildung", "Nursing", "Exam prep", "Hobby", "Other"];
const EXAMS: Record<string, string> = { "a1-mock-1": "A1 Mock 1" };
const t = (x: unknown, n = 120) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const pkt = (d: string | null) => d ? new Date(new Date(d).getTime() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
const cell = (v: unknown) => { let s = String(v ?? ""); if (/^[=@]/.test(s)) s = " " + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const u = new URL(req.url);
  if (req.method === "GET") {
    const key = (await db.from("site_settings").select("value").eq("key", "leads_csv_key").maybeSingle()).data?.value;
    if (!key || u.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });
    const { data, error } = await db.from("mock_exam_leads").select("*").order("created_at", { ascending: true }).limit(20000);
    if (error) return new Response("error", { status: 500 });
    const head = ["Submitted (PKT)", "Exam", "First name", "Last name", "Email", "Phone / WhatsApp", "Country", "City", "German level", "Goal", "Heard about us", "Marketing consent", "Logged-in student", "Score (/100)", "Finished (PKT)", "Hören", "Lesen", "Schreiben", "Sprechen", "Lead ID", "AI Schreiben T2 (/10)", "Student e-mail (Schreiben T2)", "AI Sprechen (/15)", "Sprechen transcripts"];
    const rows = (data || []).map((r: any) => [pkt(r.created_at), r.exam + (r.is_test ? " (TEST)" : ""), r.first_name, r.last_name, r.email, r.phone, r.country, r.city, r.level, r.goal, r.heard_from, r.consent ? "Yes" : "No", r.user_id ? "Yes" : "No", r.score ?? "", pkt(r.finished_at), r.score_detail?.H ?? "", r.score_detail?.L ?? "", r.score_detail?.S ?? "", r.score_detail?.P ?? "", r.id, r.writing_ai_score ?? "", r.writing_text ?? "", r.speaking_ai_score ?? "", ["p1","p2","p3"].filter((k) => r.speaking_ai_feedback?.[k]).map((k) => k.toUpperCase() + " (" + r.speaking_ai_feedback[k].total + "/" + r.speaking_ai_feedback[k].max + "): " + (r.speaking_ai_feedback[k].transcript || "")).join(" | ")]);
    const all = u.searchParams.get("h") === "0" ? rows : [head, ...rows];
    return new Response(all.map((r) => r.map(cell).join(",")).join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
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
    if (b.action !== "submit") return json({ error: "unknown action" }, 400);
    if (t(b.hp)) return json({ error: "Sorry, something went wrong. Please try again." }, 400);
    const f = { first_name: t(b.first_name, 60), last_name: t(b.last_name, 60), email: t(b.email, 160).toLowerCase(), phone: t(b.phone, 30) || null, country: t(b.country, 60), city: t(b.city, 80) || null, level: t(b.level, 20), goal: t(b.goal, 40), heard_from: t(b.heard_from, 120) || null };
    if (!f.first_name || !f.last_name || !f.country) return json({ error: "Please fill in all required fields." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(f.email)) return json({ error: "Please check your email address." }, 400);
    if (f.phone && !/^\+?[0-9 ()-]{6,24}$/.test(f.phone)) return json({ error: "Please check your phone number (digits only, with country code)." }, 400);
    if (!LEVELS.includes(f.level) || !GOALS.includes(f.goal)) return json({ error: "Please choose your level and goal." }, 400);
    if (b.consent !== true) return json({ error: "Please tick the box to continue." }, 400);
    if ((await db.rpc("is_disposable_email", { addr: f.email })).data) return json({ error: "Please use your real email address. Temporary inboxes are not accepted.", blocked: true }, 422);
    const tsSecret = env("TURNSTILE_SECRET_KEY") || (await db.from("site_settings").select("value").eq("key", "turnstile_secret").maybeSingle()).data?.value || "";
    if (tsSecret) {
      const tok = t(b.captcha, 3000); if (!tok) return json({ error: "Please complete the security check, then press the button again." }, 400);
      let ok = false;
      try { const fd = new FormData(); fd.append("secret", tsSecret); fd.append("response", tok); const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(); if (ip) fd.append("remoteip", ip);
        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd, signal: AbortSignal.timeout(8000) }); const j = await r.json(); ok = !!j.success && (!j.hostname || /(^|\.)deutschfuralle\.com$/.test(j.hostname)); } catch (_) { ok = false; }
      if (!ok) return json({ error: "The security check did not go through. Please try it once more." }, 400);
    }
    // light flood guard: max 5 forms per email per hour
    const since = new Date(Date.now() - 3600e3).toISOString();
    const { count } = await db.from("mock_exam_leads").select("id", { count: "exact", head: true }).eq("email", f.email).gte("created_at", since);
    if ((count || 0) >= 5) return json({ error: "You have sent this form a few times already. Please wait a little and try again." }, 429);
    let user_id: string | null = null;
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ") && auth.split(".").length === 3) { try { const { data } = await db.auth.getUser(auth.slice(7)); user_id = data?.user?.id || null; } catch (_) { /* anon */ } }
    const exam = EXAMS[t(b.exam, 30)] || "A1 Mock 1";
    const isTest = /\bTEST\b/.test(f.first_name + " " + f.last_name);
    const { data, error } = await db.from("mock_exam_leads").insert({ ...f, exam, consent: true, consent_text: t(b.consent_text, 300), user_id, page: t(b.page, 200), user_agent: t(req.headers.get("user-agent"), 200), is_test: isTest }).select("id,edit_token").single();
    if (error) return json({ error: "We could not save your details right now. Please try again in a minute." }, 500);
    return json({ ok: true, id: data.id, token: data.edit_token });
  } catch (_) { return json({ error: "Something went wrong. Please try again." }, 500); }
});
