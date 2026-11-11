import { assert, assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import { isTestName, mapHeader, mockExamLead, normPhone, phoneKeys, pktNote, pktStamp, planSync, registrationLead, resetTokenCache, runInBackground, signJwt, syncLead, syncLeadSafe, type SyncDeps } from "./sheets.ts";
import { C, HEADER, MockSheets, SHEET_ID, mkRow, testServiceAccountJson } from "./test_helpers.ts";

const sleep0 = () => Promise.resolve();
const logs = () => { const l = { info: [] as string[], warn: [] as string[] }; return { l, log: { info: (...a: unknown[]) => void l.info.push(a.join(" ")), warn: (...a: unknown[]) => void l.warn.push(a.join(" ")) } }; };
async function deps(mock: MockSheets, extra: Record<string, string> = {}) {
  resetTokenCache();
  const sa = await testServiceAccountJson(), { l, log } = logs();
  const e: Record<string, string> = { SHEETS_SERVICE_ACCOUNT_JSON: sa, SHEETS_SPREADSHEET_ID: SHEET_ID, SHEETS_TAB_NAME: "Website Leads", ...extra };
  const d: SyncDeps = { env: (k) => e[k] || "", fetch: async (u, i) => (await mock.handle(u, i)) ?? new Response("unmocked", { status: 599 }), log, sleep: sleep0 };
  return { d, l };
}
const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222";
const T0 = "2026-11-11T09:05:09.000Z";   // 14:05:09 PKT
const reg = (o: any = {}, id = ID1) => registrationLead(id, T0, { name: "Nohaila Mad", phone: "+212676091056", raw_phone: "0676091056", course: "German B1 Course", timing: "6:30 PM to 8:00 PM", utm_source: "instagram", utm_medium: "social", utm_campaign: "nov", landing_page: "/", ...o });
const mock = (o: any = {}, id = ID2) => mockExamLead(id, T0, { first_name: "Aya", last_name: "Mostafa", email: "Aya@Example.com", phone: "01012345678", country: "Egypt", city: "Cairo", level: "A1", goal: "Job", heard_from: "Instagram", exam: "A1 Mock 1", ...o });

// ---------- 1. phone normalisation ----------
Deno.test("phone: registration rule is unchanged (03.. and 92.. become +92, international kept)", () => {
  assertEquals(normPhone("0300 1234567"), "+923001234567");
  assertEquals(normPhone("923001234567"), "+923001234567");
  assertEquals(normPhone("00212676091056"), "+212676091056");
  assertEquals(normPhone("+216 20 123 456"), "+21620123456");
  assertEquals(normPhone("0676091056"), "0676091056");     // no country on the registration form: left alone
});
Deno.test("phone: Morocco 06.. with country Maroc / Morocco -> +212", () => {
  assertEquals(normPhone("0676091056", "Maroc"), "+212676091056");
  assertEquals(normPhone("06 76 09 10 56", "Morocco"), "+212676091056");
  assertEquals(normPhone("0512345678", "Maroc"), "+212512345678");
  assertEquals(normPhone("212676091056", "Maroc"), "+212676091056");
});
Deno.test("phone: Egypt 01.. with country Egypt -> +20", () => {
  assertEquals(normPhone("01012345678", "Egypt"), "+201012345678");
  assertEquals(normPhone("01512345678", "Egypt"), "+201512345678");
  assertEquals(normPhone("201012345678", "Egypt"), "+201012345678");
});
Deno.test("phone: +92 is never forced onto a non-PK number", () => {
  assertEquals(normPhone("03001234567", "Egypt"), "03001234567");
  assertEquals(normPhone("03001234567", "Maroc"), "03001234567");
  assertEquals(normPhone("03001234567", "Tunisia"), "03001234567");
  assertEquals(normPhone("923001234567", "Germany"), "923001234567");
  assertEquals(normPhone("03001234567", "Pakistan"), "+923001234567");
  assertEquals(normPhone("0676091056", "Tunisia"), "0676091056");   // ambiguous: unchanged
  assertEquals(normPhone("+21620123456", "Tunisia"), "+21620123456");
  assertEquals(normPhone("+212676091056", "Egypt"), "+212676091056"); // international wins over country
});
Deno.test("phone: matching keys cover raw and E.164 forms", () => {
  assert(phoneKeys("+212676091056", "0676091056").has("0676091056"));
  assert(phoneKeys("+212676091056", "0676091056").has("212676091056"));
  assertEquals(phoneKeys("", null, "12").size, 0);
});

// ---------- 2. test-row detector ----------
Deno.test("detector: case-insensitive whole word", () => {
  for (const n of ["XYZ Test", "TEST", "test", "Test User", "my tEsT lead", "Ali-Test", "Test."]) assert(isTestName(n), n);
  for (const n of ["Nohaila Mad", "Aya Mostafa", "Contest Winner", "Testa", "Latest", "Attestation", "Testimony", "Test1", ""]) assertEquals(isTestName(n), false, n);
  assertEquals(isTestName(undefined), false);
});

// ---------- time ----------
Deno.test("time: PKT formats", () => { assertEquals(pktStamp(T0), "2026-11-11 14:05:09"); assertEquals(pktNote(T0), "11 Nov 2026, 14:05"); assertEquals(pktNote("2026-12-31T20:00:00Z"), "1 Jan 2027, 01:00"); });
Deno.test("jwt: RS256 header/claims with the Sheets-only scope", async () => {
  const sa = JSON.parse(await testServiceAccountJson());
  const [h, c, s] = (await signJwt(sa, 1000)).split(".");
  const dec = (x: string) => JSON.parse(atob(x.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(dec(h), { alg: "RS256", typ: "JWT" });
  const claims = dec(c);
  assertEquals(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
  assertEquals(claims.aud, "https://oauth2.googleapis.com/token");
  assertEquals(claims.exp - claims.iat, 3600);
  assert(s.length > 300);
});

// ---------- 4. planSync: dedupe, fill-empty, locks, Re-submitted ----------
const existing = (o: Record<string, string> = {}) => mkRow({ "Created (PKT)": "2026-11-05 10:00:00", Name: "Nohaila Mad", "Phone (E.164)": "+212676091056", Email: "", "Form (registration/mock_exam)": "registration", "Course/Exam": "German B1 Course", utm_source: "facebook", utm_medium: "paid", utm_campaign: "first", "Landing page": "/german-b1-course", "Supabase table": "registration_leads", "Supabase id": ID1, Status: "Contacted", Notes: "Called, asked to call back", ...o });
Deno.test("plan: no match appends one full row, Status New, create note", () => {
  const p = planSync([HEADER], reg());
  assertEquals(p.action, "append"); if (p.action !== "append") return;
  assertEquals(p.row[C["Created (PKT)"]], "2026-11-11 14:05:09");
  assertEquals(p.row[C["Phone (E.164)"]], "+212676091056");
  assertEquals(p.row[C["Form (registration/mock_exam)"]], "registration");
  assertEquals(p.row[C["Status"]], "New");
  assertEquals(p.row[C["Supabase table"]], "registration_leads");
  assertEquals(p.row[C["Supabase id"]], ID1);
  assertEquals(p.row[C["utm_source"]], "instagram");
  assertEquals(p.row[C["Landing page"]], "/");
  assertEquals(p.row[C["Referrer"]], "");
  assertEquals(p.row[C["Notes"]], "Website Registration on 11 Nov 2026, 14:05 PKT. Course/exam: German B1 Course. Timing: 6:30 PM to 8:00 PM.");
});
Deno.test("plan: mock exam row maps name, lowercased email, E.164 phone, heard from, extras", () => {
  const p = planSync([HEADER], mock());
  assertEquals(p.action, "append"); if (p.action !== "append") return;
  assertEquals(p.row[C["Name"]], "Aya Mostafa");
  assertEquals(p.row[C["Email"]], "aya@example.com");
  assertEquals(p.row[C["Phone (E.164)"]], "+201012345678");
  assertEquals(p.row[C["Form (registration/mock_exam)"]], "mock_exam");
  assertEquals(p.row[C["Course/Exam"]], "A1 Mock 1");
  assertEquals(p.row[C["Heard from"]], "Instagram");
  assertEquals(p.row[C["Supabase table"]], "mock_exam_leads");
  assertEquals(p.row[C["Notes"]], "Website Mock Exam on 11 Nov 2026, 14:05 PKT. Course/exam: A1 Mock 1. Level: A1. Goal: Job. Country: Egypt. City: Cairo.");
});
Deno.test("plan: matches by Supabase id first", () => {
  const rows = [HEADER, existing({ "Phone (E.164)": "+1999999999", Email: "" })];
  const p = planSync(rows, reg({ phone: "+212600000000", raw_phone: "0600000000", email: "n@mad.com" }));
  assertEquals(p.action, "update"); if (p.action === "update") assertEquals(p.rowNumber, 2);
});
Deno.test("plan: matches by E.164 phone, and by raw / digits-only variants", () => {
  for (const cell of ["+212676091056", "0676091056", "212676091056", "+212 676 091 056"]) {
    const p = planSync([HEADER, existing({ "Phone (E.164)": cell, "Supabase id": ID2 })], reg());
    assert(p.action !== "append", cell);
  }
});
Deno.test("plan: sheet row typed as 03.. matches a website lead stored as 92..", () => {
  assert(phoneKeys("03001234567").has("923001234567"));
  const p = planSync([HEADER, existing({ "Phone (E.164)": "03001234567", "Supabase id": ID2 })], reg({ phone: "923001234567", raw_phone: "923001234567" }));
  assertEquals(p.action, "update");
});
Deno.test("plan: sheet row stored as 92.. matches a lead whose raw phone is 03..", () => {
  assert(phoneKeys("923001234567").has("923001234567"));
  const p = planSync([HEADER, existing({ "Phone (E.164)": "923001234567", "Supabase id": ID2 })], reg({ phone: "", raw_phone: "03001234567" }));
  assertEquals(p.action, "update");
});
Deno.test("plan: matches by lowercase email when there is no phone match", () => {
  const rows = [HEADER, existing({ "Phone (E.164)": "+49111111111", Email: "AYA@example.com", "Supabase id": ID1 })];
  const p = planSync(rows, mock({ phone: "", }, ID2));
  assert(p.action !== "append");
});
Deno.test("plan: unrelated person is appended, never merged", () => {
  const p = planSync([HEADER, existing({ "Supabase id": ID2 })], reg({ name: "Other", phone: "+212611111111", raw_phone: "0611111111" }, "33333333-3333-4333-8333-333333333333"));
  assertEquals(p.action, "append");
});
Deno.test("plan: same id retry fills empty cells only, keeps first-touch, Status, Created, id, notes; no Re-submitted", () => {
  const row = existing({ Email: "", "Course/Exam": "", Notes: "" });
  const p = planSync([HEADER, row], reg({ email: "N@Mad.com", utm_source: "tiktok", landing_page: "/other" }));
  assertEquals(p.action, "update"); if (p.action !== "update") return;
  assertEquals(p.resubmitted, false);
  const cols = p.updates.map((u) => u.col).sort();
  assertEquals(cols, ["course", "email", "notes"]);
  assertEquals(p.updates.find((u) => u.col === "email")!.value, "n@mad.com");
  assert(!p.updates.find((u) => u.col === "notes")!.value.includes("Re-submitted"));
});
Deno.test("plan: same id and nothing empty -> no write", () => {
  assertEquals(planSync([HEADER, existing({ Email: "n@mad.com" })], reg({ email: "n@mad.com" })).action, "none");
});
Deno.test("plan: locked cells are never in the update list, even when they differ", () => {
  const p = planSync([HEADER, existing({ Email: "" })], reg({ email: "a@b.co", utm_source: "tiktok", utm_medium: "x", utm_campaign: "y", landing_page: "/z", name: "Changed Name" }, ID2));
  assertEquals(p.action, "update"); if (p.action !== "update") return;
  for (const u of p.updates) assert(!["created", "utmSource", "utmMedium", "utmCampaign", "landing", "referrer", "heard", "status", "id", "table", "name", "phone", "form", "course"].includes(u.col), u.col);
});
Deno.test("plan: new Supabase id on a matched phone appends a Re-submitted note, no second row", () => {
  const p = planSync([HEADER, existing()], reg({ course: "A1 Crash Course" }, ID2));
  assertEquals(p.action, "update"); if (p.action !== "update") return;
  assertEquals(p.resubmitted, true);
  const n = p.updates.find((u) => u.col === "notes")!;
  assertEquals(n.value, "Called, asked to call back\nRe-submitted: registration, A1 Crash Course, 11 Nov 2026, 14:05 PKT, registration_leads " + ID2 + ".");
  assert(!p.updates.some((u) => u.col === "id" || u.col === "status"));
});
Deno.test("plan: a retry of an already-noted re-submit adds nothing", () => {
  const noted = existing({ Notes: "Called\nRe-submitted: registration, X, 11 Nov 2026, 14:05 PKT, registration_leads " + ID2 + "." });
  assertEquals(planSync([HEADER, noted], reg({ email: "" }, ID2)).action, "none");
});
Deno.test("plan: several matches -> newest row only, with every matched row number reported", () => {
  const rows = [HEADER, existing({ "Created (PKT)": "2026-11-01 08:00:00", "Supabase id": "a" }), existing({ "Created (PKT)": "2026-11-09 08:00:00", "Supabase id": "b" }), existing({ "Created (PKT)": "2026-11-03 08:00:00", "Supabase id": "c" })];
  const p = planSync(rows, reg({ course: "German B1 Course" }, ID2));
  assertEquals(p.action, "update"); if (p.action !== "update") return;
  assertEquals(p.rowNumber, 3); assertEquals(p.matchedRows, [2, 3, 4]);
});
Deno.test("plan: header row must have every expected column", () => {
  let err = ""; try { mapHeader(HEADER.filter((h) => h !== "Notes")); } catch (e) { err = (e as Error).message; }
  assertMatch(err, /missing: notes/);
  assertEquals(mapHeader(HEADER.map((h) => " " + h.toUpperCase() + " ")).notes, 15);   // tolerant of case/space
});
Deno.test("plan: columns are found by header name, not position", () => {
  const swapped = [...HEADER]; [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
  const p = planSync([swapped], mock());
  assertEquals(p.action, "append"); if (p.action !== "append") return;
  assertEquals(p.row[1], "aya@example.com"); assertEquals(p.row[3], "Aya Mostafa");
});
Deno.test("plan: test-looking rows already on the tab are reported, not modified", () => {
  const p = planSync([HEADER, existing({ Name: "XYZ Test", "Phone (E.164)": "+10000000", "Supabase id": "t" })], mock());
  assertEquals(p.testRows, [2]); assertEquals(p.action, "append");
});

// ---------- 3. formula injection (RAW) ----------
Deno.test("injection: =, +, -, @, tab-leading and plain E.164 values are sent as RAW text, untouched", async () => {
  for (const v of ["=HYPERLINK(\"http://x\",\"y\")", "+SUM(1,1)", "-2+3", "@cmd", "\tTabbed", "=1+1"]) {
    const m = new MockSheets(); const { d } = await deps(m);
    const lead = reg({ name: v, course: v, email: "" }, ID1); lead.landing = v; lead.utmSource = v; lead.heardFrom = v;
    assertEquals((await syncLead(lead, false, d)).status, "appended");
    const w = m.writes[0];
    assertMatch(w.url, /valueInputOption=RAW/); assertNotMatch(w.url, /USER_ENTERED/);
    const row = w.body.values[0] as string[];
    assertEquals(row[C["Name"]], v); assertEquals(row[C["Course/Exam"]], v); assertEquals(row[C["Landing page"]], v); assertEquals(row[C["utm_source"]], v);
    assertEquals(row[C["Phone (E.164)"]], "+212676091056");
    assert(row.every((x) => typeof x === "string"), "all cells are JSON strings");
    assert(!row.some((x) => x.startsWith("'")), "no visible apostrophe prefix");
    assertEquals(m.rows[1][C["Name"]], v);
  }
});
Deno.test("injection: updates (fill empty + Re-submitted note) are RAW too", async () => {
  const m = new MockSheets([HEADER, existing({ Email: "", Notes: "n" })]); const { d } = await deps(m);
  const lead = reg({ email: "a@b.co", course: "=EVIL()" }, ID2);
  assertEquals((await syncLead(lead, false, d)).status, "updated");
  const w = m.writes[0];
  assertEquals(w.body.valueInputOption, "RAW"); assertNotMatch(JSON.stringify(w.body), /USER_ENTERED/);
  assert(m.rows[1][C["Notes"]].includes("=EVIL()"));
});

// ---------- 5. mock Sheets API integration ----------
Deno.test("sync: append end to end against the mock Sheets API", async () => {
  const m = new MockSheets(); const { d, l } = await deps(m);
  assertEquals((await syncLead(reg(), false, d)).status, "appended");
  assertEquals(m.rows.length, 2); assertEquals(m.rows[1][C["Status"]], "New");
  const calls = m.calls.map((c) => c.method + " " + decodeURIComponent(new URL(c.url).pathname).replace(SHEET_ID, "<id>"));
  assertEquals(calls, ["POST /token", "GET /v4/spreadsheets/<id>/values/'Website Leads'!A:Z", "POST /v4/spreadsheets/<id>/values/'Website Leads'!A1:append"]);
  assertEquals(l.warn, []);
});
Deno.test("sync: the same lead twice gives one row (retry safe)", async () => {
  const m = new MockSheets(); const { d } = await deps(m);
  await syncLead(reg(), false, d);
  assertEquals((await syncLead(reg(), false, d)).status, "unchanged");
  assertEquals(m.rows.length, 2);
});
Deno.test("sync: repeat submit with a new id updates the row and adds the note, never a second row", async () => {
  const m = new MockSheets(); const { d } = await deps(m);
  await syncLead(reg(), false, d);
  const r = await syncLead(reg({ course: "A1 Crash Course" }, ID2), false, d);
  assertEquals(r.status, "updated"); assertEquals(m.rows.length, 2);
  assertMatch(m.rows[1][C["Notes"]], /\nRe-submitted: registration, A1 Crash Course, 11 Nov 2026, 14:05 PKT, registration_leads 22222222/);
  assertEquals(m.rows[1][C["Supabase id"]], ID1); assertEquals(m.rows[1][C["Course/Exam"]], "German B1 Course");
});
Deno.test("sync: dry run reads but never writes, and logs the would-be write", async () => {
  const m = new MockSheets(); const { d, l } = await deps(m, { SHEETS_DRY_RUN: "1" });
  assertEquals((await syncLead(reg(), false, d)).status, "dry-run");
  assertEquals(m.writes.length, 0); assertEquals(m.rows.length, 1);
  assert(l.info.some((x) => /DRY RUN: would append/.test(x) && x.includes(ID1)));
  assert(!l.info.join(" ").includes("Nohaila"), "dry-run log has no personal data");
  const m2 = new MockSheets([HEADER, existing({ Email: "" })]); const x = await deps(m2, { SHEETS_DRY_RUN: "1" });
  assertEquals((await syncLead(reg({ email: "a@b.co" }), false, x.d)).status, "dry-run");
  assertEquals(m2.writes.length, 0); assert(x.l.info.some((s) => /would fill 1 cell\(s\) \[email\] on row 2/.test(s)));
});
Deno.test("sync: tab name with a quote is escaped; spreadsheet id is validated", async () => {
  const m = new MockSheets(); const { d } = await deps(m, { SHEETS_TAB_NAME: "Bob's tab" });
  await syncLead(reg(), false, d);
  assertMatch(decodeURIComponent(m.calls[1].url), /'Bob''s tab'!A:Z/);
  const bad = await deps(new MockSheets(), { SHEETS_SPREADSHEET_ID: "../../evil" });
  let err = ""; try { await syncLead(reg(), false, bad.d); } catch (e) { err = (e as Error).message; }
  assertMatch(err, /SHEETS_SPREADSHEET_ID/);
});
Deno.test("sync: an access token is reused", async () => {
  const m = new MockSheets(); const { d } = await deps(m);
  await syncLead(reg(), false, d); await syncLead(reg({}, ID2), false, d);
  assertEquals(m.calls.filter((c) => c.url.includes("oauth2")).length, 1);
});

// ---------- 6. failures are contained, one retry only ----------
Deno.test("failure: Sheets 500 -> syncLeadSafe resolves, warning has the Supabase id, one retry only, no key material logged", async () => {
  const m = new MockSheets(); m.failWith = 500; const { d, l } = await deps(m);
  await syncLeadSafe(reg(), false, d);
  assertEquals(m.calls.length, 2, "token request tried once and retried once, nothing else");
  assertEquals(l.warn.length, 1); assertMatch(l.warn[0], /registration_leads id 11111111-1111-4111-8111-111111111111/);
  assertNotMatch(l.warn.join(" "), /PRIVATE KEY|private_key|Bearer/);
});
Deno.test("failure: network error and 429 are retried once; 403 is not retried", async () => {
  const a = new MockSheets(); a.failWith = "throw"; await syncLeadSafe(reg(), false, (await deps(a)).d); assertEquals(a.calls.length, 2);
  const b = new MockSheets(); b.failWith = 429; await syncLeadSafe(reg(), false, (await deps(b)).d); assertEquals(b.calls.length, 2);
  const c = new MockSheets(); c.failWith = 403; await syncLeadSafe(reg(), false, (await deps(c)).d); assertEquals(c.calls.length, 1);
});
Deno.test("failure: read ok but write fails -> warning with id, no throw", async () => {
  const m = new MockSheets(); const { d, l } = await deps(m);
  const orig = m.handle.bind(m); m.handle = (u, i) => (u.includes(":append") ? Promise.resolve(new Response("{}", { status: 403 })) : orig(u, i));
  await syncLeadSafe(reg(), false, d);
  assertMatch(l.warn[0], /append failed: HTTP 403/); assertMatch(l.warn[0], new RegExp(ID1));
});
Deno.test("failure: bad key JSON / missing header never throws out of syncLeadSafe", async () => {
  const m = new MockSheets(); const { d, l } = await deps(m, { SHEETS_SERVICE_ACCOUNT_JSON: "{not json" });
  await syncLeadSafe(reg(), false, d); assertMatch(l.warn[0], /not valid JSON/); assertNotMatch(l.warn[0], /not json/);
  const m2 = new MockSheets([HEADER.slice(0, 5)]); const x = await deps(m2);
  await syncLeadSafe(reg(), false, x.d); assertMatch(x.l.warn[0], /header row is missing/); assertEquals(m2.writes.length, 0);
});

// ---------- 7. skips ----------
Deno.test("skip: is_test lead and unset SHEETS_SERVICE_ACCOUNT_JSON make zero Google calls", async () => {
  const m = new MockSheets(); const { d } = await deps(m);
  assertEquals((await syncLead(reg({ name: "XYZ Test" }), true, d)).status, "skipped");
  const { d: d2 } = await deps(m, { SHEETS_SERVICE_ACCOUNT_JSON: "" });
  assertEquals((await syncLead(reg(), false, d2)).status, "skipped");
  assertEquals(m.calls.length, 0);
});

// ---------- 8. no delete / clear / trash, Sheets scope only ----------
Deno.test("source: no delete / clear / trash calls, RAW only, spreadsheets scope only, no Drive", async () => {
  const src = await Deno.readTextFile(new URL("./sheets.ts", import.meta.url));
  const idx = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const bad of [/\bDELETE\b/, /deleteDimension|deleteRange|deleteSheet|deleteEmbedded/i, /:clear\b|batchClear|\bclear\(/i, /trash/i, /USER_ENTERED/, /googleapis\.com\/drive/i, /auth\/drive/i, /method:\s*"(PUT|PATCH)"/, /values:update|\bvalues\/[^`"]*\bPUT\b/])
    assertNotMatch(src, bad);
  assertNotMatch(idx, /sheets\.googleapis|oauth2\.googleapis/);
  assertMatch(src, /valueInputOption=RAW/); assertMatch(src, /valueInputOption: "RAW"/);
  assertEquals((src.match(/https:\/\/www\.googleapis\.com\/auth\/[a-z.]+/g) || []), ["https://www.googleapis.com/auth/spreadsheets"]);
  assertNotMatch(src + idx, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*MI/);   // no embedded key
});

Deno.test("runInBackground: bounded wait without EdgeRuntime, waitUntil with it", async () => {
  const t0 = Date.now(); await runInBackground(new Promise<void>((r) => setTimeout(r, 1500)), 50); assert(Date.now() - t0 < 600);
  let got: Promise<void> | null = null; (globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<void>) => { got = p; } };
  try { const t1 = Date.now(); await runInBackground(new Promise<void>((r) => setTimeout(r, 300)), 3000); assert(Date.now() - t1 < 100); assert(got); await got; }
  finally { delete (globalThis as any).EdgeRuntime; }
});
