# DSP CRM v2 — Command Center Design Spec

**Date:** 2026-08-25
**Status:** Approved (design accepted by Rohit 2026-08-25)
**Builds on:** `2026-08-24-dsp-crm-tracker-design.md` (v1 — shipped)

## 1. Why v2

v1 replaced the spreadsheets' *storage*; Rohit's feedback: "you basically created a UI of the
excel — I want a CRM where I don't have to chase different trackers and all I can see at one
place." v2 makes the app *answer questions*: what needs attention, what's the full story on a
client, and it keeps itself current without manual CSV downloads.

Scope decisions (Rohit): Attention dashboard ✅, Client 360 + timeline ✅, auto-sync from
sheets ✅, Jira integration ❌ (later), implementor auto-assign ❌ (parked — "step 2 with a
catch"). Hosting stays on vercel.app until fully ready, then moves under uzio.com.

## 2. Sync — "app wins where humans acted"

- Rohit publishes the two sheet tabs via Google Sheets → File → Share → **Publish to web** →
  CSV (one URL per tab). No Google API/credentials.
- **GitHub Actions cron (every 2 hours)** runs `scripts/sync_sheets.py`, which fetches those
  URLs (or falls back to `data/raw/*.csv` locally) and writes to Supabase with the service key.
  Secrets live in GitHub Actions repo secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SHEET_ONBOARDING_CSV_URL`, `SHEET_AUDIT_CSV_URL`.
- **Conflict rule (DB-enforced):** `tasks.app_touched boolean` — set to true by a DB trigger
  whenever a signed-in human updates a task or adds a note (service-role writes have
  `auth.uid() = null` and don't trip it). The sync **never touches a task with
  `app_touched = true`** (no status PATCH, no note wipe). Client facts (dates, RAG, vendor,
  status, coverage note) keep flowing from the sheet; `implementor_id` is only written when
  currently null. New sheet clients auto-create; disappeared rows are left alone.

## 3. Activity log (powers the timeline and staleness)

New table `activity_log(id, client_id, task_id?, actor_id?, action, detail, created_at)`,
populated **only by DB triggers** (security definer; no client insert policy):
- task status change → action `status`, detail `"<task title>: <old> → <new>"`
- task assignee change → action `assigned`, detail `"<task title> → <user name | unassigned>"`
- new task note → action `note`, detail the note text (task title prefixed)
- client created → action `client_created`; client status/RAG change → action `client`,
  detail `"Status: <old> → <new>"` / `"RAG: …"`
- actor: `auth.uid()` when human (render joins `users` for the name); null = shown as "sync".

View `client_last_activity(client_id, last_activity)` (security_invoker) for staleness
queries. RLS: `activity_log` select to authenticated; no insert/update/delete policies.

## 4. Attention dashboard — new admin home ("Today")

Route `#today`, the admin's default view. Sections, each rendered only when non-empty,
computed client-side from Store data (thresholds are constants in one place):
- **Going live soon** — `tt_live_date` within 14 days, status ≠ Completed: countdown,
  checklist %, implementor.
- **Overdue** — tasks `due_date < today`, status Open/In Progress, grouped by assignee
  ("Unassigned" group included).
- **Unowned work** — open tasks with no assignee on clients going live within 21 days.
- **At risk** — clients with RAG R or A.
- **Audit gaps** — clients going live within 14 days whose audit-phase tasks are not all
  Done/N-A.
- **Gone quiet** — clients with no activity for 7+ days (or none ever) and status ≠ Completed.
The Clients table remains as its own nav item.

## 5. Client 360

The client detail page gains:
- Header: **go-live countdown** ("T-12 days" / "Went live N days ago"), audit-coverage chip
  (from the client notes' coverage line), onboarding & audit progress bars.
- **Activity timeline** section: `activity_log` for this client, newest first (limit 100),
  actor name or "sync", relative day headers.

## 6. Out of scope (unchanged from v1 + parked items)

Jira, email ingestion, implementor auto-assign pass, notifications/digests, custom domain
(until "fully functional and completely ready"), reporting/exports.

## 7. Rollout order

A. DB migration (app_touched, activity_log, triggers, view) — live DB + schema.sql for
   fresh installs.
B. Sync pipeline (`sync_sheets.py` + GitHub Actions cron). `import_sheets.py` remains for
   one-off manual runs but delegates to the same core.
C. Attention dashboard.
D. Client 360 (countdown + timeline).

Each phase ships independently. Manual steps for Rohit batched at the end: run migration SQL,
publish the two CSVs, add 4 GitHub secrets, QA pass.
