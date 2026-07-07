// Shared helpers used by all site-specific content scripts.
// Loaded before content-<site>.js in manifest.json, so these functions
// are available on `window` in the content script's isolated world.

// Returns true if the given text looks like an "Apply" action (not "Applied",
// not "Application tips", etc).
function isApplyButtonText(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t.includes('apply')) return false;
  if (t.includes('applied')) return false;
  if (t.includes('application')) return false; // "application tips", "application questions"
  return true;
}

// Tries multiple sources in priority order and merges them, filling in
// whichever fields each source is missing, rather than stopping at the
// first source that returns *something*. This matters because the
// og:title meta tag is often a single blob like "Acme Corp hiring Software
// Engineer in New York, NY | LinkedIn" — if we stopped there, company and
// location would end up empty (or worse, stuffed into the title) instead
// of being split out.
function extractJobDetails(siteName, clickedEl) {
  const jsonLdItem = findJsonLdJobPosting();
  const sources = [
    deriveFromJsonLd(jsonLdItem),
    extractFromDom(siteName, clickedEl),
    extractFromMetaParsed(siteName),
    extractFromTitle(siteName)
  ].filter(Boolean);

  const merged = { job_title: null, company: null, location: null, extraction_method: null };
  for (const s of sources) {
    if (!merged.job_title && s.job_title) merged.job_title = s.job_title;
    if (!merged.company && s.company) merged.company = s.company;
    if (!merged.location && s.location) merged.location = s.location;
    if (!merged.extraction_method && s.extraction_method) merged.extraction_method = s.extraction_method;
  }

  return { ...merged, ...extractJobMeta(jsonLdItem), description: extractDescription(siteName, jsonLdItem) };
}

// Grabs the full job description body text — needed later for keyword
// matching against a resume and for filling in the cover letter template.
// JSON-LD's description field (HTML-escaped) is the most reliable source
// when present; otherwise falls back to known per-site containers, and
// finally to "largest text block on the page" as a last resort.
function extractDescription(siteName, jsonLdItem) {
  if (jsonLdItem?.description) {
    return stripHtml(jsonLdItem.description).slice(0, 20000);
  }

  const knownSelectors = {
    linkedin: '.jobs-description__content, .jobs-box__html-content, .jobs-description-content__text',
    indeed: '#jobDescriptionText',
    handshake: '[class*="description"], [data-hook*="description"]'
  };
  const el = document.querySelector(knownSelectors[siteName] || '');
  if (el?.innerText?.trim()) return el.innerText.trim().slice(0, 20000);

  // Last resort: the largest block of text on the page, excluding our own badge.
  const candidates = Array.from(document.querySelectorAll('article, section, div'))
    .filter((n) => n.id !== '__job-tracker-badge')
    .map((n) => n.innerText || '')
    .filter((t) => t.length > 200);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, 20000);
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

function findJsonLdJobPosting() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        if (item && item['@type'] === 'JobPosting') return item;
      }
    } catch (e) {
      // not valid JSON, skip
    }
  }
  return null;
}

function deriveFromJsonLd(item) {
  if (!item) return null;
  const org = item.hiringOrganization;
  const loc = item.jobLocation;
  let location = null;
  try {
    const addr = Array.isArray(loc) ? loc[0]?.address : loc?.address;
    if (addr) {
      location = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
    }
  } catch (e) { /* ignore */ }
  return {
    job_title: item.title || null,
    company: (org && (org.name || org)) || null,
    location: location,
    extraction_method: 'jsonld'
  };
}

// Auto-tags: work mode (Remote/Hybrid/On-site), employment type
// (Full-time/Part-time/Internship/Contract), career level (Intern/New
// Grad/Entry Level), and term (e.g. "Fall 2026") for internship postings.
// Uses structured JSON-LD fields when present, otherwise scans the visible
// page text for common phrasing. These are best-effort — the Dashboard's
// review panel is where you fix anything guessed wrong before it's
// confirmed into your tracker.
const EMPLOYMENT_TYPE_MAP = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  INTERN: 'Internship',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  PER_DIEM: 'Per diem',
  VOLUNTEER: 'Volunteer'
};

