// Dashboard: a spreadsheet-like view of jobs.db that reads and writes the
// file directly on disk via the File System Access API, using sql.js
// (SQLite compiled to WebAssembly) to run real SQL against it in-memory.
// No server, no terminal — this tab IS the app.
//
// New captures land with reviewed = 0 and show up in the "Needs review"
// panel until you confirm or discard them. Confirmed rows (reviewed = 1)
// are the actual tracker table below.

const BASE_SCHEMA = `
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
`;

let SQL = null;
let db = null;
let fileHandle = null;
let rows = [];
let sortKey = 'applied_at';
let sortDir = 'desc';

const statusEl = document.getElementById('status');
const connectPanel = document.getElementById('connectPanel');
const appPanel = document.getElementById('appPanel');
const tableBody = document.getElementById('tableBody');
const emptyState = document.getElementById('emptyState');
const rowCountEl = document.getElementById('rowCount');
const searchInput = document.getElementById('searchInput');
const reviewPanel = document.getElementById('reviewPanel');
const reviewList = document.getElementById('reviewList');
const reviewCountEl = document.getElementById('reviewCount');
const themeToggle = document.getElementById('themeToggle');

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
  localStorage.setItem('theme', theme);
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ---------- IndexedDB: remember the file handle across sessions ----------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('job-tracker', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Status helpers ----------

function setStatus(text, color) {
  statusEl.innerHTML = `<span class="dot" style="background:${color || 'var(--good)'}"></span>${text}`;
}

// ---------- Connecting to jobs.db ----------

async function connectExisting() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'SQLite database', accept: { 'application/octet-stream': ['.db'] } }],
    excludeAcceptAllOption: false
  });
  fileHandle = handle;
  await idbSet('dbHandle', handle);
  await loadFromHandle();
}

async function createNew() {
  const handle = await window.showSaveFilePicker({
    suggestedName: 'jobs.db',
    types: [{ description: 'SQLite database', accept: { 'application/octet-stream': ['.db'] } }]
  });
  fileHandle = handle;
  await idbSet('dbHandle', handle);
  db = new SQL.Database();
  migrateSchema();
  await persist();
  await loadFromHandle();
}

async function tryReconnect() {
  const handle = await idbGet('dbHandle');
  if (!handle) return false;

  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission === 'granted') {
    fileHandle = handle;
    await loadFromHandle();
    return true;
  }

  // Needs a user gesture to (re)request permission — show a reconnect button.
  connectPanel.innerHTML = `
    <p>Reconnect to <strong>${handle.name}</strong> to continue.</p>
    <button id="reconnectBtn" class="primary">Reconnect to jobs.db</button>
  `;
  document.getElementById('reconnectBtn').addEventListener('click', async () => {
    const granted = await handle.requestPermission({ mode: 'readwrite' });
    if (granted === 'granted') {
      fileHandle = handle;
      await loadFromHandle();
    }
  });
  return true; // handled (shown reconnect UI), just not auto-loaded
}

async function loadFromHandle() {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  if (buffer.byteLength === 0) {
    db = new SQL.Database();
  } else {
    db = new SQL.Database(new Uint8Array(buffer));
  }
  migrateSchema();

  connectPanel.style.display = 'none';
  appPanel.style.display = 'block';
  setStatus(`Connected to ${fileHandle.name}`);

  await mergePending();
  refreshRows();
}

