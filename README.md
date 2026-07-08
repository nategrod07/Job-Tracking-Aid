# Job Application Tracker

Tracks jobs you apply to on LinkedIn, Indeed, and Handshake. No screen
recording, no server — a browser extension reads the page directly, and a
built-in Dashboard tab reads/writes a real SQLite database (`jobs.db`)
directly on disk, laid out like a spreadsheet. No terminal needed day to day.
The Dashboard also tracks each application's status (Applied → Interviewing →
Offer/Rejected/Ghosted) and has a Stats view for a quick read on your pipeline.

**Just want to install it, not read about how it works?** → **[Getting
Started guide](GETTING_STARTED.md)** — download, install, and connect in
about 5 minutes, no technical background needed.

## How it works

1. A Chrome extension watches for clicks on anything that looks like an
   "Apply" button, scoped to job-specific pages: LinkedIn's `/jobs/*` paths,
   Indeed's `/viewjob` and `/jobs` search/listing pages, and Handshake's
   `app.joinhandshake.com` app subdomain — not the rest of those sites. A
   small badge in the top-left corner of the page turns green to confirm it's
   active on that page (red if something's wrong — see below), and flashes
   blue "✓ Captured: ..." the moment it detects an apply click. The badge only
   appears on job-specific pages now — that's intentional (see
   [Permissions are scoped to job pages](#permissions-are-scoped-to-job-pages)
   below), not a bug if it's missing elsewhere on those sites. Click the badge
   itself for a dropdown with fit score / resume tailoring / a sample cover
   letter for whatever posting you're looking at — see "Same tools, right on
   the job page" below.
2. When it fires, it reads the job's title/company/location off the page
   (using the site's embedded structured data where available, falling back
   to the page title) and stores the capture in the extension's local
   storage — nothing leaves your machine.
3. Open the **Dashboard** (a tab inside the extension) to see everything in
   a sortable, searchable, editable table — the actual contents of
   `jobs.db`, no export/import step in between. If you keep the Dashboard
   tab open (even in the background) while you job hunt, new captures sync
   into `jobs.db` automatically the moment they happen.
4. New captures land in a **Needs review** panel at the top of the
   Dashboard first, not straight into your tracker table. Fix up the
   title/company/location if needed and click **✓ Applied** to confirm it
   (moves it into the main table with status **Applied**), or **✗ Not this**
   to discard a mis-click. This is also where you'd catch a false positive
   from an oddly-labeled button. Confirmed rows are the only ones that count
   toward your tracker.
5. Each capture also auto-tags **work mode** (Remote/Hybrid/On-site),
   **employment type** (Full-time/Part-time/Internship/Contract), **level**
   (Intern/New Grad/Entry Level), and **term** (e.g. "Fall 2026") by reading
   structured job data where available and scanning the page text otherwise.
   These are guesses — fix them in the review panel or the main table if
   they're wrong.
6. Update each row's **Status** pill any time (Applied/Interviewing/
   Offer/Rejected/Ghosted) as things progress — it's a plain dropdown in the
   table. The **📊 Stats** tab at the top of the Dashboard turns this into a
   read on your pipeline: applications per week, a status breakdown, and
   totals by site and work mode, all computed locally from your own data.

## Resume tools (cover letters & keyword matching)

This is intentionally **not AI-generated** — no API keys, no cost, nothing
sent anywhere. It's deterministic text matching (a ~300-term skill
dictionary plus an alias/synonym table) plus a fill-in-the-blank template:

1. Click **📄 Resume** in the Dashboard header. Upload a PDF (parsed
   in-browser) or just paste your resume text in directly, then **Save**.
   It's stored only in this browser's local storage — never uploaded
   anywhere.
