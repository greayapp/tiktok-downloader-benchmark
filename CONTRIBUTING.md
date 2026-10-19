# Contributing

Thanks for helping keep this benchmark accurate. Because the benchmark is run by GetTikVideo, one of
the tools it tests, contributions from anyone — including other tools' owners — are welcome and
handled in public.

## Ways to contribute

- **Dispute a result** — use the [dispute form](https://github.com/greayapp/tiktok-downloader-benchmark/issues/new?template=dispute.yml)
  with evidence (screenshots, screen recordings, timestamps, the exact link and steps). We re-test
  within 14 days and log the outcome in [CHANGELOG.md](CHANGELOG.md).
- **Suggest a tool** — use the [suggestion form](https://github.com/greayapp/tiktok-downloader-benchmark/issues/new?template=tool-suggestion.yml).
  Inclusion follows [SPEC.md §3](SPEC.md#3-scope).
- **Fix a bug in the harness** — open an issue first for anything bigger than a small fix.
- **Improve an adapter** — adapters must use a tool the way a typical visitor would (see
  [SPEC.md §5.2](SPEC.md#52-per-item-flow)): the most prominent control that matches the task,
  no hidden endpoints, no shortcuts a visitor wouldn't take.
- **Propose a change to the method** — open an issue labelled `spec`. Accepted changes take effect
  from the next edition, never the current one.

## Ground rules

1. **Disclose affiliation.** If you run or work for a tool in the benchmark (GetTikVideo included),
   say so in your issue or pull request.
2. **No paid placement.** Offers of payment for inclusion, order or score are declined and may be
   published.
3. **Evidence over opinion.** Claims about a tool need something others can check.
4. **Frozen editions.** Once an edition is tagged (`edition-YYYYqN`), its spec, weights, tool list and
   adapters don't change until it is published, except to fix a confirmed bug, which is logged.
5. **No media.** Never commit downloaded videos, audio or images; commit hashes and metadata only.

## Pull requests

- Keep each pull request to one change, and explain why it is needed.
- Fill in the checklist in the pull-request template.
- The harness's checks must pass.

Development setup and the harness's test commands will be documented here when the harness lands.

By contributing you agree that code is licensed under [MIT](LICENSE) and documentation or data under
[CC BY 4.0](LICENSE-DATA.md), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
