# TripSplit — real app

No-account group trip expense splitting. PWA frontend (React + Vite + TypeScript)
plus a Supabase backend (Postgres + Realtime + Edge Functions).

**Status:** v0.1 — full app code is here. It needs three things from Ben before it
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

## Setup (Ben's 3 steps)

### 1. Supabase project (free tier)
1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/20260930_init.sql`.
3. Copy: Project URL, `anon` key, `service_role` key, and the JWT secret
   (Project Settings → API).

### 2. Deploy edge functions + secrets
```bash
# install the Supabase CLI, then from this repo root:
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy trip-auth
supabase functions deploy ocr-scan
supabase secrets set JWT_SECRET=... GEMINI_API_KEY=...
# (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set automatically)
```
Get a Gemini API key at Google AI Studio (free tier is fine to start).

### 3. Deploy the web app
```bash
cd web
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run build          # -> dist/
```
Deploy `dist/` to Vercel / Netlify / Cloudflare Pages. Set the host's SPA
fallback (rewrite all routes to `/index.html`) so `/t/<token>` links open.

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
- Stripe Checkout + webhook → flip `trips.tier` to `paid`.
- Receipt image storage in Supabase Storage (currently base64 → vision API directly).
- PWA icons (`public/icon-192.png`, `public/icon-512.png`) — placeholder needed.
