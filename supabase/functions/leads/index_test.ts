// End-to-end tests of the request handler in index.ts with every outside call mocked (Supabase REST, Turnstile, Google token + Sheets).
// Nothing here touches the network or any real credential.
import { assert, assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import { C, MockSheets, SHEET_ID, testServiceAccountJson } from "./test_helpers.ts";
import { resetTokenCache } from "./sheets.ts";

const SB = "https://mock-project.supabase.co";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", CREATED = "2026-11-11T09:05:09.123456+00:00";
let handler!: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} } };

const sheets = new MockSheets();
const inserts: { table: string; body: any }[] = [];
let insertFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const g = await sheets.handle(url, init); if (g) return g;
  const j = (b: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });
  if (url.startsWith("https://challenges.cloudflare.com/")) { const ok = String((init?.body as FormData).get("response")) === "good"; return j({ success: ok, hostname: "www.deutschfuralle.com" }); }
  if (!url.startsWith(SB)) return new Response("unmocked " + url, { status: 599 });
  const u = new URL(url), method = (init?.method || "GET").toUpperCase(), table = u.pathname.split("/").pop()!;
  if (u.pathname.endsWith("/rpc/is_disposable_email")) return j(false);
  if (table === "site_settings") return j({ code: "PGRST116", message: "no rows" }, 406);
  if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
  if (method === "POST") {
    if (insertFails) return j({ message: "boom" }, 500);
    const body = JSON.parse(String(init!.body)); inserts.push({ table, body });
    return j(table === "registration_leads" ? { id: ID, created_at: CREATED } : { id: ID, edit_token: TOKEN, created_at: CREATED }, 201);
  }
  if (method === "GET" && table === "mock_exam_leads") return j({ first_name: "Aya", last_name: "Mostafa", email: "aya@example.com", phone: "+201012345678", country: "Egypt", city: null, level: "A1", goal: "Job", heard_from: null, consent: true, consent_text: "x", user_id: null, is_test: false });
  if (method === "PATCH") return j([]);
  return j([]);
}) as typeof fetch;

const logs: string[] = []; const warn = console.warn; const info = console.log; const infoI = console.info;
console.warn = (...a: unknown[]) => { logs.push(a.join(" ")); }; console.log = (...a: unknown[]) => { logs.push(a.join(" ")); }; console.info = console.log;

Deno.env.set("SUPABASE_URL", SB); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-for-tests-only"); Deno.env.set("TURNSTILE_SECRET_KEY", "turnstile-test-secret");
Deno.env.set("SHEETS_SERVICE_ACCOUNT_JSON", await testServiceAccountJson()); Deno.env.set("SHEETS_SPREADSHEET_ID", SHEET_ID); Deno.env.set("SHEETS_TAB_NAME", "Website Leads");
await import("./index.ts");

const post = (body: any) => handler(new Request(SB + "/functions/v1/leads", { method: "POST", headers: { "Content-Type": "application/json", "user-agent": "test" }, body: JSON.stringify(body) }));
const regBody = (o: any = {}) => ({ action: "register", name: "Nohaila Mad", phone: "0676091056".replace(/^0676/, "+212676"), course: "German B1 Course", timing: "6:30 PM to 8:00 PM", captcha: "good", consent: true, via: "wa", page: "/registration", first_touch: { utm_source: "Instagram", landing_page: "/" }, event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ...o });
const mockBody = (o: any = {}) => ({ action: "submit", first_name: "Aya", last_name: "Mostafa", email: "Aya@Example.com", phone: "01012345678", country: "Egypt", city: "Cairo", level: "A1", goal: "Job", heard_from: "Instagram", exam: "a1-mock-1", consent: true, captcha: "good", ...o });
const reset = async () => { sheets.rows.length = 1; sheets.calls.length = 0; sheets.failWith = null; inserts.length = 0; logs.length = 0; insertFails = false; resetTokenCache(); };
const body = async (r: Response) => await r.json();

