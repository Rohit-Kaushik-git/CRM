# DSP CRM Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two-screen (Admin / Implementor) client-tracking web app defined in `docs/specs/2026-08-24-dsp-crm-tracker-design.md`, plus the one-time Google-Sheets import.

**Architecture:** Static HTML/JS site (no build step) talking directly to Supabase Postgres via the supabase-js v2 CDN bundle. Supabase Auth email+password; all authorization enforced server-side with RLS. A stdlib-only Python script imports the two sheet exports.

**Tech Stack:** Supabase (Postgres + Auth + PostgREST), supabase-js v2 (CDN), vanilla HTML/CSS/JS, Python 3 stdlib, Vercel static hosting.

## Global Constraints

- **No build step, no npm.** The only external JS is `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` (UMD, exposes `window.supabase`).
- **Python scripts: stdlib only** (`csv`, `json`, `urllib`, `re`, `datetime`, `unittest`). No pip installs.
- Sign-ups restricted to emails ending `@uzio.com` (client-side check AND DB trigger).
- Admin seed email: `rohit.kaushik@uzio.com`, stored in `app_config` key `admin_emails` (comma-separated list), never hardcoded in app logic.
- Import filter: only clients whose TT live date (actual if present, else expected) is **strictly after 2026-07-31**.
- Task statuses: `'Open' | 'In Progress' | 'Done' | 'N/A'`. Client statuses: `'Not Started' | 'In Progress' | 'Live' | 'Completed'`. Modules: `'TimeTracking' | 'Payroll' | 'Benefits' | 'HR'`.
- Marking a task Done requires a note (UI-enforced via prompt; note stored in `task_notes`).
- Secrets: `SUPABASE_SERVICE_KEY` only ever in `.env` (gitignored). The anon key ships in `site/config.js` (public by design; RLS is the guard).
- Commit after every task. Shell: Git Bash on Windows; use `python` (fall back to `py` if `python` is not on PATH).

## Prerequisites (manual, done by Rohit before Task 2)

1. Create a Supabase project (supabase.com → New project, free tier, any region near India/US-East).
2. Dashboard → **Authentication → Sign In / Providers → Email** → turn **OFF** "Confirm email" (test phase; revisit before wide rollout).
3. Collect: Project URL (`https://<ref>.supabase.co`), anon key, service_role key (Settings → API).
4. Create `.env` in the repo root (never committed):
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_KEY=<service_role key>
   ```
5. Python 3.10+ installed and on PATH (needed from Task 8 onward).

---

### Task 1: Repo scaffolding and static shell

**Files:**
- Create: `vercel.json`
- Create: `.env.example`
- Create: `CLAUDE.md`
- Create: `site/config.js`
- Create: `site/index.html`
- Create: `site/styles.css`

**Interfaces:**
- Produces: `window.CONFIG` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MODULES`); the DOM ids every later task binds to: `#login`, `#login-form`, `#f-name`, `#f-email`, `#f-password`, `#login-submit`, `#tab-signin`, `#tab-signup`, `#app`, `#nav-items`, `#who`, `#signout`, `#view`, `#toast`; script load order `config.js → store.js → views-admin.js → views-user.js → app.js`.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "outputDirectory": "site",
  "cleanUrls": true
}
```

- [ ] **Step 2: Create `.env.example`**

```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_KEY=YOUR-SERVICE-ROLE-KEY
```

- [ ] **Step 3: Create `CLAUDE.md`**

```markdown
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
```

- [ ] **Step 4: Create `site/config.js`**

```javascript
/* Public runtime config. The anon key is safe to ship: RLS is the security boundary. */
window.CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  MODULES: ["TimeTracking", "Payroll", "Benefits", "HR"],
};
```

(Real values get pasted in during Task 4 verification — they are public, so committing them is fine.)

- [ ] **Step 5: Create `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSP CRM Tracker</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div id="toast"></div>

<section id="login">
  <div class="login-card">
    <h1>DSP CRM Tracker</h1>
    <div class="tabs">
      <button id="tab-signin" class="active" type="button">Sign in</button>
      <button id="tab-signup" type="button">Sign up</button>
    </div>
    <form id="login-form">
      <input id="f-name" placeholder="Full name" autocomplete="name" style="display:none">
      <input id="f-email" type="email" placeholder="you@uzio.com" autocomplete="username" required>
      <input id="f-password" type="password" placeholder="Password" autocomplete="current-password" minlength="8" required>
      <button type="submit" id="login-submit">Sign in</button>
    </form>
    <p class="hint">Use your @uzio.com email.</p>
  </div>
</section>

<div id="app" style="display:none">
  <nav id="nav">
    <div class="brand">DSP CRM</div>
    <div id="nav-items"></div>
    <div class="nav-foot"><span id="who"></span><button id="signout" type="button">Sign out</button></div>
  </nav>
  <main id="view"></main>
</div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="store.js"></script>
<script src="views-admin.js"></script>
<script src="views-user.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `site/styles.css`**

```css
:root {
  --bg: #f5f6f8; --panel: #ffffff; --ink: #1f2733; --muted: #6b7684;
  --brand: #0056b3; --line: #e3e7ec; --ok: #28a745; --warn: #e6a700; --bad: #d9364f;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 18px 0 8px; }
a { color: var(--brand); text-decoration: none; }
button { font: inherit; padding: 7px 14px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--brand); color: #fff; cursor: pointer; }
button.small { padding: 3px 9px; font-size: 12px; }
button.secondary, .tabs button { background: #fff; color: var(--ink); }
input, select { font: inherit; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
.muted { color: var(--muted); }

#login { display: flex; min-height: 100vh; align-items: center; justify-content: center; }
.login-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 28px; width: 340px; box-shadow: 0 4px 16px rgba(31,39,51,.08); }
.login-card h1 { margin-bottom: 14px; }
.login-card form { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.tabs { display: flex; gap: 6px; }
.tabs button.active { border-color: var(--brand); color: var(--brand); font-weight: 600; }
.hint { color: var(--muted); font-size: 12px; }

#app { display: flex; min-height: 100vh; }
#nav { width: 200px; background: #14263c; color: #dbe4ee; display: flex; flex-direction: column; flex-shrink: 0; }
.brand { font-weight: 700; padding: 18px 16px; font-size: 16px; color: #fff; }
#nav-items { display: flex; flex-direction: column; }
#nav-items a { color: #dbe4ee; padding: 10px 16px; }
#nav-items a.active { background: rgba(255,255,255,.12); color: #fff; font-weight: 600; }
.nav-foot { margin-top: auto; padding: 14px 16px; font-size: 12px; display: flex; flex-direction: column; gap: 8px; }
.nav-foot button { background: transparent; border-color: #3c5570; color: #dbe4ee; }
#view { flex: 1; padding: 22px 26px; min-width: 0; }

.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.card { display: block; }
#new-client-form { display: none; gap: 8px; flex-wrap: wrap; }
#new-client-form.open { display: flex; }
.head-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.head-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }

table.grid { width: 100%; border-collapse: collapse; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.grid th, .grid td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.grid th { background: #f0f3f7; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
tr.rowlink { cursor: pointer; } tr.rowlink:hover { background: #f6f9fd; }

.chip { display: inline-block; background: #e8f0fb; color: var(--brand); border-radius: 10px;
  padding: 1px 8px; font-size: 11px; margin-right: 4px; }
.rag { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
.rag-G { background: var(--ok); } .rag-A { background: var(--warn); } .rag-R { background: var(--bad); }
.bar { display: inline-block; width: 70px; height: 8px; background: var(--line); border-radius: 4px; vertical-align: middle; }
.bar span { display: block; height: 100%; background: var(--ok); border-radius: 4px; }
.note { font-size: 12px; color: var(--ink); margin: 2px 0; }
.notes-cell { max-width: 320px; }
.tabbar { display: flex; gap: 6px; margin: 16px 0 10px; }
.tabbar button { background: #fff; color: var(--ink); }
.tabbar button.active { border-color: var(--brand); color: var(--brand); font-weight: 600; }

#toast { position: fixed; top: 14px; right: 14px; z-index: 10; padding: 10px 16px; border-radius: 8px;
  color: #fff; opacity: 0; pointer-events: none; transition: opacity .2s; max-width: 340px; }
#toast.show { opacity: 1; }
#toast.err { background: var(--bad); } #toast.ok { background: var(--ok); }

@media (max-width: 760px) {
  #app { flex-direction: column; }
  #nav { width: 100%; flex-direction: row; align-items: center; flex-wrap: wrap; }
  #nav-items { flex-direction: row; }
  .nav-foot { margin-top: 0; margin-left: auto; flex-direction: row; align-items: center; }
}
```

- [ ] **Step 7: Verify the shell renders**

Open `site/index.html` in a browser (double-click, or `start site/index.html` from PowerShell).
Expected: the login card renders centered with Sign in / Sign up tabs. Console shows errors for missing `store.js` etc. — that's fine at this stage.

- [ ] **Step 8: Commit**

```bash
git add vercel.json .env.example CLAUDE.md site/
git commit -m "feat: scaffold static shell, config, styles"
```

---

