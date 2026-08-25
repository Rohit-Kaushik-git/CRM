# DSP CRM v2 — Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Attention dashboard, client 360 with activity timeline, and scheduled sheet-sync with the "app wins where humans acted" rule — per `docs/specs/2026-08-25-v2-command-center-design.md`.

**Architecture:** DB triggers own the truth (activity logging + `app_touched` marking) so every write path — UI or sync — is covered. Sync runs headless on GitHub Actions. UI additions are two new views plus header enrichment, all through the existing `Store` layer.

**Tech Stack:** unchanged (Supabase, static JS, stdlib Python, GitHub Actions for cron).

## Global Constraints

- Python stdlib only. No build step; no new CDN scripts.
- All UI data access via `window.Store`; RLS remains the enforcement boundary.
- Sync must NEVER modify a task whose `app_touched = true` (no status PATCH, no note changes).
- Sync writes `implementor_id` only when the existing client row has it null.
- Sync must be quiet when nothing changed: skip PATCHes when status+done_date already match; only rewrite `[import]` notes when the desired set differs (avoids activity-log spam every 2 h).
- `activity_log` rows come only from DB triggers (security definer). No client insert policy.
- tasks→users embeds need the FK hint `users!tasks_assignee_id_fkey`.
- Thresholds: going-live window 14 days, unowned-work window 21 days, stale after 7 days — defined once as constants.
- Commit after each task. Python command is `py` locally, `python` on GitHub runners — scripts must work under both (they do; only docs/commands differ).

---

### Task V2-1: Database — app_touched, activity_log, triggers, view

**Files:**
- Create: `scripts/migrations/2026-08-25-v2-sync-activity.sql`
- Modify: `scripts/schema.sql` (fresh-install parity)
- Modify: `scripts/rls.sql` (activity_log read policy for fresh installs)

**Interfaces:**
- Produces: `tasks.app_touched boolean not null default false`; table `activity_log(id, client_id, task_id, actor_id, action, detail, created_at)`; triggers `task_activity` (BEFORE UPDATE on tasks: logs status/assignee changes, sets `app_touched` for human writers), `note_activity` (AFTER INSERT on task_notes: logs note, marks task touched for human authors), `client_activity_ins`/`client_activity_upd` (AFTER INSERT/UPDATE on clients: logs created/status/RAG); view `client_last_activity(client_id, last_activity)` with `security_invoker`.

- [ ] **Step 1: Create `scripts/migrations/2026-08-25-v2-sync-activity.sql`**

```sql
-- v2: sync conflict-rule support + activity timeline. Run in the Supabase SQL editor.
-- Safe to re-run.
begin;

alter table tasks add column if not exists app_touched boolean not null default false;

create table if not exists activity_log (
  id         bigint generated always as identity primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  task_id    bigint references tasks(id) on delete set null,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;
drop policy if exists act_read on activity_log;
create policy act_read on activity_log for select to authenticated using (true);
-- no insert/update/delete policies: rows come only from security-definer triggers

-- BEFORE UPDATE on tasks: log status/assignee changes; human writers mark the task app-touched
create or replace function public.log_task_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.status is distinct from old.status then
    insert into activity_log (client_id, task_id, actor_id, action, detail)
    values (new.client_id, new.id, auth.uid(), 'status',
            new.title || ': ' || old.status || ' → ' || new.status);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    select name into who from users where id = new.assignee_id;
    insert into activity_log (client_id, task_id, actor_id, action, detail)
    values (new.client_id, new.id, auth.uid(), 'assigned',
            new.title || ' → ' || coalesce(who, 'unassigned'));
  end if;
  if auth.uid() is not null then
    new.app_touched := true;
  end if;
  return new;
end $$;

drop trigger if exists task_activity on tasks;
create trigger task_activity before update on tasks
for each row execute function public.log_task_changes();

-- AFTER INSERT on task_notes: log the note; human authors mark the task app-touched
create or replace function public.log_note_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select id, client_id, title into t from tasks where id = new.task_id;
  insert into activity_log (client_id, task_id, actor_id, action, detail)
  values (t.client_id, t.id, new.author_id, 'note', t.title || ': ' || new.note);
  if new.author_id is not null then
    update tasks set app_touched = true where id = new.task_id and not app_touched;
  end if;
  return new;
end $$;

drop trigger if exists note_activity on task_notes;
create trigger note_activity after insert on task_notes
for each row execute function public.log_note_insert();

-- clients: log creation and status/RAG changes
create or replace function public.log_client_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client_created', new.dsp_name);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client', 'Status: ' || old.status || ' → ' || new.status);
  end if;
  if new.rag is distinct from old.rag then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client',
            'RAG: ' || coalesce(old.rag, '—') || ' → ' || coalesce(new.rag, '—'));
  end if;
  return new;
end $$;

drop trigger if exists client_activity_ins on clients;
create trigger client_activity_ins after insert on clients
for each row execute function public.log_client_changes();
drop trigger if exists client_activity_upd on clients;
create trigger client_activity_upd after update on clients
for each row execute function public.log_client_changes();

create or replace view client_last_activity with (security_invoker = true) as
select client_id, max(created_at) as last_activity
from activity_log
group by client_id;

commit;
```

