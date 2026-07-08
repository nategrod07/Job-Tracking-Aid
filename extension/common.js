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

// DOMParser rather than the classic "div.innerHTML = html; read textContent"
// trick — sites that enforce a Trusted Types CSP (LinkedIn does) block any
// plain-string assignment to innerHTML, from content scripts too, not just
// page code, so that approach silently throws there and description
// extraction fails. DOMParser.parseFromString is a separate API that was
// deliberately left out of the Trusted Types restricted-sink list, since it
// only parses a string into a detached document — it never injects
// anything into the live page — so it works regardless of CSP.
function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body?.textContent || '').trim();
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

// Some "Apply" buttons (particularly ones that hand off to an external
// application system) aren't real <button>/<a> elements or ARIA
// button/link roles — just a styled <div>/<span> with a click handler.
// findApplyTarget() falls back to a short, bounded climb from the exact
// clicked element, checking each level's own text. It's capped at a few
// levels and a short text length specifically so it can't accidentally
// sweep in unrelated text from a large ancestor container the way an
// unbounded search would — this is a narrower, lower-risk check than the
// primary selector-based path above it, not a replacement for it.
function findApplyTarget(clicked) {
  const primary = clicked.closest('button, a, [role="button"], [role="link"], [role="menuitem"], input[type="submit"], input[type="button"]');
  if (primary) return primary;

  let el = clicked;
  for (let i = 0; i < 3 && el && el.nodeType === 1; i++) {
    const text = el.innerText || el.getAttribute('aria-label') || el.textContent || '';
    if (text.length > 0 && text.length < 200 && isApplyButtonText(text)) return el;
    el = el.parentElement;
  }
  return null;
}

let currentSiteName = null;

