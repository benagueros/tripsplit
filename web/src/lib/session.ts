/**
 * Multi-trip session store.
 *
 * Previously a single global token/JWT lived in localStorage, so opening a
 * second trip link overwrote the first trip's session and the first tab's
 * mutations failed with confusing auth errors. Now:
 * - localStorage "tripsplit.sessions": { [tripToken]: jwt } — every trip
 *   joined in this browser, so sessions survive restarts.
 * - localStorage "tripsplit.last_token": most recently active token, used by
 *   fresh tabs / after a restart.
 * - sessionStorage "tripsplit.tab_token": this tab's active trip — tabs no
 *   longer fight over one global slot, and it survives reloads.
 * The old single-session keys are still read as a fallback for browsers that
 * saved a session before this change.
 */

const SESSIONS_KEY = "tripsplit.sessions";
const LAST_KEY = "tripsplit.last_token";
const TAB_KEY = "tripsplit.tab_token";
const LEGACY_TOKEN = "tripsplit.trip_token";
const LEGACY_JWT = "tripsplit.jwt";

function readSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, string>) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    /* storage full / private mode — session still works for this tab */
  }
}

/** This tab's active trip token. */
export function getActiveToken(): string | null {
  return (
    sessionStorage.getItem(TAB_KEY) ??
    localStorage.getItem(LAST_KEY) ??
    localStorage.getItem(LEGACY_TOKEN)
  );
}

/** JWT for the given (or active) trip token. */
export function getSessionJwt(token: string | null = getActiveToken()): string | null {
  if (!token) return null;
  const jwt = readSessions()[token];
  if (jwt) return jwt;
  // Legacy single-session fallback.
  if (token === localStorage.getItem(LEGACY_TOKEN)) {
    return localStorage.getItem(LEGACY_JWT);
  }
  return null;
}

export function saveSession(token: string, jwt: string) {
  const sessions = readSessions();
  sessions[token] = jwt;
  writeSessions(sessions);
  localStorage.setItem(LAST_KEY, token);
  sessionStorage.setItem(TAB_KEY, token);
}

/** Forget one trip's session (defaults to this tab's active trip). */
export function forgetSession(token: string | null = getActiveToken()) {
  if (token) {
    const sessions = readSessions();
    delete sessions[token];
    writeSessions(sessions);
    if (localStorage.getItem(LAST_KEY) === token) {
      localStorage.removeItem(LAST_KEY);
    }
  }
  sessionStorage.removeItem(TAB_KEY);
  // Legacy single-session cleanup.
  localStorage.removeItem(LEGACY_TOKEN);
  localStorage.removeItem(LEGACY_JWT);
}
