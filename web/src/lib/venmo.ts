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
    `&${q("note", note.slice(0, 280))}&${q("audience", "private")}`
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