### Task 2: Database schema, triggers, and seed data

**Files:**
- Create: `scripts/schema.sql`

**Interfaces:**
- Produces: tables `app_config`, `users`, `clients`, `client_modules`, `task_templates`, `tasks`, `task_notes` exactly as below; trigger `on_auth_user_created` (creates `users` row, rejects non-@uzio.com, assigns role from `app_config.admin_emails`); trigger `on_client_created` (seeds one task per template + 4 module rows). Unique keys later tasks rely on: `clients.dsp_name`, `(tasks.client_id, tasks.template_id)`, `(client_modules.client_id, client_modules.module)`.

- [ ] **Step 1: Write `scripts/schema.sql`**

```sql
-- DSP CRM Tracker schema. Run once in the Supabase SQL editor.
-- Re-runnable: drops and recreates everything (destroys data — fine pre-launch).

drop table if exists task_notes, tasks, task_templates, client_modules, clients, users, app_config cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.seed_client_tasks() cascade;

create table app_config (
  key   text primary key,
  value text not null
);
insert into app_config values ('admin_emails', 'rohit.kaushik@uzio.com');

create table users (
  id     uuid primary key references auth.users(id) on delete cascade,
  name   text not null default '',
  email  text not null unique,
  role   text not null default 'implementor' check (role in ('admin','implementor')),
  active boolean not null default true
);

create table clients (
  id                  bigint generated always as identity primary key,
  dsp_name            text not null unique,
  short_code          text not null default '',
  vendor              text check (vendor in ('ADP','Paycom')),
  previous_system     text,
  implementor_id      uuid references users(id),
  status              text not null default 'Not Started'
                      check (status in ('Not Started','In Progress','Live','Completed')),
  tt_live_date        date,
  payroll_cutoff_date date,
  first_pay_date      date,
  rag                 text check (rag in ('R','A','G')),
  notes               text,
  created_at          timestamptz not null default now()
);

create table client_modules (
  id            bigint generated always as identity primary key,
  client_id     bigint not null references clients(id) on delete cascade,
  module        text not null check (module in ('TimeTracking','Payroll','Benefits','HR')),
  opted         boolean not null default false,
  training_done boolean not null default false,
  training_date date,
  unique (client_id, module)
);

create table task_templates (
  id         bigint generated always as identity primary key,
  name       text not null,
  phase      text not null check (phase in ('onboarding','audit')),
  sort_order int  not null
);

create table tasks (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id) on delete cascade,
  template_id bigint references task_templates(id),
  title       text not null,
  assignee_id uuid references users(id),
  status      text not null default 'Open' check (status in ('Open','In Progress','Done','N/A')),
  due_date    date,
  done_date   date,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  unique (client_id, template_id)
);

create table task_notes (
  id         bigint generated always as identity primary key,
  task_id    bigint not null references tasks(id) on delete cascade,
  author_id  uuid references users(id),
  note       text not null,
  created_at timestamptz not null default now()
);

-- Standard checklists (spec §3). Onboarding from the Onboarding Tracker columns,
-- audit from the Audit Tracker columns.
insert into task_templates (name, phase, sort_order) values
  ('Company Setup','onboarding',1),
  ('Federal/State Withholding & Payment','onboarding',2),
  ('Data Transfer','onboarding',3),
  ('Delta Data Upload','onboarding',4),
  ('Time Tracking Setup (Kiosk/Mobile/Web)','onboarding',5),
  ('Document Transfer','onboarding',6),
  ('Historical Data Download','onboarding',7),
  ('Audit Client Data & Minor Corrections','onboarding',8),
  ('Final Payroll Review & Testing','onboarding',9),
  ('Prior Pay Info Transfer & Approval','onboarding',10),
  ('PTO Balance Move','onboarding',11),
  ('Tax Review (Post Prior Upload)','onboarding',12),
  ('Credentials','audit',1),
  ('Qualified Overtime Report','audit',2),
  ('Census','audit',3),
  ('Census Delta','audit',4),
  ('Emergency Contact','audit',5),
  ('License Details','audit',6),
  ('Payment Method','audit',7),
  ('PTO Policy Creation','audit',8),
  ('PTO Balance','audit',9),
  ('SIT/FIT Withholding','audit',10),
  ('Earnings','audit',11),
  ('Deductions','audit',12),
  ('Contributions Transfer (Except Roth/401k)','audit',13),
  ('Workers Comp','audit',14),
  ('Doc Transfer','audit',15),
  ('Prior Comp Transfer & Approval','audit',16),
  ('Client Data Audit','audit',17),
  ('Historical Data Downloaded','audit',18);

-- Sign-up hook: reject non-uzio emails, mirror into public.users, role from admin list.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare admins text;
begin
  if new.email not ilike '%@uzio.com' then
    raise exception 'Sign-ups are restricted to @uzio.com emails';
  end if;
  select value into admins from app_config where key = 'admin_emails';
  insert into public.users (id, email, name, role) values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when admins is not null
              and lower(new.email) = any(string_to_array(replace(admins, ' ', ''), ','))
         then 'admin' else 'implementor' end
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- New client hook: seed the standard checklists and the 4 module rows.
create or replace function public.seed_client_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tasks (client_id, template_id, title)
  select new.id, t.id, t.name from task_templates t;
  insert into client_modules (client_id, module) values
    (new.id, 'TimeTracking'), (new.id, 'Payroll'), (new.id, 'Benefits'), (new.id, 'HR');
  return new;
end $$;

create trigger on_client_created
after insert on clients
for each row execute function public.seed_client_tasks();
```

- [ ] **Step 2: Run it in Supabase**

Supabase dashboard → SQL Editor → paste the whole file → Run. Expected: "Success. No rows returned".

- [ ] **Step 3: Verify seeds and triggers**

Run in the SQL editor:

```sql
select (select count(*) from task_templates) as templates,
       (select value from app_config where key = 'admin_emails') as admins;
insert into clients (dsp_name, short_code) values ('__TRIGGER_TEST__', 'TST');
select (select count(*) from tasks t join clients c on c.id = t.client_id where c.dsp_name = '__TRIGGER_TEST__') as seeded_tasks,
       (select count(*) from client_modules m join clients c on c.id = m.client_id where c.dsp_name = '__TRIGGER_TEST__') as seeded_modules;
delete from clients where dsp_name = '__TRIGGER_TEST__';
```

Expected: `templates = 30`, `admins = rohit.kaushik@uzio.com`, `seeded_tasks = 30`, `seeded_modules = 4`.

- [ ] **Step 4: Commit**

```bash
git add scripts/schema.sql
git commit -m "feat: database schema, sign-up + client-seed triggers, checklist seeds"
```

---

### Task 3: Row-Level Security

**Files:**
- Create: `scripts/rls.sql`

**Interfaces:**
- Produces: RLS on every table; helper `public.is_admin()`. Rules the UI relies on: any authenticated user reads everything; only admins insert/update `clients`, `client_modules`, `app_config`, `users`, and insert `tasks`; a task can be updated by an admin **or its assignee**; any authenticated user may insert a `task_notes` row **as themselves** (`author_id = auth.uid()`); notes are append-only (no update/delete policy). Anon role: nothing.

- [ ] **Step 1: Write `scripts/rls.sql`**

```sql
-- Row-Level Security. Run after schema.sql in the Supabase SQL editor. Re-runnable.

alter table app_config     enable row level security;
alter table users          enable row level security;
alter table clients        enable row level security;
alter table client_modules enable row level security;
alter table task_templates enable row level security;
alter table tasks          enable row level security;
alter table task_notes     enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from users where id = auth.uid() and role = 'admin' and active) $$;

drop policy if exists cfg_read  on app_config;     drop policy if exists cfg_admin_upd on app_config;
drop policy if exists usr_read  on users;          drop policy if exists usr_admin_upd on users;
drop policy if exists cli_read  on clients;        drop policy if exists cli_admin_ins on clients;
drop policy if exists cli_admin_upd on clients;
drop policy if exists mod_read  on client_modules; drop policy if exists mod_admin_upd on client_modules;
drop policy if exists tpl_read  on task_templates;
drop policy if exists tsk_read  on tasks;          drop policy if exists tsk_admin_ins on tasks;
drop policy if exists tsk_upd   on tasks;
drop policy if exists nts_read  on task_notes;     drop policy if exists nts_ins on task_notes;

-- Reads: any signed-in team member. Anon: no policies => nothing.
create policy cfg_read on app_config     for select to authenticated using (true);
create policy usr_read on users          for select to authenticated using (true);
create policy cli_read on clients        for select to authenticated using (true);
create policy mod_read on client_modules for select to authenticated using (true);
create policy tpl_read on task_templates for select to authenticated using (true);
create policy tsk_read on tasks          for select to authenticated using (true);
create policy nts_read on task_notes     for select to authenticated using (true);

-- Writes.
create policy cfg_admin_upd on app_config     for update to authenticated using (is_admin());
create policy usr_admin_upd on users          for update to authenticated using (is_admin());
create policy cli_admin_ins on clients        for insert to authenticated with check (is_admin());
create policy cli_admin_upd on clients        for update to authenticated using (is_admin());
create policy mod_admin_upd on client_modules for update to authenticated using (is_admin());
create policy tsk_admin_ins on tasks          for insert to authenticated with check (is_admin());
create policy tsk_upd       on tasks          for update to authenticated
  using (is_admin() or assignee_id = auth.uid());
create policy nts_ins       on task_notes     for insert to authenticated
  with check (author_id = auth.uid());
```

