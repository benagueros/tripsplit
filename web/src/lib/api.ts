import { anonKey, functionsUrl } from "./supabase";
import { forgetSession, getActiveToken, saveSession } from "./session";
import type { Member, Trip } from "./types";

export function getSavedTripToken(): string | null {
  return getActiveToken();
}

export function forgetTrip() {
  forgetSession();
}

async function fn<T>(name: string, body: unknown, jwt?: string): Promise<T> {
  // Supabase's gateway requires an Authorization header on function calls.
  // Before a trip session exists we send the (public) anon key; after, the
  // trip-scoped JWT. The function itself does the real authorization.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt ?? anonKey}`,
  };
  const res = await fetch(functionsUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface TripSession {
  trip: Trip;
  members: Member[];
  jwt: string;
}

/** Create a trip. Names must be unique case-insensitively. */
export async function createTrip(
  name: string,
  memberNames: string[]
): Promise<TripSession> {
  const data = await fn<{
    trip: Trip;
    members: Member[];
    jwt: string;
    token: string;
  }>("trip-auth", { action: "create", name, memberNames });
  saveSession(data.token, data.jwt);
  return { trip: data.trip, members: data.members, jwt: data.jwt };
}

/** Join via full token (from link) or short code (manual entry). */
export async function joinTrip(
  tokenOrCode: string
): Promise<TripSession> {
  const data = await fn<{
    trip: Trip;
    members: Member[];
    jwt: string;
    token: string;
  }>("trip-auth", { action: "join", tokenOrCode });
  saveSession(data.token, data.jwt);
  return { trip: data.trip, members: data.members, jwt: data.jwt };
}

export function tripLink(token: string): string {
  // Hash-based so the token never touches the server and the link works on
  // any static host with zero redirect configuration.
  return `${window.location.origin}/#/t/${token}`;
}
