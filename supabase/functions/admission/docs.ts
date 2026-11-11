// Admission letter + fee receipt: rendered to PNG (resvg), wrapped in an A4 PDF (pdf-lib), stored privately.
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
const A = "https://www.deutschfuralle.com/assets/docs/";
let wasm: Promise<void> | null = null;
export function ensureWasm() {
  if (!wasm) wasm = initWasm(fetch("https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm")).catch((e: unknown) => { if (!String(e).includes("Already initialized")) { wasm = null; throw e; } });
  return wasm;
}
// Cache assets across warm isolates. Fonts are split by document kind so Resvg does less work per request (keeps CPU under the free-tier 2s limit).
const FONT_ADMISSION = ["Poppins-Regular", "Poppins-Medium", "Poppins-SemiBold", "Poppins-Bold", "Poppins-Italic"];
const FONT_RECEIPT = ["Poppins-Regular", "Poppins-Medium", "Poppins-SemiBold", "Poppins-Bold", "CourierPrime-Regular", "CourierPrime-Bold", "Oswald-Bold", "ArchivoBlack-Regular"];
type DocKind = "admission" | "receipt";
const assetCache: Partial<Record<DocKind | "img", Promise<any>>> = {};
async function getBytes(f: string) {
  const r = await fetch(A + f);
  if (!r.ok) throw new Error("asset " + f);
  return new Uint8Array(await r.arrayBuffer());
}
function loadImg() {
  if (!assetCache.img) {
    assetCache.img = (async () => {
      await ensureWasm();
      const [logo, stamp, sign] = await Promise.all(["dfa-logo-600.png", "paid-stamp.png", "signature.png"].map(getBytes));
      const u = (b: Uint8Array) => "data:image/png;base64," + encodeBase64(b);
      // Smaller watermark bytes in the SVG = less Resvg composite work.
      return { logo: u(logo), logoW: u(logo), stamp: u(stamp), sign: u(sign) };
    })().catch((e) => { delete assetCache.img; throw e; });
  }
  return assetCache.img;
}
function loadFonts(kind: DocKind) {
  const key = kind;
  if (!assetCache[key]) {
    assetCache[key] = (async () => {
      await ensureWasm();
      const names = kind === "admission" ? FONT_ADMISSION : FONT_RECEIPT;
      return await Promise.all(names.map((f) => getBytes(f + ".ttf")));
    })().catch((e) => { delete assetCache[key]; throw e; });
  }
  return assetCache[key] as Promise<Uint8Array[]>;
}
async function load(kind: DocKind) {
  const [fonts, img] = await Promise.all([loadFonts(kind), loadImg()]);
  return { fonts, img };
}
/** Warm WASM + shared images without rendering (safe for EdgeRuntime.waitUntil). */
export async function warmDocAssets() {
  await ensureWasm();
  await loadImg();
}
const long = (d: string) => d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "–";
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const pkr = (n: number) => n.toLocaleString("en-US");
function pick(data: any, re: RegExp) { for (const k of Object.keys(data || {})) if (re.test(k)) return String(data[k] || "").trim(); return ""; }
export function docData(e: any, details: any, pay?: any) {
  const c = e.courses || {}, dd = details || {};
  const fee = Number(e.fee_total) || Number(c.fee_pkr) || 0, reg = Math.max(Number(c.old_fee_pkr) || 0, fee);
  const end = c.duration_days && e.start_date ? addDays(e.start_date, c.duration_days) : e.end_date;
  const paid = pay?.paid_on ? String(pay.paid_on).slice(0, 10) : String(e.invoiced_at || new Date().toISOString()).slice(0, 10);
  const amt = pay ? Number(pay.amount) || 0 : fee, before = pay ? Number(pay.before) || 0 : 0, bal = Math.max(fee - before - amt, 0);
  const name = e.full_name || [pick(dd, /^first name/i), pick(dd, /^last name/i)].join(" ").trim();
  const addr = [pick(dd, /^address/i), pick(dd, /^city/i), pick(dd, /^state/i), pick(dd, /^country/i)].filter(Boolean).join(", ");
  return {
    name, firstName: (name.split(" ")[0] || "there"), dob: pick(dd, /date of birth/i), cnic: pick(dd, /cnic/i), email: e.email,
    phone: pick(dd, /mobile|phone/i), address: addr, course: c.name || e.course_label || "German course", level: String(c.level || "").replace("-", " + "),
    feeText: fee ? `PKR ${pkr(fee)}` + (reg > fee ? ` (regular fee PKR ${pkr(reg)})` : "") : "–",
    start: long(e.start_date), end: long(end), accessUntil: long(e.end_date), batch: e.batch_code, studentId: e.student_id, invoiceNo: e.invoice_no,
    date: long(paid), paidDate: paid.split("-").reverse().join("-"),
    regular: reg ? `${pkr(reg)}/- PKR` : "–", discount: reg > fee ? `${pkr(reg - fee)}/- PKR` : "", total: amt ? `${pkr(amt)}/- PKR` : "–",
    invoiceNo2: pay?.invoice_no || e.invoice_no, before: before ? `${pkr(before)}/- PKR` : "",
    payNote: !pay || (pay.installments || 1) <= 1 && bal === 0 ? "" : bal > 0 ? `Installment ${pay.installment_no} of ${Math.max(pay.installments || 2, pay.installment_no)} · Balance due PKR ${pkr(bal)}${e.due_date ? " by " + long(e.due_date) : ""}` : `Final installment (${pay.installment_no} of ${Math.max(pay.installments || 2, pay.installment_no)}) · Fee paid in full`,
  };
}
async function pdfFromSvg(svg: string, fonts: Uint8Array[]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 850 }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Poppins" } }).render().asPng();
  const pdf = await PDFDocument.create();
  const im = await pdf.embedPng(png); const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 });
  pdf.setTitle("Deutsch Für Alle"); pdf.setAuthor("Deutsch Für Alle");
  return await pdf.save();
}
/** Builds both PDFs, stores them in the private "documents" bucket and returns their bytes. */
export async function buildDocs(db: any, e: any) {
  let details: any = null;
  if (e.sheet_row) details = (await db.from("registration_details").select("data").eq("sheet_row", e.sheet_row).maybeSingle()).data?.data || null;
  const first = (await db.from("payments").select("*").eq("enrollment_id", e.id).eq("invoice_no", e.invoice_no).maybeSingle()).data;
  const d = docData(e, details, first ? { ...first, before: 0 } : null);
  const a = await load("admission");
  const admission = await pdfFromSvg(admissionSvg(d, a.img), a.fonts);
  const r = await load("receipt");
  const receipt = await pdfFromSvg(receiptSvg(d, r.img), r.fonts);
  const ap = `admissions/${e.student_id}.pdf`, rp = `receipts/${e.invoice_no}.pdf`;
  for (const [p, b] of [[ap, admission], [rp, receipt]] as [string, Uint8Array][]) {
    const up = await db.storage.from("documents").upload(p, b, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
  }
  await db.from("enrollments").update({ admission_file: ap, receipt_file: rp, docs_error: null }).eq("id", e.id);
  return { admission, receipt, ap, rp, d };
}
/** Builds ONE document (admission form or first receipt) per call, to stay inside the CPU limit. */
export async function buildOne(db: any, e: any, kind: "admission" | "receipt", dry = false) {
  const { fonts, img } = await load(kind);
  let details: any = null;
  if (e.sheet_row) details = (await db.from("registration_details").select("data").eq("sheet_row", e.sheet_row).maybeSingle()).data?.data || null;
  const first = (await db.from("payments").select("*").eq("enrollment_id", e.id).eq("invoice_no", e.invoice_no).maybeSingle()).data;
  const d = docData(e, details, first ? { ...first, before: 0 } : null);
  const bytes = await pdfFromSvg(kind === "admission" ? admissionSvg(d, img) : receiptSvg(d, img), fonts);
  const path = kind === "admission" ? `admissions/${e.student_id}.pdf` : `receipts/${e.invoice_no}.pdf`;
  if (dry) return { bytes, path, d };
  const up = await db.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  await db.from("enrollments").update(kind === "admission" ? { admission_file: path, docs_error: null } : { receipt_file: path, docs_error: null }).eq("id", e.id);
  if (kind === "receipt" && first) await db.from("payments").update({ receipt_file: path }).eq("id", first.id);
  if (kind === "admission") e.admission_file = path; else e.receipt_file = path;
  return { bytes, path, d };
}
/** Receipt for one payment (installment). `before` = amount paid before this payment. */
export async function buildPaymentReceipt(db: any, e: any, pay: any, before: number) {
  const { fonts, img } = await load("receipt");
  let details: any = null;
  if (e.sheet_row) details = (await db.from("registration_details").select("data").eq("sheet_row", e.sheet_row).maybeSingle()).data?.data || null;
  const d = docData(e, details, { ...pay, before });
  const receipt = await pdfFromSvg(receiptSvg(d, img), fonts);
  const rp = `receipts/${pay.invoice_no}.pdf`;
  const up = await db.storage.from("documents").upload(rp, receipt, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  await db.from("payments").update({ receipt_file: rp }).eq("id", pay.id);
  if (pay.invoice_no === e.invoice_no) await db.from("enrollments").update({ receipt_file: rp }).eq("id", e.id);
  return { receipt, rp, d };
}
export async function fileBytes(db: any, bucket: string, path: string) {
  const r = await db.storage.from(bucket).download(path);
  if (r.error || !r.data) throw new Error("missing file " + path);
  return new Uint8Array(await r.data.arrayBuffer());
}
export async function signed(db: any, path: string, name: string) {
  const v = await db.storage.from("documents").createSignedUrl(path, 3600);
  const dl = await db.storage.from("documents").createSignedUrl(path, 3600, { download: name });
  return { url: v.data?.signedUrl || null, download: dl.data?.signedUrl || null };
}
// DFA admission letter + fee receipt (A4, 595 x 842 units). Polished versions of the owner's Canva designs.
const esc2 = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const G = "#3c7a12", GL = "#62c42f", INK = "#1d2420", MUT = "#5c6862", LINE = "#d7e3d9";
const sampleMark = (on: unknown) => on ? `<text x="297" y="470" font-family="Poppins" font-weight="700" font-size="72" fill="#d33" fill-opacity="0.12" text-anchor="middle" transform="rotate(-35 297 430)">SAMPLE – NOT VALID</text>` : "";
function rows(x: number, y: number, w: number, list: [string, string][], lw = 118, step = 19) {
  // label/value rows with light separators
  return list.map(([k, v], i) => {
    const yy = y + i * step;
    return `<text x="${x}" y="${yy}" font-family="Poppins" font-size="9.2" fill="${MUT}">${esc2(k)}</text>` +
      `<text x="${x + lw}" y="${yy}" font-family="Poppins" font-weight="500" font-size="9.6" fill="${INK}">${esc2(v || "–")}</text>` +
      (i < list.length - 1 ? `<line x1="${x}" x2="${x + w}" y1="${yy + 7}" y2="${yy + 7}" stroke="${LINE}" stroke-width="0.6"/>` : "");
  }).join("");
}
export function admissionSvg(d: any, img: any) {
  const stu: [string, string][] = [["Full name", d.name], ["Date of birth", d.dob], ["CNIC / ID", d.cnic], ["Email", d.email], ["Mobile", d.phone], ["Address", d.address]];
  const crs: [string, string][] = [["Course", d.course], ["Level", d.level], ["Course fee", d.feeText], ["Course dates", `${d.start} – ${d.end}`], ["Portal access until", d.accessUntil], ["Batch", d.batch]];
  const pY = 330, cY = pY + 46 + stu.length * 19;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842">
<rect width="595" height="842" fill="#fff"/>
<rect x="14" y="14" width="567" height="814" rx="8" fill="none" stroke="${LINE}" stroke-width="1"/>
<rect x="40" y="28" width="515" height="3.2" fill="${G}"/>
<image href="${img.logoW}" x="210" y="380" width="180" height="180" opacity="0.04"/>
<image href="${img.logo}" x="44" y="46" width="78" height="78"/>
<text x="138" y="88" font-family="Poppins" font-weight="700" font-size="30" fill="${G}">Deutsch Für Alle</text>
<text x="139" y="108" font-family="Poppins" font-size="10" fill="${G}">Live online German classes · www.deutschfuralle.com</text>
<rect x="40" y="140" width="515" height="1.6" fill="${G}"/>
<g font-family="Poppins" font-size="9" fill="${INK}">
<text x="40" y="162">${esc2(d.date)}</text><text x="40" y="175">Karachi, Pakistan</text>
<text x="555" y="162" text-anchor="end">Student ID: <tspan font-weight="600">${esc2(d.studentId)}</tspan></text>
<text x="555" y="175" text-anchor="end">Invoice No: <tspan font-weight="600">${esc2(d.invoiceNo)}</tspan></text>
<text x="555" y="188" text-anchor="end">Admissions Office</text>
<text x="555" y="201" text-anchor="end">admission@mail.deutschfuralle.com</text>
</g>
<text x="40" y="236" font-family="Poppins" font-weight="600" font-size="16" fill="${INK}">Confirmation of Registration</text>
<text x="555" y="236" font-family="Poppins" font-weight="500" font-size="10" fill="${G}" text-anchor="end">${esc2(d.studentId)}</text>
<rect x="40" y="243" width="42" height="2.4" fill="${GL}"/>
<g font-family="Poppins" font-size="10" fill="${INK}">
<text x="40" y="272">Dear ${esc2(d.firstName)},</text>
<text x="40" y="292">We are happy to confirm your registration with Deutsch Für Alle. Your fee has been received</text>
<text x="40" y="306">and your place in the course is confirmed. Here are your details:</text>
</g>
<rect x="40" y="${pY - 14}" width="515" height="${30 + stu.length * 19}" rx="6" fill="#f5fbf1" stroke="#d3eac4" stroke-width="0.8"/>
<text x="54" y="${pY + 2}" font-family="Poppins" font-weight="600" font-size="8.4" fill="${G}" letter-spacing="1.2">STUDENT</text>
${rows(54, pY + 20, 487, stu)}
<rect x="40" y="${cY - 14}" width="515" height="${30 + crs.length * 19}" rx="6" fill="#f5fbf1" stroke="#d3eac4" stroke-width="0.8"/>
<text x="54" y="${cY + 2}" font-family="Poppins" font-weight="600" font-size="8.4" fill="${G}" letter-spacing="1.2">COURSE</text>
${rows(54, cY + 20, 487, crs)}
<g font-family="Poppins" font-size="9.6" fill="${INK}">
<text x="40" y="${cY + 48 + crs.length * 19}"><tspan font-weight="600">Classes:</tspan> live online on Zoom, Monday to Friday. Your batch timing will be shared with you before the first class.</text>
<text x="40" y="${cY + 66 + crs.length * 19}"><tspan font-weight="600">Student portal:</tspan> www.deutschfuralle.com/portal.html (log in with this email address).</text>
<text x="40" y="${cY + 98 + crs.length * 19}">Kind regards,</text>
<text x="40" y="${cY + 112 + crs.length * 19}" font-weight="600">Deutsch Für Alle</text>
<text x="40" y="${cY + 126 + crs.length * 19}" fill="${MUT}">Admissions Office</text>
</g>
<rect x="40" y="790" width="515" height="0.8" fill="${LINE}"/>
<text x="40" y="806" font-family="Poppins" font-style="italic" font-size="8.2" fill="${MUT}">This document was generated automatically and is valid without a signature.</text>
<text x="555" y="806" font-family="Poppins" font-weight="600" font-size="8.2" fill="${INK}" text-anchor="end">Page 1 of 1</text>
${sampleMark(d.sample)}
</svg>`;
}
export function receiptSvg(d: any, img: any) {
  const BL = "#1f3c9e", TY = "Courier Prime";
  const items: [string, string][] = [[`${d.course} – course fee`, d.regular], ["Discount", d.discount ? "– " + d.discount : "–"], d.before ? ["Paid earlier", "– " + d.before] : ["Additional charges", "–"]];
  const ty = 300;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842">
<rect width="595" height="842" fill="#fff"/>
<rect x="14" y="14" width="567" height="814" rx="8" fill="none" stroke="${LINE}" stroke-width="1"/>
<line x1="122" y1="14" x2="122" y2="828" stroke="${BL}" stroke-width="0.9"/>
<line x1="14" y1="216" x2="581" y2="216" stroke="${BL}" stroke-width="0.9"/>
<image href="${img.logoW}" x="240" y="340" width="170" height="170" opacity="0.04"/>
<image href="${img.logo}" x="24" y="30" width="86" height="86"/>
<text x="146" y="76" font-family="Oswald" font-weight="700" font-size="29" fill="${G}">DEUTSCH FÜR ALLE</text>
<text x="146" y="96" font-family="Poppins" font-size="9" fill="${MUT}">Live online German classes · www.deutschfuralle.com</text>
<g font-family="Poppins" font-size="9.4" fill="${BL}">
<text x="398" y="60">Invoice No:</text><text x="398" y="76">Date:</text><text x="398" y="92">Student ID:</text><text x="398" y="108">Batch:</text>
</g>
<g font-family="${TY}" font-size="10" fill="${INK}">
<text x="458" y="60" font-weight="700">${esc2(d.invoiceNo2 || d.invoiceNo)}</text><text x="458" y="76">${esc2(d.paidDate)}</text><text x="458" y="92">${esc2(d.studentId)}</text><text x="458" y="108">${esc2(d.batch || "–")}</text>
</g>
<text x="398" y="140" font-family="Poppins" font-size="9.4" fill="${BL}" text-decoration="underline">RECEIVED FROM</text>
<g font-family="${TY}" font-size="10.5" fill="${INK}">
<text x="398" y="157" font-weight="700">${esc2(d.name)}</text><text x="398" y="172">${esc2(d.email)}</text><text x="398" y="187">${esc2(d.phone || "")}</text>
</g>
<g font-family="Poppins" font-weight="600" font-size="10" fill="${BL}"><text x="160" y="${ty - 40}">DESCRIPTION</text><text x="555" y="${ty - 40}" text-anchor="end">AMOUNT</text></g>
<line x1="160" y1="${ty - 28}" x2="555" y2="${ty - 28}" stroke="${BL}" stroke-width="0.9"/>
${items.map(([k, v], i) => `<text x="160" y="${ty + i * 30}" font-family="Poppins" font-size="10.4" fill="${BL}">${esc2(k)}</text><text x="555" y="${ty + i * 30}" font-family="${TY}" font-size="11" fill="${INK}" text-anchor="end">${esc2(v)}</text>`).join("")}
<line x1="160" y1="${ty + 80}" x2="555" y2="${ty + 80}" stroke="${BL}" stroke-width="0.9"/>
<text x="160" y="${ty + 104}" font-family="Poppins" font-weight="700" font-size="11" fill="${BL}">TOTAL PAID</text>
<text x="555" y="${ty + 104}" font-family="${TY}" font-weight="700" font-size="12.5" fill="${INK}" text-anchor="end">${esc2(d.total)} only</text>
<g font-family="Poppins" font-size="9" fill="${MUT}">
<text x="160" y="${ty + 140}">Course dates: <tspan fill="${INK}">${esc2(d.start)} – ${esc2(d.end)}</tspan></text>
<text x="160" y="${ty + 155}">Portal access until: <tspan fill="${INK}">${esc2(d.accessUntil)}</tspan></text>
${d.payNote ? `<text x="160" y="${ty + 176}" font-weight="600" fill="${G}">${esc2(d.payNote)}</text>` : ""}
</g>
<text x="146" y="575" font-family="Poppins" font-size="9.4" fill="${BL}" text-decoration="underline">PAYMENT RECEIVED IN (DFA)</text>
<g font-family="${TY}" font-size="10.5" fill="${INK}"><text x="146" y="592">DEUTSCH FUR ALLE</text><text x="146" y="607">AL BARAKA</text><text x="146" y="622">****3012</text></g>
<text x="146" y="660" font-family="Poppins" font-size="9.4" fill="#c4621a" text-decoration="underline">QUESTIONS?</text>
<text x="146" y="678" font-family="Poppins" font-size="9.4" fill="#c4621a">Email us at</text>
<text x="146" y="691" font-family="Poppins" font-size="9.4" fill="#c4621a">admission@mail.deutschfuralle.com</text>
<image href="${img.stamp}" x="447" y="545" width="104" height="104"/>
<image href="${img.sign}" x="440" y="668" width="118" height="28"/>
<text x="499" y="712" font-family="Poppins" font-size="8" fill="${MUT}" text-anchor="middle">Deutsch Für Alle, Accounts</text>
<text x="0" y="0" font-family="Archivo Black" font-size="66" fill="#2f5c0c" transform="translate(98 812) rotate(-90)">Receipt</text>
<text x="146" y="806" font-family="Poppins" font-style="italic" font-size="8" fill="${MUT}">Computer-generated receipt, valid without a signature. Please keep it for your records.</text>
${sampleMark(d.sample)}
</svg>`;
}
