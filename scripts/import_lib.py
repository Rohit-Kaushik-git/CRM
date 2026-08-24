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
