# DSP CRM Tracker — Design Spec

**Date:** 2026-08-24
**Status:** Approved (brainstorming session with Rohit Kaushik)
**Repo:** https://github.com/Rohit-Kaushik-git/CRM

## 1. Purpose

A lightweight internal tracking app for the Uzio implementation team, replacing two Google
Sheets (the DSP Onboarding Tracker and the Audit Tracker). It is a tracker, not a full CRM:

- Admin tracks per-client onboarding/audit progress, assigns tasks to implementors.
- Implementors mark tasks In Progress / Done with notes; notes are visible to Admin.
- Per-client module opt-ins (Time Tracking, Payroll, Benefits, HR/Onboarding) and
  training done/pending per module.
- An **Open Items** view: every assigned, not-yet-done task.
- Two screens: **Admin** and **User (implementor)**.

Guiding constraint from the requester: *"I don't want multiple functionality, I just want
tracking should be easy and very user friendly."* YAGNI applies everywhere.

## 2. Stack

| Layer    | Choice | Why |
|----------|--------|-----|
| Database | Supabase (free tier Postgres) | Zero infra; team-shared; RLS for write rules; Supabase Auth ready for future Google sign-in |
| App      | Static HTML/JS (no build step) + Supabase JS client | Fastest to build/change; same proven pattern as the Data_Tracker dashboard; UZIO design system styling |
| Hosting  | Vercel (auto-deploy on push to `main`) | Free; `vercel.json` static config |
| Import   | Python (stdlib only) one-time script | Same style as Data_Tracker scripts |

**Auth (phase 1):** Supabase Auth **email + password**. Sign-up/sign-in restricted to
`@uzio.com` addresses (enforced in the app and in the DB trigger that creates the `users`
row). Role assignment: emails on the **admin list** get `admin`, everyone else gets
`implementor`. The admin list is data, not code — a single row in an `app_config` table
(initially just `rohit.kaushik@uzio.com`), editable later from the Team view without a
deploy. Password resets via Supabase's built-in email flow.
**Auth (future):** switch the same Supabase Auth setup to Google sign-in restricted to
`@uzio.com`; accounts, roles, and data are unchanged — only the sign-in method swaps.
Structure the app so "current user" is resolved in exactly one place.

## 3. Data model (Postgres / Supabase)

```
app_config      key, value                       -- e.g. key='admin_emails', value='rohit.kaushik@uzio.com'
users           id (= auth.users id), name, email (unique, @uzio.com),
                role ('admin'|'implementor'), active bool
                -- row auto-created by a trigger on Supabase auth sign-up;
                -- role = 'admin' if email is in app_config.admin_emails
clients         id, dsp_name, short_code, vendor ('ADP'|'Paycom'), previous_system,
                implementor_id -> users, status ('Not Started'|'In Progress'|'Live'|'Completed'),
                tt_live_date, payroll_cutoff_date, first_pay_date, rag ('R'|'A'|'G'), notes
client_modules  id, client_id -> clients, module ('TimeTracking'|'Payroll'|'Benefits'|'HR'),
                opted bool, training_done bool, training_date
task_templates  id, name, phase ('onboarding'|'audit'), sort_order
tasks           id, client_id -> clients, template_id -> task_templates (null = ad-hoc),
                title, assignee_id -> users, status ('Open'|'In Progress'|'Done'|'N/A'),
                due_date, done_date, created_by -> users, created_at
task_notes      id, task_id -> tasks, author_id -> users, note text, created_at
```

Rules:
- Creating a client auto-generates one task per template row (both phases).
- **Open Item** = task with an assignee and status not in (Done, N/A). It is a query, not a table.
- Marking a task Done **requires a note** (enforced in UI).
- Notes are append-only history — never a single overwritten cell (the core sheet pain point).
- Task templates seed data comes from the sheets' columns: onboarding checklist from the
  Onboarding Tracker (Company Setup, Federal/State Withholding, Delta Data Upload, TT Setup,
  Audit Client Data, Final Payroll Review, Prior Pay Transfer, PTO Balance Move, Tax Review, …)
  and audit checklist from the Audit Tracker (Census, Census Delta, Emergency Contact,
  License Details, Payment Method, PTO Policy, PTO Balance, SIT/FIT Withholding, Earnings,
  Deductions, Contributions Transfer, Workers Comp, Doc Transfer, Prior Comp Transfer,
  Client Data Audit, Historical Data Downloaded). Exact list finalized during implementation
  from the live sheet headers.

