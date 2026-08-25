# DSP CRM v2.1 — Checklist & UX Overhaul

**Date:** 2026-08-25 · **Status:** Approved (Rohit) · **Builds on:** v2 spec.

## 1. New checklist (replaces the 12-item onboarding list; audit 6 unchanged)

| # | Onboarding task | Owner team |
|---|---|---|
| 1 | Company Setup | Implementor |
| 2 | Census Transfer | Implementor |
| 3 | Time Tracking Setup (Kiosk/Mobile/Web) | Implementor |
| 4 | Payment Method Transfer | Implementor |
| 5 | Federal/State Withholding | Data Team |
| 6 | Prior Pay Info Transfer & Approval | Data Team |
| 7 | Worker's Compensation | Data Team |
| 8 | Historical Data Download | Implementor |
| 9 | Tax Review | Tax Team |
| 10 | PTO Balance Move | Shruti |
| 11 | Document Transfer | Data Team |

Audit tab owner teams: Census/Payment/Emergency Contact Audit → Implementor;
Withholding/Prior Payroll/Deduction Audit → Data Team.

**Ownership model:** no per-task assignees. A task is owned by its template's
`owner_team`. Implementor-owned tasks belong to the client's implementor. Team
membership is config (`app_config`): `team_data_team` = shobhit.sharma@uzio.com
(Rohit later), `team_tax_team` (Rachael, Stefanie when they sign up), `team_pto`
(Shruti). "My Open Items" = implementor-owned open tasks on my clients + all open
tasks of any team my email belongs to. Admin Open Items groups by implementor and
by team. Retired task types: their tasks/notes are dropped (sheet-fed statuses
re-sync; the loss was accepted).

## 2. Vendor semantics → "Previous System" (ADP | Paycom | New)

- `clients.vendor` check gains 'New'; UI label becomes "Previous System".
- **New (non-migrating) clients:** all tasks auto-N/A except Company Setup and
  Time Tracking Setup; the Audit tab is hidden. Enforced at seed time and by a
  vendor-change trigger (flip to ADP/Paycom reopens untouched N/A tasks; flip to
  New re-N/As untouched Open tasks — `app_touched` tasks are never auto-changed).

## 3. UX

- **Client checklist grid:** Task + owner-team tag + color-coded status pill
  (Done green / In Progress amber / Open gray / N-A muted) + notes. No assignee,
  no due-date columns. Ad-hoc tasks keep an optional due date.
- **New Client:** centered modal — DSP Name, Short Code, Previous System
  (ADP/Paycom/New), TT Live Date, Payroll Live Date.
- **Clients list:** search (name/code), filters (status, previous system, RAG),
  colored status pills, consistent module chip order.
- **Today:** Unowned work = one merged row per client (client, countdown, open
  count) and now means "no implementor set". Overdue = ad-hoc tasks only (they
  alone carry due dates).
- Overdue dates render red throughout.

## 4. Sync changes

- Onboarding column map targets the new names (8 columns map; Data Transfer ×2,
  Delta Data Upload, Audit Client Data, Final Payroll Review are dropped).
- Blank sheet cells are skipped entirely (never force a task back to Open —
  preserves auto-N/A).
- previous_system containing "new" → vendor 'New'.
- Audit-file sheet continues to feed the 6 audit tasks + coverage chip.