- [ ] **Step 2: Run it in the Supabase SQL editor**

Expected: "Success. No rows returned".

- [ ] **Step 3: Verify anon gets nothing**

From Git Bash (values from `.env`):

```bash
source <(sed 's/^/export /' .env)
curl -s "$SUPABASE_URL/rest/v1/clients?select=*" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected output: `[]` (empty — RLS hides all rows from anon).

- [ ] **Step 4: Verify non-uzio sign-up is rejected**

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"outsider@gmail.com","password":"Passw0rd!123"}'
```

Expected: JSON error (code 500, `"Database error saving new user"` — the trigger raised). Then confirm no row leaked:

```sql
select count(*) from users where email like '%gmail%';  -- expect 0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/rls.sql
git commit -m "feat: row-level security — authenticated reads, role-checked writes"
```

---

### Task 4: Data layer, auth flow, app shell wiring

**Files:**
- Create: `site/store.js`
- Create: `site/app.js`
- Create: `site/views-admin.js` (stub — replaced in Tasks 5–6)
- Create: `site/views-user.js` (stub — replaced in Task 7)
- Modify: `site/config.js` (paste real `SUPABASE_URL` + anon key)

**Interfaces:**
- Consumes: `window.CONFIG`; DOM ids from Task 1; DB from Tasks 2–3.
- Produces: `window.Store` with exactly: `signUp(name,email,password)`, `signIn(email,password)`, `signOut()`, `loadMe()`, `getMe()`, `listUsers()`, `updateUser(id,patch)`, `getAdminEmails()`, `setAdminEmails(list)`, `listClients()`, `getClient(id)`, `createClient(fields)`, `updateClient(id,patch)`, `updateModule(id,patch)`, `createTask(fields)`, `updateTask(id,patch)`, `addNote(taskId,note)`, `listOpenItems(assigneeId?)`, `listDoneItems(assigneeId?)`. Globals from `app.js`: `$`, `esc()`, `fmtDate()`, `toast(msg, ok?)`, `guard(fn)`, `latestNote(task)`, plus hash routes `#clients #client/<id> #open-items #team #my-items #my-clients`. `window.Views` namespace with `renderClients, renderClientDetail, renderOpenItems, renderTeam, renderMyItems, renderMyClients`.

- [ ] **Step 1: Write `site/store.js`**

```javascript
/* Data layer — every Supabase call goes through Store. UI never touches supabase directly. */
window.Store = (() => {
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let me = null; // row from public.users for the signed-in person

  function fail(error) { throw new Error(error.message || "Request failed"); }

  async function signUp(name, email, password) {
    if (!/@uzio\.com$/i.test(email.trim())) throw new Error("Use your @uzio.com email");
    const { error } = await sb.auth.signUp({
      email: email.trim(), password, options: { data: { name } },
    });
    if (error) fail(error);
  }

  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) fail(error);
  }

  async function signOut() { await sb.auth.signOut(); me = null; }

  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { me = null; return null; }
    const { data, error } = await sb.from("users").select("*").eq("id", session.user.id).single();
    if (error) fail(error);
    me = data;
    return me;
  }

  const getMe = () => me;

  async function listUsers() {
    const { data, error } = await sb.from("users").select("*").order("name");
    if (error) fail(error);
    return data;
  }

  async function updateUser(id, patch) {
    const { error } = await sb.from("users").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function getAdminEmails() {
    const { data, error } = await sb.from("app_config").select("value").eq("key", "admin_emails").single();
    if (error) fail(error);
    return data.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  async function setAdminEmails(list) {
    const { error } = await sb.from("app_config").update({ value: list.join(",") }).eq("key", "admin_emails");
    if (error) fail(error);
  }

  async function listClients() {
    const { data, error } = await sb.from("clients")
      .select("*, implementor:users(name), tasks(status), client_modules(module,opted,training_done)")
      .order("dsp_name");
    if (error) fail(error);
    return data;
  }

  async function getClient(id) {
    const { data, error } = await sb.from("clients")
      .select(`*, implementor:users(name), client_modules(*),
               tasks(*, template:task_templates(phase,sort_order), assignee:users(name),
                     task_notes(note,created_at,author:users(name)))`)
      .eq("id", id).single();
    if (error) fail(error);
    return data;
  }

  async function createClient(fields) {
    const { data, error } = await sb.from("clients").insert(fields).select().single();
    if (error) fail(error);
    return data;
  }

  async function updateClient(id, patch) {
    const { error } = await sb.from("clients").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function updateModule(id, patch) {
    const { error } = await sb.from("client_modules").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function createTask(fields) { // ad-hoc task: template_id stays null
    const { error } = await sb.from("tasks").insert({ ...fields, created_by: me.id });
    if (error) fail(error);
  }

  async function updateTask(id, patch) {
    const { error } = await sb.from("tasks").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function addNote(taskId, note) {
    const { error } = await sb.from("task_notes").insert({ task_id: taskId, author_id: me.id, note });
    if (error) fail(error);
  }

  function openItemsQuery() {
    return sb.from("tasks")
      .select(`*, client:clients(dsp_name,short_code), assignee:users(name),
               task_notes(note,created_at,author:users(name))`)
      .not("assignee_id", "is", null);
  }

  async function listOpenItems(assigneeId) {
    let q = openItemsQuery().in("status", ["Open", "In Progress"])
      .order("due_date", { ascending: true, nullsFirst: false });
    if (assigneeId) q = q.eq("assignee_id", assigneeId);
    const { data, error } = await q;
    if (error) fail(error);
    return data;
  }

  async function listDoneItems(assigneeId) {
    let q = openItemsQuery().eq("status", "Done")
      .order("done_date", { ascending: false }).limit(100);
    if (assigneeId) q = q.eq("assignee_id", assigneeId);
    const { data, error } = await q;
    if (error) fail(error);
    return data;
  }

  return { signUp, signIn, signOut, loadMe, getMe, listUsers, updateUser,
           getAdminEmails, setAdminEmails, listClients, getClient, createClient,
           updateClient, updateModule, createTask, updateTask, addNote,
           listOpenItems, listDoneItems };
})();
```

- [ ] **Step 2: Write stub `site/views-admin.js`**

```javascript
/* Admin views — full implementations land in Tasks 5 and 6. */
window.Views = window.Views || {};
Views.renderClients      = async (view) => { view.innerHTML = "<h1>Clients</h1><p class='muted'>View not built yet (Task 5).</p>"; };
Views.renderClientDetail = async (view) => { view.innerHTML = "<h1>Client</h1><p class='muted'>View not built yet (Task 5).</p>"; };
Views.renderOpenItems    = async (view) => { view.innerHTML = "<h1>Open Items</h1><p class='muted'>View not built yet (Task 6).</p>"; };
Views.renderTeam         = async (view) => { view.innerHTML = "<h1>Team</h1><p class='muted'>View not built yet (Task 6).</p>"; };
```

- [ ] **Step 3: Write stub `site/views-user.js`**

```javascript
/* Implementor views — full implementations land in Task 7. */
window.Views = window.Views || {};
Views.renderMyItems   = async (view) => { view.innerHTML = "<h1>My Open Items</h1><p class='muted'>View not built yet (Task 7).</p>"; };
Views.renderMyClients = async (view) => { view.innerHTML = "<h1>My Clients</h1><p class='muted'>View not built yet (Task 7).</p>"; };
```

- [ ] **Step 4: Write `site/app.js`**

