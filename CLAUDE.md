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
3. Admin account lands on Today; implementor account lands on My Open Items.
4. Signed-out visitor: login form only; `curl` with anon key returns `[]`.
5. Create client (modal) → 11 onboarding + 6 audit tasks + 4 module rows; New clients: all N/A except Company Setup + TT Setup, Audit tab hidden.
6. Set a client's Implementor → their open implementor-owned tasks appear in that person's My Open Items; team members see their team's tasks.
7. Done without note → blocked. Done with note → visible to admin in Open Items → Recently done, with author + date.
8. Forgot password → email arrives → link opens set-new-password card → new password signs in.
9. Module/training toggles persist across refresh.
10. Both screens usable at 375px width.

## Sync runbook
- Scheduled: GitHub Actions "sheet-sync" runs every 2h (needs repo secrets SUPABASE_URL,
  SUPABASE_SERVICE_KEY, SHEET_ONBOARDING_CSV_URL, SHEET_AUDIT_CSV_URL — the sheet URLs are
  File → Share → Publish to web → CSV links for each tab).
- Manual: `py scripts/sync_sheets.py --dry-run` then without the flag. `--local` uses
  data/raw/*.csv instead of fetching URLs (import_sheets.py is a wrapper that forces --local).
- Conflict rule: any task a human changed in the app (app_touched) is never modified by sync.
- If the app 404s on client_last_activity/activity_log right after running a migration, run
  `notify pgrst, 'reload schema';` in the SQL editor (PostgREST schema cache).
Note: ownership is implicit — client implementor owns Implementor tasks; team tasks via app_config team_* email lists.

## Live URL
https://crm-teal-chi-45.vercel.app
(Supabase → Authentication → URL Configuration must list this as Site URL / Redirect URL for password-reset emails.)
