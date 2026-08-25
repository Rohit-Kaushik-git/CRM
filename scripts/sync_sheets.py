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
    "Federal/State Withholding/payment": "Federal/State Withholding",
    "Time Tracking Setup Kiosk/Mobile/Web Enablement": "Time Tracking Setup (Kiosk/Mobile/Web)",
    "Prior Pay Info Transfer and Approved": "Prior Pay Info Transfer & Approval",
    "Historical Data": "Historical Data Download",
    "Tax Review (Post Prior Upload)": "Tax Review",
    "PTO Balance Move": "PTO Balance Move",
    "Document Transfer": "Document Transfer",
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
            "vendor": ("ADP" if "adp" in prev_system
                       else "Paycom" if "paycom" in prev_system
                       else "New" if "new" in prev_system else None),
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
                if not cell:
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
