import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
// Deutsch Für Alle – login security: lockout, device check, email codes, login history, alerts, reports, uptime.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SITE = "https://www.deutschfuralle.com";
const CONTACT = "contact.deutschfuralle@gmail.com";
const MAX_FAILS = 5, LOCK_MIN = 15, MAX_DEVICES = 2, CODE_MIN = 10;
function claims(tok: string): any { try { let p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(atob(p)); } catch { return {}; } }
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
async function geo(ip: string): Promise<{ country?: string; city?: string }> {
  if (!ip || /^(10\.|127\.|192\.168\.|::1)/.test(ip)) return {};
  try { const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: AbortSignal.timeout(1500) }); const j = await r.json(); return j.error ? {} : { country: j.country_name || j.country || undefined, city: j.city || undefined }; } catch { return {}; }
}
function device(ua: string) {
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown system";
  return `${b} on ${o}`;
}
const pkTime = (d = new Date()) => d.toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " (Pakistan time)";
async function sha(s: string) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function textToHtml(text: string) {
  const esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#0d1712;max-width:640px;margin:0 auto;padding:16px"><div style="white-space:pre-wrap">${linked}</div><p style="margin-top:24px;font-size:13px;color:#5d6b63">Deutsch Für Alle · <a href="https://www.deutschfuralle.com">deutschfuralle.com</a></p></body></html>`;
}
async function send(to: string | string[], subject: string, text: string) {
  // Security emails always go out when SMTP is configured (independent of the admissions email switch).
  if (!env("ADMISSION_SMTP_PASS")) return "nosmtp";
  const user = env("ADMISSION_SMTP_USER") || "admission.deutschfuralle@gmail.com";
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: env("ADMISSION_SMTP_PASS") } });
  await t.sendMail({ from: `"Deutsch Für Alle" <${user}>`, replyTo: "admission.deutschfuralle@gmail.com", to, subject, text, html: textToHtml(text) });
  return "sent";
}
const SIGN = "\n\nKind regards,\nDeutsch Für Alle\n" + SITE;
const mask = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_m, a, b, c) => a + "*".repeat(Math.min(b.length, 6)) + c);
async function adminEmails(db: any): Promise<string[]> {
  const { data } = await db.from("profiles").select("id").eq("role", "admin");
  const out: string[] = [];
  for (const p of data || []) { const r = await db.auth.admin.getUserById(p.id); if (r.data?.user?.email) out.push(r.data.user.email); }
  return out;
}
async function isLocked(db: any, email: string, ip: string) {
  const since = new Date(Date.now() - LOCK_MIN * 60e3).toISOString();
  const ok = (await db.from("login_events").select("created_at").eq("email", email).eq("kind", "login_ok").gte("created_at", since).order("created_at", { ascending: false }).limit(1)).data?.[0]?.created_at || since;
  const f = (await db.from("login_events").select("created_at").eq("email", email).eq("kind", "login_fail").gt("created_at", ok).order("created_at", { ascending: true })).data || [];
  const ipf = ip ? (await db.from("login_events").select("id", { count: "exact", head: true }).eq("ip", ip).eq("kind", "login_fail").gte("created_at", since)).count || 0 : 0;
  if (f.length >= MAX_FAILS || ipf >= 20) {
    const first = f.length >= MAX_FAILS ? Date.parse(f[f.length - MAX_FAILS].created_at) : Date.now();
    return { locked: true, minutes: Math.max(1, Math.ceil((first + LOCK_MIN * 60e3 - Date.now()) / 60e3)), fails: f.length };
  }
  return { locked: false, fails: f.length };
}
async function newCode(db: any, user: any, sid: string | null, why: string) {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await db.from("email_codes").update({ used: true }).eq("user_id", user.id).eq("used", false);
  await db.from("email_codes").insert({ user_id: user.id, session_id: sid, code_hash: await sha(user.id + ":" + code), purpose: "login", expires_at: new Date(Date.now() + CODE_MIN * 60e3).toISOString() });
  const r = await send(user.email, `Your Deutsch Für Alle sign-in code: ${code}`,
    `Hello,\n\n${why}\n\nYour sign-in code is: ${code}\n\nEnter it on the website to finish signing in. The code is valid for ${CODE_MIN} minutes.\n\nIf this was not you, please do not share the code with anyone and change your password right away at ${SITE}/account.html.` + SIGN);
  return r;
}
async function trust(db: any, user: any, sid: string, dev: string, role: string, ev: any, wasKnown: boolean) {
  if (sid) await db.from("verified_sessions").upsert({ session_id: sid, user_id: user.id, device_id: dev });
  await db.from("auth_devices").update({ verified: true }).eq("user_id", user.id).eq("device_id", dev);
  if (role === "admin" && !wasKnown) {
    try {
      await send(user.email, "New sign-in to your Deutsch Für Alle admin account",
        `Hello,\n\nYour admin account was just signed in from a new device.\n\nDevice: ${ev.dev}\nApprox. location: ${[ev.city, ev.country].filter(Boolean).join(", ") || "unknown"}\nIP address: ${ev.ip || "unknown"}\nTime: ${pkTime()}\n\nIf this was you, no action is needed. If not, change your password immediately at ${SITE}/account.html and turn on two-step verification.` + SIGN);
    } catch (_) { /* alert is best effort */ }
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const ip = ipOf(req), ua = (req.headers.get("user-agent") || "").slice(0, 300);
  const log = async (row: any) => { try { await db.from("login_events").insert({ ip: ip || null, ua, ...row }); } catch (_) { /* ignore */ } };
  try {
    // ---- internal / scheduled calls ----
    const ct = req.headers.get("x-cron-token");
    if (ct) {
      const s = (await db.from("site_settings").select("value").eq("key", "cron_token").maybeSingle()).data;
      if (!s?.value || ct !== s.value) return json({ error: "forbidden" }, 403);
      if (body.action === "pw_changed") {
        const r = await db.auth.admin.getUserById(String(body.user_id || ""));
        const u = r.data?.user; if (!u?.email) return json({ ok: false });
        await db.from("login_events").insert({ user_id: u.id, email: u.email.toLowerCase(), kind: "pw_changed" });
        const m = await send(u.email, "Your Deutsch Für Alle password was changed",
          `Hello,\n\nThe password for your Deutsch Für Alle account (${u.email}) was changed on ${pkTime()}.\n\nIf you made this change, you can ignore this email.\n\nIf you did not, please reset your password straight away at ${SITE}/account.html (choose "Forgot your password?") and contact us at ${CONTACT}.` + SIGN);
        return json({ ok: true, email: m });
      }
      if (body.action === "monthly_report") {
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const { data: ev } = await db.from("login_events").select("kind,email,country,created_at").gte("created_at", since).limit(20000);
        const c: Record<string, number> = {}; const fails: Record<string, number> = {}; const countries = new Set<string>();
        for (const e of ev || []) { c[e.kind] = (c[e.kind] || 0) + 1; if (e.kind === "login_fail" && e.email) fails[e.email] = (fails[e.email] || 0) + 1; if (e.country) countries.add(e.country); }
        const top = Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, n]) => `  - ${mask(e)}: ${n}`).join("\n") || "  none";
        const nd = (await db.from("auth_devices").select("user_id", { count: "exact", head: true }).gte("first_seen", since)).count || 0;
        const text = `Hello,\n\nHere is the security summary for www.deutschfuralle.com for the last 30 days.\n\nSuccessful sign-ins: ${c.login_ok || 0}\nFailed sign-ins: ${c.login_fail || 0}\nTemporary lockouts: ${c.lockout || 0}\nNew devices registered: ${nd}\nDevices refused (limit of ${MAX_DEVICES} reached): ${c.device_blocked || 0}\nSign-in codes confirmed / wrong: ${c.code_ok || 0} / ${c.code_fail || 0}\nSign-ups blocked (bot check, temporary email, rate limit): ${c.signup_blocked || 0}\nPassword changes: ${c.pw_changed || 0}\nSign-in countries: ${[...countries].join(", ") || "unknown"}\n\nAccounts with the most failed sign-ins:\n${top}\n\nFull login history: ${SITE}/admin.html#security` + SIGN;
        const to = await adminEmails(db);
        const r = to.length ? await send(to, `DFA monthly security report – ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Karachi" })}`, text) : "no admins";
        return json({ ok: true, email: r, counts: c });
      }
      if (body.action === "uptime") {
        let ok = false, why = "";
        for (const u of [SITE + "/", SITE + "/courses.html"]) {
          try { const r = await fetch(u, { signal: AbortSignal.timeout(15000), redirect: "follow", headers: { "user-agent": "DFA-uptime-check" } }); ok = r.ok; why = `HTTP ${r.status}`; await r.body?.cancel(); } catch (x) { ok = false; why = String((x as Error).message || x).slice(0, 120); }
          if (!ok) break;
        }
        const st = (await db.from("site_settings").select("value").eq("key", "uptime_state").maybeSingle()).data?.value || "up";
        let next = st, mail = "";
        if (!ok) next = st === "up" ? "fail1" : "down";
        else next = "up";
        if (next === "down" && st !== "down") mail = "down"; if (next === "up" && st === "down") mail = "up";
        if (next !== st) await db.from("site_settings").upsert({ key: "uptime_state", value: next, updated_at: new Date().toISOString() });
        if (mail) {
          const to = [CONTACT, ...(await adminEmails(db))];
          await send(to, mail === "down" ? "Website down: www.deutschfuralle.com is not responding" : "Website back online: www.deutschfuralle.com",
            mail === "down" ? `Hello,\n\nOur automatic check could not reach www.deutschfuralle.com twice in a row (last result: ${why}) at ${pkTime()}.\n\nPlease check GitHub Pages (github.com/DFA-Official-Hub) and the domain settings. You will get another email as soon as the site is back.` + SIGN
              : `Hello,\n\nGood news: www.deutschfuralle.com is reachable again (checked ${pkTime()}).` + SIGN);
        }
        return json({ ok: true, up: ok, why, state: next, mail: mail || null });
      }
      return json({ error: "unknown action" }, 400);
    }
    // ---- public (no login) ----
    if (body.action === "precheck") {
      const email = String(body.email || "").trim().toLowerCase();
      return json(await isLocked(db, email, ip));
    }
    if (body.action === "login_fail") {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      const g = await geo(ip);
      await log({ email, kind: "login_fail", device_id: String(body.device_id || "").slice(0, 64) || null, country: g.country, city: g.city, detail: String(body.reason || "").slice(0, 120) || null });
      const l = await isLocked(db, email, ip);
      if (l.locked && l.fails === MAX_FAILS) await log({ email, kind: "lockout", detail: `${MAX_FAILS} failed attempts` });
      return json({ ...l, left: Math.max(0, MAX_FAILS - l.fails) });
    }
    if (body.action === "signup_check") {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      const block = async (why: string, msg: string) => { await log({ email, kind: "signup_blocked", detail: why }); return json({ ok: false, error: msg }); };
      if (String(body.hp || "")) return block("honeypot", "Sorry, we could not create the account. Please try again.");
      const tsSecret = env("TURNSTILE_SECRET_KEY") || (await db.from("site_settings").select("value").eq("key", "turnstile_secret").maybeSingle()).data?.value || "";
      if (tsSecret) {
        const tok = String(body.captcha || "");
        if (!tok) return block("no bot-check token", "Please complete the security check above the button, then press Create account again.");
        let ok = false;
        try { const f = new FormData(); f.append("secret", tsSecret); f.append("response", tok); if (ip) f.append("remoteip", ip);
          const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f, signal: AbortSignal.timeout(8000) }); const j = await r.json(); ok = !!j.success && (!j.hostname || /(^|\.)deutschfuralle\.com$/.test(j.hostname)); }
        catch (_) { ok = false; }
        if (!ok) return block("bot check failed", "The security check could not be confirmed. Please complete it again and press Create account.");
      }
      if (Number(body.ms || 0) < 4000) return block("too fast", "That was very quick. Please check your details and press Create account again.");
      const d = (await db.rpc("is_disposable_email", { addr: email })).data;
      if (d) return block("disposable email", "Please use a permanent email address. Temporary or disposable email services are not accepted.");
      const since = new Date(Date.now() - 3600e3).toISOString();
      const n = ip ? (await db.from("login_events").select("id", { count: "exact", head: true }).eq("ip", ip).in("kind", ["signup_ok", "signup_blocked"]).gte("created_at", since)).count || 0 : 0;
      if (n >= 5) return block("rate limit", "Too many sign-up attempts from your network. Please try again in an hour.");
      await log({ email, kind: "signup_ok" });
      return json({ ok: true, ts: tsSecret ? "used" : "skipped" });
    }
    // ---- logged-in user ----
    const tok = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: ud } = await db.auth.getUser(tok);
    const user = ud?.user; if (!user) return json({ error: "Please log in again." }, 401);
    const cl = claims(tok), sid: string = cl.session_id || "";
    const role = (await db.from("profiles").select("role").eq("id", user.id).maybeSingle()).data?.role || "user";
    const email = String(user.email || "").toLowerCase();
    if (body.action === "check") {
      const dev = String(body.device_id || "").slice(0, 64) || "unknown";
      if (sid) { const v = (await db.from("verified_sessions").select("session_id").eq("session_id", sid).maybeSingle()).data; if (v) { await db.from("auth_devices").update({ last_seen: new Date().toISOString() }).eq("user_id", user.id).eq("device_id", dev); return json({ ok: true }); } }
      const g = await geo(ip), dn = device(ua);
      const devs = (await db.from("auth_devices").select("device_id,country,verified").eq("user_id", user.id)).data || [];
      const known = devs.find((d: any) => d.device_id === dev);
      if (!known && role !== "admin" && devs.length >= MAX_DEVICES) {
        await log({ user_id: user.id, email, kind: "device_blocked", device_id: dev, country: g.country, city: g.city, detail: dn });
        return json({ ok: false, blocked: "devices", error: `This account is already used on ${MAX_DEVICES} devices, which is the limit for student accounts. Please sign in on one of your usual devices, or ask us to reset your devices (${SITE}/contact.html).` });
      }
      await log({ user_id: user.id, email, kind: "login_ok", device_id: dev, country: g.country, city: g.city, detail: dn + (cl.aal === "aal2" ? " · 2FA" : "") });
      if (known) await db.from("auth_devices").update({ last_seen: new Date().toISOString(), ua: dn, ip, country: g.country || known.country }).eq("user_id", user.id).eq("device_id", dev);
      else await db.from("auth_devices").insert({ user_id: user.id, device_id: dev, ua: dn, ip, country: g.country || null, verified: false });
      const pref = (await db.from("security_prefs").select("email_2fa").eq("user_id", user.id).maybeSingle()).data?.email_2fa || false;
      const newCountry = !!(known?.country && g.country && known.country !== g.country);
      const suspicious = (!known && devs.length > 0) || newCountry || (known && !known.verified && devs.length > 1);
      const need = cl.aal !== "aal2" && (pref || suspicious);
      if (need) {
        const why = pref ? "You asked us to send a code every time you sign in." : `We noticed a sign-in from a ${newCountry ? "new location" : "new device"} (${dn}${g.country ? ", " + g.country : ""}).`;
        const last = (await db.from("email_codes").select("created_at,session_id,used,expires_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
        const fresh = last && !last.used && last.session_id === sid && Date.parse(last.expires_at) > Date.now() + 60e3;
        if (!fresh) await newCode(db, user, sid || null, why);
        await log({ user_id: user.id, email, kind: "code_sent", device_id: dev, detail: pref ? "email 2FA" : newCountry ? "new location" : "new device" });
        return json({ ok: false, challenge: "email", to: mask(email) });
      }
      await trust(db, user, sid, dev, role, { dev: dn, ip, ...g }, !!known);
      return json({ ok: true });
    }
    if (body.action === "verify_code") {
      const code = String(body.code || "").replace(/\D/g, "");
      const dev = String(body.device_id || "").slice(0, 64) || "unknown";
      const c = (await db.from("email_codes").select("*").eq("user_id", user.id).eq("used", false).order("created_at", { ascending: false }).limit(1)).data?.[0];
      if (!c || Date.parse(c.expires_at) < Date.now()) return json({ ok: false, error: "This code has expired. Please ask for a new one." });
      if (c.attempts >= 5) return json({ ok: false, error: "Too many wrong codes. Please ask for a new one." });
      if (c.code_hash !== await sha(user.id + ":" + code)) { await db.from("email_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id); await log({ user_id: user.id, email, kind: "code_fail", device_id: dev }); return json({ ok: false, error: "That code is not correct. Please check the latest email from us." }); }
      await db.from("email_codes").update({ used: true }).eq("id", c.id);
      const known = (await db.from("auth_devices").select("verified").eq("user_id", user.id).eq("device_id", dev).maybeSingle()).data;
      await log({ user_id: user.id, email, kind: "code_ok", device_id: dev });
      await trust(db, user, sid, dev, role, { dev: device(ua), ip, ...(await geo(ip)) }, !!known?.verified);
      return json({ ok: true });
    }
    if (body.action === "resend_code") {
      const last = (await db.from("email_codes").select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
      if (last && Date.now() - Date.parse(last.created_at) < 60e3) return json({ ok: false, error: "Please wait a minute before asking for another code." });
      await newCode(db, user, sid || null, "You asked for a new sign-in code.");
      return json({ ok: true, to: mask(email) });
    }
    if (body.action === "prefs_get") {
      const p = (await db.from("security_prefs").select("email_2fa").eq("user_id", user.id).maybeSingle()).data;
      const devs = (await db.from("auth_devices").select("device_id,ua,country,first_seen,last_seen").eq("user_id", user.id).order("last_seen", { ascending: false })).data || [];
      return json({ email_2fa: !!p?.email_2fa, devices: devs, max_devices: role === "admin" ? null : MAX_DEVICES });
    }
    if (body.action === "prefs_set") {
      if (cl.aal !== "aal2" && !(sid && (await db.from("verified_sessions").select("session_id").eq("session_id", sid).maybeSingle()).data)) return json({ error: "Please confirm this sign-in first." }, 403);
      await db.from("security_prefs").upsert({ user_id: user.id, email_2fa: !!body.email_2fa, updated_at: new Date().toISOString() });
      await log({ user_id: user.id, email, kind: "2fa_change", detail: "email code " + (body.email_2fa ? "on" : "off") });
      return json({ ok: true });
    }
    if (body.action === "mfa_changed") { await log({ user_id: user.id, email, kind: "2fa_change", detail: String(body.what || "").slice(0, 60) }); return json({ ok: true }); }
    // ---- admin only (confirmed session) ----
    if (role !== "admin") return json({ error: "forbidden" }, 403);
    if (!(sid && (await db.from("verified_sessions").select("session_id").eq("session_id", sid).maybeSingle()).data)) return json({ error: "Please confirm this sign-in first (reload the page).", code: "verify_session" }, 403);
    if (body.action === "history") {
      const q = db.from("login_events").select("id,email,kind,ip,country,city,detail,device_id,created_at").order("created_at", { ascending: false }).limit(Math.min(Number(body.limit) || 300, 1000));
      const { data, error } = body.kind ? await q.eq("kind", String(body.kind)) : await q;
      if (error) return json({ error: error.message }, 500);
      return json({ events: data });
    }
    if (body.action === "reset_devices") {
      const id = String(body.user_id || "");
      await db.from("auth_devices").delete().eq("user_id", id);
      await db.from("verified_sessions").delete().eq("user_id", id);
      await db.from("reader_devices").delete().eq("user_id", id);
      await log({ user_id: id, kind: "devices_reset", detail: "by admin " + mask(email) });
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (x) { return json({ error: String((x as Error).message || x) }, 500); }
});
