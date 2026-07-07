// Background service worker: receives detected "apply" events from content
// scripts, stores them in chrome.storage.local, and dedupes rapid repeats
// (e.g. double clicks) on the same URL within a 5 minute window.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'JOB_APPLY_DETECTED') return;

  chrome.storage.local.get({ pending: [] }, (data) => {
    const pending = data.pending;
    const now = Date.now();

    const isDuplicate = pending.some(
      (p) => p.url === msg.url && now - new Date(p.applied_at).getTime() < 5 * 60 * 1000
    );
    if (isDuplicate) return;

    const entry = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      site: msg.site,
      url: msg.url,
      job_title: msg.job_title || null,
      company: msg.company || null,
      location: msg.location || null,
      extraction_method: msg.extraction_method || null,
      work_mode: msg.work_mode || null,
      employment_type: msg.employment_type || null,
      level: msg.level || null,
      term: msg.term || null,
      description: msg.description || null,
      applied_at: new Date(now).toISOString(),
      notes: ''
    };

    pending.push(entry);
    chrome.storage.local.set({ pending }, () => {
      chrome.action.setBadgeText({ text: String(pending.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    });
  });
});
