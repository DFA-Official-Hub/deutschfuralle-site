// Email templates. Plain text. Signature address: admission@mail.deutschfuralle.com.
// Owner approval needed before SEND_EMAILS is switched on.
export const SITE = "https://www.deutschfuralle.com";
const SIGN = "\n\nSee you in class,\nThe Deutsch Für Alle team\nadmission@mail.deutschfuralle.com · " + SITE;
const COURSE_LINE: Record<string, string> = {
  "a1-crash": "You picked the A1 Crash Course ({fee}). It's the fast one: all 12 A1 chapters in about a month, five classes a week. It moves quickly, so try to keep an hour free most days for revision and homework.",
  "a1-super": "You picked the A1 Super Intensive Course ({fee}). Over roughly six weeks we cover the full A1 syllabus with Netzwerk A1 Neu, plus a few A2 topics so you're not starting from zero next time. Recordings are there if you miss a class.",
  "a1-normal": "You picked the A1 Normal Track ({fee}). It's the steadier route, four classes a week over two to two and a half months, with plenty of time for grammar, practice and exam prep. A good choice if you're working or studying alongside.",
  "a2-super": "You picked the A2 Super Intensive Course ({fee}). It's the quick way through A2, about six weeks of live classes four to five times a week, covering all four modules with speaking practice in every class. Expect a busy month and a half, but you'll be exam-ready at the end.",
  "a2-normal": "You picked the A2 Normal Track ({fee}). It runs over about two and a half months at a calmer pace, so there's room for grammar, lots of speaking and listening practice, and mock tests before the exam. It suits you well if you're juggling work or studies.",
  "a1-a2": "You picked the A1 + A2 Combined Program ({fee}). It takes you from the very start to the end of A2 in about three and a half months, so it's a real commitment, but you'll come out ready for the A2 exam.",
  "b1": "You'd like to join B1 ({fee}). This is where German starts to feel like a real conversation: longer texts, giving your opinion, writing letters and plenty of everyday speaking. The course runs for about two and a half months.",
  "b2": "You'd like to join B2 ({fee}). At this level we work on fluent speaking, discussions, formal writing and the exam formats in detail, over about two and a half months.",
  "c1": "You'd like to join C1 ({fee}). C1 classes are small and focus on advanced reading, academic writing and speaking with confidence. The course runs for about two and a half months.",
  "a2": "You picked the German A2 Course. We'll work on all four modules (Lesen, Hören, Schreiben, Sprechen), with lots of speaking practice and mock tests before the exam.",
};
const fallback = (level?: string) => level ? `You told us you'd like to learn German at ${level} level. We'll confirm the exact course and batch with you.` : "We'll confirm the exact course and batch with you.";
const money = (n: number) => "PKR " + Number(n).toLocaleString("en-US");
export function feeText(fee?: number | null, old?: number | null) {
  return fee ? (old && old > fee ? `fee ${money(fee)}, down from ${Number(old).toLocaleString("en-US")}` : `fee ${money(fee)}`) : "";
}
export function confirmation(name: string, code: string | null, label: string | null, level?: string, fee?: number | null, old?: number | null) {
  const first = (name || "").split(" ")[0] || "there";
  const course = label || "your German course";
  return {
    subject: `We received your Deutsch Für Alle registration`,
    text: `Hi ${first},\n\nThanks for filling in our registration form, we've received it.\n\n${((code && COURSE_LINE[code]) || fallback(level)).replace(" ({fee})", fee ? ` (${feeText(fee, old)})` : "")}\n\nWhat happens next: we'll check your payment receipt and get in touch with your batch timings. Your place is confirmed once we've matched your payment, and then you'll get a second email with your student portal login.\n\nIf you have questions in the meantime, just reply to this email.${SIGN}`,
    course,
  };
}
export function welcome(name: string, label: string, start: string, end: string, x?: { fee: string; studentId: string; invoiceNo: string; batch?: string; courseEnd: string; paid?: string; balance?: string; due?: string } | null) {
  const first = (name || "").split(" ")[0] || "there";
  const head = x
    ? (x.balance ? `Thank you, we've received your first installment of ${x.paid} for the ${label}. Your place is confirmed, and your Student ID is ${x.studentId}. The remaining ${x.balance} is due by ${x.due}; we'll send you a reminder a few days before.` : `Thank you, we've received your fee of ${x.fee} for the ${label}. Your place is confirmed, and your Student ID is ${x.studentId}.`) + `\n\nYour course runs from ${start} to ${x.courseEnd}${x.batch ? ` (batch ${x.batch})` : ""}. You'll keep access to the portal and books until ${end}, so there's time to revise after the last class.\n\nWe've attached two documents for your records: your Confirmation of Registration and your fee receipt (${x.invoiceNo}).`
    : `Your payment has been received, thank you. You're now officially enrolled in ${label}.\n\nYour access runs from ${start} to ${end}. That's the length of the course plus 15 extra days so you have time to revise after the last class.`;
  const sid = x?.studentId ? ` – ${x.studentId}` : "";
  return {
    subject: `Welcome to Deutsch Für Alle${sid}`,
    text: `Hi ${first},\n\n${head}\n\nYour student portal:\n1. Go to ${SITE}/account.html and create an account with this same email address (or log in if you already have one).\n2. Confirm your email from the link we send you.\n3. Open ${SITE}/portal.html to see your course, your access dates and the books included.\n\nWe'll share your class timing and the Zoom link before your first class. The online books can be read on up to two devices, so please keep your login to yourself.\n\nWe're really glad to have you with us. If anything is unclear, just reply to this email.${SIGN}`,
  };
}