### Security (phase 1)
- The page ships only the **anon key**; all reads and writes require an authenticated
  session (RLS: `authenticated` role only — anon gets nothing).
- Role enforcement is server-side via RLS, not just UI: implementors may update
  status/notes on tasks where they are the assignee; admins may do everything
  (checked against the `users.role` of the JWT's user id).
- Sign-ups from non-`@uzio.com` emails are rejected by the sign-up trigger.
- The service key stays in local `.env` (gitignored) and is used only by import scripts.

## 4. Screens

One app, role-filtered. Left-nav layout in the UZIO design system (same visual language as
the DSP Ops dashboard).

### Admin screen
1. **Clients** — table/cards of all clients: RAG, status, % checklist complete, key dates,
   module chips. Click a client → detail: onboarding + audit checklist tabs; inline assign
   (implementor + due date); status toggle; module/training toggles; add ad-hoc task; notes.
2. **Open Items** — all assigned & not-done tasks across clients, grouped by implementor,
   sortable by due date / client. Done items visible in an expandable history with latest note.
3. **Team** — see registered users, edit name, promote/demote admin (writes to the
   `app_config` admin list), deactivate. Accounts are created by each user signing up
   with their `@uzio.com` email; admin does not manage passwords.

### User (implementor) screen
1. **My Open Items** — tasks assigned to me, grouped by client; actions: mark In Progress,
   mark Done (note required), add note.
2. **My Clients** — read view of clients I own with the checklist grid; editable only where
   I am the assignee.

## 5. Import (one-time script)

`scripts/import_sheets.py` — Python stdlib. Input: exports of the two Google Sheets.

- **Filter:** only clients whose Time Tracking live date is **after 2026-07-31**
  (actual TT live date if present, else expected).
- Parses cells like `Completed - 2/26 (Sanya)` → status Done, done_date 2026-02-26, and the
  raw cell text preserved as a task note. `TBD`, blanks → Open. Anything unparseable →
  status Open + verbatim note, so nothing is silently lost.
- Matches Implementor names to existing app users by first name (accounts exist only via sign-up, so unmatched names are reported for manual assignment, never auto-created); vendor from "Current Payroll with".
- Re-runnable: upserts on (client, template).

## 6. Repo layout

```
CRM/
├── CLAUDE.md                  ← project playbook (stack, conventions, deploy steps)
├── docs/specs/                ← this spec + the implementation plan
├── site/index.html            ← the app (splits into css/js files if it grows)
├── scripts/
│   ├── schema.sql             ← tables, seed task_templates, RLS
│   └── import_sheets.py
└── vercel.json
```

## 7. Error handling & testing

- All Supabase calls go through one small wrapper: failures show a visible toast
  ("Save failed — retry"), never silent console-only errors; optimistic UI updates roll back.
- Import script prints a per-row report (imported / skipped-by-filter / unparsed-cell count)
  and exits non-zero on structural surprises (missing expected columns).
- Manual test checklist per release (it's a 2-screen internal tool): sign-up with
  non-@uzio.com email rejected; rohit.kaushik@uzio.com lands on Admin screen, others on
  Implementor screen; logged-out visitors see only the login form (and API returns no
  data); create client →
  checklist auto-created; assign → appears in implementor's Open Items; Done without note
  blocked; Done with note → visible to admin with author + timestamp; module/training
  toggles persist; both screens on mobile width.

## 8. Out of scope (deliberate)

Email/Slack notifications, Jira integration, file uploads, reporting/exports, employee-level
data (no PII), audit-log UI, mobile app, real-time multiplayer editing. Tracking only.

## 9. External dependencies to create (owner: Rohit)

- Supabase project (free tier) → need project URL + anon key; service key stays in local `.env`.
- Vercel project connected to this repo (or open `site/index.html` locally during testing).
