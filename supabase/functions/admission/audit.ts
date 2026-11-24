// Activity log for the existing admission actions (WD-3). Wraps the request handler: after a successful admin/staff
// action it writes one admin_activity row with who did it. Nothing changes for the response itself.
import { createClient } from "npm:@supabase/supabase-js@2";
import { logActivity } from "./pro.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const pkr = (n: unknown) => "PKR " + Number(n || 0).toLocaleString("en-US");
/** Summary line per action; null = don't log (or not a success worth logging). */
export function summarize(action: string, body: any, res: any): string | null {
  if (!res || res.error || res.retry) return null;
  switch (action) {
    case "activate": return `Payment received: activated${body.course_code ? " on " + body.course_code : ""}, plan ${body.plan || "full"}${body.method ? ", paid by " + body.method : ""}`;
    case "record_payment": return res.ok && res.payment ? `Installment payment ${pkr(res.payment.amount)} (${res.payment.invoice_no})${res.payment.method ? " by " + res.payment.method : ""}${res.payment.reference ? ", ref " + res.payment.reference : ""}. Receipt email: ${res.email || "not sent"}` : null;
    case "set_plan": return res.ok ? (res.cleared ? "Installment plan removed" : `Installment plan saved (${(body.installments || []).length} installments)${res.due_date ? ", next due " + res.due_date : ""}`) : null;
    case "set_due": return res.ok ? `Due date set to ${body.due_date}` : null;
    case "certify": return res.certificate_no ? `Certificate ${res.certificate_no} issued` : null;
    case "cert_hold": return res.ok ? (body.hold ? "Certificate put on hold" : "Certificate hold released") : null;
    case "cert_revoke": return res.ok ? (body.undo ? "Certificate restored" : "Certificate revoked") : null;
    case "resend": return res.ok ? `Documents emailed (${(res.items || body.items || []).join(", ")}): ${res.email || ""}` : null;
    case "welcome": return res.ok ? `Welcome email: ${res.email || "sent"}` : null;
    case "wa_links": return res.ok ? `WhatsApp document links prepared (${(body.items || []).join(", ")})` : null;
    case "regen_docs": return res.ok && res.remaining === 0 && (body.done || []).length ? "Admission form and receipts rebuilt" : null;
    case "set_emails": return res.ok ? `Student emails switched ${body.on ? "ON" : "OFF"}` : null;
    case "cert_images": return res.ok ? `Certificate images ${body.on ? "shown to students" : "hidden from students"}` : null;
    default: return null;
  }
}
function sub(req: Request): string | null {
  try {
    let x = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "=";
    const c = JSON.parse(atob(x)); return c.role === "authenticated" && typeof c.sub === "string" ? c.sub : null;
  } catch (_) { return null; }
}
export function withAudit(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return handler(req);
    let body: any = null; try { body = await req.clone().json(); } catch (_) { body = null; }
    const res = await handler(req);
    const action = body && String(body.action || "");
    // Only signed-in staff calls (a forged token never gets a 2xx from the handler, which checks it with getUser first).
    if (!res.ok || !action || req.headers.get("x-cron-token") || req.headers.get("x-intake-token")) return res;
    const uid = sub(req); if (!uid) return res;
    let out: any = null; try { out = await res.clone().json(); } catch (_) { return res; }
    const s = summarize(action, body, out); if (!s) return res;
    const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });
    const p = logActivity(db, uid, Number(body.id) || null, action, s, action === "record_payment" && out.payment ? { payment_id: out.payment.id } : {});
    try { EdgeRuntime.waitUntil(p); } catch (_) { await p; }
    return res;
  };
}
