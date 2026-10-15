// Venmo has no third-party API — deep links are the ceiling.
// These open Venmo with amount + note prefilled; the user confirms in Venmo,
// then marks the payment in TripSplit.
//
// NOTE: URLSearchParams encodes spaces as "+" (form encoding), which Venmo
// does NOT decode — notes showed up with literal "+" signs. Build the query
// with encodeURIComponent instead so spaces become %20.

function venmoLink(txn: "pay" | "charge", amountDollars: string, note: string): string {
  const q = (k: string, v: string) => `${k}=${encodeURIComponent(v)}`;
  return (
    `venmo://paycharge?` +
    `${q("txn", txn)}&${q("amount", amountDollars)}` +
    // Truncate by code point, not UTF-16 unit, so a note ending in emoji
    // can't be split mid-character.
    `&${q("note", Array.from(note).slice(0, 280).join(""))}&${q("audience", "private")}`
  );
}

export function venmoPayLink(amountDollars: string, note: string): string {
  return venmoLink("pay", amountDollars, note);
}

export function venmoChargeLink(amountDollars: string, note: string): string {
  return venmoLink("charge", amountDollars, note);
}

/** Web fallback when the app isn't installed. */
export function venmoWebLink(): string {
  return "https://venmo.com/";
}

// Plain-text payment details for the copy fallback: venmo:// links only
// work where the Venmo app is installed, so desktop users paste this into
// Venmo's web app (or a message) instead of tapping a dead deep link.
// Single line: Venmo's note field is single-line, so a pasted newline may
// strip the trip-identifying note. Strip CR/LF from the inputs too —
// trip/member names arrive via text inputs, but a direct API call could
// smuggle in a newline and reintroduce multi-line paste.
export function venmoPaymentDetails(toName: string, amountDollars: string, note: string): string {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
  return `Pay ${oneLine(toName)} $${amountDollars} — ${oneLine(note)}`;
}
