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
- Password reset: "Forgot password?" on the login card → Supabase recovery email → the emailed link returns to the app, which shows the set-new-password card. Requires the app's URL to be in Supabase → Authentication → URL Configuration (Site URL / Redirect URLs); links cannot work from file://.

## Deploy
Push to `main` → Vercel auto-deploys `site/`. Schema changes: paste the changed SQL into the Supabase SQL editor by hand.

## QA checklist (run before telling the team about a change)
1. Sign-up with a non-@uzio.com email → rejected.
2. Sign-up requires matching Confirm password.
3. Admin account lands on Clients; implementor account lands on My Open Items.
4. Signed-out visitor: login form only; `curl` with anon key returns `[]`.
5. Create client → 12 onboarding + 6 audit tasks + 4 module rows auto-created.
6. Assign task → appears in that implementor's My Open Items.
7. Done without note → blocked. Done with note → visible to admin in Open Items → Recently done, with author + date.
8. Forgot password → email arrives → link opens set-new-password card → new password signs in.
9. Module/training toggles persist across refresh.
10. Both screens usable at 375px width.

## Import runbook
1. Download the sheet tabs as CSV → `data/raw/onboarding.csv` (DSP Implementation tab), `data/raw/audit.csv` (Audit File Status tab).
2. `py scripts/import_sheets.py --dry-run` — check names, dates, filter counts.
3. `py scripts/import_sheets.py` — idempotent; re-running refreshes statuses and re-writes `[import]` notes.
Note: imported tasks carry no assignees — assign in the UI once implementors have signed up.

## Live URL
https://crm-teal-chi-45.vercel.app
(Supabase → Authentication → URL Configuration must list this as Site URL / Redirect URL for password-reset emails.)
