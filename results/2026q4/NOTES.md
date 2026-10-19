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

## Operator disclosure

GetTikVideo runs this benchmark and is one of the tools tested.

- While the harness was built (19 October), its development test passes ran against all 14 tools.
  They found two GetTikVideo problems: a photo that never finished on a high-resolution photo post,
  and a lookup stuck on "Processing…". GetTikVideo fixed both before run 1 (its commits `e961dc5`
  and `a5a984d`, live 15:29–15:41 UTC on 19 October; run 1 started 16:35 UTC). The same development
  passes' findings about other tools are public in `harness/README.md` ("Known limitations and site
  behaviour"), but their owners were not told directly.
- **Deploy freeze:** GetTikVideo does not deploy any change to its site during this edition's run
  windows, so the operator's own tool can't change mid-test. Its last deploy before run 1 was
  `a5a984d` (15:41 UTC, 19 October). Windows: run 1 from 16:35 UTC on 19 October until it ends;
  run 2 and any re-runs are added here with their times.
