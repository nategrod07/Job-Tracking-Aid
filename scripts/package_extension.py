"""Zips the extension/ folder into a versioned zip for easy sharing — turns
"send the whole project folder" into "send this one file". The version comes
from extension/manifest.json, so it's always in sync.

Usage:
    python3 package_extension.py
"""
import json
import os
import zipfile

ROOT = os.path.join(os.path.dirname(__file__), '..')
EXTENSION_DIR = os.path.join(ROOT, 'extension')
MANIFEST_PATH = os.path.join(EXTENSION_DIR, 'manifest.json')

# OS cruft and dev-only files that shouldn't ship.
EXCLUDE_NAMES = {'.DS_Store'}
EXCLUDE_PREFIXES = ('_',)  # e.g. throwaway _preview.html test harnesses


def main():
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)
    version = manifest['version']

    folder_name = f'job-tracker-extension-v{version}'
    output_path = os.path.join(ROOT, f'{folder_name}.zip')

    file_count = 0
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirnames, filenames in os.walk(EXTENSION_DIR):
            for filename in filenames:
                if filename in EXCLUDE_NAMES or filename.startswith(EXCLUDE_PREFIXES):
                    continue
                file_path = os.path.join(dirpath, filename)
                arcname = os.path.join(folder_name, os.path.relpath(file_path, EXTENSION_DIR))
                zf.write(file_path, arcname)
                file_count += 1

    print(f'Packaged {file_count} files into {os.path.basename(output_path)}')
    print(f'  {os.path.abspath(output_path)}')
    print()
    print('Share this zip. Recipients:')
    print('  1. Unzip it')
    print('  2. chrome://extensions -> enable Developer mode -> Load unpacked')
    print(f'  3. Select the extracted "{folder_name}" folder')


if __name__ == '__main__':
    main()