- [ ] **Step 2: Fresh-install parity in `scripts/schema.sql`**

a) In the `create table tasks (...)` block, after the `created_at` line, add:

```sql
  app_touched boolean not null default false,
```

(keeping the `unique (client_id, template_id)` line last).

b) At the END of schema.sql, append everything from the migration EXCEPT the `begin;`/`commit;`, the `alter table tasks add column` line, and the two `alter table activity_log enable row level security` + policy lines (those two move to rls.sql): i.e. append the `create table if not exists activity_log`, the three functions, the five `drop trigger`/`create trigger` pairs, and the `client_last_activity` view, verbatim.

c) In `scripts/rls.sql`, after the `nts_ins` policy, append:

```sql
alter table activity_log enable row level security;
drop policy if exists act_read on activity_log;
create policy act_read on activity_log for select to authenticated using (true);
```

- [ ] **Step 3: Static verification** — migration and schema.sql agree on every object definition; no trigger name collides with existing ones (`task_update_columns`, `on_client_created`, `on_auth_user_created`).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/2026-08-25-v2-sync-activity.sql scripts/schema.sql scripts/rls.sql
git commit -m "feat(v2): activity log, app_touched conflict flag, DB triggers, last-activity view"
```

(Running the migration on the live DB is a batched human step at the end.)

---

### Task V2-2: Sync script

**Files:**
- Create: `scripts/sync_sheets.py`
- Modify: `scripts/import_sheets.py` → becomes a thin wrapper

**Interfaces:**
- Consumes: `import_lib` functions; env/`.env` keys `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, optional `SHEET_ONBOARDING_CSV_URL`, `SHEET_AUDIT_CSV_URL`.
- Produces: `sync_sheets.py` CLI: `--dry-run` and `--local` (skip URL fetch, use `data/raw/*.csv`); called by Task V2-3's workflow with plain `python scripts/sync_sheets.py`.

- [ ] **Step 1: Create `scripts/sync_sheets.py`** — this REPLACES the logic of import_sheets.py (copy its current constants/helpers and modify as shown). Full content:

