# 0292. The Docker image runs binference as its own user on a state volume

Status: Accepted

Accepted by the owner on 2026-10-29.

## Context

[Decision 0054](../DECISIONS.md#d0054) names a Docker image as one way to install binference, and
ENGINEERING section 24.5 fixes its shape: a Node `bookworm-slim` base, a non-root user, the state
folder as a volume and `binference health` as the health check. Nothing yet says how the image
is built, which user and paths it uses, how it stops, what its health check reports, how its
engine is reached, or how its keys open after a restart.

Facts that bound the choice:

- The engine binds its HTTP port to `127.0.0.1` only and trusts no address (protocol spec,
  section 2). In a container, that is the container's own loopback.
- The shutdown order may take up to `engine.shutdownBudgetMs`, 30 seconds by default. Docker
  waits 10 seconds after `SIGTERM` before it sends `SIGKILL`.
- A container has no desktop session and no keychain, so init picks the `file` unlock mode
  (keys spec, section 3).
- Community plugins, which would run under a user of their own, have no process host yet; every
  plugin today is a core plugin inside the engine.

## Decision

- **Build.** Two stages from the Node 26.10.0 `bookworm` and `bookworm-slim` images, each pinned
  by the digest of its multi-arch index, so amd64 and arm64 build from the same release. A newer
  base must be at least 7 days old. The build stage installs pnpm, fetches the lockfile's
  packages and checks their release dates; installing with scripts off and building run with no
  network. `pnpm deploy --prod` copies the `binference` package with its production
  dependencies to `/opt/binference`. The build reads only an allow list of files
  (`.dockerignore`): manifests, `packages/`, `plugins/`, `skills/` and the license files, never
  a `.env` file, a key or a state folder.
- **User and paths.** A user and group `binference`, ids 10001, apart from the base's `node`
  user. The state folder is the default `~/.binference`, `/var/lib/binference/.binference`, made
  owner-only in the image and declared a volume, so a new named volume takes its owner and mode.
  `BINFERENCE_HOME` stays unset.
- **Process.** The entry point is `binference`, the command `start --foreground`, so Node runs as
  PID 1 and the CLI's own `SIGTERM` handler runs the shutdown order. The stop signal is
  `SIGTERM`. Owners run the container with `--stop-timeout 45`, which covers the 30-second budget
  with room to spare; the guide says so, as a Dockerfile cannot set it.
- **Health check.** `binference health` every 30 seconds, 10-second timeout, 90-second start
  period, 3 retries. It exits 0 while the engine is `ready` or `locked` and 1 while it starts or
  cannot be reached. A locked engine counts as healthy: it waits for the owner, a restart would
  leave it locked, and its notice already reaches the owner.
- **Reaching the engine.** The image publishes no port. On a server the container runs with
  `--network host`, so the engine's loopback is the host's: the owner opens the console through
  an SSH tunnel, and the Mini App through `remote.publicUrl` and the host's own HTTPS.
- **Keys.** The `file` mode is the default: the agent key opens from the volume at each start.
  The `manual` mode suits an owner who accepts typing the passphrase after each restart through
  `docker exec -it`. The `command` mode needs its program in the image, which this image does not
  hold.
- **Read-only root.** The image runs with `--read-only` and a `tmpfs` at `/tmp`; it writes only to
  its volume. A state folder it cannot write stops the start with a message that names the path
  and says it must be the user's and not mounted read-only.
- **Plugins.** The image holds no second user until community plugins get their process host;
  that host adds the user the plugins run as.
- **Publishing.** The release workflow, once it exists, builds the image for amd64 and arm64 and
  publishes it to GitHub's registry as `ghcr.io/<org>/binference`, with an SBOM. Until then
  owners build the image from the source of the release they run.
- **Proof.** `pnpm test:image` builds the image, checks its user, health check and volume, sets
  an install up with `binference init --yes`, starts it, fills a paper trade, stops it with
  `docker stop`, and removes what it made. Privy, Telegram and the model provider are the e2e
  fakes behind an HTTPS edge on the test's Docker network; the paper trade quotes on public BNB
  Smart Chain nodes and KyberSwap's API. `pnpm check` never runs it.

## Consequences

- An owner runs the same engine on a server as on a laptop, with the same unlock modes, ports and
  state folder.
- The image is about 117 MB to download and 700 MB on disk; the build needs the network for the
  package install only.
- The console and the Mini App need the host's network or an SSH tunnel; a bridge network with
  `-p 7456:7456` reaches nothing, as the engine binds loopback.
- Docker's default 10-second stop cuts a long shutdown short; the crash suite proves a kill sends
  nothing twice, so the cost is a slower next start, not lost money.

## Alternatives

- **The base image's `node` user.** Its id 1000 is often a person's account on the host, so a bind
  mount would hand that person the state folder.
- **A small init such as `tini` as PID 1.** The engine waits on its two child processes and
  handles `SIGTERM` itself, so an init adds a package and a layer for no gain.
- **Bind the engine beyond loopback inside the container.** The protocol spec forbids it, and the
  console's origin check expects `127.0.0.1`.
- **Report a locked engine as unhealthy.** An orchestrator would restart it in a loop, and each
  start would be locked again until the owner unlocks it.
- **Publish now from a laptop, or to Docker Hub.** Releases publish only from CI with provenance
  (ENGINEERING section 13), and GitHub's registry sits beside the source and its releases.
- **One stage on the slim base.** The slim base lacks the build tools and would ship the source,
  the store and the development packages.
