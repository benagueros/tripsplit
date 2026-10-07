import { functionsUrl, getTripJwt } from "./supabase";

/**
 * Starts a TripSplit Plus checkout via Polar and redirects to it.
 * Throws on failure; callers surface the message.
 */
export async function startPlusCheckout(): Promise<void> {
  const res = await fetch(functionsUrl("polar-checkout"), {
    method: "POST",
    headers: { Authorization: `Bearer ${getTripJwt()}` },
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't start checkout.");
  if (!data.url) throw new Error("Checkout URL missing.");
  window.location.href = data.url;
}
