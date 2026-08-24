import unittest
from datetime import date
from import_lib import parse_date, parse_status_cell, parse_audit_cell, include_client


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

    def test_na_with_detail_keeps_note(self):
        status, done, note = parse_status_cell("N/A - see Sanya note")
        self.assertEqual(status, "N/A")
        self.assertIsNone(done)
        self.assertEqual(note, "N/A - see Sanya note")

    def test_not_applicable_with_detail_keeps_note(self):
        status, done, note = parse_status_cell("Not applicable for this client")
        self.assertEqual(status, "N/A")
        self.assertEqual(note, "Not applicable for this client")

    def test_name_pending_is_not_na(self):
        status, done, note = parse_status_cell("name pending")
        self.assertEqual(status, "Open")
        self.assertIsNone(done)
        self.assertEqual(note, "name pending")

    def test_free_text_preserved_as_note(self):
        status, done, note = parse_status_cell("https://jira.uzio.com/browse/PHIX-96116")
        self.assertEqual(status, "Open")
        self.assertEqual(note, "https://jira.uzio.com/browse/PHIX-96116")


class TestParseAuditCell(unittest.TestCase):
    def test_present_is_done(self):
        self.assertEqual(parse_audit_cell("Present"), ("Done", None, None))

    def test_missing_is_open(self):
        self.assertEqual(parse_audit_cell("Missing"), ("Open", None, None))

    def test_case_insensitive(self):
        self.assertEqual(parse_audit_cell("present")[0], "Done")
        self.assertEqual(parse_audit_cell("MISSING")[0], "Open")

    def test_present_with_detail_keeps_note(self):
        status, done, note = parse_audit_cell("Present (2 files)")
        self.assertEqual(status, "Done")
        self.assertEqual(note, "Present (2 files)")

    def test_blank_is_open(self):
        self.assertEqual(parse_audit_cell(""), ("Open", None, None))

    def test_fallback_to_status_cell(self):
        status, done, note = parse_audit_cell("Completed -2/26 (Sanya)")
        self.assertEqual(status, "Done")
        self.assertEqual(done, date(2026, 2, 26))


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
