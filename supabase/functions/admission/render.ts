// Renders a DFA Course Participation Certificate (PNG) on the background exported from the owner's Canva design.
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import qrcode from "npm:qrcode-generator@2.0.4";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { ensureWasm } from "./docs.ts";
const ASSETS = "https://www.deutschfuralle.com/assets/cert/";
export const SITE = "https://www.deutschfuralle.com";
let ready: Promise<{ bg: string; fonts: Uint8Array[] }> | null = null;
function load() {
  if (!ready) ready = (async () => {
    await ensureWasm();
    const get = async (f: string) => { const r = await fetch(ASSETS + f); if (!r.ok) throw new Error("asset " + f); return new Uint8Array(await r.arrayBuffer()); };
    const [bg, ...fonts] = await Promise.all(["certificate-bg-v2.jpg", "GreatVibes-Regular.ttf", "Lora-Bold.ttf", "Nunito-Bold.ttf", "Nunito-Medium.ttf"].map(get));
    return { bg: "data:image/jpeg;base64," + encodeBase64(bg), fonts };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
const long = (d: string) => new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export async function renderCertificate(e: any, sample = false): Promise<Uint8Array> {
  const { bg, fonts } = await load();
  const c = e.courses || {};
  const q = qrcode(0, "M"); q.addData(`${SITE}/verify.html?code=${e.certificate_code}`); q.make();
  const end = c.duration_days && e.start_date ? addDays(e.start_date, c.duration_days) : e.end_date;
  const svg = certSvg({
    name: e.full_name || "", course: c.name || e.course_label || "German course", level: String(c.level || "").replace("-", " + "),
    start: long(e.start_date), end: long(end), issued: long(e.certificate_issued_at), certNo: e.certificate_no,
    studentId: e.student_id || "", batch: e.batch_code || "", code: e.certificate_code, sample,
  }, { size: q.getModuleCount(), isDark: (r: number, cc: number) => q.isDark(r, cc) }, bg);
  return new Resvg(svg, { fitTo: { mode: "width", value: 2106 }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Nunito" } }).render().asPng();
}
/** Returns signed view + download URLs, rendering and storing the PNG in the private bucket the first time. */
export async function certificateUrls(db: any, e: any) {
  let path = e.certificate_file;
  if (!path) {
    path = `${e.certificate_no}.png`;
    const png = await renderCertificate(e);
    const up = await db.storage.from("certificates").upload(path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await db.from("enrollments").update({ certificate_file: path }).eq("id", e.id);
  }
  const v = await db.storage.from("certificates").createSignedUrl(path, 3600);
  const d = await db.storage.from("certificates").createSignedUrl(path, 3600, { download: `${e.certificate_no}_${String(e.full_name || "Student").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}.png` });
  return { url: v.data?.signedUrl || null, download: d.data?.signedUrl || null };
}
// Shared certificate layout (SVG, 1024 x 724 units, drawn over the owner's Canva background).
// Used by the admission Edge Function and the local sample script.
function esc(s: unknown) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
export function certSvg(d: any, qr: { size: number; isDark: (r: number, c: number) => boolean }, bgHref: string) {
  // qr: { size: n, isDark(r,c) }
  const n = qr.size, Q = 74, cell = Q / n, qx = 512 - Q / 2, qy = 532;
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(qx + c * cell).toFixed(2)} ${(qy + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  const dates = `${d.start} – ${d.end}`;
  const pillW = Math.max(250, dates.length * 9.3 + 46);
  const name = d.name.length > 26 ? 46 : 58;
  const sample = d.sample ? `<text x="512" y="300" font-family="Nunito" font-weight="700" font-size="80" fill="#d33" fill-opacity="0.13" text-anchor="middle" transform="rotate(-18 512 362)">SAMPLE – NOT VALID</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="724" viewBox="0 0 1024 724">
<image href="${bgHref}" x="0" y="0" width="1024" height="724" preserveAspectRatio="none"/>
<text x="512" y="352" font-family="Great Vibes" font-size="${name}" fill="#111" text-anchor="middle">${esc(d.name)}</text>
<rect x="${512 - pillW / 2}" y="407" width="${pillW}" height="40" rx="14" fill="#62c42f"/>
<text x="512" y="433" font-family="Lora" font-weight="700" font-size="17.5" fill="#fff" text-anchor="middle">${esc(dates)}</text>
<text x="512" y="482" font-family="Nunito" font-weight="500" font-size="17.5" fill="#111" text-anchor="middle">For active participation in the <tspan font-weight="700">${esc(d.course)}</tspan> (Level ${esc(d.level)})</text>
<text x="512" y="507" font-family="Nunito" font-weight="500" font-size="17.5" fill="#111" text-anchor="middle">at <tspan font-weight="700">DeutschFürAlle</tspan>, showing great dedication and progress.</text>
<g font-family="Nunito" font-size="9.6" fill="#33413a" text-anchor="end">
<text x="${qx - 16}" y="548"><tspan font-weight="700">Certificate No.</tspan> ${esc(d.certNo)}</text>
<text x="${qx - 16}" y="563"><tspan font-weight="700">Student ID</tspan> ${esc(d.studentId)}</text>
<text x="${qx - 16}" y="578"><tspan font-weight="700">Batch</tspan> ${esc(d.batch || "–")}</text>
<text x="${qx - 16}" y="593"><tspan font-weight="700">Issued</tspan> ${esc(d.issued)}</text>
</g>
<g font-family="Nunito" font-size="9.6" fill="#33413a">
<text x="${qx + Q + 16}" y="556" font-weight="700">Scan to verify</text>
<text x="${qx + Q + 16}" y="571">deutschfuralle.com/verify</text>
<text x="${qx + Q + 16}" y="586"><tspan font-weight="700">Code</tspan> ${esc(d.code)}</text>
</g>
<rect x="${qx - 4}" y="${qy - 4}" width="${Q + 8}" height="${Q + 8}" fill="#fff"/>
<path d="${path}" fill="#111"/>
<g font-family="Nunito" font-weight="500" font-size="7.6" fill="#5b665f" text-anchor="middle">
<text x="512" y="627">This certificate confirms participation in a Deutsch Für Alle course only.</text>
<text x="512" y="637">It is not affiliated with or issued by the Goethe-Institut, ÖSD, ECL or any other exam body,</text>
<text x="512" y="647">and has no connection with any embassy.</text>
</g>
${sample}
</svg>`;
}

/** PDF copy of the certificate (A4 landscape page with the PNG), cached next to the PNG. */
export async function certificatePdfUrls(db: any, e: any) {
  const nm = `${e.certificate_no}_${String(e.full_name || "Student").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}.pdf`;
  const path = `${e.certificate_no}.pdf`;
  let v = await db.storage.from("certificates").createSignedUrl(path, 3600);
  if (v.error || !v.data?.signedUrl) {
    const png = await certificateUrls(db, e); const r = await fetch(png.url); if (!r.ok) throw new Error("certificate image missing");
    const { PDFDocument } = await import("npm:pdf-lib@1.17.1");
    const pdf = await PDFDocument.create(); const im = await pdf.embedPng(new Uint8Array(await r.arrayBuffer()));
    const w = 841.89, h = w * im.height / im.width; const page = pdf.addPage([w, h]); page.drawImage(im, { x: 0, y: 0, width: w, height: h });
    pdf.setTitle(`Deutsch Für Alle certificate ${e.certificate_no}`); pdf.setAuthor("Deutsch Für Alle");
    const up = await db.storage.from("certificates").upload(path, await pdf.save(), { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    v = await db.storage.from("certificates").createSignedUrl(path, 3600);
  }
  const d = await db.storage.from("certificates").createSignedUrl(path, 3600, { download: nm });
  return { url: v.data?.signedUrl || null, download: d.data?.signedUrl || null };
}