// Creates the table if missing, and adds any columns that don't exist yet
// to pre-existing databases (from before that feature existed). `reviewed`
// defaults existing rows to 1 (already confirmed, no need to re-review old
// history); the auto-tag columns just default to NULL for old rows since
// there's nothing to backfill them from.
function migrateSchema() {
  db.run(BASE_SCHEMA);
  const info = db.exec("PRAGMA table_info(applications)");
  const cols = info.length ? info[0].values.map((v) => v[1]) : [];

  if (!cols.includes('reviewed')) {
    db.run('ALTER TABLE applications ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 1');
  }
  for (const col of ['work_mode', 'employment_type', 'level', 'term']) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE applications ADD COLUMN ${col} TEXT`);
    }
  }
}

async function persist() {
  const data = db.export();
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

// ---------- Merging captures from the extension's local storage ----------

function getPending() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ pending: [] }, (data) => resolve(data.pending));
  });
}

async function mergePending() {
  const pending = await getPending();
  if (pending.length === 0) return;

  let added = 0;
  const now = new Date().toISOString();
  for (const e of pending) {
    try {
      db.run(
        `INSERT INTO applications
         (site, job_title, company, location, url, applied_at, extraction_method, notes, imported_at,
          work_mode, employment_type, level, term, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          e.site, e.job_title, e.company, e.location, e.url, e.applied_at, e.extraction_method, e.notes || '', now,
          e.work_mode || null, e.employment_type || null, e.level || null, e.term || null
        ]
      );
      added++;
    } catch (err) {
      // duplicate URL — already tracked, skip
    }
  }

  chrome.storage.local.set({ pending: [] });
  chrome.action.setBadgeText({ text: '' });

  if (added > 0) {
    await persist();
    setStatus(`Synced ${added} new capture${added === 1 ? '' : 's'} — waiting for review — ${new Date().toLocaleTimeString()}`);
  }
}

// React live if a capture comes in while this tab is open, even in the background.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.pending || !db) return;
  mergePending().then(refreshRows);
});

// ---------- Rendering ----------

function refreshRows() {
  const result = db.exec('SELECT * FROM applications');
  if (result.length === 0) {
    rows = [];
  } else {
    const cols = result[0].columns;
    rows = result[0].values.map((v) => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
  }
  render();
}

function render() {
  renderReview();
  renderTable();
}

function renderReview() {
  const toReview = rows.filter((r) => !r.reviewed).sort((a, b) => b.applied_at.localeCompare(a.applied_at));
  reviewCountEl.textContent = toReview.length;
  reviewPanel.style.display = toReview.length ? 'block' : 'none';

  reviewList.innerHTML = '';
  for (const r of toReview) {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.dataset.id = r.id;
    card.innerHTML = `
      <div class="site-tag">${r.site}</div>
      <div class="fields">
        <input type="text" data-field="job_title" value="${escapeAttr(r.job_title)}" placeholder="Job title" />
        <input type="text" data-field="company" value="${escapeAttr(r.company)}" placeholder="Company" />
        <input type="text" data-field="location" value="${escapeAttr(r.location)}" placeholder="Location" />
        <input type="text" data-field="work_mode" value="${escapeAttr(r.work_mode)}" placeholder="Remote / Hybrid / On-site" />
        <input type="text" data-field="employment_type" value="${escapeAttr(r.employment_type)}" placeholder="Full-time / Part-time / Internship" />
        <input type="text" data-field="level" value="${escapeAttr(r.level)}" placeholder="Intern / New Grad / Entry Level" />
        <input type="text" data-field="term" value="${escapeAttr(r.term)}" placeholder="Fall 2026, etc." />
        <a href="${r.url}" target="_blank" style="grid-column: 1 / -1;">${escapeHtml(r.url)}</a>
      </div>
      <div class="review-actions">
        <button class="good" data-action="confirm">✓ Applied</button>
        <button class="danger" data-action="discard">✗ Not this</button>
      </div>
    `;
    reviewList.appendChild(card);
  }
}

reviewList.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const card = e.target.closest('.review-card');
  const id = card.dataset.id;

  if (action === 'discard') {
    db.run('DELETE FROM applications WHERE id = ?', [id]);
  } else if (action === 'confirm') {
    const field = (name) => card.querySelector(`[data-field="${name}"]`).value;
    db.run(
      `UPDATE applications SET job_title = ?, company = ?, location = ?,
       work_mode = ?, employment_type = ?, level = ?, term = ?, reviewed = 1 WHERE id = ?`,
      [field('job_title'), field('company'), field('location'),
       field('work_mode'), field('employment_type'), field('level'), field('term'), id]
    );
  }
  await persist();
  refreshRows();
});