function attachApplyListener(siteName) {
  currentSiteName = siteName;
  document.addEventListener('click', (e) => {
    if (contextInvalid) return;

    const target = findApplyTarget(e.target);
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
  ensureBadge();
  closeBadgeMenu();
  applyBadgeState('warning');
  setPillText('⚠️ Job Tracker was updated — refresh this page');
}

// ---------- On-page badge: confirms the tracker is active, flashes a
// confirmation the moment an "apply" click is captured, and — via a small
// dropdown — gives quick access to fit score / resume tailoring / a sample
// cover letter right on the job page, without switching to the Dashboard.
//
// Built in a Shadow DOM rather than plain inline-styled elements (the
// approach used everywhere else in this file) because a real popover with
// hover states, scrolling chip lists, and a textarea has far more CSS
// surface than a one-line badge — trying to cover all of that with
// individually `!important`-ed inline styles would be unreadable and
// fragile. Shadow DOM encapsulation solves the "aggressive host-page CSS"
// problem this file is already careful about, just more completely: host
// page styles can't reach in, and nothing in here can leak out. ----------

let badgeResetTimer = null;
let badgeHost = null;
let badgeShadow = null;

const BADGE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { position: fixed; top: 16px; left: 16px; z-index: 2147483647; }
  .pill {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; line-height: 1.4; padding: 6px 10px 6px 12px;
    border-radius: 999px; background: #16a34a; color: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    white-space: nowrap; cursor: pointer; border: none; user-select: none;
    transition: filter 0.12s ease;
  }
  .pill:hover { filter: brightness(1.08); }
  .chevron { font-size: 9px; opacity: 0.85; transition: transform 0.15s ease; }
  .wrap.open .chevron, .wrap.showing-panel .chevron { transform: rotate(180deg); }
  .menu, .panel {
    display: none;
    position: absolute; top: calc(100% + 8px); left: 0;
    width: 300px; max-height: 420px; overflow-y: auto;
    background: #fff; color: #1a1a1a; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.28); border: 1px solid #e5e7eb;
    padding: 6px;
  }
  .wrap.open .menu { display: block; }
  .wrap.showing-panel .panel { display: block; }
  .menu-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 10px 12px; font-size: 13px; text-align: left;
    background: none; border: none; border-radius: 8px; cursor: pointer; color: #1a1a1a;
  }
  .menu-item:hover { background: #f3f4f6; }
  .panel { padding: 14px; }
  .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .panel-title { font-size: 13px; font-weight: 700; margin: 0; }
  .panel-subtitle { font-size: 11px; color: #666; margin-top: 2px; }
  .panel-close { border: none; background: none; cursor: pointer; font-size: 15px; color: #888; line-height: 1; padding: 2px; }
  .panel-close:hover { color: #1a1a1a; }
  .panel-body { font-size: 12px; line-height: 1.5; }
  .score-big { font-size: 32px; font-weight: 800; }
  .score-label { font-size: 11px; color: #666; margin-bottom: 4px; }
  .chip { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 999px; margin: 0 5px 5px 0; }
  .chip.present { background: rgba(22,163,74,0.12); color: #16a34a; }
  .chip.missing { background: rgba(220,38,38,0.10); color: #dc2626; }
  .chip-section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin: 10px 0 5px; }
  .chip-section-title:first-child { margin-top: 0; }
  textarea.cover-letter {
    width: 100%; min-height: 160px; font-size: 12px; font-family: inherit;
    padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px; resize: vertical; color: #1a1a1a;
  }
  .copy-btn { font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid #e5e7eb; background: #f7f7f7; cursor: pointer; margin-top: 8px; }
  .copy-btn:hover { background: #eef2ff; }
  .loading, .empty-note { color: #888; font-size: 12px; padding: 6px 0; }
`;

// Minimal DOM-builder helper. Everything in this section used to be built
// via `el.innerHTML = templateString`, which is simpler to write — but
// sites that enforce a Trusted Types CSP (LinkedIn does; see the comment on
// stripHtml() above) block any plain-string assignment to innerHTML from
// content scripts, not just page code, so that approach silently throws
// there and the whole badge fails to render. createElement/textContent/
// appendChild aren't restricted sinks under Trusted Types (they can't be
// used for HTML injection in the first place), so building the DOM
// programmatically works everywhere regardless of a site's CSP — this
// isn't a LinkedIn-specific workaround, it's the version of this code that
// was always going to be correct on an arbitrary third-party site.
function h(tag, attrs, children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const child of children || []) {
    if (child === null || child === undefined) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function ensureBadge() {
  if (badgeHost) return badgeHost;

  badgeHost = document.createElement('div');
  badgeHost.id = '__job-tracker-badge';
  badgeShadow = badgeHost.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = BADGE_CSS; // textContent, not innerHTML — always safe, never a Trusted Types sink

  const pillBtn = h('button', { class: 'pill', id: 'pillBtn', type: 'button' }, [
    h('span', { id: 'pillText' }, ['● Job Tracker active']),
    h('span', { class: 'chevron' }, ['▾'])
  ]);
  const menu = h('div', { class: 'menu', id: 'menu' }, [
    h('button', { class: 'menu-item', 'data-action': 'score', type: 'button' }, ['🎯 Fit score']),
    h('button', { class: 'menu-item', 'data-action': 'tailor', type: 'button' }, ['📝 Tailor my resume']),
    h('button', { class: 'menu-item', 'data-action': 'cover', type: 'button' }, ['✉️ Sample cover letter'])
  ]);
  const panel = h('div', { class: 'panel', id: 'panel' }, []);
  const wrap = h('div', { class: 'wrap', id: 'wrap' }, [pillBtn, menu, panel]);

  badgeShadow.appendChild(styleEl);
  badgeShadow.appendChild(wrap);
  (document.body || document.documentElement).appendChild(badgeHost);

  wireBadgeMenu();
  applyBadgeState('idle');
  return badgeHost;
}

function setPillText(text) {
  if (!badgeShadow) return;
  badgeShadow.getElementById('pillText').textContent = text;
}

function applyBadgeState(state) {
  if (!badgeShadow) return;
  // Green = working normally, red = broken/needs a refresh, blue = flashes
  // briefly right when a capture happens.
  const bg = state === 'active' ? '#2563eb' : state === 'warning' ? '#dc2626' : '#16a34a';
  badgeShadow.getElementById('pillBtn').style.background = bg;
}

function flashBadge(jobTitle, company) {
  ensureBadge();
  clearTimeout(badgeResetTimer);
  applyBadgeState('active');
  const label = jobTitle ? `${jobTitle}${company ? ' @ ' + company : ''}` : 'application';
  setPillText(`✓ Captured: ${label}`);
  badgeResetTimer = setTimeout(() => {
    if (contextInvalid) return;
    applyBadgeState('idle');
    setPillText('● Job Tracker active');
  }, 3500);
}

function closeBadgeMenu() {
  if (!badgeShadow) return;
  badgeShadow.getElementById('wrap').classList.remove('open', 'showing-panel');
}

function wireBadgeMenu() {
  const wrap = badgeShadow.getElementById('wrap');
  const pillBtn = badgeShadow.getElementById('pillBtn');
  const menu = badgeShadow.getElementById('menu');
  const panel = badgeShadow.getElementById('panel');

  pillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (contextInvalid) return;
    const isOpen = wrap.classList.contains('open') || wrap.classList.contains('showing-panel');
    if (isOpen) {
      closeBadgeMenu();
    } else {
      wrap.classList.add('open');
    }
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('.menu-item');
    if (!btn) return;
    runBadgeAction(btn.dataset.action);
  });

  panel.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-action="close"]')) {
      closeBadgeMenu();
      return;
    }
    const copyBtn = e.target.closest('[data-action="copy"]');
    if (copyBtn) {
      const textarea = badgeShadow.getElementById('coverLetterText');
      if (!textarea) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch (err) {
        // Clipboard permissions vary by host page context — the textarea is
        // still selectable/copyable by hand, so just leave the button as-is.
      }
    }
  });

  // A click anywhere outside the badge closes it. Shadow DOM click events
  // are retargeted to the host element (badgeHost) once observed from
  // outside the shadow tree, so `badgeHost.contains(e.target)` correctly
  // stays true for clicks that originated inside the popover, even though
  // stopPropagation() above already keeps most of them from reaching here.
  document.addEventListener('click', (e) => {
    if (badgeHost && !badgeHost.contains(e.target)) closeBadgeMenu();
  });
}

function renderPanelShell(panelEl, title, bodyNode, subtitle) {
  clearNode(panelEl);
  const headerText = [h('h3', { class: 'panel-title' }, [title])];
  if (subtitle) headerText.push(h('div', { class: 'panel-subtitle' }, [subtitle]));
  const header = h('div', { class: 'panel-header' }, [
    h('div', {}, headerText),
    h('button', { class: 'panel-close', 'data-action': 'close', type: 'button' }, ['✕'])
  ]);
  panelEl.appendChild(header);
  panelEl.appendChild(h('div', { class: 'panel-body' }, [bodyNode]));
}

function renderLoading(panelEl) {
  clearNode(panelEl);
  panelEl.appendChild(h('div', { class: 'loading' }, ['Loading…']));
}

function renderSimpleMessage(panelEl, title, message) {
  renderPanelShell(panelEl, title, h('div', { class: 'empty-note' }, [message]));
}

function buildChipList(entries, kind) {
  if (!entries.length) {
    return h('span', { class: 'empty-note' }, [kind === 'present' ? 'None detected' : 'None — nice work']);
  }
  const frag = document.createDocumentFragment();
  for (const e of entries) frag.appendChild(h('span', { class: `chip ${kind}` }, [e.keyword]));
  return frag;
}

function renderScorePanel(panelEl, score, match) {
  let body;
  if (score === null) {
    body = h('div', { class: 'empty-note' }, ['Not enough information to score this one — no matching keywords found in the captured description.']);
  } else {
    const total = match.present.length + match.missing.length;
    body = h('div', {}, [
      h('div', { class: 'score-big' }, [`${score}%`]),
      h('div', { class: 'score-label' }, [`match, based on ${total} keyword${total === 1 ? '' : 's'} found in this posting`]),
      h('div', { class: 'chip-section-title' }, ['Top gaps']),
      buildChipList(match.missing.slice(0, 5), 'missing')
    ]);
  }
  renderPanelShell(panelEl, 'Fit score', body);
}

function renderTailorPanel(panelEl, match) {
  const body = h('div', {}, [
    h('div', { class: 'chip-section-title' }, ['Already on your resume']),
    buildChipList(match.present, 'present'),
    h('div', { class: 'chip-section-title' }, ['Consider adding']),
    buildChipList(match.missing, 'missing')
  ]);
  renderPanelShell(panelEl, 'Tailor my resume', body);
}

function renderCoverPanel(panelEl, letter) {
  const textarea = h('textarea', { class: 'cover-letter', id: 'coverLetterText' }, []);
  textarea.value = letter;
  const copyBtn = h('button', { class: 'copy-btn', 'data-action': 'copy', type: 'button' }, ['Copy to clipboard']);
  renderPanelShell(panelEl, 'Sample cover letter', h('div', {}, [textarea, copyBtn]), 'Standard tone — for other tones, use the Dashboard’s tools modal');
}

function getStoredResumeText() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ resumeText: '' }, (data) => resolve(data.resumeText || ''));
  });
}

// Runs one of the three badge-menu actions: extracts the current page's job
// description on demand (not just at Apply-click time, so this works even
// before you've clicked Apply), pulls your resume from shared extension
// storage, and renders a result panel. On a page with multiple postings
// visible at once (e.g. a split-pane search results view), this describes
// whatever the page-wide extraction finds — the same scoping limitation
// already documented for Handshake's DOM extraction.
async function runBadgeAction(action) {
  const wrap = badgeShadow.getElementById('wrap');
  const panel = badgeShadow.getElementById('panel');
  wrap.classList.remove('open');
  wrap.classList.add('showing-panel');
  renderLoading(panel);

  let details;
  try {
    details = extractJobDetails(currentSiteName, null);
  } catch (err) {
    details = null;
  }
  if (!details || !details.description) {
    renderSimpleMessage(panel, 'No description found', 'Could not find a job description on this page to work from.');
    return;
  }

  const resumeText = await getStoredResumeText();
  if (!resumeText) {
    renderSimpleMessage(panel, 'Resume needed', 'Add your resume in the Dashboard first (📄 Resume button), then try again.');
    return;
  }

  const match = matchKeywords(details.description, resumeText);

  if (action === 'score') {
    renderScorePanel(panel, computeFitScore(match), match);
  } else if (action === 'tailor') {
    renderTailorPanel(panel, match);
  } else if (action === 'cover') {
    const letter = buildCoverLetterDraft(details, resumeText, match, 'standard');
    renderCoverPanel(panel, letter);
  }
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
