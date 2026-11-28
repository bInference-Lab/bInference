# 0466. The agent's site serves the install script

Status: Accepted

Accepted by the lead on 2026-11-28, on the owner's ruling of the same day: host the install script
on agent.binference.io and deploy it.

Amends [decision 0357](0357-the-install-scripts-pin-one-node-release-by-its-signed-sha-256-and-never-need-root.md)
on where the scripts are hosted.

## Context

Decision 0357 hosts `install.sh` and its sum on binference.io. binference.io is the main bInference
site, which this repository does not build, and it answered 404 for the script: the one-liner in the
README, the guides and the agent's site failed for every new owner of 2026.11.0-beta.1 and
2026.11.0-beta.2. The agent's site, agent.binference.io, is built from this repository
(decision 0452).

## Decision

- The one-liner is `curl -fsSL https://agent.binference.io/install.sh | sh`, with `-s -- --beta` for
  the beta channel. Every page, guide and README names that address.
- The agent's site serves `install.sh` and `install.sh.sha256` as `text/plain; charset=utf-8`. Its
  build copies the script from `install/install.sh` and writes its SHA-256, so the hosted script is
  the file every release stages unchanged; the copies are never committed.
- `install.ps1` is not hosted until the nightly one-liner job has passed once on Windows, as
  decision 0357 says.

## Consequences

- The one-liner works as soon as the site is deployed, and a change to the script reaches owners
  with the next deploy of the site.
- The hosted script follows `master` when the site deploys, not a release tag. The script installs
  the release the channel names, so a newer script never installs an unreleased binference.
- Whoever deploys the agent's site checks that the hosted sum matches the latest release's
  `SHA256SUMS`.

## Alternatives

- Host on binference.io: that site is built elsewhere, and the script stayed at 404.
- Serve from GitHub's raw files or the release assets: the address would name a tag or a branch,
  and the one-liner would change with each release.
