# TikTok Downloader Benchmark

An open, measured comparison of TikTok downloader websites: does the download work, is the file
what the button says, how fast is it, and do the site's ads get in the way or mislead?

**Live results:** https://greayapp.github.io/tiktok-downloader-benchmark/

> **Disclosure:** this benchmark is run by [GetTikVideo](https://gettikvideo.com), one of the tools
> it tests. That's why everything here is public: the method, the code, the raw data and the
> evidence, so anyone can check the results or run the tests themselves.

## Status

| | |
|---|---|
| Specification | [v1.0](SPEC.md) — frozen (tag `spec-v1.0`) |
| First edition | **Q4 2026** — tested 19–23 October 2026; [results](https://greayapp.github.io/tiktok-downloader-benchmark/) and [notes](results/2026q4/NOTES.md) |
| Cadence | Quarterly (March, June, September, December); December is the annual edition |
| Tools in the first edition | 14 — see [Appendix A of the spec](SPEC.md#appendix-a--candidate-tools-for-q4-2026) |
| Daily uptime check | Two links per tool every day; [monthly logs](results/monitor/) |

## What is measured

Every tool gets the same 38 public TikTok links (videos, photo posts, MP3 tasks, link variants and
links that should fail), on desktop and on a phone, twice per edition.

| Category | Weight | In short |
|---|---|---|
| Reliability | 30 | The file downloads, plays and matches the post; clear errors for bad links; daily uptime |
| Ads and intrusiveness | 20 | Pop-ups, redirects, Better Ads Standards violations, notification prompts, deceptive ads, forced waits, extra clicks. Showing ads is not penalised. |
| Quality and honesty | 15 | Resolution against the best available; "HD", "No watermark" and "MP3" labels that are true |
| Speed | 15 | Median time from submitting the link to the download starting, and how fast the file arrives |
| Privacy and safety | 10 | Trackers, cookies before any click, app-install pushes; tools flagged unsafe are not ranked |
| Mobile, accessibility, friction | 10 | Accessibility score, mobile usability, Core Web Vitals, logins, captchas, limits |

Scores use fixed thresholds, so a tool's score doesn't depend on how the others did. The details are
in [SPEC.md](SPEC.md).

## How it stays fair

- The spec, weights, tool list and test code are frozen (tagged) before each edition's first run.
- GetTikVideo goes through exactly the same process as every other tool, and its results are
  published however they come out.
- No payment, affiliate link or sponsorship decides inclusion, order or score.
- Every penalty is backed by a dated screenshot or log, published in `results/`.
- Results can be disputed; confirmed errors are corrected in public.

## Repository layout

```
SPEC.md               the method (versioned)
CHANGELOG.md          spec changes, corrections, replaced samples
samples/core.json     the fixed test links (the rotating set is published with each edition's results)
samples/reference/    ground truth for each link, read from TikTok's own page data
harness/              test code, per-tool adapters, the daily uptime check and the iPhone check
results/<edition>/    scores, raw records, network summaries and evidence
results/monitor/      daily uptime logs (one file per month) and the per-edition uptime summary
site/                 the live site (GitHub Pages)
```

To run the tests yourself, see [harness/README.md](harness/README.md).

## Dispute a result or suggest a tool

- **Dispute a result:** [open a dispute](https://github.com/greayapp/tiktok-downloader-benchmark/issues/new?template=dispute.yml)
  with your evidence, or email **greyapp@protonmail.com**. We re-test within 14 days.
- **Suggest a tool:** [suggest it](https://github.com/greayapp/tiktok-downloader-benchmark/issues/new?template=tool-suggestion.yml).

See [CONTRIBUTING.md](CONTRIBUTING.md) for code and adapter contributions.

## Licence

- Code (`harness/`, `site/`, workflows): [MIT](LICENSE).
- Specification, documentation, samples metadata and results: [CC BY 4.0](LICENSE-DATA.md).

No downloaded media is stored in this repository: files are deleted after verification and only
their hashes and technical metadata are kept.

## Citing

See [CITATION.cff](CITATION.cff), or: *TikTok Downloader Benchmark, GreyApp, edition 2026 Q4,
https://greayapp.github.io/tiktok-downloader-benchmark/*.
