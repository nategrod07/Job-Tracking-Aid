# Getting Started (for friends & family)

This guide skips the technical explanations and just gets you up and running.
Takes about 5 minutes. If you get stuck, see **Troubleshooting** at the
bottom.

## Step 1 — Download it

1. Go to the **[Releases page](../../releases/latest)**.
2. Under "Assets," click the `.zip` file to download it.
3. Find the downloaded zip file (usually in your **Downloads** folder) and
   unzip it — double-click it on Mac, or right-click → "Extract All" on
   Windows. You'll get a folder named something like
   `job-tracker-extension-v1.1.0`.

## Step 2 — Install it in Chrome

1. Open Chrome and go to `chrome://extensions` (type or paste that into the
   address bar).
2. Turn on **Developer mode** — it's a toggle switch in the top-right
   corner. Chrome shows this warning for anything installed outside its
   official store; it doesn't mean something is wrong.
3. Click **Load unpacked** (top-left).
4. Select the folder from Step 1 (the one named
   `job-tracker-extension-v1.1.0`, not the zip file itself).
5. You should see "Job Application Tracker" appear as a card. Click the
   puzzle-piece icon in Chrome's toolbar and pin it so it's easy to find.

## Step 3 — Connect your tracker

1. Click the extension icon → **Open Dashboard**. This opens a new tab.
2. Click **Create new jobs.db**. Chrome will ask where to save a file —
   anywhere on your computer is fine (e.g., Desktop or Documents). This file
   is where your applications get saved, like a spreadsheet only you can
   see. Nothing is uploaded anywhere.
3. That's it — you're set up.

## Step 4 — Use it

Just browse and apply to jobs like normal on **LinkedIn, Indeed, or
Handshake**. Watch for a small badge in the top-left corner of the page: it
turns green when it's watching, and flashes blue "✓ Captured" the moment you
click Apply. Open the Dashboard any time to see everything you've applied
to.

## Troubleshooting

- **"This extension may be able to read and change data on this site" or
  similar warnings during install** — normal for anything installed outside
  the Chrome Web Store. This extension never sends your data anywhere; see
  the main [README](README.md) if you want the details.
- **No badge appears on a job site** — make sure you're on an actual job
  posting or search page, not the site's homepage (the badge only shows up
  on job-specific pages, on purpose). If it was showing before and stopped,
  try refreshing the page.
- **Badge is red instead of green** — the extension was updated since you
  opened that tab. Just refresh the page.
- **Chrome asks you to "Reconnect to jobs.db"** — this can happen after
  restarting your browser. Click it once and pick the same file again.
- **Still stuck?** Ask whoever sent you this link — the [main
  README](README.md) has the full details if they need to dig deeper.
