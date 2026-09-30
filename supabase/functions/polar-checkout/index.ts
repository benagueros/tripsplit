// polar-checkout: creates a Polar checkout session for TripSplit Plus.
// The caller must present the trip JWT; the trip_id baked into the token is
// stamped into the checkout metadata so the webhook can upgrade that trip.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   POLAR_API_TOKEN  — Organization Access Token (server-side only, never the client).
//   POLAR_PRODUCT_ID — the TripSplit Plus product id from the Polar dashboard.
//   APP_URL          — e.g. https://tripsplit.us (used for the success URL).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POLAR_API_TOKEN = Deno.env.get("POLAR_API_TOKEN")!;
const POLAR_PRODUCT_ID = Deno.env.get("POLAR_PRODUCT_ID")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://tripsplit.us";

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
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  return atob(b64);
}

function tripIdFromJwt(auth: string | null): string | null {
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(base64urlDecode(auth.slice(7).split(".")[1]));
    return payload.trip_id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const tripId = tripIdFromJwt(req.headers.get("authorization"));
  if (!tripId) return json({ error: "Not authorized for this trip." }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: trip } = await supabase
    .from("trips")
    .select("id,tier,token")
    .eq("id", tripId)
    .single();
  if (!trip) return json({ error: "Trip not found." }, 404);
  if (trip.tier === "paid") return json({ error: "Trip already on Plus." }, 400);

  // Create the Polar checkout. Metadata ties the subscription back to this trip.
  const res = await fetch("https://api.polar.sh/v1/checkouts/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${POLAR_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      products: [POLAR_PRODUCT_ID],
      metadata: { trip_id: tripId },
      success_url: `${APP_URL}/#/t/${trip.token}?upgraded=1`,
      allow_discount_codes: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("polar-checkout: Polar API error", res.status, err.slice(0, 500));
    return json({ error: "Could not start checkout. Try again." }, 502);
  }

  const checkout = await res.json() as { url?: string; id?: string };
  if (!checkout.url) return json({ error: "Checkout URL missing." }, 502);

  return json({ url: checkout.url });
});
