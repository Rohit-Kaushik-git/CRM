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
