// Website Leads -> Google Sheets sync for the `leads` edge function.
// Runs only after the lead row is safely stored in Supabase. Every failure is caught and logged with the Supabase id
// so a catch-up can retry; nothing in here can fail a lead save. Writes go to one tab of one spreadsheet, as plain text
// (RAW), and only ever add a row or fill empty cells. Secrets are read from the environment by name and never logged:
//   SHEETS_SERVICE_ACCOUNT_JSON  service account key (skip the sync when unset)
//   SHEETS_SPREADSHEET_ID        spreadsheet id
//   SHEETS_TAB_NAME              tab name (default "Website Leads")
//   SHEETS_DRY_RUN               "1" = read and plan, log the would-be write, send no write

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

// ---------- test-lead detector ----------
// Case-insensitive whole word: "XYZ Test", "TEST", "test user" match; "Contest", "Testa", "Testimony" do not.
export const isTestName = (s: unknown): boolean => /\btest\b/i.test(String(s ?? ""));

// ---------- phone ----------
const MOROCCO = /(^|[^a-z])(maroc|morocco)([^a-z]|$)|المغرب/i;
const EGYPT = /(^|[^a-z])(egypt|egypte|égypte)([^a-z]|$)|مصر/i;
const PAKISTAN = /(^|[^a-z])pakistan([^a-z]|$)|پاکستان/i;
/** Normalise to E.164 where it is unambiguous.
 *  Without a country (the registration form) this is the long-standing rule: 03xxxxxxxxx / 92xxxxxxxxxx -> +92.
 *  With a country (mock exam form) local numbers get that country's prefix only, so +92 is never forced onto another country.
 *  Already-international numbers (+216..., +212..., 00...) are kept as they are. */
export function normPhone(p: string, country?: string): string {
  let d = String(p ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) return d;
  if (country === undefined) {
    if (/^03\d{9}$/.test(d)) d = "+92" + d.slice(1);
    else if (/^92\d{10}$/.test(d)) d = "+" + d;
    return d;
  }
  if (MOROCCO.test(country)) {
    if (/^0[567]\d{8}$/.test(d)) return "+212" + d.slice(1);
    if (/^212[567]\d{8}$/.test(d)) return "+" + d;
  } else if (EGYPT.test(country)) {
    if (/^01[0125]\d{8}$/.test(d)) return "+20" + d.slice(1);
    if (/^201[0125]\d{8}$/.test(d)) return "+" + d;
  } else if (PAKISTAN.test(country)) {
    if (/^03\d{9}$/.test(d)) return "+92" + d.slice(1);
    if (/^92\d{10}$/.test(d)) return "+" + d;
  }
  return d;
}
/** Digit-only variants used for matching: E.164 digits and the raw digits ("0676091056" and "+212676091056" both match the same person). */
export function phoneKeys(...vals: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of vals) { const d = String(v ?? "").replace(/\D/g, ""); if (d.length >= 7) out.add(d); }
  return out;
}

