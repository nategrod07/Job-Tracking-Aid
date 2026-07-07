"""Creates jobs.db (SQLite) in the project root with the applications table.
Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
"""
import os
import sqlite3

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

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    conn.commit()
    conn.close()
    print(f'Database ready at {os.path.abspath(DB_PATH)}')

if __name__ == '__main__':
    main()