```javascript
/* App shell: auth flow, navigation, shared helpers. */
const $ = (s) => document.querySelector(s);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(d) { return d || "—"; }
function toast(msg, ok = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = (ok ? "ok" : "err") + " show";
  setTimeout(() => (t.className = ""), 3500);
}
async function guard(fn) { // wrap async UI actions: surface failures as toasts
  try { return await fn(); } catch (e) { toast(e.message); }
}
function latestNote(t) {
  const notes = (t.task_notes || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return notes[0]
    ? `<span class="note">“${esc(notes[0].note)}” — ${esc(notes[0].author?.name || "import")}</span>`
    : `<span class="muted">—</span>`;
}

const NAV = [
  { hash: "clients",    label: "Clients",       roles: ["admin"] },
  { hash: "open-items", label: "Open Items",    roles: ["admin"] },
  { hash: "team",       label: "Team",          roles: ["admin"] },
  { hash: "my-items",   label: "My Open Items", roles: ["implementor"] },
  { hash: "my-clients", label: "My Clients",    roles: ["implementor"] },
];

function buildNav(me) {
  $("#nav-items").innerHTML = NAV.filter((n) => n.roles.includes(me.role))
    .map((n) => `<a href="#${n.hash}" data-nav="${n.hash}">${n.label}</a>`).join("");
}

async function renderRoute() {
  const me = Store.getMe();
  if (!me) return;
  const view = $("#view");
  const home = me.role === "admin" ? "clients" : "my-items";
  const hash = location.hash.replace(/^#/, "") || home;
  const [name, arg] = hash.split("/");
  document.querySelectorAll("#nav-items a").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const routes = {
    "clients":    () => Views.renderClients(view),
    "client":     () => Views.renderClientDetail(view, Number(arg)),
    "open-items": () => Views.renderOpenItems(view),
    "team":       () => Views.renderTeam(view),
    "my-items":   () => Views.renderMyItems(view),
    "my-clients": () => Views.renderMyClients(view),
  };
  await guard(routes[name] || routes[home]);
}

function showLogin() { $("#login").style.display = "flex"; $("#app").style.display = "none"; }

function showApp(me) {
  $("#login").style.display = "none";
  $("#app").style.display = "flex";
  $("#who").textContent = `${me.name} · ${me.role}`;
  buildNav(me);
  renderRoute();
}

function wireLogin() {
  let mode = "signin";
  const setMode = (m) => {
    mode = m;
    $("#f-name").style.display = m === "signup" ? "block" : "none";
    $("#login-submit").textContent = m === "signup" ? "Sign up" : "Sign in";
    $("#tab-signin").classList.toggle("active", m === "signin");
    $("#tab-signup").classList.toggle("active", m === "signup");
  };
  $("#tab-signin").onclick = () => setMode("signin");
  $("#tab-signup").onclick = () => setMode("signup");
  $("#login-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const email = $("#f-email").value, pw = $("#f-password").value;
      if (mode === "signup") {
        await Store.signUp($("#f-name").value.trim(), email, pw);
        await Store.signIn(email, pw);
      } else {
        await Store.signIn(email, pw);
      }
      const me = await Store.loadMe();
      if (me) { location.hash = ""; showApp(me); }
    });
  };
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", async () => {
  wireLogin();
  $("#signout").onclick = () => guard(async () => {
    await Store.signOut(); location.hash = ""; showLogin();
  });
  const me = await (Store.loadMe().catch((e) => { toast(e.message); return null; }));
  me ? showApp(me) : showLogin();
});
```

- [ ] **Step 5: Paste real values into `site/config.js`** (from `.env`: `SUPABASE_URL`, anon key).

- [ ] **Step 6: Verify auth end-to-end** (Rohit does the browser part)

Open `site/index.html`:
1. Sign up tab → name `Rohit Kaushik`, email `rohit.kaushik@uzio.com`, a password ≥8 chars → lands in the app; sidebar shows **Clients / Open Items / Team**; footer shows `Rohit Kaushik · admin`.
2. Sign out → login screen returns.
3. Sign up a second account, e.g. `test.implementor@uzio.com` → sidebar shows **My Open Items / My Clients**, footer `… · implementor`.
4. Try signing up `someone@gmail.com` → error toast "Use your @uzio.com email".
5. Refresh while signed in → session persists straight into the app.

If the page can't reach Supabase from `file://`, serve it instead: `python -m http.server 8000 -d site` → http://localhost:8000.

- [ ] **Step 7: Commit**

```bash
git add site/
git commit -m "feat: data layer, email+password auth flow, role-based nav shell"
```

---

### Task 5: Admin — Clients list and Client detail

**Files:**
- Modify: `site/views-admin.js` (replace the `renderClients` / `renderClientDetail` stubs; keep the Task 6 stubs for `renderOpenItems` / `renderTeam` at the bottom)

**Interfaces:**
- Consumes: `Store.*`, helpers `$ esc fmtDate toast guard latestNote`, routes from Task 4.
- Produces: `Views.renderClients(view)`, `Views.renderClientDetail(view, id)` (used by BOTH roles — it checks `Store.getMe().role` internally), plus module-level constants `STATUS_OPTS`, `CLIENT_STATUS_OPTS`, and helper `pct(tasks)` reused by Task 7.

- [ ] **Step 1: Replace the two stubs in `site/views-admin.js`** with:

```javascript
/* Admin views. renderClientDetail is shared with the implementor screen. */
window.Views = window.Views || {};

const STATUS_OPTS = ["Open", "In Progress", "Done", "N/A"];
const CLIENT_STATUS_OPTS = ["Not Started", "In Progress", "Live", "Completed"];

function pct(tasks) {
  if (!tasks || !tasks.length) return 0;
  const done = tasks.filter((t) => t.status === "Done" || t.status === "N/A").length;
  return Math.round((done / tasks.length) * 100);
}

function clientRow(c) {
  return `<tr class="rowlink" data-id="${c.id}">
    <td><b>${esc(c.dsp_name)}</b></td><td>${esc(c.short_code)}</td><td>${esc(c.vendor || "—")}</td>
    <td><span class="rag rag-${c.rag || "none"}"></span></td>
    <td>${esc(c.status)}</td><td>${esc(c.implementor?.name || "—")}</td>
    <td>${fmtDate(c.tt_live_date)}</td>
    <td><span class="bar"><span style="width:${pct(c.tasks)}%"></span></span> ${pct(c.tasks)}%</td>
    <td>${(c.client_modules || []).filter((m) => m.opted)
          .map((m) => `<span class="chip">${m.module}</span>`).join("") || "—"}</td>
  </tr>`;
}

const CLIENT_TABLE_HEAD = `<thead><tr>
  <th>DSP</th><th>Code</th><th>Vendor</th><th>RAG</th><th>Status</th>
  <th>Implementor</th><th>TT live</th><th>Checklist</th><th>Modules</th></tr></thead>`;

function wireClientRows(view) {
  view.querySelectorAll(".rowlink").forEach((r) =>
    (r.onclick = () => (location.hash = `#client/${r.dataset.id}`)));
}

Views.renderClients = async (view) => {
  const clients = await Store.listClients();
  view.innerHTML = `
    <div class="page-head"><h1>Clients</h1><button id="new-client" type="button">+ New client</button></div>
    <div id="new-client-form" class="card">
      <input id="nc-name" placeholder="DSP name">
      <input id="nc-code" placeholder="Short code" maxlength="8" style="width:110px">
      <select id="nc-vendor"><option value="">Vendor…</option><option>ADP</option><option>Paycom</option></select>
      <input id="nc-tt" type="date" title="TT live date">
      <button id="nc-save" type="button">Create</button>
    </div>
    <table class="grid">${CLIENT_TABLE_HEAD}<tbody>${clients.map(clientRow).join("")}</tbody></table>
    ${clients.length ? "" : `<p class="muted">No clients yet — create one above or run the import.</p>`}`;
  $("#new-client").onclick = () => $("#new-client-form").classList.toggle("open");
  $("#nc-save").onclick = () => guard(async () => {
    const name = $("#nc-name").value.trim();
    if (!name) { toast("DSP name is required"); return; }
    const c = await Store.createClient({
      dsp_name: name,
      short_code: $("#nc-code").value.trim().toUpperCase(),
      vendor: $("#nc-vendor").value || null,
      tt_live_date: $("#nc-tt").value || null,
    });
    location.hash = `#client/${c.id}`;
  });
  wireClientRows(view);
};