// ---------- time ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pktDate = (iso: string) => { const d = new Date(new Date(iso).getTime() + 5 * 3600e3); return isNaN(d.getTime()) ? null : d; };
/** "2026-11-11 14:05:09" (Asia/Karachi) */
export function pktStamp(iso: string): string { const d = pktDate(iso); return d ? d.toISOString().slice(0, 19).replace("T", " ") : ""; }
/** "11 Nov 2026, 14:05" (Asia/Karachi) */
export function pktNote(iso: string): string { const d = pktDate(iso); return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${d.toISOString().slice(11, 16)}` : ""; }

// ---------- lead shape ----------
export interface SheetLead {
  kind: "registration" | "mock_exam";
  table: "registration_leads" | "mock_exam_leads";
  id: string; createdAt: string; rawPhone: string;   // rawPhone = what the person typed, kept for matching
  name: string; phone: string; email: string; course: string; heardFrom: string;
  utmSource: string; utmMedium: string; utmCampaign: string; landing: string;
  extra: string[];                       // "Timing: ...", "Level: ..." etc. for the create note
}
const s = (v: unknown) => String(v ?? "");
const attr = (a: any) => ({ utmSource: s(a?.utm_source), utmMedium: s(a?.utm_medium), utmCampaign: s(a?.utm_campaign), landing: s(a?.landing_page) });
export function registrationLead(id: string, createdAt: string, r: any): SheetLead {
  return { kind: "registration", table: "registration_leads", id, createdAt, rawPhone: s(r.raw_phone ?? r.phone), name: s(r.name), phone: normPhone(s(r.phone)), email: s(r.email).toLowerCase(),
    course: s(r.course), heardFrom: "", ...attr(r), extra: r.timing ? ["Timing: " + s(r.timing)] : [] };
}
export function mockExamLead(id: string, createdAt: string, r: any): SheetLead {
  const x: string[] = [];
  if (r.level) x.push("Level: " + s(r.level)); if (r.goal) x.push("Goal: " + s(r.goal));
  if (r.country) x.push("Country: " + s(r.country)); if (r.city) x.push("City: " + s(r.city));
  return { kind: "mock_exam", table: "mock_exam_leads", id, createdAt, rawPhone: s(r.raw_phone ?? r.phone),
    name: (s(r.first_name) + " " + s(r.last_name)).trim(), phone: r.phone ? normPhone(s(r.phone), s(r.country)) : "", email: s(r.email).toLowerCase(),
    course: s(r.exam), heardFrom: s(r.heard_from), ...attr(r), extra: x };
}
const createNote = (l: SheetLead) =>
  `Website ${l.kind === "registration" ? "Registration" : "Mock Exam"} on ${pktNote(l.createdAt)} PKT. Course/exam: ${l.course}.` + (l.extra.length ? " " + l.extra.map((e) => e + ".").join(" ") : "");
const resubmitNote = (l: SheetLead) => `Re-submitted: ${l.kind}, ${l.course}, ${pktNote(l.createdAt)} PKT, ${l.table} ${l.id}.`;

// ---------- columns ----------
const HEAD: Record<string, string> = {
  created: "created (pkt)", name: "name", phone: "phone (e.164)", email: "email", form: "form (registration/mock_exam)", course: "course/exam",
  utmSource: "utm_source", utmMedium: "utm_medium", utmCampaign: "utm_campaign", landing: "landing page", referrer: "referrer", heard: "heard from",
  table: "supabase table", id: "supabase id", status: "status", notes: "notes",
};
type ColKey = keyof typeof HEAD;
const norm = (x: unknown) => s(x).trim().toLowerCase().replace(/\s+/g, " ");
export function mapHeader(row: string[]): Record<ColKey, number> {
  const idx: any = {}, missing: string[] = [];
  const cells = row.map(norm);
  for (const k of Object.keys(HEAD)) { const i = cells.indexOf(HEAD[k]); if (i < 0) missing.push(HEAD[k]); idx[k] = i; }
  if (missing.length) throw new Error("Website Leads header row is missing: " + missing.join(", "));
  return idx;
}
const colLetter = (i: number) => { let n = i + 1, out = ""; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
const cellAt = (row: string[], i: number) => s(row[i]);

// ---------- plan ----------
export type Plan =
  | { action: "append"; row: string[]; testRows: number[] }
  | { action: "update"; rowNumber: number; updates: { col: ColKey; value: string }[]; resubmitted: boolean; matchedRows: number[]; testRows: number[] }
  | { action: "none"; rowNumber: number; matchedRows: number[]; testRows: number[] };

/** `values` is the whole tab as returned by the Sheets API (row 1 = header). Pure function: no I/O. */
export function planSync(values: string[][], lead: SheetLead): Plan {
  const idx = mapHeader(values[0] || []);
  const body = values.slice(1).map((r, i) => ({ r, n: i + 2 }));
  // Test rows already on the tab are only reported (never touched).
  const testRows = body.filter(({ r }) => isTestName(cellAt(r, idx.name)) || isTestName(cellAt(r, idx.course))).map((x) => x.n);

  const myPhones = phoneKeys(lead.phone, lead.rawPhone);
  let matches = body.filter(({ r }) => cellAt(r, idx.id) === lead.id);
  if (!matches.length && myPhones.size) matches = body.filter(({ r }) => { const k = phoneKeys(cellAt(r, idx.phone)); for (const p of k) if (myPhones.has(p)) return true; return false; });
  if (!matches.length && lead.email) matches = body.filter(({ r }) => norm(cellAt(r, idx.email)) === lead.email);

  if (!matches.length) {
    const row: string[] = new Array(Math.max(...Object.values(idx)) + 1).fill("");
    const put = (k: ColKey, v: string) => { row[idx[k]] = v; };
    put("created", pktStamp(lead.createdAt)); put("name", lead.name); put("phone", lead.phone); put("email", lead.email);
    put("form", lead.kind); put("course", lead.course); put("utmSource", lead.utmSource); put("utmMedium", lead.utmMedium); put("utmCampaign", lead.utmCampaign);
    put("landing", lead.landing); put("referrer", ""); put("heard", lead.heardFrom); put("table", lead.table); put("id", lead.id); put("status", "New"); put("notes", createNote(lead));
    return { action: "append", row, testRows };
  }

  // Newest match wins (Created (PKT) sorts as text); ties go to the lower row number.
  const sorted = [...matches].sort((a, b) => cellAt(b.r, idx.created).localeCompare(cellAt(a.r, idx.created)) || a.n - b.n);
  const hit = sorted[0], matchedRows = matches.map((m) => m.n);
  const sameId = cellAt(hit.r, idx.id) === lead.id;
  const updates: { col: ColKey; value: string }[] = [];
  // Fill empty cells only. First-touch fields, Created, Status and the original Supabase id are never overwritten (an empty one may be filled).
  const fill = (k: ColKey, v: string) => { if (v && !cellAt(hit.r, idx[k]).trim()) updates.push({ col: k, value: v }); };
  fill("name", lead.name); fill("phone", lead.phone); fill("email", lead.email); fill("form", lead.kind); fill("course", lead.course);
  fill("created", pktStamp(lead.createdAt)); fill("utmSource", lead.utmSource); fill("utmMedium", lead.utmMedium); fill("utmCampaign", lead.utmCampaign);
  fill("landing", lead.landing); fill("heard", lead.heardFrom); fill("table", lead.table); fill("id", lead.id);   // Status is never touched on an existing row
  const oldNotes = cellAt(hit.r, idx.notes);
  let resubmitted = false;
  if (!oldNotes.trim()) updates.push({ col: "notes", value: sameId ? createNote(lead) : createNote(lead) + "\n" + resubmitNote(lead) }), resubmitted = !sameId;
  else if (!sameId && !oldNotes.includes(lead.id)) { updates.push({ col: "notes", value: oldNotes + "\n" + resubmitNote(lead) }); resubmitted = true; }
  return updates.length ? { action: "update", rowNumber: hit.n, updates, resubmitted, matchedRows, testRows } : { action: "none", rowNumber: hit.n, matchedRows, testRows };
}

// ---------- Google auth (service account JWT, signed with WebCrypto) ----------
const b64u = (b: ArrayBuffer | string) => { const u = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b); let o = ""; for (const c of u) o += String.fromCharCode(c); return btoa(o).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export async function signJwt(sa: { client_email: string; private_key: string }, nowSec: number): Promise<string> {
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claims));
  return head + "." + claims + "." + b64u(sig);
}
let tokenCache: { token: string; exp: number } | null = null;
export const resetTokenCache = () => { tokenCache = null; };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface SyncDeps { env: (k: string) => string; fetch?: Fetch; log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }; sleep?: (ms: number) => Promise<void>; now?: () => number }

// One try plus one retry on 429 / 5xx / network error. Never loops.
async function call(deps: SyncDeps, url: string, init: RequestInit): Promise<Response> {
  const f = deps.fetch ?? fetch, sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await f(url, { ...init, signal: AbortSignal.timeout(8000) });
      if ((r.status === 429 || r.status >= 500) && attempt === 0) { await r.body?.cancel(); await sleep(600); continue; }
      return r;
    } catch (e) { if (attempt === 0) { await sleep(600); continue; } throw e; }
  }
}
async function accessToken(deps: SyncDeps, sa: any): Promise<string> {
  const nowMs = (deps.now ?? Date.now)();
  if (tokenCache && tokenCache.exp - 60e3 > nowMs) return tokenCache.token;
  const jwt = await signJwt(sa, Math.floor(nowMs / 1000));
  const r = await call(deps, TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!r.ok) { await r.body?.cancel(); throw new Error("Google token request failed: HTTP " + r.status); }
  const j = await r.json();
  if (!j.access_token) throw new Error("Google token response had no access_token");
  tokenCache = { token: j.access_token, exp: nowMs + (Number(j.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

export type SyncResult = { status: "skipped"; reason: string } | { status: "dry-run" | "appended" | "updated" | "unchanged"; detail: string };

/** Sync one lead. Throws on Sheets errors; use syncLeadSafe from the request path. */
export async function syncLead(lead: SheetLead, isTest: boolean, deps: SyncDeps): Promise<SyncResult> {
  if (isTest) return { status: "skipped", reason: "test lead" };
  const raw = deps.env("SHEETS_SERVICE_ACCOUNT_JSON");
  if (!raw) return { status: "skipped", reason: "SHEETS_SERVICE_ACCOUNT_JSON not set" };
  const log = deps.log ?? console;
  const sheetId = deps.env("SHEETS_SPREADSHEET_ID"), tab = deps.env("SHEETS_TAB_NAME") || "Website Leads";
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) throw new Error("SHEETS_SPREADSHEET_ID is missing or malformed");
  let sa: any; try { sa = JSON.parse(raw); } catch { throw new Error("SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON"); }
  if (!sa?.client_email || !sa?.private_key) throw new Error("SHEETS_SERVICE_ACCOUNT_JSON has no client_email / private_key");
  const dry = deps.env("SHEETS_DRY_RUN") === "1";
  const q = "'" + tab.replace(/'/g, "''") + "'";
  const token = await accessToken(deps, sa);
  const auth = { Authorization: "Bearer " + token };

  const rr = await call(deps, `${API}/${sheetId}/values/${encodeURIComponent(q + "!A:Z")}?valueRenderOption=FORMATTED_VALUE`, { headers: auth });
  if (!rr.ok) { await rr.body?.cancel(); throw new Error("Sheets read failed: HTTP " + rr.status); }
  const values: string[][] = ((await rr.json()).values || []).map((r: unknown[]) => r.map(s));
  const plan = planSync(values, lead);
  if (plan.testRows.length) log.warn(`leads->sheets: test-looking row(s) already on "${tab}" at row(s) ${plan.testRows.join(", ")}; not touched, report to Lead & CRM Manager for manual removal`);
  if (plan.action !== "append" && plan.matchedRows.length > 1) log.warn(`leads->sheets: id ${lead.id} matched several rows (${plan.matchedRows.join(", ")}); updating the newest, row ${plan.rowNumber}`);

  if (plan.action === "none") return { status: "unchanged", detail: `row ${plan.rowNumber} already complete` };
  const idx = mapHeader(values[0]);
  if (plan.action === "append") {
    if (dry) { log.info(`leads->sheets DRY RUN: would append 1 row (${plan.row.filter(Boolean).length} filled cells) for id ${lead.id}`); return { status: "dry-run", detail: "append" }; }
    const r = await call(deps, `${API}/${sheetId}/values/${encodeURIComponent(q + "!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ majorDimension: "ROWS", values: [plan.row] }) });
    if (!r.ok) { await r.body?.cancel(); throw new Error("Sheets append failed: HTTP " + r.status); }
    await r.body?.cancel();
    return { status: "appended", detail: "new row" };
  }
  if (dry) { log.info(`leads->sheets DRY RUN: would fill ${plan.updates.length} cell(s) [${plan.updates.map((u) => HEAD[u.col]).join(", ")}] on row ${plan.rowNumber}${plan.resubmitted ? " with a Re-submitted note" : ""} for id ${lead.id}`); return { status: "dry-run", detail: "update" }; }
  const data = plan.updates.map((u) => ({ range: `${q}!${colLetter(idx[u.col])}${plan.rowNumber}`, values: [[u.value]] }));
  const r = await call(deps, `${API}/${sheetId}/values:batchUpdate`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "RAW", data }) });
  if (!r.ok) { await r.body?.cancel(); throw new Error("Sheets update failed: HTTP " + r.status); }
  await r.body?.cancel();
  return { status: "updated", detail: `row ${plan.rowNumber}${plan.resubmitted ? " (re-submitted)" : ""}` };
}