export const BANK_TEXT = "Bank: Al Baraka\nAccount title: DEUTSCH FUR ALLE\nAccount number: 0102724973012\nIBAN: PK95AIIN0000102724973012";
export type FeeInfo = { name: string; studentId: string; course: string; batch: string; total: string; paid: string; balance: string; due: string };
function feeBlock(f: FeeInfo) {
  return `Name: ${f.name}\nStudent ID: ${f.studentId}\nCourse: ${f.course}\nBatch: ${f.batch || "–"}\nTotal fee: ${f.total}\nPaid so far: ${f.paid}\nBalance due: ${f.balance}\nDue date: ${f.due}`;
}
function payBlock() {
  return `How to pay:\n${BANK_TEXT}\n\nYou can also scan the Raast QR code attached to this email with any banking app.\n\nOnce you've paid, please reply to this email with a screenshot or photo of the transfer and we'll send you your receipt. If paying on time is difficult this month, just reply and tell us, and we'll work something out together.`;
}
export function reminder(stage: number, f: FeeInfo) {
  const first = (f.name || "").split(" ")[0] || "there";
  const open: Record<number, [string, string]> = {
    1: [`Your next fee installment is due on ${f.due}`, `Just a quick note that the next installment for your ${f.course} is due on ${f.due}, three days from now.`],
    2: [`Your fee installment is due today`, `This is a friendly reminder that the next installment for your ${f.course} is due today, ${f.due}.`],
    3: [`Your fee installment is now overdue`, `We haven't received the next installment for your ${f.course} yet. It was due on ${f.due}. If you've already paid, thank you, and please send us the proof so we can update your record.`],
    0: [`Fee reminder for your ${f.course}`, `Here's a short summary of the fee still outstanding for your ${f.course}.`],
  };
  const [subject, lead] = open[stage] || open[0];
  return { subject, text: `Hi ${first},\n\n${lead}\n\n${feeBlock(f)}\n\n${payBlock()}${SIGN}` };
}
export function docsMail(name: string, course: string, items: string[], fee?: FeeInfo | null, studentId?: string) {
  const first = (name || "").split(" ")[0] || "there";
  const list = items.map((x) => "- " + x).join("\n");
  const rem = fee ? `\n\nA quick note on your fee: a balance of ${fee.balance} is still open, due on ${fee.due}.\n\n${feeBlock(fee)}\n\n${payBlock()}` : "";
  const sid = studentId ? ` – ${studentId}` : "";
  return {
    subject: items.length ? `Your Deutsch Für Alle admission documents${sid}` : `Fee reminder for your ${course}${sid}`,
    text: `Hi ${first},\n\n${items.length ? `As requested, here are your documents for the ${course}. You'll find them attached:\n${list}` : `Here's a short summary of the fee still outstanding for your ${course}.`}${rem}\n\nIf anything looks wrong, just reply to this email and we'll fix it.${SIGN}`,
  };
}
export function receiptMail(name: string, course: string, amount: string, inv: string, balance: string, due: string) {
  const first = (name || "").split(" ")[0] || "there";
  return {
    subject: `Payment received – Deutsch Für Alle (${inv})`,
    text: `Hi ${first},\n\nThank you, we've received your payment of ${amount} for the ${course}. Your receipt (${inv}) is attached.\n\n${balance ? `The remaining balance is ${balance}, due by ${due}.` : `Your course fee is now paid in full. Nothing more is due.`}${SIGN}`,
  };
}
// BANK_QR moved to private Storage documents/internal/dfa-raast-qr.jpg (not in git).
