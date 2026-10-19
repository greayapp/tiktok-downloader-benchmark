# TikTok Downloader Benchmark — Specification

**Version:** 1.0 (frozen, git tag `spec-v1.0`) · **Date:** 2026-10-19 · **First edition:** Q4 2026 (December)
**Operated by:** GetTikVideo (gettikvideo.com), which is also one of the tools tested — see §2.
**Contact:** greyapp@protonmail.com · **Live results:** https://greayapp.github.io/tiktok-downloader-benchmark/

A repeatable, evidence-backed comparison of TikTok downloader websites. Every number comes from a
scripted test anyone can re-run; every negative finding is backed by a dated screenshot or log;
the method and weights are fixed before results are seen.

---

## 1. Principles

1. **Measured, not opinion.** Only things a script can measure (or a human can verify from
   published evidence) count toward a score. Impressions of design are not scored.
2. **Reproducible.** The test code, the sample list, the raw results and the evidence are public.
3. **Same treatment for every tool, including ours.** No tool is special-cased; GetTikVideo's
   results are published however they come out.
4. **Users' interests first.** A tool loses points for harming users (failed or broken files,
   misleading labels, hijacking ads, trackers), not for earning money: showing ads is not penalised,
   intrusive or deceptive ads are.
5. **Fixed before results.** This spec, the weights and the tool list are frozen (tagged) before the
   first run of an edition and never changed after seeing that edition's results.

## 2. Governance and conflict of interest

- **Disclosure.** Every results page, post and the repository README opens with: *"This benchmark is
  run by GetTikVideo, one of the tools it tests."*
- **No money.** No payment, affiliate link or sponsorship decides inclusion, order or score. The
  results page contains no affiliate links.
- **Equal treatment.** GetTikVideo is tested with the same adapter process, vantage point, random
  order and timing as every other tool. Its adapter gets no knowledge the others don't.
- **Frozen inputs.** Before run 1 of an edition, the spec version, tool list, weights and adapters are
  committed and tagged (e.g. `edition-2026q4`). Later changes go into the next edition, with a
  changelog entry.
- **Corrections.** Anyone (including a tool's owner) can dispute a result with evidence through a
  GitHub issue or by email (greyapp@protonmail.com). We reproduce it within 14 days; confirmed errors are corrected, the
  score is updated, and the correction is logged publicly. Results are never removed silently.
- **Independent re-runs** are welcome. If a third party's run materially disagrees, we investigate
  and note it on the results page.

## 3. Scope

**In scope:** free web tools whose main purpose is downloading TikTok videos, photos or audio from a
pasted link, used in a desktop or mobile browser.

**Out of scope:** mobile apps, browser extensions, desktop software, paid-only services, TikTok's own
"Save video", and general multi-site downloaders unless they rank among the most-used for TikTok.

**Selection.**
- *Q4 2026 (pilot):* the tools most often recommended in "best TikTok downloader" lists, checked to be
  live from the vantage point, plus two the operator added (indown.io, ttsave.net), **plus
  GetTikVideo** (disclosed). The list is in **Appendix A**.
- *From 2027:* the 12 most-visited TikTok-specific downloader sites by estimated monthly visits
  (Ahrefs or Similarweb; source and snapshot date recorded), counting only sites reachable from the
  vantage point, plus GetTikVideo.
- Clones that copy another tool's name on a different domain are excluded; the original domain is
  used. A tool that can't be reached from the vantage point is listed as "not tested" with the reason.

## 4. Test corpus (samples)

### 4.1 Composition (per edition)

| Group | Items | What it covers |
|---|---|---|
| **Videos — core (fixed)** | 10 | V1–V4 standard (15–60 s, four different accounts) · V5–V6 long (3–10 min) · V7–V8 1080p source (15–120 s) · V9 original sound (for MP3) · V10 the oldest post found (well over 12 months old) |
| **Photo posts — core (fixed)** | 10 | P1–P3 one or two images · P4–P7 multi-image (3–10 images, four different accounts) · P8–P10 high-resolution images (at least 2000 px wide), to check that images aren't downscaled |
| **Audio tasks** | 2 | MP3 from V1 and V9 |
| **Link variants** | 3 | V1 without `www.` (`https://tiktok.com/@…`) · V2 with tracking parameters (`?is_from_webapp=1&sender_device=pc`) · P4 shared with the `/photo/` path |
| **Should-fail cases** | 3 | N1 a post that doesn't exist (an official account's link with an unused post ID) · N2 TikTok's Explore page (a TikTok link with nothing to download) · N3 a non-TikTok link. (No links to private people's accounts or deleted posts, for their privacy; no sound or profile pages, which some tools rightly download from.) |
| **Videos and photos — rotating** | 5 + 5 | Fresh each edition; kept private until results are published |

