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
| `npm test` | Unit tests for the scoring formulas (SPEC.md §7) |
| `npm run reference` | Reference data for every sample from TikTok's own page data + yt-dlp (needs access to tiktok.com) |
| `npm run run -- --edition 2026q4 --run r1` | One full run: every tool × every sample × desktop and mobile |
| `npm run pagespeed -- --edition 2026q4` | Accessibility and Core Web Vitals per tool (Lighthouse lab, or CrUX field data with `CRUX_API_KEY`) |
| `npm run iphone -- --edition 2026q4` | One video per tool in iOS Safari on the simulator, real taps |
| `npm run monitor -- --push` | The daily uptime check; `--push` commits and pushes the results |
| `npm run score -- --edition 2026q4 --publish` | Scores, CSV, the review checklist, and the live site's data |
| `npm run explore -- <domain> <tiktok link>` | Try one tool by hand when writing or fixing its adapter |

Useful options for `run`: `--tools a,b`, `--items V1,P4`, `--viewports desktop`, `--parallel 3`
(tools tested at once; never two tests on one site), `--no-retry`, `--samples file.json`.

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

`schedule/install.sh` installs a LaunchAgent that runs `npm run monitor -- --push` every day at
11:00 local time (and at the next wake if the Mac was asleep). `schedule/uninstall.sh` removes it.
Logs: `~/Library/Logs/tiktok-downloader-benchmark-monitor.log`.