function extractJobMeta(jsonLdItem) {
  const scanText = `${document.title} ${document.body?.innerText || ''}`.slice(0, 8000);

  let workMode = null;
  if (jsonLdItem?.jobLocationType === 'TELECOMMUTE') workMode = 'Remote';
  if (!workMode) {
    if (/\bremote\b/i.test(scanText)) workMode = 'Remote';
    else if (/\bhybrid\b/i.test(scanText)) workMode = 'Hybrid';
    else if (/\bon[\s-]?site\b/i.test(scanText)) workMode = 'On-site';
  }

  let employmentType = null;
  if (jsonLdItem?.employmentType) {
    const key = Array.isArray(jsonLdItem.employmentType) ? jsonLdItem.employmentType[0] : jsonLdItem.employmentType;
    employmentType = EMPLOYMENT_TYPE_MAP[key] || null;
  }
  if (!employmentType) {
    if (/\bfull[\s-]?time\b/i.test(scanText)) employmentType = 'Full-time';
    else if (/\bpart[\s-]?time\b/i.test(scanText)) employmentType = 'Part-time';
    else if (/\bcontract(or)?\b/i.test(scanText)) employmentType = 'Contract';
  }

  let level = null;
  if (/\bintern(ship)?\b/i.test(scanText)) level = 'Intern';
  else if (/\bnew grad(uate)?\b/i.test(scanText)) level = 'New Grad';
  else if (/\bentry[\s-]?level\b/i.test(scanText)) level = 'Entry Level';

  let term = null;
  const termMatch = scanText.match(/\b(Spring|Summer|Fall|Winter)\s+20\d{2}\b/i);
  if (termMatch) term = termMatch[0].replace(/\s+/g, ' ');

  return { work_mode: workMode, employment_type: employmentType, level, term };
}

// Known "blob" formats that sites cram title + company + location into a
// single og:title/document.title string. Parsed with named capture groups.
const SITE_META_PATTERNS = {
  // "Acme Corp hiring Software Engineer in New York, NY | LinkedIn"
  linkedin: [/^(?<company>.+?)\s+hiring\s+(?<title>.+?)\s+in\s+(?<location>.+?)\s*(\|\s*LinkedIn)?$/i],
  // "Software Engineer - Acme Corp - New York, NY | Indeed.com"
  indeed: [/^(?<title>.+?)\s*-\s*(?<company>.+?)\s*-\s*(?<location>.+?)\s*(\|\s*Indeed[^|]*)?$/i],
  // Handshake's title format isn't well known/stable — DOM extraction and
  // JSON-LD are relied on more heavily for this site; no blob pattern here.
  handshake: []
};

function extractFromMetaParsed(siteName) {
  const raw = document.querySelector('meta[property="og:title"]')?.content || document.title;
  if (!raw) return null;

  for (const re of SITE_META_PATTERNS[siteName] || []) {
    const m = raw.match(re);
    if (m && m.groups) {
      return {
        job_title: m.groups.title?.trim() || null,
        company: m.groups.company?.trim() || null,
        location: m.groups.location?.trim() || null,
        extraction_method: 'meta-parsed'
      };
    }
  }

  // No pattern matched — return the raw blob as a title-only guess so at
  // least something is captured; extractJobDetails() will still prefer a
  // DOM- or JSON-LD-derived company/location over this if one was found.
  return { job_title: cleanTitle(raw), company: null, location: null, extraction_method: 'meta' };
}

function extractFromTitle(siteName) {
  const raw = document.title || null;
  if (!raw) return null;
  return { job_title: cleanTitle(raw), company: null, location: null, extraction_method: 'title-fallback' };
}

// Strips a trailing " | SiteName" suffix that most job boards append to
// <title>/og:title.
function cleanTitle(raw) {
  return raw.replace(/\s*\|\s*[^|]+$/, '').trim();
}

// Site-specific DOM selectors. These are the most likely part of the setup
// to break when a site redesigns its pages — if extraction quality drops
// later, this is the first place to update. Wrapped defensively so a
// missing/renamed selector never throws, it just falls through to the
// other sources.
//
// `clickedEl` (the element that was actually clicked) is used to scope the
// search to a nearby container first. This matters on sites like Handshake
// that show job details in a split-pane/side panel without a real page
// navigation — a plain document-wide `querySelector('h1')` can grab the
// wrong heading (e.g. a page-level "Jobs" header) instead of the specific
// job's title. Each function still falls back to a document-wide search if
// the scoped one comes up empty, so this can't make things worse.
function extractFromDom(siteName, clickedEl) {
  const scope = clickedEl ? findScopedContainer(clickedEl) : document;
  try {
    if (siteName === 'linkedin') return extractLinkedInDom(scope);
    if (siteName === 'indeed') return extractIndeedDom(scope);
    if (siteName === 'handshake') return extractHandshakeDom(scope);
  } catch (err) {
    // selectors didn't match this page version — fall through silently
  }
  return null;
}

