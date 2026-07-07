function render() {
  chrome.storage.local.get({ pending: [] }, (data) => {
    const list = document.getElementById('list');
    list.innerHTML = '';

    if (data.pending.length === 0) {
      list.innerHTML = '<div class="empty">No captured applications yet.<br>Click Apply on LinkedIn, Indeed, or Handshake.</div>';
      return;
    }

    // newest first
    const entries = [...data.pending].reverse();
    for (const entry of entries) {
      const tags = [entry.work_mode, entry.employment_type, entry.level, entry.term].filter(Boolean).join(' · ');

      const div = document.createElement('div');
      div.className = 'entry';
      div.innerHTML = `
        <button class="delete" data-id="${entry.id}">remove</button>
        <div class="site">${entry.site}</div>
        <div class="title">${entry.job_title || '(title not detected)'}</div>
        <div class="meta">${entry.company || ''}${entry.company && entry.location ? ' · ' : ''}${entry.location || ''}</div>
        ${tags ? `<div class="meta">${tags}</div>` : ''}
        <div class="meta">${new Date(entry.applied_at).toLocaleString()}</div>
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

function clearOnly() {
  if (!confirm('Clear all captured entries without exporting them?')) return;
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