Totals: 38 items per tool per run, on each of the two viewports. The core links are in
[`samples/core.json`](samples/core.json); the rotating ones are published with the edition's results.

Notes on the choices: brand accounts rarely post a single image, and every TikTok photo post carries
a sound, so the photo groups are by image count and image size. A `vm.tiktok.com` short link can only
be made in the TikTok app while signed in, which the benchmark does not do, so the first variant is
the `www`-less link.

### 4.2 Sourcing rules

- Public posts from official, brand or large verified creator accounts only; no posts by private
  individuals (including brand reposts of their clips), no minors, no sensitive content. Captions are
  read before a post is chosen.
- Posts are spread across accounts: no account more than twice among the core videos, or among the
  core photo posts. Rotating videos are recent posts (from the 60 days before selection); rotating
  photo posts are the best remaining candidates, since brand accounts post few photo posts.
- The core list is public (in the repository). Rotating items are published with the results, so
  no tool can tune itself to them in advance.
- Before each run, every positive item is checked to be live and public (`npm run reference --
  --check`); a dead core item is replaced (and logged), never silently dropped.

### 4.3 Reference ("ground truth")

For each item, a reference record is captured before the run by a small published script
(`harness/src/reference.mjs`) that reads TikTok's own page data, cross-checked with yt-dlp: duration,
the highest available resolution, image count and dimensions for photo posts, the music's length,
and the publish date. GetTikVideo's code is **not** used as a reference. For the watermark check
(§6.B) the script also fetches TikTok's own unwatermarked and watermarked versions of each video;
those stay on the test machine and are deleted after the edition. Where tiktok.com is blocked at the
vantage point (currently India), the reference is captured through a VPN and that is recorded in the
edition's `run.json`; the tool tests themselves always use the residential connection.

## 5. Test procedure

### 5.1 Environment

- **Browser:** Google Chrome stable (version recorded), a fresh profile per tool per run, no
  extensions, no ad blocker, default settings, notifications left at "ask".
- **Viewports:** every item runs twice per run — **desktop** (1366×768) and **mobile** (Android
  Chrome emulation, 390×844, touch, mobile user agent) — because sites behave and show ads
  differently on phones.
- **iPhone:** if an iOS Simulator is available on the test machine (Xcode, free), one video per tool
  is also run in iOS Safari to check that the file saves. Without a simulator this check is reported
  as "not measured", never guessed.
- **Vantage point:** one residential connection (location recorded; currently India). No paid
  proxies or cloud machines. Bandwidth is measured and recorded at the start of each run.
