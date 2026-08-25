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
