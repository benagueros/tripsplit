// ocr-scan: receipt photo -> structured line items via a vision model.
// Quota is enforced here, server-side: free trips get 15 scans/month,
// paid trips 200. Scans are never uncapped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
// Google's own error messages name the current model when an old one is
// rejected, so the first default was set from a live API response
// (Sep 30, 2026: gemini-3.8-flash). A comma-separated list is tried in order —
// if the primary model is overloaded, the next one is attempted.
const GEMINI_MODELS = (Deno.env.get("GEMINI_MODELS")
  ?? Deno.env.get("GEMINI_MODEL")
  ?? "gemini-3.8-flash,gemini-3-flash-preview")
  .split(",").map((m) => m.trim()).filter(Boolean);

const QUOTAS: Record<string, number> = { free: 15, paid: 200 };

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

const SYSTEM_PROMPT = `You are a receipt parser. Extract every purchased line item from this receipt photo.
Return ONLY valid JSON with this shape:
{"items":[{"name":string,"qty":number,"price_cents":integer}],
 "subtotal_cents":integer|null,"tax_cents":integer|null,"tip_cents":integer|null,"total_cents":integer|null}
Rules:
- price_cents is the TOTAL line price in cents (qty × unit price), not the unit price.
- qty is the quantity shown; default 1.
- Extract ALL line items — warehouse receipts (e.g. Costco) can have dozens; do not stop early and do not summarize.
- Warehouse receipts show an item number next to each product: use the product description as the name, ignore the item number.
- Exclude payment-method lines, loyalty text, addresses, membership info, and cashier names.
- If a value is unreadable, use null for that total field but still extract items.
- Round half-up to the nearest cent.`;

// Single-model vision call. Throws Error("vision_http") when Google rejects
// the call, Error("vision_http_transient") when it stays overloaded through
// retries, and Error("vision_parse") when the response isn't usable JSON.
// Transient 429/503s are retried with backoff; other HTTP failures throw
// immediately since retrying can't help.
async function visionCall(
  model: string,
  image: { mime_type: string; data: string },
  retryHint: string | null
): Promise<Record<string, unknown>> {
  // The API key travels in the x-goog-api-key header, never in the URL —
  // query strings end up in access logs, whereas headers don't.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      parts: [
        { inline_data: { mime_type: image.mime_type || "image/jpeg", data: image.data } },
        { text: retryHint ?? "Extract the line items and totals from this receipt." },
      ],
    }],
    generationConfig: { response_mime_type: "application/json", temperature: 0 },
  });
  let res!: Response;
  let errText = "";
  let errStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_KEY,
      },
      body,
    });
    if (res.ok) break;
    errText = await res.text();
    errStatus = res.status;
    const transient = res.status === 429 || res.status === 503;
    if (!transient || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  if (!res.ok) {
    console.error("vision error", model, errText);
    // Surface a sanitized hint so failures are diagnosable without the
    // dashboard logs. Never includes the key (it travels in a header, and
    // only a redacted slice of the provider's message is forwarded).
    let hint = "unknown";
    try {
      const ej = JSON.parse(errText);
      hint = ej?.error?.message ?? hint;
    } catch { /* keep raw hint fallback */ }
    if (hint === "unknown") hint = errText.slice(0, 160);
    const transient = errStatus === 429 || errStatus === 503;
    const e = new Error(transient ? "vision_http_transient" : "vision_http") as Error & { detail?: string };
    e.detail = `${model}: ${String(hint).slice(0, 180)}`;
    throw e;
  }
  const raw = await res.json();
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.items) && parsed.items.length > 0) return parsed;
  } catch {
    // fall through to parse error
  }
  throw new Error("vision_parse");
}

