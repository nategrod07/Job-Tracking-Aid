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

const STATUS_VALUES = ['Applied', 'Interviewing', 'Offer', 'Rejected', 'Ghosted'];
const TERMINAL_STATUSES = new Set(['Offer', 'Rejected']);

// A follow-up is "due" once its date has passed and the application isn't
// already resolved (Offer/Rejected) — no point nudging about a closed loop.
function isFollowUpDue(row) {
  if (!row.follow_up_date || TERMINAL_STATUSES.has(row.status)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.follow_up_date + 'T00:00:00');
  return !isNaN(due) && due <= today;
}

let SQL = null;
let db = null;
let fileHandle = null;
let rows = [];
let sortKey = 'applied_at';
let sortDir = 'desc';

const statusEl = document.getElementById('status');
const connectPanel = document.getElementById('connectPanel');
const appPanel = document.getElementById('appPanel');
const kpiRow = document.getElementById('kpiRow');
const kpiTotal = document.getElementById('kpiTotal');
const kpiWeek = document.getElementById('kpiWeek');
const kpiTopSite = document.getElementById('kpiTopSite');
const kpiFollowUp = document.getElementById('kpiFollowUp');
const filterStatus = document.getElementById('filterStatus');
const filterSite = document.getElementById('filterSite');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const applicationsView = document.getElementById('applicationsView');
const statsView = document.getElementById('statsView');
const weeklyChart = document.getElementById('weeklyChart');
const statusDonut = document.getElementById('statusDonut');
const siteBars = document.getElementById('siteBars');
const workModeBars = document.getElementById('workModeBars');
const skillGapPanel = document.getElementById('skillGapPanel');
const tableBody = document.getElementById('tableBody');
const emptyState = document.getElementById('emptyState');
const rowCountEl = document.getElementById('rowCount');
const searchInput = document.getElementById('searchInput');
const reviewPanel = document.getElementById('reviewPanel');
const reviewList = document.getElementById('reviewList');
const reviewCountEl = document.getElementById('reviewCount');
const themeToggle = document.getElementById('themeToggle');

const toastContainer = document.getElementById('toastContainer');
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmBody = document.getElementById('confirmBody');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn = document.getElementById('confirmOkBtn');

const resumeBtn = document.getElementById('resumeBtn');
const resumeModal = document.getElementById('resumeModal');
const resumeFileInput = document.getElementById('resumeFileInput');
const resumeTextArea = document.getElementById('resumeTextArea');
const resumeSaveBtn = document.getElementById('resumeSaveBtn');
const resumeCloseBtn = document.getElementById('resumeCloseBtn');

const toolsModal = document.getElementById('toolsModal');
const toolsTitle = document.getElementById('toolsTitle');
const toolsSubtitle = document.getElementById('toolsSubtitle');
const toolsNoResume = document.getElementById('toolsNoResume');
const toolsNoDescription = document.getElementById('toolsNoDescription');
const toolsOpenResumeBtn = document.getElementById('toolsOpenResumeBtn');
const experienceInfo = document.getElementById('experienceInfo');
const kwColumns = document.getElementById('kwColumns');
const kwPresent = document.getElementById('kwPresent');
const kwMissing = document.getElementById('kwMissing');
const toneSelect = document.getElementById('toneSelect');
const coverLetterArea = document.getElementById('coverLetterArea');
const coverLetterCopyBtn = document.getElementById('coverLetterCopyBtn');
const toolsCloseBtn = document.getElementById('toolsCloseBtn');

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

// ---------- Toasts + confirm dialog (replace native alert()/confirm()) ----------

function notify(kind, message, timeout = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="dot"></span><span class="toast-message"></span>`;
  el.querySelector('.toast-message').textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

let confirmResolve = null;

function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm' } = {}) {
  confirmTitle.textContent = title;
  confirmBody.textContent = message;
  confirmOkBtn.textContent = okLabel;
  confirmModal.classList.add('open');
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function closeConfirmDialog(result) {
  confirmModal.classList.remove('open');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

confirmCancelBtn.addEventListener('click', () => closeConfirmDialog(false));
confirmOkBtn.addEventListener('click', () => closeConfirmDialog(true));

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
  kpiRow.style.display = 'flex';
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
  const isNewColumn = {};
  for (const col of ['work_mode', 'employment_type', 'level', 'term', 'description', 'status', 'tags', 'follow_up_date']) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE applications ADD COLUMN ${col} TEXT`);
      isNewColumn[col] = true;
    }
  }
  // Backfill confirmed rows so pre-existing data isn't stuck with a blank status
  // pill — everything already tracked was, at minimum, applied to.
  if (isNewColumn.status) {
    db.run("UPDATE applications SET status = 'Applied' WHERE reviewed = 1 AND (status IS NULL OR status = '')");
  }
}

