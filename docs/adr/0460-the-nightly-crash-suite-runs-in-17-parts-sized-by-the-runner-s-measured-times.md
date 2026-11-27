# 0460. The nightly crash suite runs in 17 parts sized by the runner's measured times

Status: Accepted

Accepted by the lead on 2026-11-27 (option A: 20 runs at every kill point each night).

Amends [decision 0339](0339-the-crash-suite-sends-stakes-and-bridges-on-stand-ins-of-the-bare-chain.md)
on the nightly parts.

## Context

Decision 0339 runs the crash suite each night in seven parts, 20 runs at each kill point, each
part under 120 minutes by the times measured on the maintainers' laptop. On the hosted
`macos-latest` runner no night from 2026-11-23 to 2026-11-27 passed: the swaps, the live fills,
the stakes and the Relay bridges reached the 120-minute limit every night they ran, and the
Across bridges failed once in 240 runs and took 94 minutes when they passed.

The runner logs give each run's time for the parts that finished (runs 45636512737 and
46012197120). Against `config/vitest/crash-times.generated.json`:

| Part                | Laptop estimate | Runner              | Runner / laptop                |
| ------------------- | --------------- | ------------------- | ------------------------------ |
| coin launches       | 37 min          | 104 and 106 min     | 2.8 (2.3 to 4.8 by kill point) |
| token pair launches | 30 min          | 83 and 46 min       | 2.9 and 1.6                    |
| Across bridges      | 78 min          | 95 and 94 min       | 1.2                            |
| resent writes       | 28 min          | 57 and 56 min       | 2.1 and 2.0                    |
| chat launches       | 11 min          | 30 and 35 min       | 2.7 and 3.2                    |
| swaps and the rest  | 73 min          | over 118, cancelled | over 1.6                       |
| live fills          | 61 min          | over 118, cancelled | over 1.9                       |
| stakes              | 53 min          | over 118, cancelled | over 2.2                       |
| Relay bridges       | 79 min          | over 118, cancelled | over 1.5                       |

A run that waits for the engine's 30-second delivery read is 1.2 times slower on the runner; one
that mostly computes, 2 to 3 times. A part that Vitest stops at the limit prints no run times, so
the four cancelled parts have none yet; their uploaded results hold them.

The account runs 5 macOS jobs at once: on 2026-11-27 the sixth and seventh crash parts started
only when an earlier one ended. A push to `master` starts 8 macOS jobs.

## Decision

- **Measured times per machine.** `BINFERENCE_CRASH_TIMES` names the machine whose times size a
  pass: unset, the laptop's file as today; `macos-runner`, the runner's,
  `config/vitest/crash-times.macos-runner.generated.json`. `pnpm crash:times` writes the file it
  names. The runner's file holds the runner's mean for every kill point the logs above timed, and
  for the others the laptop's time times 2.9, the slowest whole part measured, until a night's
  uploaded results replace them. The reporter's estimate and its refusal of a part over 120
  minutes stay as they are, on those times.
- **17 parts,** each 32 to 77 minutes by the runner's times at 20 runs a point, about 1,010
  minutes in all. A file whose points take longer runs in parts that each name their points with
  `-t`: the live fills by kind, the coin launches, the stakes and both bridges by kill point.
  Every kill point is in one part.
- **20 runs at each kill point each night** stay, as decisions 0129 and 0290 set.
- **Three parts at a time** (`max-parallel: 3`), so a push to `master` still finds 2 of the 5
  macOS runners. A night takes about 6 hours of wall time.

| Each night     | Before                             | After                       |
| -------------- | ---------------------------------- | --------------------------- |
| Crash jobs     | 7                                  | 17                          |
| Runner minutes | 730 to 770, 4 parts stopped at 120 | about 1,010 by the estimate |
| Longest part   | over 120 minutes                   | about 77 minutes            |
| All jobs       | 33                                 | 43                          |

## Consequences

- Every part ends before its limit with a margin of about a third, and a failure names its part.
- The Relay parts' estimate uses the 2.9 factor; if their runs take as long as Across's on the
  runner, each takes about 40 minutes and the first night's results let them join two parts.
- After a night, `BINFERENCE_CRASH_TIMES=macos-runner pnpm crash:times <results>` on its
  uploaded results refreshes the runner's times; a part they put over 90 minutes splits again.
- A new kill point or crash file joins a part in the matrix, or the night skips it, as before.

## Alternatives

- **10 runs at each kill point each night,** in the seven parts: about 510 minutes, the longest
  part (the Relay bridges) about 114 minutes by the same times, so it still needs splitting. Each
  point would reach 100 runs on an OS in 10 nights instead of 5. It halves the runner minutes but
  lowers the nightly bar decisions 0129 and 0290 set. Left to the maintainers.
- **The kill points in turns,** half of them each night at 20 runs: the same minutes as 10 runs a
  night, and a fault at a point shows a night later. Left to the maintainers.
- **One factor over the laptop's times.** The runner's ratio goes from 1.1 to 4.8 by kill point,
  so one factor oversizes the bridges or undersizes the launches. Rejected.
- **A longer job limit.** A part over two hours shows a failure late, and a slow runner still
  stops it. Rejected, as in decision 0290.
