"""Merges two jobs.db files into one, deduping by URL (the same uniqueness
rule the app itself enforces). Useful if you've ended up with two separate
jobs.db files tracking different captures — e.g. after loading the extension
from two different folder copies — and want one combined tracker.

Makes a timestamped backup of the primary file before writing to it, so this
is safe to re-run or undo.

Usage:
    python3 merge_db.py <primary.db> <secondary.db>

Rows from secondary.db are merged into primary.db. Rows whose url already
exists in primary.db are skipped (already tracked). primary.db is what you
should keep using afterward; secondary.db is left untouched.
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

# Kept in sync by hand with extension/dashboard.js's migrateSchema() — this
# script needs to understand the same additive columns to merge correctly
# across jobs.db files that were created at different points in time.
SCHEMA_COLUMNS = [
    'work_mode', 'employment_type', 'level', 'term', 'description',
    'status', 'tags', 'follow_up_date'
]

BASE_SCHEMA = """
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


def migrate(conn):
    conn.execute(BASE_SCHEMA)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(applications)")]
    if 'reviewed' not in cols:
        conn.execute('ALTER TABLE applications ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 1')
    for col in SCHEMA_COLUMNS:
        if col not in cols:
            conn.execute(f'ALTER TABLE applications ADD COLUMN {col} TEXT')
    conn.commit()


def main():
    if len(sys.argv) != 3:
        print('Usage: python3 merge_db.py <primary.db> <secondary.db>')
        print('Rows from secondary.db are merged into primary.db (deduped by URL).')
        sys.exit(1)

    primary_path, secondary_path = sys.argv[1], sys.argv[2]
    for path in (primary_path, secondary_path):
        if not os.path.isfile(path):
            print(f'File not found: {path}')
            sys.exit(1)

    backup_path = f'{primary_path}.bak-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
    shutil.copy2(primary_path, backup_path)
    print(f'Backed up {primary_path} -> {backup_path}')

    primary = sqlite3.connect(primary_path)
    secondary = sqlite3.connect(secondary_path)
    migrate(primary)
    migrate(secondary)

    cols = [row[1] for row in primary.execute("PRAGMA table_info(applications)") if row[1] != 'id']
    col_list = ', '.join(cols)
    placeholders = ', '.join('?' for _ in cols)

    rows = secondary.execute(f'SELECT {col_list} FROM applications').fetchall()

    added, skipped = 0, 0
    for row in rows:
        try:
            primary.execute(f'INSERT INTO applications ({col_list}) VALUES ({placeholders})', row)
            added += 1
        except sqlite3.IntegrityError:
            skipped += 1  # duplicate URL — already tracked

    primary.commit()
    primary.close()
    secondary.close()

    print(f'Merged {secondary_path} into {primary_path}')
    print(f'  {added} added, {skipped} skipped (already tracked)')
    print(f'  Backup saved at {backup_path} — delete it once you have confirmed the merge looks right')


if __name__ == '__main__':
    main()
