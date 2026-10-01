# TripSplit

No-account group trip expense splitting. PWA frontend (React + Vite + TypeScript)
plus a Supabase backend (Postgres + Realtime + Edge Functions).

**Status:** live at https://tripsplit.us — Polar billing is wired up (TripSplit Plus,
$2.99/mo).

## How it works

- **No accounts, ever.** A trip is created → an unguessable token link is shared in
  the group chat. The `trip-auth` edge function mints a trip-scoped JWT; every
  Postgres RLS policy checks the token claim, so a link grants exactly one trip.
- **Receipts:** photo → `ocr-scan` edge function (Gemini vision, structured JSON)
  → correction screen → per-person claiming. Tax + tip split proportionally.
- **Split by day:** lodging (nights) / rental car (days) — each night/day splits
  only among that unit's participants. Saving is blocked if any unit is empty.
- **Settle:** netted balances, greedy debt simplification, Venmo deep links
  (Venmo has no third-party API — deep links are the ceiling), mark-as-paid with
  recipient confirmation.
- **Quotas (server-side, can't be bypassed):** free trips 15 scans/month, paid 200.

## Repo layout

```
web/                    PWA frontend
  src/lib/              types, money math, settle engine, supabase client, api, store
  src/screens/          CreateTrip, JoinTrip, TripView, ShareTrip, ReceiptFlow,
                        SimpleExpense, SplitByDay, Balances
supabase/
  migrations/           schema + RLS (no-account security model)
  functions/
    trip-auth/          create/join trips, mint trip-scoped JWTs
    ocr-scan/           vision OCR + monthly quota enforcement
    polar-checkout/     paid tier checkout (Polar)
    polar-webhook/      tier upgrades/downgrades (Polar webhooks, HMAC-verified)
    polar-cancel/       in-app cancel/resume (trip-JWT auth)
```

## Monetization (live)
- Polar Checkout + webhook → flip `trips.tier` to `paid` (idempotent).
- In-app cancel/resume via `polar-cancel`; `subscription.revoked` flips the trip
  back to free at period end.
- Receipt image storage in Supabase Storage (currently base64 → vision API directly).
- PWA icons (`public/icon-192.png`, `public/icon-512.png`) — placeholder needed.

## Security model

- **No accounts by design.** The trip link/token is a bearer credential: anyone
  who has it gets full access to that trip (and only that trip), like a Google
  Doc shared by link. There is no per-member permission layer.
- Trip JWTs are HMAC-SHA256 signed by `trip-auth`; every edge function verifies
  the signature itself (the Supabase gateway check can't — it validates against
  the project's auth secret, not the trip secret).
- `trips.tier` / share token / Polar subscription ids can only be changed by
  `service_role` (database trigger) — members can't grant themselves Plus or
  rotate credentials from the console.
- `scan_usage` is read-only for members; only `ocr-scan` (service role) writes
  it, so quotas can't be reset from the client.
- Short join codes are 6 digits (~10.8M combos) and joins are rate-limited
  (30/min/IP).
