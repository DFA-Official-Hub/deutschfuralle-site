// Student details on documents: registration form copy (Google Sheet -> registration_details) + staff overrides.
// Pure functions, shared by docs.ts and index.ts, tested in tests/student-info.test.ts.
export const FIELDS = ["full_name", "dob", "gender", "cnic", "email", "phone", "address", "city", "state", "country", "qualification"] as const;
export type Field = typeof FIELDS[number];
export type Info = Partial<Record<Field, string>>;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function validIso(y: number, m: number, d: number) {
  const t = Date.UTC(y, m - 1, d), x = new Date(t);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}
const pad = (n: number) => String(n).padStart(2, "0");
/** "1995-02-11", "11 February 1995" or "11 Feb 1995" -> "1995-02-11". Anything else (or an impossible date) -> "". Never shifts the day: no time zones involved. */
export function isoDob(v: unknown): string {
  const s = String(v ?? "").trim();
  let m = s.match(ISO);
  if (m) return validIso(+m[1], +m[2], +m[3]) ? s : "";
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![2].toLowerCase()) && m![2].length >= 3);
    if (mi >= 0 && validIso(+m[3], mi + 1, +m[1])) return `${m[3]}-${pad(mi + 1)}-${pad(+m[1])}`;
  }
  return "";
}
/** "1995-02-11" -> "11 February 1995" (calendar date, no time zone). Unknown formats are returned unchanged. */
export function longDate(v: unknown): string {
  const iso = isoDob(v); if (!iso) return String(v ?? "").trim();
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}
function pick(data: Record<string, unknown> | null | undefined, re: RegExp) {
  for (const k of Object.keys(data || {})) if (re.test(k.trim())) { const v = String((data as any)[k] ?? "").trim(); if (v) return v; }
  return "";
}
/** Registration form answers (sheet column titles) -> the fields documents use. */
export function fromRegistration(data: Record<string, unknown> | null | undefined): Info {
  const name = [pick(data, /^first name/i), pick(data, /^last name/i)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const dobRaw = pick(data, /date of birth/i);
  return {
    full_name: name, dob: isoDob(dobRaw) || dobRaw, gender: pick(data, /^gender/i), cnic: pick(data, /cnic/i),
    email: pick(data, /^email/i).toLowerCase(), phone: pick(data, /mobile|phone/i), address: pick(data, /^address/i),
    city: pick(data, /^city/i), state: pick(data, /^state/i), country: pick(data, /^country/i), qualification: pick(data, /qualification/i),
  };
}
/** The registration row that belongs to this enrollment. The sheet row number alone is not enough: staff move rows in the
 *  sheet (batch headings), so a row number can later hold another student. Use it only when the email matches too;
 *  otherwise take the newest row with the student's email. */
export function pickDetails(rows: { sheet_row: number; email?: string | null; data: any; updated_at?: string | null }[], e: { sheet_row?: number | null; email?: string | null }) {
  const em = String(e.email || "").trim().toLowerCase();
  const same = (r: any) => em && String(r.email || pick(r.data, /^email/i)).trim().toLowerCase() === em;
  const byRow = rows.find((r) => e.sheet_row && r.sheet_row === e.sheet_row);
  if (byRow && same(byRow)) return byRow;
  const mine = rows.filter(same).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) || b.sheet_row - a.sheet_row);
  return mine[0] || null;
}
/** What the documents show: staff override, else the registration form, else the enrollment row. */
export function effective(reg: Info, over: Info | null | undefined, e: { full_name?: string | null; email?: string | null; phone?: string | null }): Required<Info> {
  const o = over || {}, out: any = {};
  for (const f of FIELDS) out[f] = String((o as any)[f] ?? "").trim() || String((reg as any)[f] ?? "").trim();
  if (!o.full_name) out.full_name = String(e.full_name || "").trim() || out.full_name;
  if (!o.email) out.email = String(e.email || "").trim().toLowerCase() || out.email;
  if (!out.phone) out.phone = String(e.phone || "").trim();
  return out;
}
export const LIMITS: Record<Field, number> = { full_name: 120, dob: 40, gender: 30, cnic: 30, email: 200, phone: 30, address: 300, city: 80, state: 80, country: 80, qualification: 120 };
/** Validates what staff typed. Values equal to the registration form are not stored (so later sheet fixes still flow through);
 *  an empty value means "use the registration form". Returns the overrides to save, or an error. */
export function cleanOverrides(input: Record<string, unknown> | null | undefined, reg: Info, e: { full_name?: string | null; email?: string | null }): { info: Info | null; error?: string } {
  const out: Info = {}, base = effective(reg, null, e as any);
  for (const f of FIELDS) {
    if (!input || !(f in input)) continue;
    let v = String((input as any)[f] ?? "").replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (v.length > LIMITS[f]) return { info: null, error: `${label(f)} is too long.` };
    if (f === "dob") {
      v = isoDob(v);
      if (!v) return { info: null, error: "Date of birth: pick a real date." };
      const y = +v.slice(0, 4), now = new Date().getUTCFullYear();
      if (y < 1920 || y > now - 3) return { info: null, error: "Date of birth: the year looks wrong." };
    }
    if (f === "email") { v = v.toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { info: null, error: "Email: enter a valid address." }; }
    if (f === "cnic" && !/^[0-9A-Za-z\- ]{5,30}$/.test(v)) return { info: null, error: "CNIC / ID: use numbers and dashes only." };
    if (f === "phone" && !/^\+?[0-9 ()\-]{7,30}$/.test(v)) return { info: null, error: "Mobile: use numbers only (spaces and + are fine)." };
    const b = f === "dob" ? isoDob(base.dob) || base.dob : String((base as any)[f] || "");
    if (v === b) continue;
    (out as any)[f] = v;
  }
  return { info: Object.keys(out).length ? out : null };
}
export function label(f: Field): string {
  return ({ full_name: "Full name", dob: "Date of birth", gender: "Gender", cnic: "CNIC / ID", email: "Email", phone: "Mobile", address: "Address", city: "City", state: "Province / state", country: "Country", qualification: "Qualification" } as Record<Field, string>)[f];
}
/** Field-by-field old -> new for the audit trail (only fields that changed). */
export function diff(a: Info, b: Info): { old: Info; new: Info } {
  const o: Info = {}, n: Info = {};
  for (const f of FIELDS) { const x = String((a as any)[f] ?? ""), y = String((b as any)[f] ?? ""); if (x !== y) { (o as any)[f] = x; (n as any)[f] = y; } }
  return { old: o, new: n };
}
/** Address line for documents. */
export function addressLine(i: Info): string {
  return [i.address, i.city, i.state, i.country].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}
