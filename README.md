# Job Application Tracker

Tracks jobs you apply to on LinkedIn, Indeed, and Handshake. No screen
recording, no server — a browser extension reads the page directly, and a
built-in Dashboard tab reads/writes a real SQLite database (`jobs.db`)
directly on disk, laid out like a spreadsheet. No terminal needed day to day.

## How it works

1. A Chrome extension watches for clicks on anything that looks like an
   "Apply" button on linkedin.com, indeed.com, and joinhandshake.com. A
   small badge in the top-left corner of the page turns green to confirm it's
   active (red if something's wrong — see below), and flashes blue
   "✓ Captured: ..." the moment it detects an apply click.
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
   (moves it into the main table), or **✗ Not this** to discard a mis-click.
   This is also where you'd catch a false positive from an oddly-labeled
   button. Confirmed rows are the only ones that count toward your tracker.
5. Each capture also auto-tags **work mode** (Remote/Hybrid/On-site),
   **employment type** (Full-time/Part-time/Internship/Contract), **level**
   (Intern/New Grad/Entry Level), and **term** (e.g. "Fall 2026") by reading
   structured job data where available and scanning the page text otherwise.
   These are guesses — fix them in the review panel or the main table if
   they're wrong.

## Resume tools (cover letters & keyword matching)

This is intentionally **not AI-generated** — no API keys, no cost, nothing
sent anywhere. It's deterministic text matching plus a fill-in-the-blank
template:

1. Click **📄 Resume** in the Dashboard header. Upload a PDF (parsed
   in-browser) or just paste your resume text in directly, then **Save**.
   It's stored only in this browser's local storage — never uploaded
   anywhere.
2. On any confirmed row, click **📝 tools**. This shows:
   - Which keywords from that job's captured description already appear in
     your resume ("Already on your resume") versus ones that don't
     ("Consider adding") — matched against a built-in list of common
     tech/soft skills plus repeated capitalized terms in the posting (to
     catch specific tools/products the built-in list doesn't know about).
   - A cover letter **draft**, pre-filled with the job title/company/matched
     skills. Bracketed sections like `[Add 1-2 sentences about...]` are
     prompts for you to fill in with real specifics — this is a skeleton to
     edit, not a finished letter. **Copy to clipboard** when you're happy
     with it.
3. If a job has no captured description (rare, but possible if extraction
   failed on that page), keyword matching is skipped but the cover letter
   draft still works off the job title/company you have on file.

Because this is template-based rather than AI-written, quality depends on
how much you customize the bracketed prompts — treat it as a fast starting
draft, not a final letter.

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

## Limitation of the Dashboard approach

The File System Access API (what lets the Dashboard read/write `jobs.db`
directly) is Chrome/Edge-only — it won't work in Firefox or Safari. Live
auto-sync also only happens while the Dashboard tab is open somewhere
(background tabs are fine, closed windows are not); otherwise click
**Sync now** when you next open it.

## Sharing with friends

Since there's no AI/API key involved, sharing this with 2-3 friends is
simple — nobody needs an account, key, or shared backend:

1. Share the whole project folder (or just zip the `extension/` folder).
2. Each friend does their own **Load unpacked** in `chrome://extensions`
   (Setup section above) and their own **Create new jobs.db** in the
   Dashboard the first time.
3. Everyone's data stays local to their own machine — there's no shared
   database or server, so nobody sees anyone else's applications.
4. Each person's resume (if they use the Resume tools) also stays local to
   their own browser.

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
- **Keyword matching is naive**: it's substring/word matching against a
  fixed skill list plus repeated capitalized terms, not real language
  understanding — it won't catch paraphrased skills (e.g. "led a team" vs
  "Leadership") and can occasionally flag irrelevant capitalized words.
  Treat the "Consider adding" list as a prompt to double check, not a
  strict requirement.
