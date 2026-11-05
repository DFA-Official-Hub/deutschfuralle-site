// Public WhatsApp redirect: 302 to wa.me/<DFA number>. Number from secret only — never in HTML/JS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

function digitsOnly(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

async function resolveNumber(): Promise<string> {
  const fromEnv = digitsOnly(Deno.env.get("DFA_WHATSAPP_NUMBER") || "");
  if (fromEnv.length >= 10 && fromEnv.length <= 15) return fromEnv;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return "";
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await db.from("site_settings").select("value").eq("key", "whatsapp_number").maybeSingle();
  return digitsOnly(String(data?.value || ""));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }
  try {
    const num = await resolveNumber();
    if (!num) return new Response("WhatsApp is temporarily unavailable.", { status: 503, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
    const u = new URL(req.url);
    const text = u.searchParams.get("text");
    const dest = new URL(`https://wa.me/${num}`);
    if (text != null && text !== "") dest.searchParams.set("text", text);
    return new Response(null, {
      status: 302,
      headers: {
        ...cors,
        Location: dest.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (_) {
    return new Response("WhatsApp is temporarily unavailable.", { status: 503, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
  }
});