function renderTable() {
  const confirmed = rows.filter((r) => r.reviewed);
  const q = searchInput.value.trim().toLowerCase();
  let visible = confirmed;
  if (q) {
    visible = confirmed.filter((r) =>
      [r.job_title, r.company, r.location, r.site].some((f) => (f || '').toLowerCase().includes(q))
    );
  }

  visible = [...visible].sort((a, b) => {
    const av = (a[sortKey] ?? '').toString();
    const bv = (b[sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  rowCountEl.textContent = `${visible.length} of ${confirmed.length} application${confirmed.length === 1 ? '' : 's'}`;
  emptyState.style.display = confirmed.length === 0 ? 'block' : 'none';

  tableBody.innerHTML = '';
  for (const r of visible) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    tr.innerHTML = `
      <td>${new Date(r.applied_at).toLocaleDateString()}</td>
      <td class="site">${r.site}</td>
      <td contenteditable="true" data-field="job_title">${escapeHtml(r.job_title)}</td>
      <td contenteditable="true" data-field="company">${escapeHtml(r.company)}</td>
      <td contenteditable="true" data-field="location">${escapeHtml(r.location)}</td>
      <td contenteditable="true" data-field="work_mode">${escapeHtml(r.work_mode)}</td>
      <td contenteditable="true" data-field="employment_type">${escapeHtml(r.employment_type)}</td>
      <td contenteditable="true" data-field="level">${escapeHtml(r.level)}</td>
      <td contenteditable="true" data-field="term">${escapeHtml(r.term)}</td>
      <td class="url"><a href="${r.url}" target="_blank" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td>
      <td contenteditable="true" data-field="notes">${escapeHtml(r.notes)}</td>
      <td class="actions"><button data-action="delete">delete</button></td>
    `;
    tableBody.appendChild(tr);
  }
}

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(v) {
  return escapeHtml(v);
}

// ---------- Editing (confirmed table) ----------

tableBody.addEventListener('blur', async (e) => {
  const td = e.target.closest('td[contenteditable]');
  if (!td) return;
  const tr = td.closest('tr');
  const id = tr.dataset.id;
  const field = td.dataset.field;
  const value = td.textContent;

  db.run(`UPDATE applications SET ${field} = ? WHERE id = ?`, [value, id]);
  await persist();
  refreshRows();
}, true);

tableBody.addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete') return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  if (!confirm('Remove this row?')) return;
  db.run('DELETE FROM applications WHERE id = ?', [id]);
  await persist();
  refreshRows();
});

document.querySelectorAll('thead th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    sortDir = sortKey === key && sortDir === 'desc' ? 'asc' : 'desc';
    sortKey = key;
    renderTable();
  });
});

document.getElementById('addRowBtn').addEventListener('click', async () => {
  const now = new Date().toISOString();
  const placeholderUrl = `manual:${Date.now()}`;
  db.run(
    `INSERT INTO applications (site, job_title, company, location, url, applied_at, extraction_method, notes, imported_at, reviewed)
     VALUES ('manual', 'New application', '', '', ?, ?, 'manual', '', ?, 1)`,
    [placeholderUrl, now, now]
  );
  await persist();
  refreshRows();
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  await mergePending();
  refreshRows();
});

searchInput.addEventListener('input', renderTable);

// ---------- Boot ----------

document.getElementById('openExistingBtn').addEventListener('click', () => connectExisting().catch(console.error));
document.getElementById('createNewBtn').addEventListener('click', () => createNew().catch(console.error));

async function boot() {
  SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
  const handled = await tryReconnect();
  if (!handled) {
    setStatus('Not connected', '#999');
  }
}

boot();