Views.renderClientDetail = async (view, id) => {
  const me = Store.getMe();
  const isAdmin = me.role === "admin";
  const dis = isAdmin ? "" : "disabled";
  const [c, users] = await Promise.all([Store.getClient(id), Store.listUsers()]);
  const active = users.filter((u) => u.active);
  const userOpts = (sel) => `<option value="">Unassigned</option>` + active.map((u) =>
    `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  const tasksFor = (phase) => c.tasks
    .filter((t) => (t.template ? t.template.phase === phase : phase === "onboarding"))
    .sort((a, b) => (a.template?.sort_order ?? 999) - (b.template?.sort_order ?? 999) || a.id - b.id);

  const taskRow = (t) => {
    const canEdit = isAdmin || t.assignee_id === me.id;
    const notes = (t.task_notes || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const noteLine = (n) =>
      `<div class="note">“${esc(n.note)}” — ${esc(n.author?.name || "import")}, ${n.created_at.slice(0, 10)}</div>`;
    return `<tr data-task="${t.id}">
      <td>${esc(t.title)}${t.template_id ? "" : ` <span class="chip">ad-hoc</span>`}</td>
      <td><select class="t-assignee" ${dis}>${userOpts(t.assignee_id)}</select></td>
      <td><input type="date" class="t-due" value="${t.due_date || ""}" ${dis}></td>
      <td><select class="t-status" ${canEdit ? "" : "disabled"}>
        ${STATUS_OPTS.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}
      </select></td>
      <td class="notes-cell">
        ${notes.length ? noteLine(notes[0]) : `<span class="muted">no notes</span>`}
        ${notes.length > 1 ? `<details><summary class="muted">${notes.length - 1} more</summary>
          ${notes.slice(1).map(noteLine).join("")}</details>` : ""}
        ${canEdit ? `<button class="t-note small secondary" type="button">+ note</button>` : ""}
      </td></tr>`;
  };

  const moduleRow = (m) => `<tr data-mod="${m.id}">
    <td>${m.module}</td>
    <td><input type="checkbox" class="m-opted" ${m.opted ? "checked" : ""} ${dis}></td>
    <td><input type="checkbox" class="m-training" ${m.training_done ? "checked" : ""} ${dis}></td>
    <td><input type="date" class="m-date" value="${m.training_date || ""}" ${dis}></td></tr>`;

  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(c.dsp_name)} <span class="muted">${esc(c.short_code)}</span></h1>
      <a href="#${isAdmin ? "clients" : "my-clients"}">← back</a>
    </div>
    <div class="card head-grid">
      <label>Status <select id="c-status" ${dis}>
        ${CLIENT_STATUS_OPTS.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}
      </select></label>
      <label>RAG <select id="c-rag" ${dis}>
        ${["", "G", "A", "R"].map((r) => `<option value="${r}" ${r === (c.rag || "") ? "selected" : ""}>${r || "—"}</option>`).join("")}
      </select></label>
      <label>Vendor <select id="c-vendor" ${dis}>
        ${["", "ADP", "Paycom"].map((v) => `<option value="${v}" ${v === (c.vendor || "") ? "selected" : ""}>${v || "—"}</option>`).join("")}
      </select></label>
      <label>Implementor <select id="c-imp" ${dis}>${userOpts(c.implementor_id)}</select></label>
      <label>TT live <input id="c-tt" type="date" value="${c.tt_live_date || ""}" ${dis}></label>
      <label>Payroll cutoff <input id="c-cutoff" type="date" value="${c.payroll_cutoff_date || ""}" ${dis}></label>
      <label>First pay <input id="c-pay" type="date" value="${c.first_pay_date || ""}" ${dis}></label>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Modules &amp; training</h2>
      <table class="grid"><thead><tr><th>Module</th><th>Opted</th><th>Training done</th><th>Training date</th></tr></thead>
      <tbody>${c.client_modules.slice()
        .sort((a, b) => CONFIG.MODULES.indexOf(a.module) - CONFIG.MODULES.indexOf(b.module))
        .map(moduleRow).join("")}</tbody></table>
    </div>
    <div class="tabbar">
      <button id="tab-onb" class="active" type="button">Onboarding (${tasksFor("onboarding").length})</button>
      <button id="tab-aud" type="button">Audit (${tasksFor("audit").length})</button>
    </div>
    <div id="task-area"></div>
    ${isAdmin ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <input id="adhoc-title" placeholder="Ad-hoc task title" style="flex:1;min-width:180px">
      <select id="adhoc-assignee">${userOpts(null)}</select>
      <input id="adhoc-due" type="date">
      <button id="adhoc-add" type="button">Add task</button>
    </div>` : ""}`;

  const reload = () => Views.renderClientDetail(view, id);

  const renderTasks = (phase) => {
    $("#tab-onb").classList.toggle("active", phase === "onboarding");
    $("#tab-aud").classList.toggle("active", phase === "audit");
    $("#task-area").innerHTML = `<table class="grid"><thead><tr>
      <th>Task</th><th>Assignee</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${tasksFor(phase).map(taskRow).join("")}</tbody></table>`;
    $("#task-area").querySelectorAll("tr[data-task]").forEach((row) => {
      const tid = Number(row.dataset.task);
      const t = c.tasks.find((x) => x.id === tid);
      const asg = row.querySelector(".t-assignee");
      if (!asg.disabled) asg.onchange = () =>
        guard(() => Store.updateTask(tid, { assignee_id: asg.value || null }));
      const due = row.querySelector(".t-due");
      if (!due.disabled) due.onchange = () =>
        guard(() => Store.updateTask(tid, { due_date: due.value || null }));
      const st = row.querySelector(".t-status");
      if (!st.disabled) st.onchange = () => guard(async () => {
        if (st.value === "Done") {
          const note = prompt("Completion note (required):");
          if (note === null || !note.trim()) { st.value = t.status; toast("A note is required to mark Done"); return; }
          await Store.addNote(tid, note.trim());
          await Store.updateTask(tid, { status: "Done", done_date: new Date().toISOString().slice(0, 10) });
        } else {
          await Store.updateTask(tid, { status: st.value, done_date: null });
        }
        reload();
      });
      const nb = row.querySelector(".t-note");
      if (nb) nb.onclick = () => guard(async () => {
        const note = prompt("Note:");
        if (note && note.trim()) { await Store.addNote(tid, note.trim()); reload(); }
      });
    });
  };
  $("#tab-onb").onclick = () => renderTasks("onboarding");
  $("#tab-aud").onclick = () => renderTasks("audit");
  renderTasks("onboarding");

  if (isAdmin) {
    const bind = (sel, field) => {
      const el = $(sel);
      el.onchange = () => guard(() => Store.updateClient(id, { [field]: el.value || null }));
    };
    bind("#c-status", "status"); bind("#c-rag", "rag"); bind("#c-vendor", "vendor");
    bind("#c-imp", "implementor_id"); bind("#c-tt", "tt_live_date");
    bind("#c-cutoff", "payroll_cutoff_date"); bind("#c-pay", "first_pay_date");

    view.querySelectorAll("tr[data-mod]").forEach((row) => {
      const mid = Number(row.dataset.mod);
      row.querySelector(".m-opted").onchange = (e) =>
        guard(() => Store.updateModule(mid, { opted: e.target.checked }));
      row.querySelector(".m-training").onchange = (e) =>
        guard(() => Store.updateModule(mid, { training_done: e.target.checked }));
      row.querySelector(".m-date").onchange = (e) =>
        guard(() => Store.updateModule(mid, { training_date: e.target.value || null }));
    });

    $("#adhoc-add").onclick = () => guard(async () => {
      const title = $("#adhoc-title").value.trim();
      if (!title) { toast("Task title required"); return; }
      await Store.createTask({
        client_id: id, title,
        assignee_id: $("#adhoc-assignee").value || null,
        due_date: $("#adhoc-due").value || null,
      });
      reload();
    });
  }
};
```

(Keep the Task-4 stub lines for `Views.renderOpenItems` and `Views.renderTeam` at the bottom of the file until Task 6 replaces them.)

- [ ] **Step 2: Verify as admin** (browser, signed in as rohit.kaushik@uzio.com)

1. Clients view: "+ New client" → create `Test DSP` / `TSTD` / ADP → lands on detail page.
2. Detail: Onboarding tab shows 12 tasks, Audit tab 18. Modules table shows 4 rows.
3. Assign a task to `test.implementor` with a due date → no error toast.
4. Change task status to Done → prompt appears; empty note → blocked with toast; real note → status Done, note visible with your name and today's date.
5. Toggle TimeTracking `opted` + `training done` → refresh page → both persist.
6. Add ad-hoc task "Fix EE names" → appears in Onboarding tab with an `ad-hoc` chip.
7. Clients list now shows checklist % > 0 and the TimeTracking chip.

- [ ] **Step 3: Verify as implementor**

Sign in as `test.implementor@uzio.com`, open `#client/<id>` by URL: every header/module control is disabled; only the task assigned to them has an enabled status dropdown and "+ note".

- [ ] **Step 4: Commit**

```bash
git add site/views-admin.js
git commit -m "feat: admin clients list and client detail with checklists, modules, ad-hoc tasks"
```

---

### Task 6: Admin — Open Items and Team

**Files:**
- Modify: `site/views-admin.js` (replace the remaining two stubs)

**Interfaces:**
- Consumes: `Store.listOpenItems/listDoneItems/listUsers/updateUser/getAdminEmails/setAdminEmails`, `latestNote`.
- Produces: `Views.renderOpenItems(view)`, `Views.renderTeam(view)`.

- [ ] **Step 1: Replace the `renderOpenItems` stub** with:

```javascript
Views.renderOpenItems = async (view) => {
  const [open, done] = await Promise.all([Store.listOpenItems(), Store.listDoneItems()]);
  const groups = {};
  open.forEach((t) => {
    const k = t.assignee?.name || "Unassigned";
    (groups[k] = groups[k] || []).push(t);
  });
  const openRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td><td>${t.status}</td><td>${fmtDate(t.due_date)}</td>
    <td class="notes-cell">${latestNote(t)}</td></tr>`;
  const doneRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td><td>${esc(t.assignee?.name || "—")}</td>
    <td>${fmtDate(t.done_date)}</td><td class="notes-cell">${latestNote(t)}</td></tr>`;
  view.innerHTML = `<div class="page-head"><h1>Open Items</h1>
      <span class="muted">${open.length} open across ${Object.keys(groups).length} people</span></div>` +
    (open.length ? Object.entries(groups).map(([who, ts]) => `
      <h2>${esc(who)} <span class="muted">(${ts.length})</span></h2>
      <table class="grid"><thead><tr>
        <th>Client</th><th>Task</th><th>Status</th><th>Due</th><th>Latest note</th></tr></thead>
      <tbody>${ts.map(openRow).join("")}</tbody></table>`).join("")
      : `<p class="muted">Nothing open — all assigned work is done.</p>`) +
    `<h2>Recently done <span class="muted">(last ${done.length})</span></h2>
     <table class="grid"><thead><tr>
       <th>Client</th><th>Task</th><th>By</th><th>Done</th><th>Note</th></tr></thead>
     <tbody>${done.map(doneRow).join("") || `<tr><td colspan="5" class="muted">nothing yet</td></tr>`}</tbody></table>`;
};
```

- [ ] **Step 2: Replace the `renderTeam` stub** with:

```javascript
Views.renderTeam = async (view) => {
  const [users, adminEmails] = await Promise.all([Store.listUsers(), Store.getAdminEmails()]);
  view.innerHTML = `<div class="page-head"><h1>Team</h1></div>
    <p class="muted">Accounts are created by signing up on the login page with an @uzio.com email.
       Admins are whoever is on the admin list (stored in app_config).</p>
    <table class="grid"><thead><tr>
      <th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr data-id="${u.id}" data-email="${esc(u.email)}">
      <td><input class="u-name" value="${esc(u.name)}"></td>
      <td>${esc(u.email)}</td>
      <td>${u.role}</td>
      <td><input type="checkbox" class="u-active" ${u.active ? "checked" : ""}></td>
      <td><button class="u-role small secondary" type="button">
        ${u.role === "admin" ? "Make implementor" : "Make admin"}</button></td>
    </tr>`).join("")}</tbody></table>`;
  view.querySelectorAll("tbody tr").forEach((row) => {
    const uid = row.dataset.id, email = row.dataset.email;
    row.querySelector(".u-name").onchange = (e) =>
      guard(() => Store.updateUser(uid, { name: e.target.value.trim() }));
    row.querySelector(".u-active").onchange = (e) =>
      guard(() => Store.updateUser(uid, { active: e.target.checked }));
    row.querySelector(".u-role").onclick = () => guard(async () => {
      const makeAdmin = !adminEmails.includes(email.toLowerCase());
      const next = makeAdmin
        ? [...adminEmails, email.toLowerCase()]
        : adminEmails.filter((x) => x !== email.toLowerCase());
      if (!next.length) { toast("At least one admin must remain"); return; }
      await Store.setAdminEmails(next);
      await Store.updateUser(uid, { role: makeAdmin ? "admin" : "implementor" });
      toast("Role updated", true);
      Views.renderTeam(view);
    });
  });
};
```

- [ ] **Step 3: Verify** (browser, as admin)

1. Open Items: the task assigned in Task 5 appears under `test.implementor`; the Done one appears in "Recently done" with its note.
2. Team: both users listed. Rename test user → refresh → persists. "Make admin" on test user → role flips to admin (and back). Demoting yourself as the last admin is blocked by the toast.
3. As `test.implementor` (implementor role), hand-navigate to `#team`: the route renders but every write fails with an RLS error toast — server-side enforcement confirmed. (Nav never shows Team to implementors.)