Deno.test("register: saved, response unchanged, row lands on Website Leads (RAW)", async () => {
  await reset();
  const r = await post(regBody()); const j = await body(r);
  assertEquals(r.status, 200); assertEquals(j, { ok: true, event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  assertEquals(inserts.length, 1); assertEquals(inserts[0].body.is_test, false); assertEquals(inserts[0].body.phone, "+212676091056");
  assertEquals(sheets.rows.length, 2);
  const row = sheets.rows[1];
  assertEquals(row[C["Supabase id"]], ID); assertEquals(row[C["Supabase table"]], "registration_leads"); assertEquals(row[C["Status"]], "New");
  assertEquals(row[C["Created (PKT)"]], "2026-11-11 14:05:09"); assertEquals(row[C["utm_source"]], "instagram");
  assertMatch(sheets.writes[0].url, /valueInputOption=RAW/);
});
Deno.test("register: Sheets down -> still { ok: true }, lead saved, warning carries the Supabase id", async () => {
  await reset(); sheets.failWith = 500;
  const r = await post(regBody()); const j = await body(r);
  assertEquals(r.status, 200); assertEquals(j.ok, true); assertEquals(inserts.length, 1);
  assert(logs.some((l) => l.includes("leads->sheets FAILED") && l.includes(ID)), logs.join("|"));
  assertEquals(sheets.rows.length, 1);
});
Deno.test("submit: Sheets down -> still ok with id and token", async () => {
  await reset(); sheets.failWith = "throw";
  const r = await post(mockBody()); const j = await body(r);
  assertEquals(r.status, 200); assertEquals(j, { ok: true, id: ID, token: TOKEN });
  assert(logs.some((l) => l.includes("mock_exam_leads id " + ID)));
});
Deno.test("submit: mock exam lead appended with E.164 phone from the country, lowercased email", async () => {
  await reset();
  const r = await post(mockBody()); assertEquals(r.status, 200); assertEquals(await body(r), { ok: true, id: ID, token: TOKEN });
  assertEquals(inserts[0].body.phone, "01012345678", "Supabase still stores what the person typed");
  const row = sheets.rows[1];
  assertEquals(row[C["Phone (E.164)"]], "+201012345678"); assertEquals(row[C["Email"]], "aya@example.com"); assertEquals(row[C["Name"]], "Aya Mostafa");
  assertEquals(row[C["Form (registration/mock_exam)"]], "mock_exam"); assertEquals(row[C["Heard from"]], "Instagram");
});
Deno.test("is_test: 'XYZ Test' / 'TEST' / 'test' are stored with is_test = true and never reach Sheets", async () => {
  for (const name of ["XYZ Test", "TEST", "my test lead"]) {
    await reset();
    assertEquals((await post(regBody({ name }))).status, 200);
    assertEquals(inserts[0].body.is_test, true, name); assertEquals(sheets.calls.length, 0, name);
  }
  await reset();
  assertEquals((await post(mockBody({ first_name: "XYZ", last_name: "test" }))).status, 200);
  assertEquals(inserts[0].body.is_test, true); assertEquals(sheets.calls.length, 0);
  for (const name of ["Contest Winner", "Testa Ahmed", "Nohaila Mad"]) { await reset(); await post(regBody({ name })); assertEquals(inserts[0].body.is_test, false, name); assertEquals(sheets.rows.length, 2, name); }
});
Deno.test("SHEETS_SERVICE_ACCOUNT_JSON unset -> silent skip, response normal", async () => {
  await reset(); const k = Deno.env.get("SHEETS_SERVICE_ACCOUNT_JSON")!; Deno.env.delete("SHEETS_SERVICE_ACCOUNT_JSON");
  try { const r = await post(regBody()); assertEquals((await body(r)).ok, true); assertEquals(sheets.calls.length, 0); assertEquals(logs.filter((l) => l.includes("leads->sheets")), []); }
  finally { Deno.env.set("SHEETS_SERVICE_ACCOUNT_JSON", k); }
});
Deno.test("SHEETS_DRY_RUN=1 -> nothing is written, response normal", async () => {
  await reset(); Deno.env.set("SHEETS_DRY_RUN", "1");
  try { assertEquals((await post(regBody())).status, 200); assertEquals(sheets.writes.length, 0); assert(logs.some((l) => l.includes("DRY RUN") && l.includes(ID))); }
  finally { Deno.env.delete("SHEETS_DRY_RUN"); }
});
Deno.test("clone and score never touch Sheets", async () => {
  await reset();
  const c = await post({ action: "clone", id: ID, token: TOKEN, exam: "a1-mock-2", page: "/x" });
  assertEquals(c.status, 200); assertEquals((await body(c)).ok, true); assertEquals(inserts.length, 1); assertEquals(inserts[0].body.exam, "A1 Mock 2");
  const s = await post({ action: "score", id: ID, token: TOKEN, score: 70, detail: { H: 20, L: 20, S: 15, P: 15 } });
  assertEquals(s.status, 200);
  assertEquals(sheets.calls.length, 0); assertEquals(sheets.rows.length, 1);
});
Deno.test("insert failure -> 500 as before and no Sheets call", async () => {
  await reset(); insertFails = true;
  assertEquals((await post(regBody())).status, 500); assertEquals((await post(mockBody())).status, 500);
  assertEquals(sheets.calls.length, 0);
});
Deno.test("v10 validation intact: courses, timings (old and new), Turnstile, honeypot, bad input", async () => {
  for (const course of ["German B1 Course", "German for Kids (12-16)", "A2 Super Intensive Course", "Free Demo Class", "B1 / B2 (ask for details)"])
    for (const timing of ["12:00 PM to 1:30 PM", "9:00 PM to 10:30 PM", "12PM to 1PM"]) { await reset(); assertEquals((await post(regBody({ course, timing }))).status, 200, course + timing); }
  await reset();
  assertEquals((await post(regBody({ course: "German C2 Course" }))).status, 400);
  assertEquals((await post(regBody({ timing: "3:00 AM to 4:00 AM" }))).status, 400);
  assertEquals((await post(regBody({ captcha: "" }))).status, 400);
  assertEquals((await post(regBody({ captcha: "bad" }))).status, 400);
  assertEquals((await post(regBody({ hp: "bot" }))).status, 400);
  assertEquals((await post(regBody({ phone: "123" }))).status, 400);
  assertEquals((await post(mockBody({ captcha: "" }))).status, 400);
  assertEquals((await post(mockBody({ consent: false }))).status, 400);
  assertEquals((await post(mockBody({ level: "C2" }))).status, 400);
  assertEquals((await post({ action: "nope" })).status, 400);
  assertEquals(inserts.length, 0); assertEquals(sheets.calls.length, 0);
});
Deno.test("CSV endpoint unchanged: wrong or missing key -> 403", async () => {
  await reset();
  const r = await handler(new Request(SB + "/functions/v1/leads?csv=1&key=nope")); assertEquals(r.status, 403); assertEquals(await r.text(), "forbidden");
});
Deno.test("with EdgeRuntime.waitUntil the response does not wait for Sheets, and the task is handed to the runtime", async () => {
  await reset(); let handed = 0; (globalThis as any).EdgeRuntime = { waitUntil: (_p: Promise<void>) => { handed++; } };
  try { const r = await post(regBody()); assertEquals(r.status, 200); assertEquals(handed, 1); }
  finally { delete (globalThis as any).EdgeRuntime; }
});

addEventListener("unload", () => { console.warn = warn; console.log = info; console.info = infoI; globalThis.fetch = realFetch; });