- **Pacing:** human-like delays (2–5 s between items), tools and items in a random order seeded by the
  run id (so it can be reproduced). One test at a time, so no test shares the connection with
  another (a large file on one tool would slow another tool's page and transfer); a run takes about
  seven hours.

### 5.2 Per-item flow

For each item, a per-tool **adapter** (published) drives the site the way a typical user would:

1. Open the tool's home page (fresh load).
2. Paste the link and submit.
3. Wait for the result (limit **60 s**).
4. Choose the control a typical user would choose for the task: the most prominent one matching it —
   "HD / No watermark" MP4 for videos, "MP3" for audio tasks, "Download all" (or each image in turn)
   for photo posts.
5. Wait for the file to start downloading (limit **60 s** after the click, including clicks an ad
   took) and to finish (a 15-minute safety limit: a large original-quality file on the test line
   says nothing about the tool); keep the file for verification.

Clicks and taps land at the element's position on screen, so whatever covers it (an ad layer, a
modal) receives them — as it would for a visitor. If a click only opened an ad tab, the visitor
clicks again; if a Google vignette or a modal covers the page, the visitor closes it with its own
close control ("Close", "×", "Skip"). Each of those is an extra click (§6.D). The ad itself is never
clicked or watched.

- An **ad wall** (the site requires watching an ad, or similar, to continue) ends the item with the
  outcome `ad-wall` (§6.A, §6.D).
- A **bot-protection challenge** that needs interaction is never solved; the item's outcome is
  `blocked`.

Everything else that happens is recorded: new tabs or windows, navigations, permission prompts,
dialogs, every network request (classified with EasyList and EasyPrivacy), cookies, and
screenshots at each step.

### 5.3 Runs and retries

- **Two full runs** per edition, at least 48 hours apart, at different times of day.
- Each item gets **one retry** after 10 minutes if it fails, like a user trying again. An item that
  succeeds on the retry counts as a success; the retry rate is reported.
- If a tool fails at least 80% of items in a run (an outage), that tool is re-run once after 24 hours
  and the re-run replaces the outage run; the outage is noted and is reflected in uptime (§6.A3).

### 5.4 Uptime monitor (between editions)

Once a day, two items per tool (one video, one photo post, rotating through the core set) are run
through the same flow on the same test machine, and the results are pushed to the repository, which
updates the live site. A day the machine is off is recorded as **no data**, not as a failure.
Bot-protection challenges are recorded as **blocked** and excluded, because real visitors pass them.

## 6. Metrics

### A. Reliability

- **A1 Success rate.** An item succeeds only if **all** of these hold:
  the file downloads completely; it opens (ffprobe for media, image decode for photos); the media
  matches the post (duration within ±1 s for videos; image count equal for photo posts); and the
  requested kind was delivered (video for video, audio for MP3, the photos for photo posts).
  `A1 = successes / attempts` over all positive items and runs. Items that ended `blocked` or
  `ad-wall` are left out (a visitor gets past both; the ad wall is penalised under §6.D). A tool
  blocked in more than half of its items on both viewports is listed as **not measurable** for the
  edition instead of being scored. A task the tool never offers — on every item of that task its
  result shows options for other tasks but none for this one (e.g. no MP3 button) — is listed as a
  missing feature (§6.G) and its items are left out of A1; if the tool offers the task at least
  once, every failure counts.
- **A2 Error handling** (should-fail cases): 100 = a clear, correct message; 50 = a generic error;
  0 = no message within 30 s, a fake "success" (a download control appears), or a redirect instead of
  an error. Only text or dialogs that appear after submitting count (not FAQ text already on the
  page).
- **A3 Uptime** = successful monitor checks / counted checks. Not counted: days the test machine was
  offline (no data), `blocked` and `ad-wall` checks, and checks of a task the tool never offered in
  that quarter (as in A1).

### B. Output quality and honesty (successful items only)

- **Resolution ratio** = delivered height / best available height (from the reference), capped at 1.
- **Label honesty** — a failure when a control's label doesn't match what it delivers:
  "HD" < 720p; "1080p" < 1080p; "No watermark" with a watermark; "MP3" that isn't MP3 audio.
- **Watermark check:** three frames per video are compared with the reference unwatermarked stream;
  differences in the watermark region are flagged and confirmed by a person, with the frame kept as
  evidence.
- **Photos:** every image present, at full resolution, and in a format browsers display (JPEG, PNG or
  WebP; HEIC-only output counts against the item).