async function persist() {
  const data = db.export();
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (err) {
    console.error('Failed to write jobs.db:', err);
    setStatus('Could not save to jobs.db — your last change may not be on disk', 'var(--bad)');
    notify('error', 'Could not save to jobs.db — your last change may not be on disk.');
    throw err;
  }
}

// ---------- Merging captures from the extension's local storage ----------

function getPending() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ pending: [] }, (data) => resolve(data.pending));
  });
}

// A real INSERT failure (schema mismatch, malformed data, sql.js error) should
// never disappear silently — only a UNIQUE-constraint hit on the url column is
// an expected, safe-to-ignore outcome (the capture is already tracked).
function isDuplicateUrlError(err) {
  const msg = typeof err?.message === 'string' ? err.message : '';
  return /UNIQUE constraint failed/i.test(msg) && /\burl\b/i.test(msg);
}

async function mergePending() {
  const pending = await getPending();
  if (pending.length === 0) return;

  let added = 0;
  let failed = 0;
  const now = new Date().toISOString();
  for (const e of pending) {
    try {
      db.run(
        `INSERT INTO applications
         (site, job_title, company, location, url, applied_at, extraction_method, notes, imported_at,
          work_mode, employment_type, level, term, description, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          e.site, e.job_title, e.company, e.location, e.url, e.applied_at, e.extraction_method, e.notes || '', now,
          e.work_mode || null, e.employment_type || null, e.level || null, e.term || null, e.description || null
        ]
      );
      added++;
    } catch (err) {
      if (isDuplicateUrlError(err)) {
        // duplicate URL — already tracked, skip silently
      } else {
        failed++;
        console.error('Failed to import a captured application:', err, e);
      }
    }
  }

  chrome.storage.local.set({ pending: [] });
  chrome.action.setBadgeText({ text: '' });

  if (added > 0) {
    await persist();
  }
  if (added > 0 || failed > 0) {
    const parts = [];
    if (added > 0) parts.push(`Synced ${added} new capture${added === 1 ? '' : 's'} — waiting for review`);
    if (failed > 0) parts.push(`${failed} failed to import — see console`);
    setStatus(`${parts.join(' · ')} — ${new Date().toLocaleTimeString()}`, failed > 0 ? 'var(--bad)' : undefined);
    if (failed > 0) notify('error', `${failed} capture${failed === 1 ? '' : 's'} failed to import — see console for details.`);
    else if (added > 0) notify('success', `Synced ${added} new capture${added === 1 ? '' : 's'} — waiting for review.`);
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
  const confirmed = rows.filter((r) => r.reviewed);
  renderKpis(confirmed);
  refreshSiteFilterOptions(confirmed);
  renderReview();
  renderTable();
  if (currentView === 'stats') renderStats(confirmed);
}

// ---------- View tabs (Applications / Stats) ----------

let currentView = 'applications';

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  applicationsView.style.display = view === 'applications' ? 'block' : 'none';
  statsView.style.display = view === 'stats' ? 'block' : 'none';
  if (view === 'stats') renderStats(rows.filter((r) => r.reviewed));
}

document.querySelectorAll('.view-tab').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

// ---------- KPIs + Stats tab (all computed client-side from `rows`) ----------

function renderKpis(confirmed) {
  kpiTotal.textContent = confirmed.length;

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = confirmed.filter((r) => {
    const t = new Date(r.applied_at).getTime();
    return !isNaN(t) && t >= weekAgo;
  }).length;
  kpiWeek.textContent = thisWeek;

  const siteCounts = {};
  for (const r of confirmed) siteCounts[r.site] = (siteCounts[r.site] || 0) + 1;
  const topSite = Object.entries(siteCounts).sort((a, b) => b[1] - a[1])[0];
  kpiTopSite.textContent = topSite ? topSite[0] : '—';

  kpiFollowUp.textContent = confirmed.filter(isFollowUpDue).length;
}

function renderStats(confirmed) {
  renderWeeklyChart(confirmed);
  renderStatusDonut(confirmed);
  renderBreakdownBars(siteBars, confirmed, 'site');
  renderBreakdownBars(workModeBars, confirmed, 'work_mode');
  renderSkillGapPanel(confirmed);
}

// Aggregates matchKeywords()'s "missing" list across every application with
// a captured description, so a skill that keeps showing up as a gap across
// many different postings — not just one — surfaces as worth actually
// building, not just noting once and forgetting.
function renderSkillGapPanel(confirmed) {
  const resumeText = getResumeText();
  const withDescriptions = confirmed.filter((r) => r.description);

  if (!resumeText) {
    skillGapPanel.innerHTML = '<div class="chart-empty">Add your resume (📄 Resume, above) to see skill gaps across all your applications.</div>';
    return;
  }
  if (withDescriptions.length === 0) {
    skillGapPanel.innerHTML = '<div class="chart-empty">No captured job descriptions yet.</div>';
    return;
  }

  const counts = {};
  for (const r of withDescriptions) {
    const match = matchKeywords(r.description, resumeText);
    for (const m of match.missing) {
      counts[m.keyword] = (counts[m.keyword] || 0) + 1;
    }
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) {
    skillGapPanel.innerHTML = '<div class="chart-empty">No recurring gaps across your applications — nice work.</div>';
    return;
  }

  const max = Math.max(1, ...entries.map(([, c]) => c));
  const countLabel = `Across ${withDescriptions.length} application${withDescriptions.length === 1 ? '' : 's'} with a captured description`;
  skillGapPanel.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">${escapeHtml(countLabel)}</div>
    ${entries.map(([label, count]) => `
      <div class="bar-row">
        <div class="bar-row-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="bar-row-track"><div class="bar-row-fill" style="width:${(count / max) * 100}%"></div></div>
        <div class="bar-row-value">${count}</div>
      </div>
    `).join('')}
  `;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function computeWeeklyBuckets(confirmed, weeks) {
  const now = new Date();
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = startOfWeek(new Date(now.getTime() - i * 7 * 86400000));
    buckets.push({ start, count: 0 });
  }
  for (const r of confirmed) {
    const d = new Date(r.applied_at);
    if (isNaN(d)) continue;
    const weekStart = startOfWeek(d).getTime();
    const bucket = buckets.find((b) => b.start.getTime() === weekStart);
    if (bucket) bucket.count++;
  }
  return buckets;
}

function renderWeeklyChart(confirmed) {
  const buckets = computeWeeklyBuckets(confirmed, 10);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const chartHeight = 100;
  const colWidth = 100 / buckets.length;
  const barWidth = colWidth * 0.7;

  const bars = buckets.map((b, i) => {
    const barHeight = Math.max((b.count / max) * 70, b.count ? 3 : 1.5);
    const x = i * colWidth + (colWidth - barWidth) / 2;
    const y = chartHeight - barHeight - 14;
    const dateLabel = `${b.start.getMonth() + 1}/${b.start.getDate()}`;
    return `<rect class="weekly-chart-bar${b.count ? '' : ' empty'}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="1.5"><title>Week of ${dateLabel}: ${b.count}</title></rect>`;
  }).join('');

  const firstLabel = buckets.length ? `${buckets[0].start.getMonth() + 1}/${buckets[0].start.getDate()}` : '';
  const lastLabel = buckets.length ? `${buckets[buckets.length - 1].start.getMonth() + 1}/${buckets[buckets.length - 1].start.getDate()}` : '';

  weeklyChart.innerHTML = `
    <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none" style="width:100%;height:140px;">${bars}</svg>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px;">
      <span>${firstLabel}</span><span>${lastLabel}</span>
    </div>
  `;
}

function renderStatusDonut(confirmed) {
  const counts = {};
  for (const status of STATUS_VALUES) counts[status] = 0;
  for (const r of confirmed) {
    const status = STATUS_VALUES.includes(r.status) ? r.status : 'Applied';
    counts[status]++;
  }
  const total = confirmed.length;
  if (total === 0) {
    statusDonut.innerHTML = '<div class="chart-empty">No data yet</div>';
    return;
  }

  let cumulative = 0;
  const stops = [];
  const legend = [];
  for (const status of STATUS_VALUES) {
    const count = counts[status];
    if (count === 0) continue;
    const pct = (count / total) * 100;
    const varName = `--status-${status.toLowerCase()}`;
    stops.push(`var(${varName}) ${cumulative.toFixed(2)}% ${(cumulative + pct).toFixed(2)}%`);
    legend.push(`<div class="donut-legend-item"><span class="donut-dot" style="background:var(${varName})"></span>${status} (${count})</div>`);
    cumulative += pct;
  }

  statusDonut.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background: conic-gradient(${stops.join(', ')});"></div>
      <div class="donut-legend">${legend.join('')}</div>
    </div>
  `;
}

function renderBreakdownBars(container, confirmed, field) {
  const counts = {};
  for (const r of confirmed) {
    const key = r[field] || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    container.innerHTML = '<div class="chart-empty">No data yet</div>';
    return;
  }
  const max = Math.max(1, ...entries.map(([, c]) => c));
  container.innerHTML = entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-row-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div class="bar-row-track"><div class="bar-row-fill" style="width:${(count / max) * 100}%"></div></div>
      <div class="bar-row-value">${count}</div>
    </div>
  `).join('');
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
       work_mode = ?, employment_type = ?, level = ?, term = ?, reviewed = 1, status = 'Applied' WHERE id = ?`,
      [field('job_title'), field('company'), field('location'),
       field('work_mode'), field('employment_type'), field('level'), field('term'), id]
    );
  }
  await persist();
  refreshRows();
});

// Shared by renderTable() (what's on screen) and CSV export (what gets
// downloaded) so the two can never drift out of sync with each other.
function getVisibleRows() {
  const confirmed = rows.filter((r) => r.reviewed);
  const q = searchInput.value.trim().toLowerCase();
  const statusFilter = filterStatus.value;
  const siteFilter = filterSite.value;

  let visible = confirmed;
  if (q) {
    visible = visible.filter((r) =>
      [r.job_title, r.company, r.location, r.site, r.tags].some((f) => (f || '').toLowerCase().includes(q))
    );
  }
  if (statusFilter) visible = visible.filter((r) => (r.status || 'Applied') === statusFilter);
  if (siteFilter) visible = visible.filter((r) => r.site === siteFilter);

  return [...visible].sort((a, b) => {
    const av = (a[sortKey] ?? '').toString();
    const bv = (b[sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function renderTable() {
  const confirmed = rows.filter((r) => r.reviewed);
  const visible = getVisibleRows();

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
      <td class="status-cell" data-status="${escapeAttr(r.status || 'Applied')}">
        <select class="status-select" data-field="status">
          ${STATUS_VALUES.map((v) => `<option value="${v}"${(r.status || 'Applied') === v ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </td>
      <td contenteditable="true" data-field="work_mode">${escapeHtml(r.work_mode)}</td>
      <td contenteditable="true" data-field="employment_type">${escapeHtml(r.employment_type)}</td>
      <td contenteditable="true" data-field="level">${escapeHtml(r.level)}</td>
      <td contenteditable="true" data-field="term">${escapeHtml(r.term)}</td>
      <td contenteditable="true" data-field="tags" placeholder="e.g. referral, dream job">${escapeHtml(r.tags)}</td>
      <td class="follow-up-cell${isFollowUpDue(r) ? ' overdue' : ''}">
        <input type="date" data-field="follow_up_date" value="${escapeAttr(r.follow_up_date || '')}" />
      </td>
      <td class="url"><a href="${r.url}" target="_blank" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td>
      <td contenteditable="true" data-field="notes">${escapeHtml(r.notes)}</td>
      <td class="actions">
        <button data-action="tools">📝 tools</button>
        <button data-action="delete">delete</button>
      </td>
    `;
    tableBody.appendChild(tr);
  }
}

// Keeps the site filter's options in sync with whatever sites actually
// appear in the data (covers "manual" rows, not just the three built-in
// capture sites) without hardcoding a list that could drift.
function refreshSiteFilterOptions(confirmed) {
  const sites = [...new Set(confirmed.map((r) => r.site).filter(Boolean))].sort();
  const current = filterSite.value;
  filterSite.innerHTML = '<option value="">All sites</option>' + sites.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  if (sites.includes(current)) filterSite.value = current;
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
  if (e.target.dataset.action === 'tools') {
    const tr = e.target.closest('tr');
    openToolsModal(tr.dataset.id);
    return;
  }
  if (e.target.dataset.action !== 'delete') return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const ok = await confirmDialog('This removes the row permanently — there is no undo.', { title: 'Remove this row?', okLabel: 'Remove' });
  if (!ok) return;
  db.run('DELETE FROM applications WHERE id = ?', [id]);
  await persist();
  refreshRows();
});

tableBody.addEventListener('change', async (e) => {
  const field = e.target.dataset.field;
  if (field !== 'status' && field !== 'follow_up_date') return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  db.run(`UPDATE applications SET ${field} = ? WHERE id = ?`, [e.target.value, id]);
  await persist();
  refreshRows();
});

filterStatus.addEventListener('change', renderTable);
filterSite.addEventListener('change', renderTable);

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
    `INSERT INTO applications (site, job_title, company, location, url, applied_at, extraction_method, notes, imported_at, reviewed, status)
     VALUES ('manual', 'New application', '', '', ?, ?, 'manual', '', ?, 1, 'Applied')`,
    [placeholderUrl, now, now]
  );
  await persist();
  refreshRows();
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  await mergePending();
  refreshRows();
});

// ---------- CSV export ----------

const CSV_COLUMNS = [
  ['applied_at', 'Applied'], ['site', 'Site'], ['job_title', 'Title'], ['company', 'Company'],
  ['location', 'Location'], ['status', 'Status'], ['work_mode', 'Work mode'], ['employment_type', 'Type'],
  ['level', 'Level'], ['term', 'Term'], ['tags', 'Tags'], ['follow_up_date', 'Follow-up'],
  ['url', 'Link'], ['notes', 'Notes']
];

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(visibleRows) {
  if (visibleRows.length === 0) {
    notify('error', 'Nothing to export — no rows match the current search/filters.');
    return;
  }
  const header = CSV_COLUMNS.map(([, label]) => csvEscape(label)).join(',');
  const lines = visibleRows.map((r) => CSV_COLUMNS.map(([field]) => csvEscape(r[field])).join(','));
  const csv = [header, ...lines].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  notify('success', `Exported ${visibleRows.length} application${visibleRows.length === 1 ? '' : 's'} to CSV.`);
}

exportCsvBtn.addEventListener('click', () => exportCsv(getVisibleRows()));

searchInput.addEventListener('input', renderTable);

// ---------- Resume (stored in localStorage — never leaves the browser) ----------

function getResumeText() {
  return localStorage.getItem('resumeText') || '';
}

function openResumeModal() {
  resumeTextArea.value = getResumeText();
  resumeModal.classList.add('open');
}

function closeResumeModal() {
  resumeModal.classList.remove('open');
}

resumeBtn.addEventListener('click', openResumeModal);
resumeCloseBtn.addEventListener('click', closeResumeModal);

resumeSaveBtn.addEventListener('click', () => {
  localStorage.setItem('resumeText', resumeTextArea.value);
  closeResumeModal();
});

resumeFileInput.addEventListener('change', async () => {
  const file = resumeFileInput.files[0];
  if (!file) return;
  try {
    resumeTextArea.value = 'Extracting text from PDF...';
    const text = await extractPdfText(file);
    resumeTextArea.value = text;
  } catch (err) {
    console.error(err);
    resumeTextArea.value = '';
    notify('error', 'Could not read that PDF. You can paste your resume text in manually instead.');
  }
});

async function extractPdfText(file) {
  const pdfjsLib = await import('./vendor/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }
  return text.trim();
}

// ---------- Tools modal: keyword match + cover letter draft ----------

let toolsRowId = null;
let toolsRow = null;
let toolsMatch = { present: [], missing: [] };

function renderKeywordChips(entries, kind) {
  if (!entries.length) {
    return `<span style="color:var(--muted);font-size:12px;">${kind === 'present' ? 'None detected' : 'None — nice work'}</span>`;
  }
  return entries
    .map((e) => `<span class="kw-chip ${kind} tier-${e.tier.toLowerCase()}" title="${e.tier} priority">${escapeHtml(e.keyword)}</span>`)
    .join('');
}

function regenerateCoverLetter() {
  if (!toolsRow) return;
  coverLetterArea.value = buildCoverLetterDraft(toolsRow, getResumeText(), toolsMatch, toneSelect.value);
}

function openToolsModal(id) {
  const row = rows.find((r) => String(r.id) === String(id));
  if (!row) return;
  toolsRowId = id;
  toolsRow = row;

  toolsTitle.textContent = `${row.job_title || 'Job'} — ${row.company || ''}`;
  toolsSubtitle.textContent = [row.site, row.location, row.work_mode].filter(Boolean).join(' · ');

  const resumeText = getResumeText();
  toolsNoResume.style.display = resumeText ? 'none' : 'block';
  toolsNoDescription.style.display = row.description ? 'none' : 'block';
  toneSelect.value = 'standard';

  if (row.description) {
    toolsMatch = matchKeywords(row.description, resumeText);
    kwColumns.style.display = 'flex';
    kwPresent.innerHTML = renderKeywordChips(toolsMatch.present, 'present');
    kwMissing.innerHTML = renderKeywordChips(toolsMatch.missing, 'missing');

    const experienceMentions = extractExperienceRequirements(row.description);
    if (experienceMentions.length) {
      experienceInfo.style.display = 'block';
      experienceInfo.textContent = `📅 Experience requested: ${experienceMentions.join(' · ')}`;
    } else {
      experienceInfo.style.display = 'none';
    }
  } else {
    toolsMatch = { present: [], missing: [] };
    kwColumns.style.display = 'none';
    experienceInfo.style.display = 'none';
  }

  regenerateCoverLetter();
  toolsModal.classList.add('open');
}

function closeToolsModal() {
  toolsModal.classList.remove('open');
  toolsRowId = null;
  toolsRow = null;
}

toolsCloseBtn.addEventListener('click', closeToolsModal);
toolsOpenResumeBtn.addEventListener('click', () => {
  closeToolsModal();
  openResumeModal();
});
toneSelect.addEventListener('change', regenerateCoverLetter);

coverLetterCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(coverLetterArea.value);
    coverLetterCopyBtn.textContent = 'Copied!';
    setTimeout(() => { coverLetterCopyBtn.textContent = 'Copy to clipboard'; }, 1800);
  } catch (err) {
    notify('error', 'Could not copy automatically — select the text and copy manually.');
  }
});

// ---------- Boot ----------

function handlePickerError(err, message) {
  if (err?.name === 'AbortError') return; // user cancelled the picker — not an error
  console.error(err);
  setStatus(message, 'var(--bad)');
}

document.getElementById('openExistingBtn').addEventListener('click', () => {
  connectExisting().catch((err) => handlePickerError(err, 'Could not open that file — try again'));
});
document.getElementById('createNewBtn').addEventListener('click', () => {
  createNew().catch((err) => handlePickerError(err, 'Could not create jobs.db — try again'));
});

async function boot() {
  if (!window.showOpenFilePicker || !window.showSaveFilePicker) {
    connectPanel.innerHTML = `
      <p><strong>This Dashboard needs Chrome or Edge.</strong> It reads and writes
      <code>jobs.db</code> directly using the File System Access API, which isn't
      available in this browser.</p>
    `;
    setStatus('Unsupported browser', 'var(--bad)');
    return;
  }

  try {
    SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
  } catch (err) {
    console.error('Failed to load the local database engine:', err);
    connectPanel.innerHTML = `
      <p><strong>Could not load the local database engine.</strong> Try reloading this
      tab. If this keeps happening, reload the extension from
      <code>chrome://extensions</code> and refresh this tab again.</p>
    `;
    setStatus('Failed to start', 'var(--bad)');
    return;
  }

  try {
    const handled = await tryReconnect();
    if (!handled) {
      setStatus('Not connected', '#999');
    }
  } catch (err) {
    console.error('Failed to reconnect to jobs.db:', err);
    setStatus('Reconnect failed — try Open existing jobs.db below', 'var(--bad)');
  }
}

boot();
