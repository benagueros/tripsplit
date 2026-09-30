// trip-auth: creates trips and mints trip-scoped JWTs.
// No user accounts exist. The JWT carries { trip_id, trip_token } and every
// RLS policy checks the token claim, so a leaked link grants exactly one trip.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// NOTE: "SUPABASE_" prefix is reserved by Supabase — custom secrets must not use it.
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const WORDS = [
  "CANYON", "RIVER", "MESQUITE", "PECAN", "ARROYO", "BISON",
  "COYOTE", "DELTA", "EMBER", "FLINT", "GULCH", "HICKORY",
];

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64url(data: Uint8Array | string): string {
  const bin = typeof data === "string"
    ? data
    : String.fromCharCode(...data);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function mintJwt(tripId: string, tripToken: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    role: "authenticated",
    trip_id: tripId,
    trip_token: tripToken,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`))
  );
  return `${header}.${payload}.${base64url(sig)}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json();
    const { action } = body as { action: string };

    if (action === "create") {
      const { name, memberNames } = body as {
        name: string; memberNames: string[];
      };
      const clean = [...new Set(
        (memberNames ?? []).map((n) => n.trim()).filter(Boolean)
      )];
      if (!name?.trim()) return json({ error: "Trip name is required." }, 400);
      if (clean.length < 2) return json({ error: "Add at least two people." }, 400);
      const lowered = clean.map((n) => n.toLowerCase());
      if (new Set(lowered).size !== lowered.length) {
        return json({
          error: "Names must be unique — add a last name or initial to tell duplicates apart.",
        }, 400);
      }

      // Generate a unique short code like CANYON-4821.
      let code = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        const word = WORDS[Math.floor(Math.random() * WORDS.length)];
        const digits = String(Math.floor(1000 + Math.random() * 9000));
        const candidate = `${word}-${digits}`;
        const { data } = await supabase.from("trips").select("id").eq("code", candidate).maybeSingle();
        if (!data) { code = candidate; break; }
      }
      if (!code) return json({ error: "Could not generate a trip code, try again." }, 500);

      const token = randomToken();
      const { data: trip, error: tripErr } = await supabase.from("trips")
        .insert({ name: name.trim(), token, code })
        .select().single();
      if (tripErr) throw tripErr;

      const { data: members, error: memErr } = await supabase.from("members")
        .insert(clean.map((n) => ({ trip_id: trip.id, name: n })))
        .select();
      if (memErr) throw memErr;

      const jwt = await mintJwt(trip.id, token);
      return json({ trip, members, jwt, token });
    }

    if (action === "join") {
      const { tokenOrCode } = body as { tokenOrCode: string };
      const value = (tokenOrCode ?? "").trim();
      if (!value) return json({ error: "Enter a trip link or code." }, 400);
      // Short codes look like CANYON-4821; anything else is treated as a token.
      const looksLikeCode = /^[A-Za-z]+-\d{4}$/.test(value);
      const attempts: Array<[string, string]> = looksLikeCode
        ? [["code", value.toUpperCase()], ["token", value]]
        : [["token", value], ["code", value.toUpperCase()]];
      let found = null;
      for (const [col, val] of attempts) {
        const { data } = await supabase.from("trips").select().eq(col, val).maybeSingle();
        if (data) { found = data; break; }
      }
      if (!found) return json({ error: "Trip not found — check the link or code." }, 404);
      const { data: members } = await supabase.from("members")
        .select().eq("trip_id", found.id).order("created_at");
      const jwt = await mintJwt(found.id, found.token);
      return json({ trip: found, members: members ?? [], jwt, token: found.token });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong — try again." }, 500);
  }
});