### C. Speed (successful video items)

- **Time to result** = submit → download control visible.
- **Time to download** = submit → the file starts arriving (includes any waits the site imposes and
  every extra click).
- **Transfer rate** = file size ÷ (finished − started), for files of 5 MB or more; the test line's
  bandwidth, measured at the start of each run, is published next to it.
- **Time to file** = submit → file complete: reported, not scored, because it depends mostly on the
  file's size (tools differ: one 229-second video came as 24 MB from some tools and as TikTok's
  716 MB original from others) and on the test line.
- Medians and 90th percentiles reported. The page is checked every 250 ms, so timings carry no
  fixed waits of the harness.

### D. Ads and intrusiveness

Showing ads is not penalised. These are, each type counted once per tool per edition, each backed by
evidence:

| Behaviour | Definition |
|---|---|
| Pop-up / pop-under / new tab | A window or tab the user didn't explicitly ask for, including one opened on the first click anywhere on the page |
| Redirect | The tool's tab is sent to another site without the user choosing a link |
| Better Ads Standards violation | Any experience listed in the Coalition for Better Ads standards (pop-up, prestitial or poststitial with countdown, full-screen scroll-over, auto-playing video with sound, flashing animation, large sticky ad, mobile ad density over 30%) |
| Notification prompt | The site asks for permission to send notifications |
| Deceptive ad | An ad that imitates the tool's own download button, a system / browser / phone message, or a video player — flagged automatically, confirmed by a person, screenshot published |
| Ad wall | The site requires watching an ad (or similar) before it works |
| Option behind an ad | The best option for the task (e.g. HD) is locked behind watching an ad; the harness uses the best unlocked option instead |
| Forced wait | A countdown or delay before the file that isn't needed to produce it |
| Extra clicks | Each click beyond the minimum (submit + one download click) needed to get the file |

Also reported, not scored: the number of ad requests (EasyList-matched) during the flow.

### E. Privacy and safety

- **Unsafe flag:** listed by Google Safe Browsing, or reported malicious by 2+ engines on VirusTotal,
  at run time → shown with a warning and **not ranked**.
- **Install push:** the flow requires, or puts an interstitial in front of, installing an app, APK or
  extension.
- **Trackers:** distinct third-party tracker domains contacted during the flow (EasyPrivacy-matched).
- **Cookies before interaction:** third-party cookies set on page load, before any click.
- **HTTPS:** a missing or invalid certificate on any step of the flow.

### F. Mobile experience, accessibility and friction (measured on the mobile viewport)

- **Accessibility:** Lighthouse accessibility score (mobile emulation) of the home page.
- **Mobile usability** (measured at the first video result on the mobile viewport):
  - no horizontal scrolling on the home page or the result;
  - the link box uses a font of at least 16 px (smaller makes iPhones zoom in on tap);
  - the paste box, submit button and download controls are at least 24×24 CSS px (WCAG 2.2
    target size, AA), and ideally 44×44;
  - no ad sits between the paste box and the first download control (ads that push the real
    button down).
- **Page performance:** Core Web Vitals for the home page from Chrome's public field data (CrUX,
  phones, 75th percentile: LCP, INP, CLS) when a (free) CrUX API key is available and the site has
  data; otherwise the median of 3 Lighthouse mobile lab runs (LCP, CLS, and Total Blocking Time in
  place of INP), labelled as lab data.
- **iPhone check:** sample V1 in iOS Safari on an iOS Simulator, driven with real taps by Apple's
  XCUITest, including Safari's own download prompt; it passes if the file is saved on the device and
  verifies (§6.A1). Taps follow §5.2: the control is brought to the middle of the screen and the tap
  lands there; an ad layer is closed with its own close control and an ad page is left with Back,
  each an extra tap; ads are never tapped on purpose. A failed check counts only once a person has
  confirmed it from its end-of-test screenshot (published as evidence); otherwise the tool's iPhone
  check is "not measured".