/** Never throws. A failure is logged with the Supabase id so it can be retried by hand. Error text is the message only (no key material). */
export async function syncLeadSafe(lead: SheetLead, isTest: boolean, deps: SyncDeps): Promise<void> {
  const log = deps.log ?? console;
  try { const r = await syncLead(lead, isTest, deps); if (r.status !== "skipped") log.info(`leads->sheets ${r.status}: ${r.detail} (id ${lead.id})`); }
  catch (e) { log.warn(`leads->sheets FAILED for ${lead.table} id ${lead.id}; the lead is saved in Supabase, retry the sheet sync by hand: ${(e as Error)?.message ?? "unknown error"}`); }
}

/** Run the sync without holding up the response: EdgeRuntime.waitUntil when it exists, otherwise wait at most capMs. */
export async function runInBackground(task: Promise<void>, capMs = 3000): Promise<void> {
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") { er.waitUntil(task); return; }
  let timer: number | undefined;
  await Promise.race([task, new Promise<void>((res) => { timer = setTimeout(res, capMs) as unknown as number; })]);
  clearTimeout(timer);
}

/** What the request path calls after the Supabase insert. Never throws and never needs awaiting for correctness:
 *  building the lead, the Sheets calls and the scheduling are all inside the guard. */
export async function queueSync(id: string, table: string, build: () => SheetLead, isTest: boolean, deps: SyncDeps): Promise<void> {
  const log = deps.log ?? console;
  try {
    await runInBackground((async () => {
      let lead: SheetLead;
      try { lead = build(); } catch (e) { log.warn(`leads->sheets FAILED for ${table} id ${id}; the lead is saved in Supabase: ${(e as Error)?.message ?? "unknown error"}`); return; }
      await syncLeadSafe(lead, isTest, deps);
    })());
  } catch (e) { log.warn(`leads->sheets FAILED for ${table} id ${id}; the lead is saved in Supabase: ${(e as Error)?.message ?? "unknown error"}`); }
}
