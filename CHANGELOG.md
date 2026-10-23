# Changelog

All changes to the specification, the tool list, the samples, and every correction to published
results are recorded here.

### Planned for spec v1.1 (next edition)
- §2 Governance: the operator doesn't deploy changes to its own tool during an edition's run
  windows. Already followed from the Q4 2026 edition on (see `results/2026q4/NOTES.md`).
- §7: a tool with no working download in any run (an outage in every run, §5.3) is listed as "down
  during testing", with no overall score or rank, like a "not measurable" tool. Already applied
  in the Q4 2026 edition (LoveTik).

### 2026-10-23 — Repository moved
- The benchmark now lives at https://github.com/greayapp/tiktok-downloader-benchmark, with the live
  results at https://greayapp.github.io/tiktok-downloader-benchmark/. Contact:
  greyapp@protonmail.com. The commit IDs changed in the move; the notes and records cite the new
  ones. No method, sample or result changed.

### 2026-10-23 — Harness: a tab opened only to download the file is the delivery (from Q1 2027)
- A link with `target=_blank` to an attachment opens a blank tab that downloads the file and closes
  itself. The observer recorded such tabs as pop-ups (§6.D); it now records them as the delivery,
  matching the download to the tab by its address, and gives a blank or own-site tab up to 20 s for
  its download to start before judging it. A tab that downloads anything other than the requested
  file (e.g. an installer from an ad) is still a pop-up. Browser tests added; checked live on
  TTDownloader (its download tabs) and TikTokio (its pop-under tabs, still pop-ups).
- Applies from the next edition. Q4 2026 results are unchanged: TTDownloader's pop-up penalty
  stands on its separate ad tab (grotaich.net, on the first click); only its recorded count of new
  tabs included its download tabs.

### 2026-10-23 — Q4 2026 published; one outage re-run not done
- Results of the Q4 2026 edition published (`results/2026q4/`, `results/latest.json`), with the
  rotating samples (`samples/2026q4-rotating.json`, `samples/reference/R*.json`). Evidence
  screenshots are stored at 256 colours (phone shots 780 px wide) to keep the repository small.
  Local folder paths in the records are repository-relative.
- Departure from §5.3: LoveTik's run 2 was an outage (70 of 70 failed), and the rule calls for one
  more re-run. The operator's owner decided not to run it: LoveTik had failed all 210 items of run 1,
  its outage re-run and run 2. Its run 2 result stands; it is listed as "down during testing".

### 2026-10-23 — Results: a tool that never worked is shown as down, not scored
- A tool whose every download failed in every run would otherwise get an overall score from its
  ads, privacy and phone checks alone, which would mislead. It is now listed as "down during
  testing" with no score or rank (its partial measurements are kept in `scores.json`). Decided by
  the operator's owner during the Q4 2026 review, before publication; to be written into §7 in v1.1.
- Review records: `review.json` now marks which tools' ad screenshots and new tabs a person
  reviewed (`adsReviewed`, `popupsConfirmed`), so the review list only shows what is left.

### 2026-10-23 — Scoring fix: Chrome's error page is not a redirect
- When a page failed to load (e.g. `net::ERR_TIMED_OUT`), Chrome shows its own error page
  (`chrome-error://`), which the observer recorded as the tool's tab going to another site, and
  scoring counted as a redirect (−40 under §6.D). Only navigations to another web site count now, in
  the observer and in scoring (records already made keep the entry; scoring ignores it). In the
  Q4 2026 runs this affected GetTikVideo (8 such pages, all from home-page timeouts already counted
  as failures under reliability) and MusicalDown (1). Test added. Fixed before any results were
  published.

### 2026-10-23 — Scoring fix: quality rates downloads only
- Quality (§6.B, "successful items only") was also counting should-fail items, which the harness
  records as "success" with their A2 grade, as perfect downloads (resolution ratio 1). That raised
  every tool's quality a little, and gave a tool with no download at all a quality of 100. They are
  now left out (and out of speed, where they had no timings). Test added. Fixed before any results
  were published.

### 2026-10-23 — Ad-wall check fix after Q4 2026 run 2
- In run 2, TikMate's desktop block recorded every item as "no download control" or an unanswered
  should-fail link, although its screenshots show Google's offerwall ("Unlock more content · View a
  short ad") on each one; run 1 and run 2's phone block recognised the same wall. The wall check
  now also looks inside open shadow roots, reads Chrome's accessibility tree and every frame at
  once, and runs on arrival (a wall already up before the link is pasted) and once more before an
  item is recorded as failed. Browser tests added. TikMate's run 2 desktop block is redone with the
  fix; details in `results/2026q4/NOTES.md`. No change to scoring.

