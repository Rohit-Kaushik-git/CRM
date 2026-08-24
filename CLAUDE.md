# DSP CRM Tracker

Internal tracker for the Uzio implementation team. Spec: `docs/specs/2026-08-24-dsp-crm-tracker-design.md`.

## Stack
- Static site in `site/` — no build step. supabase-js v2 from CDN. Deployed on Vercel.
- Supabase: Postgres + Auth (email+password, @uzio.com only) + RLS.
- `scripts/` — stdlib-only Python (schema is plain SQL run in the Supabase SQL editor).

## Conventions
- All Supabase calls go through `site/store.js` (`window.Store`). UI never calls `supabase.*` directly.
- All UI errors surface via `toast()`; async handlers wrap in `guard()`.
- Roles: admin / implementor. Role rules live in RLS (`scripts/rls.sql`), UI only mirrors them.
- Secrets in `.env` (gitignored). Anon key in `site/config.js` is public by design.

## Deploy
Push to `main` → Vercel auto-deploys `site/`. Schema changes: paste the changed SQL into the Supabase SQL editor by hand.
