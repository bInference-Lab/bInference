# 0290. The nightly crash suite runs in four parts on each OS

Status: Accepted

Accepted by the tech lead on 2026-10-21.

## Context

The nightly `crash` workflow runs `pnpm test:crash` on Linux, macOS and Windows, 20 runs at each
kill point, in one job per OS with a 60-minute timeout. It was sized for the first five kill
points ([decision 0129](0129-the-crash-suite-kills-an-engine-built-from-the-real-executor.md)).
The suite now has 41: 5 of a swap, 13 of live order fills, 19 of a token launch from the CLI and
3 from Telegram
([decision 0287](0287-the-crash-suite-launches-flap-tokens-on-stand-ins-of-the-bare-chain.md)).
One run of every point takes about 6 minutes on a developer's laptop, so 20 runs take about 2
hours there, and longer on a hosted runner, past both the job's timeout and a sensible wait for
one job. GitHub Actions is off for now, so no hosted run times exist yet.

At 20 runs a point on the same laptop: the swaps and chat launches take about 20 minutes, the
live fills about 42, the coin launches about 34 and the token pair launches about 25.

## Decision

- **Four parts per OS.** The job's matrix runs each OS with four parts: the swaps and chat
  launches, the live fills, the launches against the coin, and the launches against a token
  pair. A part names its test files and, for the launches, the kill points it runs by name.
- **Timeout 120 minutes** per job: the longest part takes about 42 minutes on a laptop, which
  leaves room for a runner up to two and a half times slower.
- **20 runs at each kill point on each OS** stay the default; a run by hand still takes `runs`.

## Consequences

- A night runs 12 crash jobs, 4 per OS, where it ran 3, and its wall time follows the longest
  part rather than the sum.
- A new crash test file joins a part in the matrix, or the night skips it.
- The run times are checked against the first three hosted runs once Actions is on, and the
  parts or the timeout change if a part takes over 90 minutes.

## Alternatives

- **One job per OS with a 6-hour timeout.** It fits, but a failure shows after hours, and a slow
  runner can still time it out. Rejected.
- **Vitest's file shards.** The launch file alone takes over half the time, and a shard splits
  only by file. Rejected.
- **Fewer runs at each point.** Y15 asks for 100 runs on each OS with no second send; fewer runs
  at a launch's points would test each of them less than the swap's were. Rejected.