- **Friction:** login required; a captcha in the normal flow; a usage limit or paywall hit within the
  sample; and, when measured, a file that won't save on iPhone (§5.1).

### G. Features (listed, not scored)

HD option, no-watermark option, MP3, photo posts, profile pictures, bulk download, browser
extension, app, languages.

## 7. Scoring

Scores use **absolute thresholds**, so a tool's score doesn't depend on how the others did.
Categories A–E are measured on both viewports and averaged **50/50 desktop/mobile**; category F is
measured on mobile.

| Category | Weight | Formula (0–100) |
|---|---|---|
| **A. Reliability** | **30** | `0.6·A1 + 0.1·A2 + 0.3·A3` (A1, A3 as percentages; A2 the average of the should-fail cases). If there is no uptime data yet, A1 and A2 are re-weighted proportionally. |
| **B. Quality and honesty** | **15** | Per successful item: `100 × resolution ratio − 50 per label-honesty failure` (floor 0); photo items: `100 − 25` if HEIC-only, `0` if images are missing or downscaled. Average over items. |
| **C. Speed** | **15** | 70% median time to download `T`: 100 if `T ≤ 4 s`, 0 if `T ≥ 30 s`, linear in between · 30% median transfer rate `R`: 100 if `R ≥ 20 Mbit/s`, 0 if `R ≤ 2 Mbit/s`, linear (without files of 5 MB or more, `T` alone). |
| **D. Ads and intrusiveness** | **20** | Start at 100 and subtract: pop-up / new tab −30 · redirect −40 · ad wall −20 (or, if there is no wall, an option behind an ad −10) · each Better Ads violation type −20 · notification prompt −15 · deceptive ad −20 · forced wait −10 · each extra click −5, using the typical (median) number per download (max −20). Floor 0. |
| **E. Privacy and safety** | **10** | Start at 100 and subtract: install push −30 · 5 per tracker domain (max −40) · cookies before interaction −10 · HTTPS problem −50. Floor 0. *Unsafe flag → not ranked.* |
| **F. Mobile experience, accessibility, friction** | **10** | Average of four parts: accessibility (Lighthouse score) · mobile usability (100 − horizontal scroll 25 − link-box font under 16 px 15 − any primary control under 24×24 px 20, or under 44×44 px 10 − ad between paste box and download control 25; floor 0) · performance (share of the three Core Web Vitals rated "good" × 100) · friction (100 − login 50 − captcha 30 − limit/paywall 30 − iPhone save fails 20, floor 0). |

- **Overall score** = the weighted sum, rounded to a whole number. Ties are broken by Reliability.
- **Category leaders** are shown alongside the overall ranking, so a reader can pick by what matters
  to them.
- **Missing data:** a metric that couldn't be measured for a tool (and why) is shown as such; its
  weight is redistributed within the category, never filled with a guess.

## 8. Published data and evidence

Repository layout (public on GitHub):

```
SPEC.md                    this document (versioned)
CHANGELOG.md               spec changes, corrections, replaced samples
samples/core.json          the fixed sample list
samples/2026q4-rotating.json   published with the results
harness/                   test code, adapters, reference script
results/2026q4/
  tools.json               tools tested, versions, selection source and date
  scores.csv               per-tool category and overall scores
  runs/<run-id>/<tool>/<item>.json   timings, outcome, ffprobe metadata, file hashes, errors
  network/<run-id>/<tool>.json       domains contacted, ad and tracker matches, cookies
  evidence/<tool>/         screenshots for every penalty and failure
```

**Not published:** the downloaded media itself (deleted within 24 hours of verification; only hashes
and metadata are kept), and screenshots other than those backing a penalty or a failure. Network
activity is published as summaries (domains, counts, list matches), never raw captures with cookies
or tokens.

## 9. Ethics and legal

- Low volume: about 150 attempts per tool per edition (38 items × 2 viewports × 2 runs), plus two
  daily monitor checks.