// Tries each configured model in order. An overloaded model falls through to
// the next; any other failure (bad key, bad model name, unparseable output)
// throws immediately. Callers retry only on vision_parse, with a nudge.
async function extractItems(
  image: { mime_type: string; data: string },
  retryHint: string | null
): Promise<Record<string, unknown>> {
  let lastTransient: (Error & { detail?: string }) | undefined;
  for (const model of GEMINI_MODELS) {
    try {
      return await visionCall(model, image, retryHint);
    } catch (e) {
      const err = e as Error & { detail?: string };
      if (err.message === "vision_http_transient") {
        lastTransient = err;
        continue;
      }
      throw e;
    }
  }
  throw lastTransient ?? new Error("vision_http");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const tripId = await verifyTripJwt(req.headers.get("authorization"));
    if (!tripId) return json({ error: "Not authorized for this trip." }, 401);

    const { data: trip } = await supabase.from("trips").select("id,tier").eq("id", tripId).single();
    if (!trip) return json({ error: "Trip not found." }, 404);

    // Monthly quota, counted server-side so it can't be bypassed.
    // Reserve-first: the usage row is inserted BEFORE the vision call and
    // the count happens after. A plain check-then-act lets two concurrent
    // scans both slip under the quota; the insert is the atomic reservation.
    // Over-quota and failed scans roll their row back, so quota is never
    // burned on failures (fail-closed: at worst a boundary race retries).
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const quota = QUOTAS[trip.tier] ?? QUOTAS.free;

    const { image_base64, mime_type } = await req.json() as {
      image_base64: string; mime_type: string;
    };
    if (!image_base64) return json({ error: "No image provided." }, 400);
    // Server-side size cap: the client downscales, but anyone with the trip
    // link can POST directly. Reject absurd payloads before they reach the
    // vision API or burn quota. ~8MB decoded is far above a real receipt photo.
    if (typeof image_base64 !== "string" || Math.floor(image_base64.length * 3 / 4) > 8 * 1024 * 1024) {
      return json({ error: "Image is too large — please use a smaller photo." }, 413);
    }
    if (!GEMINI_KEY) return json({ error: "Receipt scanning is not configured." }, 500);

    const { data: usageRow, error: usageErr } = await supabase
      .from("scan_usage").insert({ trip_id: tripId }).select("id").single();
    if (usageErr || !usageRow) {
      console.error("ocr-scan: usage reservation failed", usageErr?.message);
      return json({ error: "Something went wrong — try again." }, 500);
    }
    const releaseReservation = () =>
      supabase.from("scan_usage").delete().eq("id", usageRow.id);

    const { count } = await supabase.from("scan_usage")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .gte("created_at", monthStart.toISOString());
    if ((count ?? 0) > quota) {
      await releaseReservation();
      return json({
        error: `This trip has used its ${quota} scans for the month.`,
        quota_exceeded: true,
      }, 429);
    }

    let parsed: Record<string, unknown> | undefined;
    let visionDown = false;
    let visionDetail = "";
    try {
      parsed = await extractItems(
        { mime_type: mime_type || "image/jpeg", data: image_base64 },
        null
      );
    } catch (e) {
      const err = e as Error & { detail?: string };
      if (err.message === "vision_parse") {
        // Retry once with an explicit nudge before giving up.
        try {
          parsed = await extractItems(
            { mime_type: mime_type || "image/jpeg", data: image_base64 },
            "This is a long receipt. Extract EVERY line item from top to bottom — do not stop after the first few and do not summarize. Then extract the totals."
          );
        } catch (e2) {
          const err2 = e2 as Error & { detail?: string };
          visionDown = err2.message === "vision_http";
          visionDetail = err2.detail ?? "";
        }
      } else {
        visionDown = true;
        visionDetail = err.detail ?? "";
      }
    }
    if (!parsed) {
      // Roll back the reservation: a failed scan must not burn quota.
      await releaseReservation();
      // Log the upstream detail server-side only — don't forward raw provider
      // text to clients.
      if (visionDetail) console.error("ocr-scan: vision failed:", visionDetail.slice(0, 500));
      return json({
        error: visionDown
          ? "The scanner service is having trouble right now — try again in a bit, or enter the items manually."
          : "Couldn't read that receipt. Try a flatter, well-lit photo — or enter the items manually.",
      }, 502);
    }

    const items = (parsed.items as { name?: string }[])
      .filter((it) => it?.name && String(it.name).trim())
      .map((it: { name: string; qty?: number; price_cents?: number }, i: number) => ({
        name: String(it.name).slice(0, 120),
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        price_cents: Math.max(0, Math.round(Number(it.price_cents) || 0)),
        sort: i,
      }));
    if (items.length === 0) {
      await releaseReservation();
      return json({ error: "No items found — try a clearer photo." }, 422);
    }

    return json({
      items,
      subtotal_cents: parsed.subtotal_cents ?? null,
      tax_cents: parsed.tax_cents ?? null,
      tip_cents: parsed.tip_cents ?? null,
      total_cents: parsed.total_cents ?? null,
      scans_remaining: quota - (count ?? 0),
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong — try again." }, 500);
  }
});