- [ ] **Step 4: Commit**

```bash
git add site/views-admin.js
git commit -m "feat: admin open items rollup and team management"
```

---

### Task 7: Implementor screen

**Files:**
- Modify: `site/views-user.js` (replace both stubs)

**Interfaces:**
- Consumes: `Store.listOpenItems(me.id)`, `Store.listDoneItems(me.id)`, `Store.listClients`, `Store.updateTask`, `Store.addNote`, helpers, `clientRow`/`CLIENT_TABLE_HEAD`/`wireClientRows` from Task 5 (same script scope — views-admin.js loads first).
- Produces: `Views.renderMyItems(view)`, `Views.renderMyClients(view)`.

- [ ] **Step 1: Replace `site/views-user.js`** with:

```javascript
/* Implementor views. Client detail is shared: Views.renderClientDetail handles both roles. */
window.Views = window.Views || {};

Views.renderMyItems = async (view) => {
  const me = Store.getMe();
  const [items, done] = await Promise.all([Store.listOpenItems(me.id), Store.listDoneItems(me.id)]);
  const byClient = {};
  items.forEach((t) => {
    const k = t.client?.dsp_name || "?";
    (byClient[k] = byClient[k] || []).push(t);
  });
  const row = (t) => `<tr data-task="${t.id}">
    <td>${esc(t.title)}</td><td>${t.status}</td><td>${fmtDate(t.due_date)}</td>
    <td class="notes-cell">${latestNote(t)}</td>
    <td>
      ${t.status === "Open" ? `<button class="t-start small secondary" type="button">Start</button>` : ""}
      <button class="t-done small" type="button">Done</button>
      <button class="t-addnote small secondary" type="button">+ note</button>
    </td></tr>`;
  view.innerHTML = `<div class="page-head"><h1>My Open Items</h1>
      <span class="muted">${items.length} open</span></div>` +
    (items.length ? Object.entries(byClient).map(([name, ts]) => `
      <h2>${esc(name)}</h2>
      <table class="grid"><thead><tr>
        <th>Task</th><th>Status</th><th>Due</th><th>Latest note</th><th>Actions</th></tr></thead>
      <tbody>${ts.map(row).join("")}</tbody></table>`).join("")
      : `<p class="muted">Nothing assigned to you right now.</p>`) +
    `<h2>My recently done</h2>
     <table class="grid"><thead><tr><th>Task</th><th>Client</th><th>Done</th><th>Note</th></tr></thead>
     <tbody>${done.map((t) => `<tr><td>${esc(t.title)}</td>
        <td>${esc(t.client?.dsp_name)}</td><td>${fmtDate(t.done_date)}</td>
        <td class="notes-cell">${latestNote(t)}</td></tr>`).join("")
        || `<tr><td colspan="4" class="muted">nothing yet</td></tr>`}</tbody></table>`;

  view.querySelectorAll("tr[data-task]").forEach((r) => {
    const tid = Number(r.dataset.task);
    const start = r.querySelector(".t-start");
    if (start) start.onclick = () => guard(async () => {
      await Store.updateTask(tid, { status: "In Progress" });
      Views.renderMyItems(view);
    });
    r.querySelector(".t-done").onclick = () => guard(async () => {
      const note = prompt("Completion note (required):");
      if (note === null) return;
      if (!note.trim()) { toast("A note is required to mark Done"); return; }
      await Store.addNote(tid, note.trim());
      await Store.updateTask(tid, { status: "Done", done_date: new Date().toISOString().slice(0, 10) });
      toast("Marked done", true);
      Views.renderMyItems(view);
    });
    r.querySelector(".t-addnote").onclick = () => guard(async () => {
      const note = prompt("Note:");
      if (note && note.trim()) { await Store.addNote(tid, note.trim()); Views.renderMyItems(view); }
    });
  });
};

Views.renderMyClients = async (view) => {
  const me = Store.getMe();
  const clients = (await Store.listClients()).filter((c) => c.implementor_id === me.id);
  view.innerHTML = `<div class="page-head"><h1>My Clients</h1></div>` +
    (clients.length
      ? `<table class="grid">${CLIENT_TABLE_HEAD}<tbody>${clients.map(clientRow).join("")}</tbody></table>`
      : `<p class="muted">No clients have you as implementor yet.</p>`);
  wireClientRows(view);
};
```

- [ ] **Step 2: Verify** (browser, as `test.implementor@uzio.com`)

1. My Open Items: shows the task assigned in Task 5, grouped under `Test DSP`.
2. Start → status becomes In Progress. Done → empty note blocked; real note → task moves to "My recently done".
3. As admin, Open Items now shows that completion in "Recently done" with the implementor's note — the admin-visibility requirement.
4. My Clients: empty (or shows Test DSP if the admin set `test.implementor` as its implementor — set it, verify it appears and clicks through to the shared detail view in read-mostly mode).

- [ ] **Step 3: Commit**

```bash
git add site/views-user.js
git commit -m "feat: implementor screen — my open items with done-note flow, my clients"
```

---

### Task 8: Import parsing library (TDD)

**Files:**
- Create: `scripts/import_lib.py`
- Test: `scripts/test_import_lib.py`

**Interfaces:**
- Produces: `parse_date(text, default_year=2026) -> datetime.date | None`; `parse_status_cell(text) -> (status: str, done_date: date|None, note: str|None)`; `include_client(actual_tt: date|None, expected_tt: date|None, cutoff=date(2026,7,31)) -> bool`. Task 9 imports all three.

- [ ] **Step 1: Write the failing tests — `scripts/test_import_lib.py`**

