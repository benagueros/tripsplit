// polar-cancel: let a trip member cancel (or resume) the trip's TripSplit Plus
// subscription without leaving the app. Auth: trip JWT, same as polar-checkout.
// The subscription is looked up from the trip row, so a caller can only ever
// touch their own trip's subscription.
//
// Actions (POST JSON body):
//   { "action": "status" }  -> current subscription state, no changes
//   { "action": "cancel" }  -> cancel at period end (keeps Plus until paid time runs out)
//   { "action": "resume" }  -> undo a scheduled cancellation
//
// When the paid period finally ends, Polar fires subscription.revoked and the
// polar-webhook flips the trip back to the free tier automatically.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   POLAR_API_TOKEN — Organization Access Token with subscriptions:read + subscriptions:write.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;
const POLAR_API_TOKEN = Deno.env.get("POLAR_API_TOKEN")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function base64urlDecode(s: string): string {
  let b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  while (b64.length % 4) b64 += "=";
  return atob(b64);
}

// Verify the trip JWT's HMAC-SHA256 signature (signed by trip-auth with
// JWT_SECRET) and return the trip_id. The Supabase gateway's JWT check can't
// cover this — it validates against the project's auth secret, not ours — so
// the signature must be checked here, otherwise anyone could forge a token
// for any trip_id.
async function verifyTripJwt(auth: string | null): Promise<string | null> {
  if (!auth?.startsWith("Bearer ")) return null;
  const parts = auth.slice(7).split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(base64urlDecode(sigB64), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(base64urlDecode(payloadB64));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload.trip_id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const tripId = await verifyTripJwt(req.headers.get("authorization"));
  if (!tripId) return json({ error: "Not authorized for this trip." }, 401);

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (!["status", "cancel", "resume"].includes(action ?? "")) {
    return json({ error: "action must be status, cancel, or resume." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: trip } = await supabase
    .from("trips")
    .select("id,tier,polar_subscription_id")
    .eq("id", tripId)
    .single();
  if (!trip) return json({ error: "Trip not found." }, 404);
  const subId = (trip as { polar_subscription_id: string | null }).polar_subscription_id;
  if (!subId) return json({ error: "No Plus subscription on this trip." }, 400);

  const headers = {
    Authorization: `Bearer ${POLAR_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const subUrl = `https://api.polar.sh/v1/subscriptions/${subId}`;

  if (action === "cancel" || action === "resume") {
    const res = await fetch(subUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ cancel_at_period_end: action === "cancel" }),
    });
    if (!res.ok) {
      console.error("polar-cancel: polar update failed", res.status, await res.text());
      return json({ error: "Couldn't update the subscription." }, 502);
    }
  }

  const res = await fetch(subUrl, { headers });
  if (!res.ok) {
    console.error("polar-cancel: polar read failed", res.status, await res.text());
    return json({ error: "Couldn't read the subscription." }, 502);
  }
  const sub = (await res.json()) as {
    status?: string;
    cancel_at_period_end?: boolean;
    current_period_end?: string | null;
  };
  return json({
    status: sub.status ?? null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: sub.current_period_end ?? null,
  });
});
