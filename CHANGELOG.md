# Changelog

All changes to the specification, the tool list, the samples, and every correction to published
results are recorded here.

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