```python
import unittest
from datetime import date
from import_lib import parse_date, parse_status_cell, include_client


class TestParseDate(unittest.TestCase):
    def test_month_day_gets_default_year(self):
        self.assertEqual(parse_date("2/26"), date(2026, 2, 26))

    def test_full_date(self):
        self.assertEqual(parse_date("3/6/2026"), date(2026, 3, 6))

    def test_two_digit_year(self):
        self.assertEqual(parse_date("3/6/26"), date(2026, 3, 6))

    def test_date_embedded_in_text(self):
        self.assertEqual(parse_date("Completed -2/26 (Sanya)"), date(2026, 2, 26))

    def test_no_date(self):
        self.assertIsNone(parse_date("Completed"))
        self.assertIsNone(parse_date(""))
        self.assertIsNone(parse_date(None))

    def test_invalid_date_returns_none(self):
        self.assertIsNone(parse_date("13/45"))


class TestParseStatusCell(unittest.TestCase):
    def test_blank_is_open(self):
        self.assertEqual(parse_status_cell(""), ("Open", None, None))
        self.assertEqual(parse_status_cell(None), ("Open", None, None))

    def test_bare_completed(self):
        self.assertEqual(parse_status_cell("Completed"), ("Done", None, None))

    def test_completed_with_date_and_owner_keeps_note(self):
        status, done, note = parse_status_cell("Completed -2/26 (Sanya)")
        self.assertEqual(status, "Done")
        self.assertEqual(done, date(2026, 2, 26))
        self.assertEqual(note, "Completed -2/26 (Sanya)")

    def test_tbd_is_open(self):
        self.assertEqual(parse_status_cell("TBD"), ("Open", None, None))

    def test_tbd_with_detail_keeps_note(self):
        status, done, note = parse_status_cell("TBD (Sanya/Priyanshu) data missing for 7 EEs")
        self.assertEqual(status, "Open")
        self.assertIsNone(done)
        self.assertIn("Priyanshu", note)

    def test_na(self):
        self.assertEqual(parse_status_cell("N/A"), ("N/A", None, None))
        self.assertEqual(parse_status_cell("na"), ("N/A", None, None))

    def test_free_text_preserved_as_note(self):
        status, done, note = parse_status_cell("https://jira.uzio.com/browse/PHIX-96116")
        self.assertEqual(status, "Open")
        self.assertEqual(note, "https://jira.uzio.com/browse/PHIX-96116")


class TestIncludeClient(unittest.TestCase):
    CUTOFF = date(2026, 7, 31)

    def test_after_cutoff_included(self):
        self.assertTrue(include_client(date(2026, 8, 1), None))

    def test_on_cutoff_excluded(self):
        self.assertFalse(include_client(date(2026, 7, 31), None))

    def test_actual_wins_over_expected(self):
        self.assertFalse(include_client(date(2026, 2, 22), date(2026, 9, 1)))

    def test_expected_used_when_no_actual(self):
        self.assertTrue(include_client(None, date(2026, 8, 15)))

    def test_no_dates_excluded(self):
        self.assertFalse(include_client(None, None))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd scripts && python -m unittest test_import_lib -v; cd ..
```

Expected: `ModuleNotFoundError: No module named 'import_lib'`. (If `python` is missing, use `py`.)

- [ ] **Step 3: Write `scripts/import_lib.py`**

```python
"""Pure parsing helpers for the sheet import. No I/O here — keep it unit-testable."""
import re
from datetime import date

DEFAULT_YEAR = 2026
_DONE_RE = re.compile(r"^\s*(completed|done)\b", re.I)
_BARE_DONE_RE = re.compile(r"^\s*(completed|done)[\s\-–—]*$", re.I)
_NA_RE = re.compile(r"^\s*(n/?a|not applicable)\s*$", re.I)
_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?")


def parse_date(text, default_year=DEFAULT_YEAR):
    """First M/D or M/D/Y found in text -> date, defaulting the year. None if absent/invalid."""
    if not text:
        return None
    m = _DATE_RE.search(text)
    if not m:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    year = int(m.group(3)) if m.group(3) else default_year
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_status_cell(text):
    """Sheet cell -> (status, done_date, note). Never loses information:
    anything beyond a bare status keyword is preserved as the note."""
    raw = (text or "").strip()
    if not raw:
        return ("Open", None, None)
    if _NA_RE.match(raw):
        return ("N/A", None, None)
    if _DONE_RE.match(raw):
        note = None if _BARE_DONE_RE.match(raw) else raw
        return ("Done", parse_date(raw), note)
    if raw.upper().startswith("TBD"):
        return ("Open", None, raw if len(raw) > 3 else None)
    return ("Open", None, raw)


def include_client(actual_tt, expected_tt, cutoff=date(2026, 7, 31)):
    """Import filter: TT live date (actual wins over expected) strictly after the cutoff."""
    d = actual_tt or expected_tt
    return bool(d and d > cutoff)
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd scripts && python -m unittest test_import_lib -v; cd ..
```

Expected: all tests PASS (OK).

- [ ] **Step 5: Commit**

```bash
git add scripts/import_lib.py scripts/test_import_lib.py
git commit -m "feat: sheet-cell parsing library with unit tests"
```

---

### Task 9: Import script

**Files:**
- Create: `scripts/import_sheets.py`
- Modify: `docs/specs/2026-08-24-dsp-crm-tracker-design.md` (one-line correction, see Step 3)

**Interfaces:**
- Consumes: `import_lib` (Task 8); `.env` with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`; CSV exports at `data/raw/onboarding.csv` (DSP Implementation tab) and `data/raw/audit.csv` (audit tracker main tab) — Rohit downloads these via File → Download → CSV of each tab.
- Produces: clients/tasks/notes/modules in Supabase; a printed report. Idempotent: re-run updates rather than duplicates (clients upsert on `dsp_name`; task statuses PATCHed; prior `[import]` notes wiped per client before re-inserting).

- [ ] **Step 1: Write `scripts/import_sheets.py`**

```python
"""One-time import of the two Google Sheet trackers into Supabase.

Inputs (CSV exports placed in data/raw/ — gitignored):
  data/raw/onboarding.csv   DSP Implementation tab of the Onboarding Tracker
  data/raw/audit.csv        main tab of the Audit Tracker

Usage:
  python scripts/import_sheets.py --dry-run   # print what would change, write nothing
  python scripts/import_sheets.py             # write to Supabase

Needs .env in the repo root with SUPABASE_URL and SUPABASE_SERVICE_KEY.
Implementor names are matched against existing app users by first name;
unmatched names are reported, never guessed (accounts only exist via sign-up).
"""
import csv
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_lib import parse_date, parse_status_cell, include_client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# sheet column (stripped) -> task_template name
ONBOARDING_COLS = {
    "Company Setup": "Company Setup",
    "Federal/State Withholding/payment": "Federal/State Withholding & Payment",
    "Data Transfer (Paycom)": "Data Transfer",
    "Data Transfer (ADP)": "Data Transfer",
    "Delta Data Upload": "Delta Data Upload",
    "Time Tracking Setup Kiosk/Mobile/Web Enablement": "Time Tracking Setup (Kiosk/Mobile/Web)",
    "Document Transfer": "Document Transfer",
    "Historical Data": "Historical Data Download",
    "Audit Client Data and Minor Data Corrections": "Audit Client Data & Minor Corrections",
    "Final Payroll Review and Testing": "Final Payroll Review & Testing",
    "Prior Pay Info Transfer and Approved": "Prior Pay Info Transfer & Approval",
    "PTO Balance Move": "PTO Balance Move",
    "Tax Review (Post Prior Upload)": "Tax Review (Post Prior Upload)",
}
AUDIT_COLS = {
    "Credentials": "Credentials",
    "Downloaded Qualified Overtime Report": "Qualified Overtime Report",
    "Census": "Census",
    "Census Delta": "Census Delta",
    "Emergency Contact": "Emergency Contact",
    "License Details": "License Details",
    "Payment Method": "Payment Method",
    "PTO Policy Creation": "PTO Policy Creation",
    "PTO Balance": "PTO Balance",
    "SIT/FIT Withholding": "SIT/FIT Withholding",
    "Earnings": "Earnings",
    "Deductions": "Deductions",
    "Contributions Transfer (Except Roth/401k)": "Contributions Transfer (Except Roth/401k)",
    "Workers Comp": "Workers Comp",
    "Doc Transfer": "Doc Transfer",
    "Prior Comp Transfer and Approval": "Prior Comp Transfer & Approval",
    "Client Data Audit": "Client Data Audit",
    "Historical Data Dowloaded": "Historical Data Downloaded",  # sheet's own typo
}


def load_env():
    conf = {}
    with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                conf[k.strip()] = v.strip()
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not conf.get(key):
            sys.exit(f".env is missing {key}")
    return conf


def rest(conf, method, path, body=None, prefer="return=representation"):
    req = urllib.request.Request(
        conf["SUPABASE_URL"] + "/rest/v1/" + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
    )
    req.add_header("apikey", conf["SUPABASE_SERVICE_KEY"])
    req.add_header("Authorization", "Bearer " + conf["SUPABASE_SERVICE_KEY"])
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} failed: {e.code} {e.read().decode()[:500]}")


def read_rows(filename, required_cols):
    path = os.path.join(ROOT, "data", "raw", filename)
    if not os.path.exists(path):
        sys.exit(f"Missing {path} — export the sheet tab as CSV and place it there.")
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    try:
        hi = next(i for i, r in enumerate(rows) if "DSP Name" in [c.strip() for c in r])
    except StopIteration:
        sys.exit(f"{filename}: no header row containing 'DSP Name' found.")
    headers = [c.strip() for c in rows[hi]]
    missing = [c for c in required_cols if c not in headers]
    if missing:
        sys.exit(f"{filename}: expected columns missing: {missing}")
    out = []
    for r in rows[hi + 1:]:
        d = {headers[i]: (r[i].strip() if i < len(r) else "") for i in range(len(headers))}
        if d.get("DSP Name"):
            out.append(d)
    return out