### 2026-10-20 — Runner fix during Q4 2026 run 1
- Run 1 stalled on a page call with no time limit; the runner now times out page reads, records an
  item unfinished after 12 minutes as "skipped" (a harness hang, not counted), and can resume a run
  (`--resume`, redoing an unfinished tool × viewport block whole). Commit `344fbbc`; details in
  `results/2026q4/NOTES.md`. No change to how tools are tested or scored.

### 2026-10-19 — Schedule: Q4 2026 edition tested in late October
- The first edition (Q4 2026) is tested in late October instead of December. No method change: the
  spec stays v1.0 (tag `spec-v1.0`); only §10's first-edition date changed. Results carry their real
  test dates. Next edition: Q1 2027 (March); the December annual edition starts in 2027.

### 2026-10-19 — Adapter and harness fixes before the first edition
- Photo posts: image buttons a site hides while a file downloads are waited for; every file that
  arrives during the photo step is kept (no late file credited to the next image).
- iPhone check: redirects are recorded and left with Back; a file opened in Safari's player is
  recorded as not saved; Safari's own alerts are dismissed (never an App Store jump).

### 2026-10-19 — Spec v1.0 (frozen; from building the harness and two test passes)
- Clicks and taps land at the element's position on screen; a click an ad takes is repeated, a
  Google vignette or modal is closed with its own close control — each an extra click.
- New outcomes: `ad-wall` (watch an ad to continue — never watched; −20 under Ads) and `blocked`
  (bot-protection challenge — never solved). Both are left out of reliability; a tool blocked in
  more than half of its items on both viewports is "not measurable".
- An option locked behind an ad (e.g. HD) is skipped and costs −10 under Ads (unless there is a wall).
- A task a tool never offers (e.g. no MP3 option on any result) is a missing feature, not failures.
- Should-fail grading reads only text and dialogs that appear after submitting.
- Should-fail links no longer point at private people's accounts or deleted posts.
- Accessibility: home page (Lighthouse mobile). Core Web Vitals: CrUX field data with a free key,
  else Lighthouse lab (TBT for INP). iPhone check: iOS Simulator + XCUITest, real taps.
- Reference data captured through a VPN where tiktok.com is blocked; tests use the residential line.
- One test at a time in an edition run (a large download on one tool slowed others' pages in testing).
- Uptime (A3) leaves out days the test machine was offline, ad walls, and checks of a task the tool
  never offered that quarter.
- Link variants are scored as the task of the post they point to (L3 is a photo post).
- A tool that is not measurable shows no scores (what was measured stays in `scores.json` as `partial`).
- Speed: 70% time to download start, 30% transfer rate (files ≥ 5 MB); time to the finished file is
  reported, not scored. The file must start within 60 s of the click and may then take up to 15
  minutes (was: finish within 120 s), so a tool serving TikTok's large original file isn't failed for
  the test line's bandwidth. The page is checked every 250 ms (the harness had a fixed ~7 s wait).
- Each run records its vantage point (country, Cloudflare location) and bandwidth, never the IP
  address; tests refuse to run off the residential line.
- Samples chosen (see `samples/core.json`): photo groups are 1–2 images, 3–10 images, and
  high-resolution (≥ 2000 px) posts; the first link variant is V1 without `www.`.
- iPhone check: taps follow §5.2 (control brought to mid-screen, ad layers closed, ad pages left
  with Back); a failed check counts only once a person confirms it from the screenshot.
- A failure where the site showed an error quotes it ("the site said: …").
- N2 is TikTok's Explore page instead of a sound page: two tools rightly offer a sound's audio, so a
  sound page isn't a should-fail case.
- A tab that shows the requested file itself is the delivery, not a pop-up.
- Rewarded ads (a video ad that must play out to "earn" the file) are ad walls, detected inside ad
  frames and never waited out; when only the chosen option has one, the next option is used.
- Photo posts: when "Download all" gives no file, the photos are saved one by one (as a visitor
  would); controls are found again by label at click time (ads inserted on the page shift positions).

### 2026-10-19 — Spec v0.2 (draft)
- Every item runs on desktop **and** mobile; categories A–E are averaged 50/50.
- Category F becomes "Mobile experience, accessibility and friction", with mobile usability checks
  (no horizontal scroll, 16 px link box, WCAG 2.2 target sizes, no ad between the paste box and the
  download control).
- iPhone (iOS Safari) check runs only when an iOS Simulator is available; otherwise "not measured".
- One residential vantage point; the daily uptime monitor runs on the same machine.
- Results are published on GitHub Pages.
- Tool list: added indown.io and ttsave.net; savefrom.net not tested (unreachable from the vantage
  point).
- Contact address for disputes: greyapp@protonmail.com.

### 2026-10-19 — Spec v0.1 (draft)
- First draft of the method, scoring and governance.
