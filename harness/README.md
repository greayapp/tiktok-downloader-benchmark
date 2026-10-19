# Harness

The test code behind the [TikTok Downloader Benchmark](../README.md). It drives each tool the way a
visitor would and records what happens; the method it implements is [SPEC.md](../SPEC.md).

## Prerequisites (all free)

- Node.js 20+ and `npm install` in this folder
- Google Chrome (stable) — the harness drives the installed browser, unmodified
- `ffmpeg` / `ffprobe` and `yt-dlp` on `PATH` (e.g. `brew install ffmpeg yt-dlp`)
- For the iPhone check: Xcode with an iOS simulator runtime, a booted iPhone simulator, and
  `xcodegen` (`brew install xcodegen`)

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the scoring formulas (SPEC.md §7) and browser tests for finding controls (needs Chrome) |
| `npm run reference` | Reference data for every sample from TikTok's own page data + yt-dlp (needs access to tiktok.com) |
| `npm run reference -- --check` | Before each run: every sample still live and unchanged (needs access to tiktok.com) |
| `npm run run -- --edition 2026q4 --run r1` | One full run: every tool × every sample × desktop and mobile |
| `npm run pagespeed -- --edition 2026q4` | Accessibility and Core Web Vitals per tool (Lighthouse lab, or CrUX field data with `CRUX_API_KEY`) |
| `npm run iphone -- --edition 2026q4` | One video per tool in iOS Safari on the simulator, real taps |
| `npm run monitor -- --push` | The daily uptime check; `--push` commits and pushes the results |
| `npm run score -- --edition 2026q4 --publish` | Scores, CSV, the review checklist, and the live site's data |
| `npm run explore -- <domain> <tiktok link>` | Try one tool by hand when writing or fixing its adapter |

Useful options for `run`: `--tools a,b`, `--items V1,P4`, `--viewports desktop`, `--parallel 3`
(tools tested at once — development only: editions run one test at a time, SPEC.md §5.1),
`--no-retry`, `--samples file.json`.

`run` and `monitor` first record the vantage point (country, nearest Cloudflare location and, for a
run, download bandwidth; never the IP address) and refuse to start when the machine isn't in the
expected country (`TDB_COUNTRY`, default `IN`): references are captured through a VPN where
tiktok.com is blocked, but the tests use the residential connection. `--any-vantage` overrides this.

## How a test works

1. A fresh Chrome profile per tool per run and viewport (desktop 1366×768; Android emulation 390×844).
2. For each sample (random order): open the home page, click into the link box, paste, submit, wait
   for the result (60 s), pick the control a visitor would pick for the task, wait for the file
   (120 s), verify it. Clicks and taps land at the element's position on screen, so whatever covers
   it (an ad layer, a modal) gets them — as a visitor would experience.
3. A Google vignette or a modal is closed with its own close button (an extra click); an ad wall
   ("watch an ad to continue") is recorded, never watched; a bot-protection challenge is recorded as
   blocked, never solved.
4. Everything the site does is recorded: new tabs, redirects, notification requests, dialogs, every
   request classified with EasyList and EasyPrivacy, third-party cookies before any click.

`src/adapters/<domain>.mjs` only overrides what the generic flow gets wrong for a site.

## What is published and what isn't

Records (`results/<edition>/runs/…`) are published. Downloaded files, screenshots and browser data
stay in `runs-local/` and `.cache/` (git-ignored); evidence screenshots for penalties are copied to
`results/<edition>/evidence/` when an edition is scored. No downloaded media is ever committed.

## Daily monitor on macOS

`schedule/install.sh` installs a LaunchAgent that starts `src/monitor.mjs --push` every hour from
11:00 to 23:00 local time (and at the next wake if the Mac was asleep). The check runs once per day;
it waits for a later hour when the Mac is off the residential connection (a VPN on). It pushes only
when its own commit is the one thing not yet on GitHub. `schedule/uninstall.sh` removes it.
Logs: `~/Library/Logs/tiktok-downloader-benchmark-monitor.log`.

## Running an edition (checklist)

1. **Samples live** — VPN on, `npm run reference -- --check`, VPN off. Replace and log any dead core
   item (CHANGELOG.md).
2. **Freeze the inputs** — commit, then `git tag -a edition-<id> -m "…"` (e.g. `edition-2026q4`)
   and push the tag. From here adapters don't change for this edition.
3. **Run 1** — `caffeinate -dimsu npm run run -- --edition <id> --run r1` (one test at a time,
   about 8 hours; keep the Mac on power and online; the daily monitor waits while it runs).
4. **Run 2** — at least 48 hours after run 1, at a different time of day: `… --run r2`. A tool that
   failed at least 80% of a run's items is re-run once 24 hours later (`--tools <domain> --run r1b`).
5. **iPhone and pages** — `npm run iphone -- --edition <id>`, `npm run pagespeed -- --edition <id>`.
6. **Score and review** — `npm run score -- --edition <id>` writes `results/<id>/review-todo.json`:
   watermark flags, new-tab and ad screenshots (Better Ads, deceptive ads, forced waits), failed
   iPhone checks. A person records each decision in `results/<id>/review.json`; score again.
7. **Publish** — `npm run score -- --edition <id> --publish`, then make the rotating samples public:
   move `samples/local-rotating.json` to `samples/<id>-rotating.json` and `git add -f
   samples/reference/R*.json`. Commit and push; the site shows the edition.

## Known limitations and site behaviour (checked 2026-10-19)

Adapters can change until the edition is tagged (SPEC.md §12). Fixed in the flow on 2026-10-19:
photo posts whose image buttons hide while a file downloads (TTSave), files credited to the wrong
image (TikTokio 7 of 8), the iPhone check mistaking a redirect or a file opened in Safari's player
for an ad.

What the test passes showed to be the sites' own behaviour, not the harness's (kept as measured):

- **TTSave:** on long videos (229 s, 246 s) its server keeps "preparing" the file past the 60 s
  limit; on the iPhone, Safari is redirected away repeatedly (e.g. to a betting site and a fake
  "lucky draw") before a result appears.
- **TikTokio:** its server drops the 716 MB original of a 229-second video part-way; smaller files
  arrive.
- **TikWM (iPhone):** the download control opens the video in Safari's player, which offers no way
  to save it.
- **SSSTik:** its video options are behind a rewarded video ad (an ad wall, never waited out); MP3
  and photos work.
- **TikMate:** Google's offerwall ("view a short ad") covers the site on every visit.
- **TikCD (phone):** each tap in the photo step opens an ad tab instead of the photo.
- **LoveTik:** answers valid links with "Error: Could not get Video ID."
- **Bot protection:** SaveTik, TikWM and inDown show a challenge to the automated desktop/Android
  browser (never solved), so they are often "not measurable" there; inDown and TikWM load normally
  in iOS Safari on the simulator.
