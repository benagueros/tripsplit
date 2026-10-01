# TripSplit

No-account group trip expense splitting. PWA frontend (React + Vite + TypeScript)
plus a Supabase backend (Postgres + Realtime + Edge Functions).

**Status:** v0.1 — full app code is here. It needs three things from before it
runs live (see Setup below). Stripe billing is scaffolded for phase 2.

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
    stripe-checkout/    (phase 2) paid tier checkout
    stripe-webhook/     (phase 2) tier upgrades
```

## Phase 2 (not yet built)
- Polar Checkout + webhook → flip `trips.tier` to `paid`.
- Receipt image storage in Supabase Storage (currently base64 → vision API directly).
- PWA icons (`public/icon-192.png`, `public/icon-512.png`) — placeholder needed.
