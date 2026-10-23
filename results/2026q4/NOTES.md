# Q4 2026 edition — notes and disclosures

**Method:** spec v1.0 (tag `spec-v1.0`). **Inputs** (tools, samples, references, adapters): tag
`edition-2026q4`. Every run's real dates, vantage point and bandwidth are in its `run.json`.

## Timing

- First planned for December; tested in late October 2026 instead (October is already Q4). The
  method is unchanged; see CHANGELOG.md, 2026-10-19.
- Uptime (§6.A3) covers the days the daily monitor ran this quarter, from 19 October.

## Vantage point

- Tests: one residential connection in India. References and the pre-run sample checks: through a
  VPN (Tokyo), because tiktok.com is blocked at the vantage point (§4.3).

## Run log

- **Run 1** started 16:35 UTC on 19 October. At 01:48 UTC on 20 October the runner stopped making
  progress (it waited on a page that never answered, during TikCD's mobile block). It was stopped at
  about 02:50 UTC and resumed at 02:53 UTC with a fix to the runner (commit `b4f9f0f`: page reads time
  out, an item unfinished after 12 minutes is "skipped", not counted). The 17 tool × viewport blocks
  already finished were kept; TikCD's mobile block was redone from its start. Nothing about how tools
  are tested changed; run 2 uses the same runner.

- **Run 1 ended** at 09:10 UTC on 20 October (all 14 tools, both viewports).
- **Two blocks redone** after run 1 (10:20–12:27 UTC on 20 October), because of a harness bug in the
  photo step, fixed in commit `558676b`: a site that opens each photo in a new tab (TikCD on phones)
  had photos lost (a slow photo tab was taken for an ad and closed; a tab in the background can't
  open the next one) or uncounted; the "Download all" control also took one photo's slot. Only two
  blocks showed the pattern — TikCD mobile and TikTokio desktop — and both were redone whole with
  the fixed harness; the records they replace are kept on the test machine. Since this fix the
  harness also brings the tool's tab to the front before each tap (a person switches back after a
  file opens in a new tab); run 2 uses the same harness.
- **GetTikVideo timeouts:** five GetTikVideo items in run 1 (22:22–22:45 IST, 19 October) failed
  because its site didn't answer (`net::ERR_TIMED_OUT`). A one-hour connection watch on the same
  line showed the line itself fine (360/360 connections to Cloudflare over IPv4 and IPv6, and to
  GetTikVideo's host) apart from one slow connection to GetTikVideo's host, so these count as
  GetTikVideo failures, like any tool's.
- **Outage re-run:** LoveTik failed every item of run 1 ("Error: Could not get Video ID."), which
  meets the outage rule (§5.3: at least 80%); it is re-run once, at least 24 hours later, and the
  re-run replaces its run 1 result.
- **LoveTik re-run** (`r1b`): 07:40–10:22 UTC on 22 October, after all 30 samples were checked live
  (07:29 UTC). LoveTik failed every item again (70 of 70, same message); the three should-fail
  links were refused, as in run 1. As the rule says, this result replaces its run 1 result (the
  run 1 records are kept on the test machine), and the outage counts in its uptime.
- **Run 2** started 10:23 UTC on 22 October (run 1 started 16:35 UTC, a different time of day) and
  ended 02:43 UTC on 23 October (all 14 tools, both viewports).
- **One block redone** after run 2 (03:09–03:13 UTC on 23 October): TikMate on desktop. Every item's
  screenshot shows Google's offerwall ("Unlock more content · View a short ad"), but the harness
  didn't recognise it and recorded "no download control" (and silent should-fail answers) instead;
  run 1 and run 2's phone block recognised the same wall. The wall check was fixed (commit
  `e6db999`: it also reads shadow roots, Chrome's accessibility tree and every frame, on arrival
  and before recording a failure) and the block redone whole: all 38 items are an ad wall, as in
  run 1. The records it replaces, and their screenshots, are kept on the test machine. No other
  "no download control" failure in either run shows a wall in its screenshot.