```python
"""Scheduled sheet -> Supabase sync (v2). Also runnable manually.

Conflict rule: a task with app_touched = true (any human change in the app) is
NEVER modified by the sync. Client facts keep flowing from the sheets;
implementor_id is only written while the existing row has none.

Sources: SHEET_ONBOARDING_CSV_URL / SHEET_AUDIT_CSV_URL (published-to-web CSV
links) when set, else data/raw/onboarding.csv + data/raw/audit.csv.

Usage:
  python scripts/sync_sheets.py --dry-run    # report, write nothing
  python scripts/sync_sheets.py --local      # ignore URLs, use data/raw files
  python scripts/sync_sheets.py

Env resolution: real environment variables win; .env in repo root fills gaps.
"""
import csv
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_lib import parse_date, parse_status_cell, parse_audit_cell, include_client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
    "Census Audit": "Census Audit",
    "Withholding Audit": "Withholding Audit",
    "Payment Audit": "Payment Audit",
    "Prior Payroll Audit": "Prior Payroll Audit",
    "Deduction Audit": "Deduction Audit",
    "Emergency Contact Audit": "Emergency Contact Audit",
}


def load_env():
    conf = {}
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    conf[k.strip()] = v.strip()
    conf.update({k: v for k, v in os.environ.items() if k.startswith(("SUPABASE_", "SHEET_"))})
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not conf.get(key):
            sys.exit(f"Missing {key} (set env var or .env)")
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


def fetch_csvs(conf, local_only):
    os.makedirs(os.path.join(ROOT, "data", "raw"), exist_ok=True)
    pairs = [("SHEET_ONBOARDING_CSV_URL", "onboarding.csv"), ("SHEET_AUDIT_CSV_URL", "audit.csv")]
    for env_key, fname in pairs:
        url = conf.get(env_key)
        dest = os.path.join(ROOT, "data", "raw", fname)
        if url and not local_only:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            print(f"fetched {fname}: {len(data)} bytes")
        elif not os.path.exists(dest):
            sys.exit(f"Missing {dest} and no {env_key} set.")


def norm_header(text):
    return re.sub(r"\s+", " ", (text or "")).strip()


def read_rows(filename, required_cols, key_col="DSP Name"):
    path = os.path.join(ROOT, "data", "raw", filename)
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    try:
        hi = next(i for i, r in enumerate(rows) if key_col in [norm_header(c) for c in r])
    except StopIteration:
        sys.exit(f"{filename}: no header row containing '{key_col}' found.")
    headers = [norm_header(c) for c in rows[hi]]
    missing = [c for c in required_cols if c not in headers]
    if missing:
        sys.exit(f"{filename}: expected columns missing: {missing}")
    out = []
    for r in rows[hi + 1:]:
        d = {headers[i]: (r[i].strip() if i < len(r) else "") for i in range(len(headers))}
        if d.get(key_col):
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


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    dry = "--dry-run" in argv
    local_only = "--local" in argv
    conf = load_env()
    fetch_csvs(conf, local_only)

    onboarding = read_rows("onboarding.csv",
                           ["DSP Name", "Expected Time Tracking Live Date", "Implementor"])
    audit = read_rows("audit.csv", ["Client", "Census Audit", "Last Checked"], key_col="Client")
    audit_by_name = {r["Client"].upper(): r for r in audit}

    users = rest(conf, "GET", "users?select=id,name")
    user_by_first = {u["name"].split()[0].lower(): u["id"] for u in users if u.get("name")}
    templates = rest(conf, "GET", "task_templates?select=id,name")
    tpl_by_name = {t["name"]: t["id"] for t in templates}
    existing = {c["dsp_name"].upper(): c for c in
                rest(conf, "GET", "clients?select=id,dsp_name,implementor_id")}

    missing_tpls = sorted({t for t in list(ONBOARDING_COLS.values()) + list(AUDIT_COLS.values())
                           if t not in tpl_by_name})
    if missing_tpls:
        sys.exit(f"task_templates missing: {missing_tpls} — run migrations before syncing.")

    report = {"synced": 0, "skipped_filter": 0, "tasks_updated": 0,
              "tasks_skipped_touched": 0, "unmatched_implementors": set()}

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

        prev_system = row.get("Previous System", "").lower()
        client = {
            "dsp_name": row["DSP Name"],
            "short_code": row.get("DSP Short Code", ""),
            "vendor": "ADP" if "adp" in prev_system else ("Paycom" if "paycom" in prev_system else None),
            "previous_system": row.get("Previous System") or None,
            "status": client_status(row.get("Final Status", "")),
            "tt_live_date": iso(actual or expected),
            "payroll_cutoff_date": iso(parse_date(row.get("Payroll Cut off Date", ""))),
            "first_pay_date": iso(parse_date(row.get("Payroll Live(Pay) Date", ""))),
            "rag": (row.get("RAG", "").strip()[:1].upper() or None),
            "notes": (f"Audit folder coverage: {arow.get('Coverage')} (last checked {arow.get('Last Checked')})"
                      if arow.get("Coverage") else None),
        }
        if client["rag"] not in ("R", "A", "G"):
            client["rag"] = None
        ex = existing.get(row["DSP Name"].upper())
        if imp_id and not (ex and ex.get("implementor_id")):
            client["implementor_id"] = imp_id  # only fill when app hasn't set one

        print(("DRY  " if dry else "SYNC ") + client["dsp_name"])
        if dry:
            report["synced"] += 1
            continue

        res = rest(conf, "POST", "clients?on_conflict=dsp_name", [client],
                   prefer="resolution=merge-duplicates,return=representation")
        cid = res[0]["id"]

        tasks = rest(conf, "GET",
                     f"tasks?client_id=eq.{cid}"
                     "&select=id,template_id,status,done_date,app_touched,task_notes(note)")
        task_by_tpl = {t["template_id"]: t for t in tasks}
        last_checked = parse_date(arow.get("Last Checked", ""))

        for cols, src in ((ONBOARDING_COLS, row), (AUDIT_COLS, arow)):
            for col, tpl_name in cols.items():
                if col not in src:
                    continue
                cell = src.get(col, "")
                if not cell and col.startswith("Data Transfer ("):
                    continue
                if cols is AUDIT_COLS:
                    status, done, note = parse_audit_cell(cell)
                    if status == "Done" and done is None:
                        done = last_checked
                else:
                    status, done, note = parse_status_cell(cell)
                t = task_by_tpl.get(tpl_by_name[tpl_name])
                if not t:
                    continue
                if t["app_touched"]:
                    report["tasks_skipped_touched"] += 1
                    continue
                want_notes = ["[import] " + note] if note else []
                have_notes = sorted(n["note"] for n in (t.get("task_notes") or [])
                                    if n["note"].startswith("[import] "))
                changed = (t["status"] != status or t["done_date"] != iso(done)
                           or have_notes != sorted(want_notes))
                if not changed:
                    continue
                rest(conf, "PATCH", f"tasks?id=eq.{t['id']}",
                     {"status": status, "done_date": iso(done)}, prefer="return=minimal")
                rest(conf, "DELETE", f"task_notes?task_id=eq.{t['id']}&note=like.%5Bimport%5D*",
                     prefer="return=minimal")
                for n in want_notes:
                    rest(conf, "POST", "task_notes", {"task_id": t["id"], "note": n},
                         prefer="return=minimal")
                report["tasks_updated"] += 1

        mods = rest(conf, "GET", f"client_modules?client_id=eq.{cid}&select=id,module,opted,training_done")
        training_done = "complete" in row.get("Training Status", "").lower()
        for m in mods:
            if m["module"] in ("TimeTracking", "Payroll"):
                patch = {}
                if not m["opted"]:
                    patch["opted"] = True
                if m["module"] == "TimeTracking" and m["training_done"] != training_done:
                    patch["training_done"] = training_done
                if patch:
                    rest(conf, "PATCH", f"client_modules?id=eq.{m['id']}", patch, prefer="return=minimal")

        report["synced"] += 1

    print("\n--- sync report ---")
    print(f"clients synced:        {report['synced']}")
    print(f"skipped (TT filter):   {report['skipped_filter']}")
    print(f"tasks updated:         {report['tasks_updated']}")
    print(f"tasks skipped (app):   {report['tasks_skipped_touched']}")
    print(f"unmatched implementors: {sorted(report['unmatched_implementors']) or 'none'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Replace `scripts/import_sheets.py` entirely** with the wrapper:

```python
"""Manual one-off import — now delegates to sync_sheets (kept for muscle memory).

Usage:  python scripts/import_sheets.py [--dry-run]
Always uses the local data/raw/*.csv files (never fetches URLs).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_sheets

if __name__ == "__main__":
    sync_sheets.main(sys.argv[1:] + ["--local"])
```

- [ ] **Step 3: Verify** — `py -m py_compile scripts/sync_sheets.py scripts/import_sheets.py`; `cd scripts && py -m unittest test_import_lib -v` still green (27 tests); `py scripts/sync_sheets.py --dry-run --local` prints the same 30 DRY lines as before (uses local CSVs; safe).

- [ ] **Step 4: Commit**

```bash
git add scripts/sync_sheets.py scripts/import_sheets.py
git commit -m "feat(v2): sheet sync honoring app_touched, URL fetch, quiet no-op runs"
```

---

### Task V2-3: GitHub Actions cron

**Files:**
- Create: `.github/workflows/sync.yml`

- [ ] **Step 1: Create `.github/workflows/sync.yml`**

```yaml
name: sheet-sync
on:
  schedule:
    - cron: "0 */2 * * *"   # every 2 hours (UTC)
  workflow_dispatch: {}      # manual "Run workflow" button

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Run sheet sync
        run: python scripts/sync_sheets.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          SHEET_ONBOARDING_CSV_URL: ${{ secrets.SHEET_ONBOARDING_CSV_URL }}
          SHEET_AUDIT_CSV_URL: ${{ secrets.SHEET_AUDIT_CSV_URL }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/sync.yml
git commit -m "feat(v2): scheduled sheet-sync workflow (GitHub Actions, 2h cron)"
```

(Adding the 4 repo secrets + publishing the CSVs is a batched human step.)

---

### Task V2-4: Store additions + "Today" attention dashboard

**Files:**
- Modify: `site/store.js` (extend `listClients` select; add `listLastActivity`, `getActivity`)
- Modify: `site/app.js` (nav + route + default home)
- Modify: `site/views-admin.js` (add `Views.renderToday`; helpers)
- Modify: `site/styles.css` (small additions)

**Interfaces:**
- Produces: `Store.listLastActivity() -> [{client_id, last_activity}]`, `Store.getActivity(clientId) -> [{...activity, actor:{name}}]`; `Views.renderToday(view)`; global `daysUntil(dateStr)` (defined in views-admin.js, reused by Task V2-5).

- [ ] **Step 1: `site/store.js`** — replace `listClients`'s `.select(...)` with:

```javascript
      .select(`*, implementor:users(name),
               tasks(id,title,status,assignee_id,due_date,
                     template:task_templates(phase),
                     assignee:users!tasks_assignee_id_fkey(name)),
               client_modules(module,opted,training_done)`)
```

and add (after `listDoneItems`, before the return):

```javascript
  async function listLastActivity() {
    const { data, error } = await sb.from("client_last_activity").select("*");
    if (error) fail(error);
    return data;
  }

  async function getActivity(clientId) {
    const { data, error } = await sb.from("activity_log")
      .select("*, actor:users(name)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) fail(error);
    return data;
  }
```

Return object gains: `listLastActivity, getActivity,`

- [ ] **Step 2: `site/app.js`** — NAV gains Today first; admin home becomes today:

In `NAV`, insert as the FIRST element: `{ hash: "today", label: "Today", roles: ["admin"] },`
In `renderRoute`, change `const home = me.role === "admin" ? "clients" : "my-items";` to `const home = me.role === "admin" ? "today" : "my-items";` and add to `routes`: `"today": () => Views.renderToday(view),`

- [ ] **Step 3: `site/views-admin.js`** — add near the top (after `pct`):

```javascript
const LIVE_SOON_DAYS = 14, UNOWNED_WINDOW_DAYS = 21, STALE_DAYS = 7;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00") - today) / 86400000);
}

function countdownLabel(d) {
  if (d === null) return "";
  if (d > 0) return `T-${d} day${d === 1 ? "" : "s"}`;
  if (d === 0) return "Goes live today";
  return `Live ${-d}d ago`;
}
```

and add `Views.renderToday` (before `Views.renderClients`):

```javascript
Views.renderToday = async (view) => {
  const [clients, lastAct] = await Promise.all([Store.listClients(), Store.listLastActivity()]);
  const lastByClient = Object.fromEntries(lastAct.map((r) => [r.client_id, r.last_activity]));
  const active = clients.filter((c) => c.status !== "Completed");
  const openish = (t) => t.status === "Open" || t.status === "In Progress";
  const todayIso = new Date().toISOString().slice(0, 10);
  const allTasks = clients.flatMap((c) => (c.tasks || []).map((t) => ({ ...t, _client: c })));

  const soon = active
    .filter((c) => { const d = daysUntil(c.tt_live_date); return d !== null && d >= 0 && d <= LIVE_SOON_DAYS; })
    .sort((a, b) => (a.tt_live_date || "").localeCompare(b.tt_live_date || ""));
  const overdue = allTasks
    .filter((t) => openish(t) && t.due_date && t.due_date < todayIso)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const unowned = allTasks.filter((t) => {
    const d = daysUntil(t._client.tt_live_date);
    return openish(t) && !t.assignee_id && d !== null && d >= 0 && d <= UNOWNED_WINDOW_DAYS;
  });
  const atRisk = active.filter((c) => c.rag === "R" || c.rag === "A");
  const auditGap = soon.filter((c) =>
    (c.tasks || []).some((t) => t.template?.phase === "audit" && openish(t)));
  const stale = active.filter((c) => {
    const last = lastByClient[c.id];
    return !last || (Date.now() - new Date(last).getTime()) / 86400000 >= STALE_DAYS;
  });

  const clientLink = (c) => `<a href="#client/${c.id}">${esc(c.dsp_name)}</a>`;
  const table = (head, rows) => `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  const section = (title, count, body) => count
    ? `<h2>${title} <span class="muted">(${count})</span></h2>${body}` : "";

  const soonRows = soon.map((c) => `<tr>
      <td>${clientLink(c)}</td><td><b>${countdownLabel(daysUntil(c.tt_live_date))}</b></td>
      <td>${fmtDate(c.tt_live_date)}</td><td>${esc(c.implementor?.name || "—")}</td>
      <td><span class="bar"><span style="width:${pct(c.tasks)}%"></span></span> ${pct(c.tasks)}%</td>
      <td><span class="rag rag-${c.rag || "none"}"></span> ${esc(c.status)}</td></tr>`).join("");
  const overdueRows = overdue.map((t) => `<tr>
      <td>${clientLink(t._client)}</td><td>${esc(t.title)}</td>
      <td>${esc(t.assignee?.name || "Unassigned")}</td><td>${fmtDate(t.due_date)}</td>
      <td>${t.status}</td></tr>`).join("");
  const unownedRows = unowned.map((t) => `<tr>
      <td>${clientLink(t._client)}</td><td>${esc(t.title)}</td>
      <td>${countdownLabel(daysUntil(t._client.tt_live_date))}</td></tr>`).join("");
  const riskRows = atRisk.map((c) => `<tr>
      <td>${clientLink(c)}</td><td><span class="rag rag-${c.rag}"></span> ${c.rag}</td>
      <td>${esc(c.status)}</td><td>${fmtDate(c.tt_live_date)}</td>
      <td>${esc(c.implementor?.name || "—")}</td></tr>`).join("");
  const gapRows = auditGap.map((c) => {
    const openAudit = (c.tasks || []).filter((t) => t.template?.phase === "audit" && openish(t));
    return `<tr><td>${clientLink(c)}</td>
      <td>${countdownLabel(daysUntil(c.tt_live_date))}</td>
      <td>${openAudit.map((t) => `<span class="chip">${esc(t.title)}</span>`).join(" ")}</td></tr>`;
  }).join("");
  const staleRows = stale.map((c) => {
    const last = lastByClient[c.id];
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    return `<tr><td>${clientLink(c)}</td>
      <td>${days === null ? "no activity yet" : days + " days quiet"}</td>
      <td>${esc(c.implementor?.name || "—")}</td><td>${esc(c.status)}</td></tr>`;
  }).join("");

  const total = soon.length + overdue.length + unowned.length + atRisk.length + auditGap.length + stale.length;
  view.innerHTML = `<div class="page-head"><h1>Today</h1>
      <span class="muted">${new Date().toDateString()}</span></div>` +
    (total === 0 ? `<p class="muted" style="font-size:15px">Nothing needs attention. 🎉</p>` : "") +
    section("Going live soon", soon.length,
      table(`<th>Client</th><th>Countdown</th><th>TT live</th><th>Implementor</th><th>Checklist</th><th>Status</th>`, soonRows)) +
    section("Overdue", overdue.length,
      table(`<th>Client</th><th>Task</th><th>Owner</th><th>Due</th><th>Status</th>`, overdueRows)) +
    section("Unowned work (go-live ≤ ${UNOWNED_WINDOW_DAYS}d)".replace("${UNOWNED_WINDOW_DAYS}", UNOWNED_WINDOW_DAYS), unowned.length,
      table(`<th>Client</th><th>Task</th><th>Go-live</th>`, unownedRows)) +
    section("At risk (RAG)", atRisk.length,
      table(`<th>Client</th><th>RAG</th><th>Status</th><th>TT live</th><th>Implementor</th>`, riskRows)) +
    section("Audit gaps before go-live", auditGap.length,
      table(`<th>Client</th><th>Countdown</th><th>Open audit items</th>`, gapRows)) +
    section("Gone quiet", stale.length,
      table(`<th>Client</th><th>Silence</th><th>Implementor</th><th>Status</th>`, staleRows));
};
```

**Note for implementer:** the `"Unowned work"` section-title line uses an awkward `.replace()` — write it instead as a plain template literal: `` `Unowned work (go-live ≤ ${UNOWNED_WINDOW_DAYS}d)` `` passed directly to `section(...)`.

- [ ] **Step 4: `site/styles.css`** — append:

```css
h2 { margin-top: 22px; }
.act-row { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.act-row:last-child { border-bottom: none; }
.act-row .when { color: var(--muted); margin-right: 8px; font-size: 12px; }
```

- [ ] **Step 5: Verify statically** — new Store methods exist and are exported; `renderToday` only uses fields present in the extended `listClients` select; route/nav wired; no direct supabase calls.

- [ ] **Step 6: Commit**

```bash
git add site/store.js site/app.js site/views-admin.js site/styles.css
git commit -m "feat(v2): Today attention dashboard — go-lives, overdue, unowned, risk, audit gaps, stale"
```

---

### Task V2-5: Client 360 — countdown, coverage, progress, activity timeline

**Files:**
- Modify: `site/views-admin.js` (`Views.renderClientDetail` only)

**Interfaces:**
- Consumes: `Store.getActivity(id)` (V2-4), `daysUntil`/`countdownLabel` (V2-4), existing `tasksFor`/`pct`.

- [ ] **Step 1:** In `Views.renderClientDetail`:

a) Change the data fetch to include activity:

```javascript
  const [c, users, activity] = await Promise.all([
    Store.getClient(id), Store.listUsers(), Store.getActivity(id),
  ]);
```

b) In the header, right after the `<h1>…</h1>` line inside `.page-head`, the back link stays; ADD directly AFTER the closing `</div>` of `.page-head` a chip strip:

```javascript
    <div style="margin:-6px 0 12px;display:flex;gap:8px;flex-wrap:wrap">
      ${(() => { const d = daysUntil(c.tt_live_date);
                 return d === null ? "" : `<span class="chip"><b>${countdownLabel(d)}</b></span>`; })()}
      ${(() => { const m = (c.notes || "").match(/coverage:\s*(\S+)/i);
                 return m ? `<span class="chip">Audit folder ${esc(m[1])}</span>` : ""; })()}
      <span class="chip">Onboarding ${pct(tasksFor("onboarding"))}%</span>
      <span class="chip">Audit ${pct(tasksFor("audit"))}%</span>
    </div>
```

(This block is part of the big template literal — place it right after the `.page-head` div closes.)

c) At the END of the template literal (after the ad-hoc form block), append the timeline:

```javascript
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Activity</h2>
      ${activity.length ? activity.map((a) => `<div class="act-row">
          <span class="when">${a.created_at.slice(0, 16).replace("T", " ")}</span>
          <b>${esc(a.actor?.name || "sync")}</b> ${esc(a.detail)}</div>`).join("")
        : `<p class="muted">No activity recorded yet.</p>`}
    </div>
```

- [ ] **Step 2: Verify statically** — `tasksFor` is defined before the template uses it (it is — it's declared above the `view.innerHTML` assignment); `activity` destructured; nothing else in the function changed.

- [ ] **Step 3: Commit**

```bash
git add site/views-admin.js
git commit -m "feat(v2): client 360 — countdown, coverage chip, phase progress, activity timeline"
```

---

## Human steps (batched at the end)

1. Run `scripts/migrations/2026-08-25-v2-sync-activity.sql` in the Supabase SQL editor.
2. Publish both sheet tabs: Google Sheets → File → Share → Publish to web → pick the tab → CSV → copy each link.
3. GitHub repo → Settings → Secrets and variables → Actions → add `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SHEET_ONBOARDING_CSV_URL`, `SHEET_AUDIT_CSV_URL`.
4. GitHub → Actions tab → run "sheet-sync" manually once; check the log's sync report.
5. QA: Today dashboard renders with real data; client page shows countdown + timeline; change a task in the app, edit the same client in the sheet, re-run sync → the app-touched task is NOT overwritten (report shows `tasks skipped (app)` > 0).

## Self-review notes

- Sync no longer sets `created_by`/notes author (service role) — unchanged from v1 behavior.
- The dashboard reads everything through 2 queries (listClients + listLastActivity) — no N+1.
- `daysUntil` uses local midnight on both sides — no timezone off-by-one for date-only strings.
- activity_log INSERT from triggers bypasses RLS via security definer; view uses security_invoker so RLS of activity_log applies to readers.
