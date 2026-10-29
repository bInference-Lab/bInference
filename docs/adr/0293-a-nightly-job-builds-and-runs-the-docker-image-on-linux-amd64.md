# 0293. A nightly job builds and runs the Docker image on Linux amd64

Status: Accepted

Accepted by the owner on 2026-10-29.

## Context

`pnpm test:image` builds the Docker image from the checkout, sets it up, trades on paper and stops
it ([decision 0292](0292-the-docker-image-runs-binference-as-its-own-user-on-a-state-volume.md)).
It needs Docker and the network, takes about 2 minutes on a developer's laptop with a warm build,
and stays out of `pnpm check`. Run only by hand, a change to a package's build, such as an export
the build never made, reaches master unseen: two such faults stopped the built package from
starting until the image found them. The tests run on arm64 laptops, while most servers are
amd64. A pull request push starts 11 jobs, 12 with the mutation job; the nightly workflows start
at 02:17, 03:41 and 04:23 UTC, and the crash suite's jobs run for up to 2 hours.

## Decision

- **`image.yml`** runs `pnpm test:image` every night at 01:13 UTC, before the other nightly
  workflows start, and by hand, from master.
- **One job on `ubuntu-latest`**, which is amd64 and has Docker. No macOS or Windows row: the
  image runs Linux on every OS, and Linux minutes cost least.
- **30-minute timeout**: a cold build of both stages and the run take about 10 minutes on a hosted
  runner by estimate, which leaves room for a slow registry or package mirror.
- The job holds no key and no secret: Privy, Telegram and the model are the test's fakes, and the
  paper trade reads public nodes and KyberSwap's public API.
- `permissions: read-all`, a concurrency group that never cancels a run, actions pinned to full
  commit SHAs, and `persist-credentials: false`, as every workflow.

## Consequences

- A pull request push starts as many jobs as before; each night adds one Linux job of about 10
  minutes.
- A change that breaks the built package or the image shows on master by the next morning.
- arm64 is still proven only on laptops; the release workflow builds both.

## Alternatives

- **On every pull request push.** It would add a 10-minute job to each push for a fault that a
  nightly run catches within a day.
- **amd64 and arm64 each night.** GitHub's arm64 runners cost more, and arm64 already runs on
  every developer's laptop.
- **Build only, with no run.** Both faults the image found built cleanly and failed at start.