- **No second outage re-run:** LoveTik failed every item of run 2 as well (70 of 70, same message).
  The outage rule (§5.3) calls for one more re-run; the operator's owner decided not to run it,
  since LoveTik had then failed all 210 items across run 1, its re-run and run 2. Its run 2 result
  stands, and LoveTik is listed as "down during testing", without a score. This departs from §5.3
  and is logged in CHANGELOG.md.

## Review (what a person confirmed, 23 October)

- Pop-ups: the new tabs of SSSTik, MusicalDown, TTDownloader, TikTokio and TTSave were checked and
  confirmed as tabs the visitor didn't ask for (ad tabs; TikTokio's and TTSave's pop-unders end on
  Google's home page). TTDownloader's other new tabs are its own download tabs (how it delivers the
  file) and don't count; its ad tab (grotaich.net, on the first click) does.
- Deceptive ads (§6.D): TikCD's "iPhone app for free" is first in its list of download buttons,
  styled like them (desktop and phone); TTDownloader's "Buy Cheap TikTok Followers — Learn More" is
  a row in its table of download options (desktop; the row is empty on phones). Screenshots in
  `evidence/tikcd.com/` and `evidence/ttdownloader.com/`.
- No Better Ads violation or forced wait was found in any tool's screenshots. SSSTik's phone result
  carries heavy ads, but a mobile ad density over 30% can't be shown from the screenshots, so it
  isn't flagged.
- iPhone check (§6.F): failures confirmed for TikMate (ad wall), LoveTik (outage) and TikWM (the
  video opened in Safari's player, not saved). TTSave's was rejected: a full-screen ad with a Close
  button covered the page, which a person would close. SaveTik's wasn't judged (not scored).
- All decisions are in `review.json`.

## Corrections before publishing

Three harness and scoring bugs were found while checking the results, fixed, tested and logged
in CHANGELOG.md before anything was published:
1. TikMate's ad wall wasn't recognised in run 2's desktop block (`e6db999`); the block was redone.
2. Quality counted should-fail links as perfect downloads (`102148f`); every tool's quality was a
   little too high.
3. Chrome's own error page after a page that failed to load was counted as a redirect, −40 under
   Ads (`7fd25be`). **This raised GetTikVideo's overall score from 83 to 91**: its 8 such pages all
   came from home-page timeouts on the test line, which still count as failures under
   reliability. MusicalDown had 1.

## Also note

- Large files: TikTokio's and TikMate's download servers cut off the largest original files
  (about 200–270 MB) 2–4 minutes into the transfer; files that finish sooner arrive. These count
  as failures (the file didn't arrive). Chrome offers a Resume button on an interrupted download,
  which the harness doesn't use.
- TikMate: most items are behind its ad wall, so its reliability comes from the few that weren't
  (5 items).
- LoveTik: no download worked in any run (its outage re-run included), so it is listed as "down
  during testing", without a score.

## Operator disclosure

GetTikVideo runs this benchmark and is one of the tools tested.

- While the harness was built (19 October), its development test passes ran against all 14 tools.
  They found two GetTikVideo problems: a photo that never finished on a high-resolution photo post,
  and a lookup stuck on "Processing…". GetTikVideo fixed both before run 1 (its commits `e961dc5`
  and `a5a984d`, live 15:29–15:41 UTC on 19 October; run 1 started 16:35 UTC). The same development
  passes' findings about other tools are public in `harness/README.md` ("Known limitations and site
  behaviour"), but their owners were not told directly.
- Between run 1 and run 2 (the freeze was lifted between runs), GetTikVideo deployed two changes
  to its "More from @creator" recent-videos list on 21 October (its commits `6df28e8` and `a54466e`).
  They don't touch the download steps, but run 2 tests that newer version.
- **Deploy freeze:** GetTikVideo does not deploy any change to its site during this edition's run
  windows, so the operator's own tool can't change mid-test. Its last deploy before run 1 was
  `a5a984d` (15:41 UTC, 19 October); its last deploy before run 2 was `a54466e` (21 October).
  Windows: run 1, 16:35 UTC on 19 October to 09:10 UTC on 20 October, then the redo, 10:20–12:27 UTC
  on 20 October; the LoveTik re-run and run 2, from 07:40 UTC on 22 October until run 2 ends.
