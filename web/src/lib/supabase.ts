import { createClient } from "@supabase/supabase-js";
import { getSessionJwt } from "./session";

const url = import.meta.env.VITE_SUPABASE_URL as string;
export const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) {
  // Fails fast in dev; in production the build injects these via env.
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url ?? "", anonKey ?? "");

export function functionsUrl(name: string): string {
  return `${url}/functions/v1/${name}`;
}

/** Scoped JWT minted by the trip-auth edge function; stored per trip token. */
export function getTripJwt(): string | null {
  return getSessionJwt();
}

/** Authenticated supabase client carrying the trip-scoped JWT. */
export function authedClient() {
  const jwt = getTripJwt();
  if (!jwt) throw new Error("No trip session — join a trip first.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