def iso(d):
    return d.isoformat() if d else None


def client_status(text):
    t = (text or "").lower()
    if "complete" in t:
        return "Completed"
    if "live" in t:
        return "Live"
    if not t.strip():
        return "Not Started"
    return "In Progress"


def main():
    dry = "--dry-run" in sys.argv
    conf = load_env()
    onboarding = read_rows("onboarding.csv",
                           ["DSP Name", "Expected Time Tracking Live Date", "Implementor"])
    audit = read_rows("audit.csv", ["DSP Name", "Current Payroll with"])
    audit_by_name = {r["DSP Name"].upper(): r for r in audit}

    users = rest(conf, "GET", "users?select=id,name")
    user_by_first = {u["name"].split()[0].lower(): u["id"] for u in users if u.get("name")}
    templates = rest(conf, "GET", "task_templates?select=id,name")
    tpl_by_name = {t["name"]: t["id"] for t in templates}

    report = {"imported": 0, "skipped_filter": 0, "cells_kept_as_notes": 0,
              "unmatched_implementors": set()}

    for row in onboarding:
        actual = parse_date(row.get("Actual Time Tracking Live Date", ""))
        expected = parse_date(row.get("Expected Time Tracking Live Date", ""))
        if not include_client(actual, expected):
            report["skipped_filter"] += 1
            continue

        arow = audit_by_name.get(row["DSP Name"].upper(), {})
        imp_name = row.get("Implementor", "").strip()
        imp_id = user_by_first.get(imp_name.split()[0].lower()) if imp_name else None
        if imp_name and not imp_id:
            report["unmatched_implementors"].add(imp_name)

        payroll_with = arow.get("Current Payroll with", "").lower()
        client = {
            "dsp_name": row["DSP Name"],
            "short_code": row.get("DSP Short Code", ""),
            "vendor": "ADP" if "adp" in payroll_with else ("Paycom" if "paycom" in payroll_with else None),
            "previous_system": row.get("Previous System") or None,
            "implementor_id": imp_id,
            "status": client_status(row.get("Final Status", "")),
            "tt_live_date": iso(actual or expected),
            "payroll_cutoff_date": iso(parse_date(row.get("Payroll Cut off Date", ""))),
            "first_pay_date": iso(parse_date(row.get("Payroll Live(Pay) Date", ""))),
            "rag": row.get("RAG", "").strip()[:1].upper() or None,
        }
        if client["rag"] not in ("R", "A", "G"):
            client["rag"] = None

        print(("DRY  " if dry else "SYNC ") + client["dsp_name"]
              + f"  tt={client['tt_live_date']}  vendor={client['vendor']}  imp={imp_name or '-'}")
        if dry:
            report["imported"] += 1
            continue

        res = rest(conf, "POST", "clients?on_conflict=dsp_name", [client],
                   prefer="resolution=merge-duplicates,return=representation")
        cid = res[0]["id"]

        # wipe previous [import] notes for this client's tasks (makes re-runs clean)
        tasks = rest(conf, "GET", f"tasks?client_id=eq.{cid}&select=id,template_id")
        task_by_tpl = {t["template_id"]: t["id"] for t in tasks}
        for tid in task_by_tpl.values():
            rest(conf, "DELETE", f"task_notes?task_id=eq.{tid}&note=like.%5Bimport%5D*",
                 prefer="return=minimal")

        for cols, src in ((ONBOARDING_COLS, row), (AUDIT_COLS, arow)):
            for col, tpl_name in cols.items():
                if col not in src:
                    continue
                cell = src.get(col, "")
                if not cell and col.startswith("Data Transfer ("):
                    continue  # only one vendor's column is filled; skip the empty twin
                status, done, note = parse_status_cell(cell)
                tid = task_by_tpl.get(tpl_by_name[tpl_name])
                if not tid:
                    continue
                rest(conf, "PATCH", f"tasks?id=eq.{tid}",
                     {"status": status, "done_date": iso(done)}, prefer="return=minimal")
                if note:
                    report["cells_kept_as_notes"] += 1
                    rest(conf, "POST", "task_notes",
                         {"task_id": tid, "note": "[import] " + note}, prefer="return=minimal")

        # modules: imported clients are on TT + Payroll; training from the tracker column
        mods = rest(conf, "GET", f"client_modules?client_id=eq.{cid}&select=id,module")
        training_done = "complete" in row.get("Training Status", "").lower()
        for m in mods:
            if m["module"] in ("TimeTracking", "Payroll"):
                patch = {"opted": True}
                if m["module"] == "TimeTracking":
                    patch["training_done"] = training_done
                rest(conf, "PATCH", f"client_modules?id=eq.{m['id']}", patch, prefer="return=minimal")

        report["imported"] += 1

    print("\n--- report ---")
    print(f"imported:            {report['imported']}")
    print(f"skipped (TT filter): {report['skipped_filter']}")
    print(f"cells kept as notes: {report['cells_kept_as_notes']}")
    print(f"unmatched implementors: {sorted(report['unmatched_implementors']) or 'none'}")
    if report["unmatched_implementors"]:
        print("  -> these people have no app account yet; assign their clients in the Team/Clients UI once they sign up.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Dry-run against the real exports**

Rohit downloads both tabs as CSV into `data/raw/onboarding.csv` and `data/raw/audit.csv`, then:

```bash
python scripts/import_sheets.py --dry-run
```

Expected: one `DRY <name>` line per client with TT live after 2026-07-31; a report with `skipped (TT filter)` covering the rest; exit code 0. Sanity-check a few names/dates against the sheet before the real run.

- [ ] **Step 3: Correct the spec's implementor-mapping sentence**

In `docs/specs/2026-08-24-dsp-crm-tracker-design.md` §5, replace:

`- Maps Implementor names to `users` rows (creating them), vendor from "Current Payroll with".`

with:

`- Matches Implementor names to existing app users by first name (accounts exist only via sign-up, so unmatched names are reported for manual assignment, never auto-created); vendor from "Current Payroll with".`

- [ ] **Step 4: Real run and verification**

```bash
python scripts/import_sheets.py
```

Then in the app (as admin): Clients list shows the imported clients with vendors, dates, statuses, and checklist percentages; open one client → audit tasks show statuses and `[import]` notes with the original cell text.

- [ ] **Step 5: Commit**

```bash
git add scripts/import_sheets.py docs/specs/2026-08-24-dsp-crm-tracker-design.md
git commit -m "feat: sheet import script (filtered to TT live after 2026-07-31), spec correction"
```

---

### Task 10: Deploy and runbook

**Files:**
- Modify: `CLAUDE.md` (add QA checklist + deploy runbook)

**Interfaces:**
- Consumes: everything above.
- Produces: the live Vercel URL; documented ops.

- [ ] **Step 1: Connect Vercel** (Rohit, once): vercel.com → Add New Project → import `Rohit-Kaushik-git/CRM` → Framework preset "Other", output directory `site` (vercel.json already says so) → Deploy. Note the URL.

- [ ] **Step 2: Append to `CLAUDE.md`**

```markdown
## QA checklist (run before telling the team about a change)
1. Sign-up with a non-@uzio.com email → rejected.
2. Admin account lands on Clients; implementor account lands on My Open Items.
3. Signed-out visitor: login form only; `curl` with anon key returns `[]`.
4. Create client → 12 onboarding + 18 audit tasks + 4 module rows auto-created.
5. Assign task → appears in that implementor's My Open Items.
6. Done without note → blocked. Done with note → visible to admin in Open Items → Recently done, with author + date.
7. Module/training toggles persist across refresh.
8. Both screens usable at 375px width.

## Import runbook
1. Download both sheet tabs as CSV → `data/raw/onboarding.csv`, `data/raw/audit.csv`.
2. `python scripts/import_sheets.py --dry-run` — check names, dates, filter counts.
3. `python scripts/import_sheets.py` — idempotent; re-running refreshes statuses and re-writes `[import]` notes.

## Live URL
<paste Vercel URL here after first deploy>
```

(Replace the placeholder with the real URL from Step 1.)

- [ ] **Step 3: Run the full QA checklist** on the deployed URL. All 8 items must pass; fix anything that fails before closing the task.

- [ ] **Step 4: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: QA checklist, import runbook, live URL"
git push
```

---

## Self-review notes

- Spec coverage: auth+roles (T2–T4), clients/checklists/modules/ad-hoc (T2, T5), open items incl. done-notes visible to admin (T6, T7), implementor screen (T7), import with filter + note preservation (T8–T9), deploy (T10), error toasts via `guard()` (T4), manual QA (T10). Spec §5's "creating them" implementor claim contradicted the auth model; corrected via T9 Step 3.
- Type consistency: `Store` method names/signatures in Tasks 5–7 match Task 4's definitions; `clientRow`/`CLIENT_TABLE_HEAD`/`wireClientRows`/`pct` defined in T5, reused in T7 (script load order guarantees availability); template names in T9's column maps match T2's seed list exactly (30 templates).
- Known deliberate limits: `prompt()` for notes (ugly but YAGNI), full-view re-render after each write, no optimistic updates, email-confirm disabled during test phase.