// Climbs up from the clicked element looking for the nearest ancestor that
// plausibly contains the whole job card/detail pane: something with a
// heading in it and a meaningful amount of text (so we don't stop at a tiny
// wrapper div with just the button in it).
function findScopedContainer(el) {
  let node = el;
  for (let i = 0; i < 10 && node.parentElement; i++) {
    node = node.parentElement;
    if (node.querySelector('h1, h2, h3') && (node.innerText || '').length > 150) {
      return node;
    }
  }
  return document;
}

function firstMatch(scope, selector) {
  return scope.querySelector(selector) || (scope !== document ? document.querySelector(selector) : null);
}

function extractLinkedInDom(scope) {
  const title = firstMatch(scope, 'h1')?.innerText?.trim() || null;

  // LinkedIn always links the company name to its own /company/ page, so
  // this is more stable than relying on a specific class name.
  const companyLink = firstMatch(scope, 'a[href*="/company/"]');
  const company = companyLink?.innerText?.trim() || null;

  // The line under the title (e.g. "New York, NY · 2 days ago · 200 applicants")
  // is usually separated by middle dots; the first segment is the location.
  const subtitle = firstMatch(
    scope,
    '.job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__primary-description'
  )?.innerText;
  let location = subtitle ? subtitle.split('·')[0]?.trim() || null : null;
  if (!location) location = findLocationNearTitle(scope);

  if (!title && !company && !location) return null;
  return { job_title: title, company, location, extraction_method: 'dom' };
}

function extractIndeedDom(scope) {
  const title = firstMatch(scope, 'h1.jobsearch-JobInfoHeader-title, h1[data-testid="jobsearch-JobInfoHeader-title"]')
    ?.innerText?.trim() || null;
  const company = firstMatch(scope, '[data-testid="inlineHeader-companyName"]')?.innerText?.trim() || null;
  let location = firstMatch(scope, '[data-testid="inlineHeader-companyLocation"]')?.innerText?.trim() || null;
  if (!location) location = findLocationNearTitle(scope);

  if (!title && !company && !location) return null;
  return { job_title: title, company, location, extraction_method: 'dom' };
}

function extractHandshakeDom(scope) {
  // Prefer any heading inside the scoped panel over a document-wide h1 —
  // Handshake's search page has its own page-level heading that isn't the
  // job title, so falling back to `document` for this specific query would
  // reintroduce the bug this is meant to fix.
  const title = scope.querySelector('h1, h2, [role="heading"]')?.innerText?.trim() || null;

  const companyLink = firstMatch(scope, 'a[href*="/employers/"], a[href*="/organizations/"], a[href*="/companies/"]');
  let company = companyLink?.innerText?.trim() || null;

  // Fallback: a short, title-cased line near the title that isn't the title
  // itself and doesn't look like a location — often the employer name shown
  // as plain text rather than a link.
  if (!company) company = findCompanyNearTitle(scope, title);

  const location = findLocationNearTitle(scope);

  if (!title && !company && !location) return null;
  return { job_title: title, company, location, extraction_method: 'dom' };
}

// Picks what to scan for the fallback finders below. If `scope` is already
// a meaningfully bounded container (from findScopedContainer), scan it
// directly — climbing further from a heading *inside* it would escape past
// its boundary into unrelated sibling content (e.g. a page-level nav
// header on a split-pane site like Handshake). Only when there's no usable
// scope (scope is `document` itself) do we fall back to the older
// heading-then-climb approach as a last resort.
function resolveScanContainer(scope) {
  if (scope && scope !== document) return scope;

  const h1 = document.querySelector('h1');
  if (!h1) return null;
  let container = h1;
  for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
  return container;
}

