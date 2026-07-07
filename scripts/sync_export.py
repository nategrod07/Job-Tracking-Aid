"""Imports a job-tracker-export-*.json file (downloaded from the extension
popup) into jobs.db, deduping on URL.

Usage:
    python3 sync_export.py                  # auto-finds newest export in ~/Downloads
    python3 sync_export.py /path/to/file.json
    python3 sync_export.py --list           # print recent rows in the database
    python3 sync_export.py --list 20        # print the 20 most recent rows
"""
import glob
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'jobs.db')

SCHEMA = """
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site TEXT NOT NULL,
    job_title TEXT,
    company TEXT,
    location TEXT,
    url TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL,
    extraction_method TEXT,
    notes TEXT DEFAULT '',
    imported_at TEXT NOT NULL
);
"""

def find_latest_export():
    downloads = os.path.expanduser('~/Downloads')
    candidates = sorted(
        glob.glob(os.path.join(downloads, 'job-tracker-export-*.json')),
        key=os.path.getmtime,
        reverse=True,
    )
    return candidates[0] if candidates else None

def import_file(path):
    with open(path) as f:
        entries = json.load(f)

    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)

    added, skipped = 0, 0
    now = datetime.now(timezone.utc).isoformat()
    for e in entries:
        try:
            conn.execute(
                """INSERT INTO applications
                   (site, job_title, company, location, url, applied_at, extraction_method, notes, imported_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    e.get('site'),
                    e.get('job_title'),
                    e.get('company'),
                    e.get('location'),
                    e.get('url'),
                    e.get('applied_at'),
                    e.get('extraction_method'),
                    e.get('notes', ''),
                    now,
                ),
            )
            added += 1
        except sqlite3.IntegrityError:
            skipped += 1  # duplicate URL, already tracked

    conn.commit()
    conn.close()
    print(f'Imported {path}')
    print(f'  {added} added, {skipped} skipped (already in database)')

def list_recent(limit=10):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    rows = conn.execute(
        """SELECT site, job_title, company, location, applied_at, url
           FROM applications ORDER BY applied_at DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()

    if not rows:
        print('No applications in the database yet.')
        return

    for site, title, company, location, applied_at, url in rows:
        print(f'[{site}] {title or "(no title)"} — {company or "?"} ({location or "?"})')
        print(f'    applied {applied_at}')
        print(f'    {url}')

def main():
    args = sys.argv[1:]

    if args and args[0] == '--list':
        limit = int(args[1]) if len(args) > 1 else 10
        list_recent(limit)
        return

    path = args[0] if args else find_latest_export()
    if not path:
        print('No export file found in ~/Downloads and none provided.')
        print('Usage: python3 sync_export.py [path/to/export.json]')
        sys.exit(1)

    import_file(path)

if __name__ == '__main__':
    main()