- Only public content from official, brand or large verified accounts; downloaded media is never
  redistributed.
- Competitors are named by their product name and domain only; no logos.
- Every negative statement is backed by dated evidence; corrections follow §2.
- Users are reminded on the results page to download only content they have the right to save.

## 10. Cadence and versioning

- **Quarterly editions:** March, June, September, December. The **December** edition is the annual
  edition, where the spec may change (major version), the tool list is re-selected, and the core
  samples are refreshed if needed.
- **First edition:** Q4 2026 (December), with whatever uptime data the monitor has collected by then.
- **Spec versions:** `1.x` within a year; changes take effect from the next edition only.

## 11. Publication

- **Live site (GitHub Pages):** https://greayapp.github.io/tiktok-downloader-benchmark/ — built from
  this repository on every push: the latest edition (overall ranking, category leaders, per-tool
  cards with evidence links), the uptime monitor's daily results, the methodology, the disclosure,
  past editions and the changelog. Nothing is published anywhere that isn't in the repository.
- **Repository:** the full spec, code, data and evidence; the README links to the live site.
- **GetTikVideo** may link to the live site and post a short summary per edition; it does not host
  its own copy of the results.
- **Structured data:** `Dataset` on the results page. No `Review` or `AggregateRating` markup.
- The title always carries the edition: *"TikTok Downloader Benchmark — Q4 2026"*.

## 12. Freezing

- **The method** (this document, the weights and the formulas) is frozen as v1.0 with the git tag
  `spec-v1.0`. Changes after that apply from the next edition only.
- **The edition's inputs** (tool list, samples, references and adapters) are frozen with the tag
  `edition-2026q4` immediately before run 1, so adapters can be fixed for site changes until the
  runs start, and not after.

---

## Appendix A — Candidate tools for Q4 2026

Checked from India on 2026-10-19 (HTTP status of the home page; "challenge" = a Cloudflare check
shown to scripts, which a normal browser passes). 14 tools including GetTikVideo.

| Tool | Domain | Status 2026-10-19 |
|---|---|---|
| SnapTik | snaptik.app | live |
| SSSTik | ssstik.io | live |
| MusicalDown | musicaldown.com | live |
| TikMate | tikmate.app | live |
| SaveTik | savetik.co | challenge (check in a browser) |
| TTDownloader | ttdownloader.com | live |
| TikWM | tikwm.com | challenge (check in a browser) |
| LoveTik | lovetik.com | live |
| TikTokio | tiktokio.com | live |
| TikDown | tikdown.org | live |
| TikCD | tikcd.com | live |
| inDown | indown.io | challenge (check in a browser) — added by the operator |
| TTSave | ttsave.net | live — added by the operator |
| GetTikVideo *(operator)* | gettikvideo.com | live |

Not tested: savefrom.net (no response from the vantage point in India). Excluded: snaptik.io (a clone
domain, unreachable), snapsave.app (Facebook-focused).

## Appendix B — Per-item result record

```json
{
  "edition": "2026q4",
  "run": "2026q4-r1",
  "tool": "example.com",
  "item": "V7",
  "viewport": "desktop",
  "started": "2026-12-02T10:14:03Z",
  "outcome": "success | failure | blocked | skipped",
  "failure": null,
  "retried": false,
  "timings_ms": { "to_result": 2140, "to_file": 5320 },
  "control_label": "Download HD (No Watermark)",
  "file": {
    "sha256": "…",
    "bytes": 4823112,
    "ffprobe": { "codec": "h264", "width": 1080, "height": 1920, "duration": 34.1 },
    "watermark": false,
    "label_honest": true
  },
  "reference": { "duration": 34.1, "max_height": 1920 },
  "behaviour": {
    "new_tabs": 0,
    "redirects": 0,
    "permission_prompts": [],
    "ad_requests": 6,
    "tracker_domains": ["…"],
    "cookies_before_interaction": 0
  },
  "evidence": ["evidence/example.com/V7-result.png"]
}
```
