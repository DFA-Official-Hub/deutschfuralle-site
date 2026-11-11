// Shared helpers for the leads tests: a generated throw-away RSA key (never a real credential) and an in-memory mock of the Google token + Sheets endpoints.
export const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd";
export const HEADER = ["Created (PKT)", "Name", "Phone (E.164)", "Email", "Form (registration/mock_exam)", "Course/Exam", "utm_source", "utm_medium", "utm_campaign", "Landing page", "Referrer", "Heard from", "Supabase table", "Supabase id", "Status", "Notes"];
export const C = Object.fromEntries(HEADER.map((h, i) => [h, i])) as Record<string, number>;

export async function testServiceAccountJson(): Promise<string> {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let bin = ""; for (const b of der) bin += String.fromCharCode(b);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ type: "service_account", client_email: "leads-test@example-project.iam.gserviceaccount.com", private_key: pem });
}

export interface Call { method: string; url: string; body?: any }
export class MockSheets {
  rows: string[][];
  calls: Call[] = [];
  failWith: number | "throw" | null = null;       // make every Sheets call fail
  constructor(rows: string[][] = [HEADER]) { this.rows = rows.map((r) => [...r]); }
  get writes() { return this.calls.filter((c) => c.method === "POST" && /values/.test(c.url)); }
  /** returns undefined when the url is not a Google url */
  async handle(url: string, init?: RequestInit): Promise<Response | undefined> {
    const method = (init?.method || "GET").toUpperCase();
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      this.calls.push({ method, url });
      if (this.failWith === "throw") throw new TypeError("network down");
      if (typeof this.failWith === "number") return j({ error: "x" }, this.failWith);
      return j({ access_token: "mock-access-token", expires_in: 3600 });
    }
    if (!url.startsWith("https://sheets.googleapis.com/")) return undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, url, body });
    if (this.failWith === "throw") throw new TypeError("network down");
    if (typeof this.failWith === "number") return j({ error: { message: "mock failure" } }, this.failWith);
    const u = new URL(url);
    if (method === "GET") return j({ values: this.rows.map((r) => [...r]) });
    if (u.pathname.endsWith(":append")) {
      if (u.searchParams.get("valueInputOption") !== "RAW") return j({ error: "need RAW" }, 400);
      this.rows.push(...body.values); return j({ updates: { updatedRows: body.values.length } });
    }
    if (u.pathname.endsWith("/values:batchUpdate")) {
      if (body.valueInputOption !== "RAW") return j({ error: "need RAW" }, 400);
      for (const d of body.data) {
        const m = /!([A-Z]+)(\d+)$/.exec(d.range)!; let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64; col -= 1;
        const row = this.rows[Number(m[2]) - 1]; while (row.length <= col) row.push(""); row[col] = d.values[0][0];
      }
      return j({ totalUpdatedCells: body.data.length });
    }
    return j({ error: "unexpected" }, 400);
  }
}
export const mkRow = (o: Record<string, string>): string[] => HEADER.map((h) => o[h] ?? "");
