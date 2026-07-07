// Shares the Dashboard's saved theme (same extension origin = same
// localStorage) so the popup doesn't feel like a mismatched leftover.
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
})();

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const EMPTY_ICON = '<svg class="empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/><path d="M10 12v2h4v-2"/></svg>';

function render() {
  chrome.storage.local.get({ pending: [] }, (data) => {
    const list = document.getElementById('list');
    list.innerHTML = '';

    if (data.pending.length === 0) {
      list.innerHTML = `
        <div class="empty">
          ${EMPTY_ICON}
          <div class="empty-title">No captures yet</div>
          <div class="empty-hint">Click Apply on LinkedIn, Indeed, or Handshake.</div>
        </div>`;
      return;
    }

    // newest first
    const entries = [...data.pending].reverse();
    for (const entry of entries) {
      const tags = [entry.work_mode, entry.employment_type, entry.level, entry.term]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');

      const div = document.createElement('div');
      div.className = 'entry';
      div.innerHTML = `
        <button class="delete" data-id="${escapeHtml(entry.id)}">remove</button>
        <div class="site">${escapeHtml(entry.site)}</div>
        <div class="title">${escapeHtml(entry.job_title) || '(title not detected)'}</div>
        <div class="meta">${escapeHtml(entry.company)}${entry.company && entry.location ? ' · ' : ''}${escapeHtml(entry.location)}</div>
        ${tags ? `<div class="meta">${tags}</div>` : ''}
        <div class="meta">${escapeHtml(new Date(entry.applied_at).toLocaleString())}</div>
      `;
      list.appendChild(div);
    }

    list.querySelectorAll('.delete').forEach((btn) => {
      btn.addEventListener('click', () => removeEntry(btn.dataset.id));
    });
  });
}

function removeEntry(id) {
  chrome.storage.local.get({ pending: [] }, (data) => {
    const pending = data.pending.filter((e) => e.id !== id);
    chrome.storage.local.set({ pending }, () => {
      chrome.action.setBadgeText({ text: pending.length ? String(pending.length) : '' });
      render();
    });
  });
}

function exportAndClear() {
  chrome.storage.local.get({ pending: [] }, (data) => {
    if (data.pending.length === 0) return;
    const blob = new Blob([JSON.stringify(data.pending, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `job-tracker-export-${Date.now()}.json`;
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      chrome.storage.local.set({ pending: [] }, () => {
        chrome.action.setBadgeText({ text: '' });
        render();
      });
    });
  });
}

// Two-step confirm (click again within 3s) instead of a native confirm() —
// consistent with the Dashboard's styled confirm dialog, just sized for a
// small popup where a modal would feel cramped.
let clearArmed = false;
let clearResetTimer = null;

function clearOnly() {
  const btn = document.getElementById('clearBtn');
  if (!clearArmed) {
    clearArmed = true;
    btn.textContent = 'Click again to confirm';
    btn.classList.add('danger-pending');
    clearResetTimer = setTimeout(() => {
      clearArmed = false;
      btn.textContent = 'Clear only';
      btn.classList.remove('danger-pending');
    }, 3000);
    return;
  }

  clearTimeout(clearResetTimer);
  clearArmed = false;
  btn.textContent = 'Clear only';
  btn.classList.remove('danger-pending');
  chrome.storage.local.set({ pending: [] }, () => {
    chrome.action.setBadgeText({ text: '' });
    render();
  });
}

document.getElementById('exportBtn').addEventListener('click', exportAndClear);
document.getElementById('clearBtn').addEventListener('click', clearOnly);
document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
render();