2. On any confirmed row, click **📝 tools**. This shows:
   - Which keywords from that job's captured description already appear in
     your resume ("Already on your resume") versus ones that don't
     ("Consider adding") — matched against a built-in skill dictionary
     (languages, frameworks, cloud/infra, data/ML, design, business/soft
     skills, and more) plus repeated capitalized terms in the posting (to
     catch specific tools/products the dictionary doesn't know about). Each
     keyword also carries a **priority** (bolder chip = higher priority),
     scored from how often it appears, whether it's near "required"/"nice to
     have" language, and whether it shows up early in the posting — both
     lists are sorted highest-priority first. Matching is alias-aware in
     both directions: a job posting saying "K8s" and a resume saying "led a
     team" both count toward "Kubernetes" and "Leadership" respectively, not
     just exact matches of the dictionary's own wording.
   - A cover letter **draft**, pre-filled with your top matched skills, with
     a **tone** selector (Standard/Enthusiastic/Concise) that changes the
     phrasing without changing what's said. Bracketed sections like
     `[Add 1-2 sentences about...]` are prompts for you to fill in with real
     specifics — this is a skeleton to edit, not a finished letter.
     **Copy to clipboard** when you're happy with it.
3. If a job has no captured description (rare, but possible if extraction
   failed on that page), keyword matching is skipped but the cover letter
   draft still works off the job title/company you have on file.

Because this is template-based rather than AI-written, quality depends on
how much you customize the bracketed prompts — treat it as a fast starting
draft, not a final letter. The alias table catches common paraphrasing
(abbreviations, tense/form variants of the highest-value soft skills) but
isn't real language understanding — treat "Consider adding" as a prompt to
double check, not a strict requirement.

### Same tools, right on the job page

Click the **● Job Tracker active** badge (top-left of any job page) for a
dropdown with three quick actions, so you don't have to switch to the
Dashboard to get a read on a posting:

- **🎯 Fit score** — a 0-100% score for this specific posting, weighted by
  how important each matched/missing keyword looks (see "Resume tools"
  above) — not a claim of precise fit, just the same heuristic rolled into
  one number.
- **📝 Tailor my resume** — the same "Already on your resume" / "Consider
  adding" chip lists as the Dashboard's tools modal.
- **✉️ Sample cover letter** — a draft in the Standard tone (for
  Enthusiastic/Concise, use the Dashboard's tools modal).

All three need your resume saved first (📄 Resume, in the Dashboard) and a
captured job description on the current page. On a page showing multiple
postings at once (e.g. a split-pane search view), this works off whatever
the page-wide extraction finds, same as elsewhere in this app.

## Setup

### 1. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder in this
   project.
4. Pin the extension so it's easy to reach.

Whenever these files get updated (like just now), click the reload icon on
the extension's card in `chrome://extensions`, **and** refresh any
LinkedIn/Indeed/Handshake tabs you already had open — content scripts (and
the on-page badge) only load into new page loads, not tabs that were
already open before the reload.

### 2. Connect the Dashboard to a database file

1. Click the extension icon → **Open Dashboard**.
2. Click **Create new jobs.db** the first time (or **Open existing jobs.db**
   if you already have one, e.g. from the old `scripts/init_db.py` flow).
3. Chrome will remember this file going forward — you generally won't be
   asked again. If Chrome ever asks you to "Reconnect to jobs.db" (this can
   happen after a browser restart, since it re-verifies file permission),
   just click it once.

### 3. Use it

- Browse and apply to jobs as normal on LinkedIn, Indeed, or Handshake. Watch
  for the top-left badge to flash "✓ Captured" as confirmation it worked. If
  it turns red instead, the extension was reloaded/updated since you loaded
  the page — refresh it.
- Open the Dashboard any time to see the full list — click column headers to
  sort, use the search box to filter, click into any cell to edit it, use
  **+ Add row** for jobs it missed, **delete** to remove a row.
- If the Dashboard tab wasn't open when you applied, click **Sync now** to
  pull in anything waiting.
- The old terminal-based path (`scripts/init_db.py` / `scripts/sync_export.py`
  plus the popup's **Export & clear** button) still works as a manual
  backup/portability option, but isn't needed for normal day-to-day use.
- `jobs.db` is a normal SQLite file — open it with any SQLite browser (e.g.
  DB Browser for SQLite) any time you want.

## Permissions are scoped to job pages

The extension only requests access to job-specific URL patterns, not entire
sites:

- **LinkedIn**: `linkedin.com/jobs/*` (job view and the search/browse pane) —
  not the rest of linkedin.com.
- **Indeed**: `indeed.com/viewjob*` (a single posting) and `indeed.com/jobs*`
  (search/browse) — not the rest of indeed.com.
- **Handshake**: the `app.joinhandshake.com` subdomain (the actual logged-in
  app, where postings live) — not the `joinhandshake.com` marketing site or
  `support.joinhandshake.com`. Handshake's exact in-app routes aren't
  publicly documented the way LinkedIn's and Indeed's are, so this one is
  scoped at the subdomain level rather than a specific path; the on-page
  badge is still your immediate signal if capture ever stops working there.

This means two things in practice: the on-page badge (and capture) will only
ever appear on those job-specific pages, not elsewhere on those sites — and
if you ever check what this extension can access in `chrome://extensions`,
the permission list reflects that narrower scope rather than "read and
change all your data on linkedin.com/indeed.com/joinhandshake.com."

## Limitation of the Dashboard approach

The File System Access API (what lets the Dashboard read/write `jobs.db`
directly) is Chrome/Edge-only — it won't work in Firefox or Safari. Live
auto-sync also only happens while the Dashboard tab is open somewhere
(background tabs are fine, closed windows are not); otherwise click
**Sync now** when you next open it.

## Sharing with friends

Since there's no AI/API key involved, sharing this with a few friends or
family is simple — nobody needs an account, key, or shared backend:

1. **Just point them at the [Getting Started guide](GETTING_STARTED.md)** —
   it links straight to the [latest release](../../releases/latest), where
   they can download a ready-to-use zip and follow plain-language,
   non-technical steps. This is the easiest path and the one to default to.
2. Everyone's data stays local to their own machine — there's no shared
   database or server, so nobody sees anyone else's applications. Each
   person's resume (if they use the Resume tools) also stays local to their
   own browser.

### Cutting a new release (for whoever maintains this)

1. Run `python3 scripts/package_extension.py` to build a versioned zip (e.g.
   `job-tracker-extension-v1.1.0.zip`) from the current `extension/` folder —
   the version comes straight from `extension/manifest.json`, so bump that
   first if this is a new version.
2. Create a GitHub Release (Releases → Draft a new release), tag it to match
   the version (e.g. `v1.1.0`), and attach the zip as an asset. The Getting
   Started guide's download link always points at whatever release is
   marked "latest," so nothing else needs to change.

If you want easier installs later (skipping "Developer mode" and Load
Unpacked), the next step up would be publishing it as an unlisted Chrome
Web Store item — that costs a one-time $5 developer registration fee and
goes through Google's review process. Worth considering only if 2-3 friends
grows into something bigger.

## Known limitations

- **Indeed off-site redirects**: many Indeed listings send you to the
  employer's own application system when you click Apply. The capture
  still logs the Indeed page's job details at the moment of the click, but
  can't see anything that happens after you leave Indeed.
- **LinkedIn Easy Apply**: this logs the click on "Easy Apply"/"Apply", not
  confirmation that a multi-step modal was fully submitted.
- **Site redesigns break selectors**: extraction leans on each site's
  `JobPosting` structured data (schema.org) first, since that's more
  stable than CSS class names, with page-title fallback. If a site changes
  how it embeds job data, extraction quality may degrade — the click will
  still be captured, just possibly with a blank title/company/location
  that you can fill in by hand from the URL.
- **Multiple clicks / re-opening a job page**: duplicate clicks on the same
  URL within 5 minutes are collapsed into a single capture. Re-applying to
  the same URL after that window will look like a new row (rare in
  practice).
- **No account/company enrichment**: this stores exactly what's visible on
  the page. Anything richer (parsed salary bands, remote/hybrid tags,
  seniority) would need extra extraction logic per site.
- **Keyword matching is still heuristic, not real language understanding**:
  the alias table (see Resume tools above) catches common abbreviations and
  the highest-value soft-skill phrasings, but it's a curated list, not a
  language model — an unlisted paraphrase or an unusual abbreviation won't
  be recognized, and the priority score is a rough proximity heuristic (how
  often/where a term appears relative to "required" vs. "nice to have"
  language), not a judgment of actual fit. Treat "Consider adding" as a
  prompt to double check, not a strict requirement.
- **Handshake's permission scoping is coarser than LinkedIn/Indeed's**: see
  [Permissions are scoped to job pages](#permissions-are-scoped-to-job-pages)
  above — Handshake is scoped at the subdomain level since its in-app routes
  aren't publicly documented, so it's not narrowed to a specific path the
  way LinkedIn/Indeed are.
