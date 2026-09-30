// Venmo has no third-party API — deep links are the ceiling.
// These open Venmo with amount + note prefilled; the user confirms in Venmo,
// then marks the payment in TripSplit.

export function venmoPayLink(amountDollars: string, note: string): string {
  const params = new URLSearchParams({
    txn: "pay",
    amount: amountDollars,
    note: note.slice(0, 280),
    audience: "private",
  });
  return `venmo://paycharge?${params.toString()}`;
}

export function venmoChargeLink(amountDollars: string, note: string): string {
  const params = new URLSearchParams({
    txn: "charge",
    amount: amountDollars,
    note: note.slice(0, 280),
    audience: "private",
  });
  return `venmo://paycharge?${params.toString()}`;
}

/** Web fallback when the app isn't installed. */
export function venmoWebLink(): string {
  return "https://venmo.com/";
}