// Generic last-resort location finder: scans the resolved container's
// nearby text lines for something that looks like a place ("City, ST") or
// a work-mode word (Remote/Hybrid/On-site). Used when a site's specific
// selectors miss (e.g. after a redesign) or aren't known at all (Handshake).
function findLocationNearTitle(scope) {
  const container = resolveScanContainer(scope);
  if (!container) return null;

  const lines = linesNear(container);
  for (const line of lines) {
    const segment = line.split('·')[0].trim();
    if (/^(Remote|Hybrid|On[\s-]?site)$/i.test(segment)) return segment;
    // "City, ST" or "City, State" style, optionally with a country after
    if (/^[A-Z][A-Za-z.'\s]+,\s*[A-Z]{2}(,\s*[A-Za-z\s]+)?$/.test(segment)) return segment;
  }
  return null;
}

// Best-effort employer-name guess when there's no company link to grab:
// looks for a short, title-cased line in the resolved container that isn't
// the job title and doesn't look like a location/date/applicant-count line.
function findCompanyNearTitle(scope, title) {
  const container = resolveScanContainer(scope);
  if (!container) return null;

  const lines = linesNear(container);
  for (const line of lines) {
    if (title && line === title) continue;
    if (line.length < 2 || line.length > 60) continue;
    if (/^(Remote|Hybrid|On[\s-]?site)$/i.test(line)) continue;
    if (/^[A-Z][A-Za-z.'\s]+,\s*[A-Z]{2}/.test(line)) continue; // looks like "City, ST"
    if (/\d/.test(line)) continue; // dates, applicant counts, etc.
    if (/^[A-Z][a-zA-Z&.,'\s-]+$/.test(line)) return line;
  }
  return null;
}

function linesNear(container) {
  const text = container.innerText || '';
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 15);
}

// Attaches a single delegated click listener (capture phase) so it still
// catches clicks on buttons that render later via JS (SPA behavior).
//
// If the extension gets reloaded/updated while this page is still open
// (common on SPAs like LinkedIn, since clicking around doesn't reload the
// page), this content script becomes a stale orphan: chrome.runtime calls
// throw "Extension context invalidated". We catch that once, stop trying
// again, and tell you to refresh the page instead of spamming the console.
let contextInvalid = false;

function attachApplyListener(siteName) {
  document.addEventListener('click', (e) => {
    if (contextInvalid) return;

    const target = e.target.closest('button, a, [role="button"], [role="link"]');
    if (!target) return;
    const text = target.innerText || target.getAttribute('aria-label') || target.textContent || '';
    if (!isApplyButtonText(text)) return;

    const details = extractJobDetails(siteName, target);
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_APPLY_DETECTED',
        site: siteName,
        url: location.href,
        job_title: details.job_title,
        company: details.company,
        location: details.location,
        extraction_method: details.extraction_method,
        work_mode: details.work_mode,
        employment_type: details.employment_type,
        level: details.level,
        term: details.term,
        description: details.description
      });
      flashBadge(details.job_title, details.company);
    } catch (err) {
      markContextInvalid();
    }
  }, true);
}

function markContextInvalid() {
  if (contextInvalid) return;
  contextInvalid = true;
  clearTimeout(badgeResetTimer);
  const badge = ensureBadge();
  applyBadgeStyle(badge, 'warning');
  badge.textContent = '⚠️ Job Tracker was updated — refresh this page';
}

// ---------- On-page badge: confirms the tracker is active, and flashes a
// confirmation the moment an "apply" click is captured. ----------

let badgeResetTimer = null;

function ensureBadge() {
  let badge = document.getElementById('__job-tracker-badge');
  if (badge) return badge;

  badge = document.createElement('div');
  badge.id = '__job-tracker-badge';
  // Every rule is !important because job sites ship aggressive global CSS
  // (resets, `all: unset` on wildcard selectors, huge base font-sizes, etc.)
  // that would otherwise bleed into this element since it inherits from
  // wherever it's mounted in the DOM.
  applyBadgeStyle(badge, 'idle');
  badge.textContent = '● Job Tracker active';
  (document.body || document.documentElement).appendChild(badge);
  return badge;
}

function applyBadgeStyle(badge, state) {
  // Green = working normally, red = broken/needs a refresh, blue = flashes
  // briefly right when a capture happens.
  const bg = state === 'active' ? '#2563eb' : state === 'warning' ? '#dc2626' : '#16a34a';
  badge.setAttribute('style', `
    all: initial !important;
    position: fixed !important;
    top: 16px !important;
    left: 16px !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: 12px !important;
    line-height: 1.4 !important;
    padding: 6px 12px !important;
    border-radius: 999px !important;
    background: ${bg} !important;
    color: #fff !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25) !important;
    pointer-events: none !important;
    white-space: nowrap !important;
    display: block !important;
    opacity: 1 !important;
    visibility: visible !important;
  `);
}

function flashBadge(jobTitle, company) {
  const badge = ensureBadge();
  clearTimeout(badgeResetTimer);
  applyBadgeStyle(badge, 'active');
  const label = jobTitle ? `${jobTitle}${company ? ' @ ' + company : ''}` : 'application';
  badge.textContent = `✓ Captured: ${label}`;
  badgeResetTimer = setTimeout(() => {
    if (contextInvalid) return;
    applyBadgeStyle(badge, 'idle');
    badge.textContent = '● Job Tracker active';
  }, 3500);
}

// Show the "active" badge as soon as the content script loads on a matched page.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureBadge);
} else {
  ensureBadge();
}

// Proactively catch context invalidation even without a click, so the
// warning shows up as soon as possible rather than waiting for you to try
// to apply to something.
const heartbeat = setInterval(() => {
  try {
    if (!chrome.runtime || !chrome.runtime.id) throw new Error('invalidated');
  } catch (err) {
    markContextInvalid();
    clearInterval(heartbeat);
  }
}, 8000);
