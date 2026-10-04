// polar-webhook: receives Polar subscription events and flips trips.tier.
// Checkout sessions carry { trip_id } in metadata; this handler reads it back
// from the subscription so tier changes are tied to the right trip.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   POLAR_WEBHOOK_SECRET — the signing secret from the Polar webhook endpoint.
//     Polar uses the Standard Webhooks scheme: headers webhook-id,
//     webhook-timestamp, webhook-signature (v1,<base64 HMAC-SHA256 of
//     "<id>.<timestamp>.<raw body>")).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("POLAR_WEBHOOK_SECRET")!;

const PAID_STATUSES = new Set(["active", "trialing"]);
const FREE_STATUSES = new Set(["canceled", "expired", "revoked", "unpaid"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Base64(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return btoa(String.fromCharCode(...mac));
}

function candidateSecrets(secret: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const enc = new TextEncoder();
  // 1. Verbatim (some Polar integrations use the full whsec_ string as the key).
  out.push(enc.encode(secret));
  const stripped = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (stripped !== secret) {
    // 2. Standard Webhooks spec: whsec_ + base64(raw key bytes).
    try {
      const bin = atob(stripped);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out.push(bytes);
    } catch {
      // not valid base64 — skip
    }
    // 3. Stripped prefix, raw UTF-8 bytes.
    out.push(enc.encode(stripped));
  }
  return out;
}

async function verifySignature(
  rawBody: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
): Promise<boolean> {
  // Timestamp sanity check. Polar retries failed deliveries with the ORIGINAL
  // timestamp, and its backoff spans days — so a tight window breaks legitimate
  // retries. The handler below is idempotent (absolute tier sets), so a
  // replayed event is harmless; the HMAC signature is the authenticity
  // guarantee, not the timestamp.
  const ts = Number(timestamp);
  const now = Date.now() / 1000;
  if (!Number.isFinite(ts) || ts > now + 300 || ts < now - 7 * 86400) return false;

  const message = `${id}.${timestamp}.${rawBody}`;
  const sigs = signatureHeader.split(" ").map((part) =>
    part.startsWith("v1,") ? part.slice(3) : part
  );

  for (const keyBytes of candidateSecrets(WEBHOOK_SECRET)) {
    const expected = await hmacSha256Base64(keyBytes, message);
    if (sigs.some((sig) => timingSafeEqual(sig, expected))) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const rawBody = await req.text();
  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("webhook-signature") ?? "";

  if (!id || !timestamp || !signature) {
    return json({ error: "missing webhook headers" }, 400);
  }
  if (!(await verifySignature(rawBody, id, timestamp, signature))) {
    console.error("polar-webhook: bad signature");
    return json({ error: "bad signature" }, 401);
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const type = event.type ?? "";
  if (!type.startsWith("subscription.")) {
    // Acknowledge anything else (orders, refunds) without acting.
    return json({ ok: true, ignored: type });
  }

  const data = event.data ?? {};
  const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
  const tripId = metadata["trip_id"];
  const status = String(data["status"] ?? "");
  const subscriptionId = String(data["id"] ?? "");
  const customerId = String(data["customer_id"] ?? "");

  if (typeof tripId !== "string" || !tripId) {
    console.error(`polar-webhook: ${type} missing metadata.trip_id`);
    return json({ ok: true, ignored: "no trip_id" });
  }

  let tier: "paid" | "free" | null = null;
  if (PAID_STATUSES.has(status)) tier = "paid";
  else if (FREE_STATUSES.has(status)) tier = "free";

  if (!tier) {
    return json({ ok: true, ignored: `status ${status}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Event ordering: Polar may deliver events late or out of order (retries
  // reuse the original timestamp). A delayed event must never overwrite
  // newer state — e.g. a stale "paid" event for an OLD subscription
  // overwriting polar_subscription_id, after which the old sub's "canceled"
  // event would downgrade a trip that's actually paying on a new sub.
  // Track the newest applied event timestamp per trip and ignore anything
  // strictly older. (Same-second events apply in arrival order; tier sets
  // are idempotent so a retried duplicate is harmless.)
  const eventTs = Number(timestamp); // validated finite by verifySignature
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("polar_subscription_id, polar_last_event_ts")
    .eq("id", tripId)
    .single();
  if (tripErr) {
    console.error("polar-webhook: trip lookup failed", tripErr.message);
    return json({ error: "trip lookup failed" }, 500);
  }
  const lastTs = trip?.polar_last_event_ts
    ? new Date(trip.polar_last_event_ts as string).getTime() / 1000
    : null;
  if (lastTs !== null && eventTs < lastTs) {
    console.log(
      `polar-webhook: ignoring out-of-order ${type} for trip ${tripId} (event ts ${eventTs}, last applied ${lastTs})`
    );
    return json({ ok: true, ignored: "out-of-order event" });
  }

  // Ignore stale downgrades: if the trip already points at a different (newer)
  // subscription — e.g. cancel then resubscribe — a late event for the old
  // subscription must not flip a paying trip back to free.
  if (tier === "free") {
    const current = (trip?.polar_subscription_id as string | null) ?? null;
    if (current && current !== subscriptionId) {
      console.log(
        `polar-webhook: ignoring stale ${type} for trip ${tripId} (event sub ${subscriptionId || "?"}, current ${current})`
      );
      return json({ ok: true, ignored: "stale subscription" });
    }
  }

  const { error } = await supabase
    .from("trips")
    .update({
      tier,
      polar_subscription_id: subscriptionId || null,
      polar_customer_id: customerId || null,
      polar_last_event_ts: new Date(eventTs * 1000).toISOString(),
    })
    .eq("id", tripId);

  if (error) {
    console.error("polar-webhook: trip update failed", error.message);
    return json({ error: "trip update failed" }, 500);
  }

  console.log(`polar-webhook: trip ${tripId} -> ${tier} (${type}, ${status})`);
  return json({ ok: true, trip_id: tripId, tier });
});
