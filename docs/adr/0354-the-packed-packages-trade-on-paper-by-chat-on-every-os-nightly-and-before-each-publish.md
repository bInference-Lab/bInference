# 0354. The packed packages trade on paper by chat on every OS, nightly and before each publish

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

The Docker image found two faults no unit test saw: a build that never wrote `dist/orders.mjs`, and
a runtime bundle the permission model could not read, so a built `binference` crashed. Decision
0353 runs `pnpm release:dry`, which installs the packed tarballs and checks that `binference
--version` prints the version and that each package loads, and a smoke job on Linux. Decision 0352
puts 36 workspace packages inside the `binference` tarball, each with its own `exports`, and the
CLI starts the signer, runtime, plugin and worker files of those packages by name. A file one of
them names but lacks fails only when that path runs. The image suite (decision 0292) runs Linux
alone and through Docker; an owner's `npm i -g binference` runs on macOS and Windows too.

Facts that bound the check:

- `binference start` reads BNB Smart Chain and quotes through KyberSwap's API, so a paper trade
  needs the network, as the image suite's does.
- Privy's and Telegram's addresses are fixed in the code; the model provider takes any address,
  `http` on this machine included. `network.proxy` (decision 0347) sends every other request
  through the owner's proxy, and Node trusts a certificate that `NODE_EXTRA_CA_CERTS` names.
- The install must not see the repository: a project inside it resolves a package a tarball lacks
  from the repository's own `node_modules`.
- `binference start` with `BINFERENCE_HOME` set refuses the login service, so `start --foreground`
  is the start a test makes on every OS.

## Decision

- **The smoke.** `pnpm release:smoke <folder>` takes the files a dry run wrote and installs the
  tarballs into an empty project in the OS's temporary folder. It checks that every file each
  package's manifest names is there (every `exports` target and condition, `bin` and `main`), for
  the four published packages and each workspace package they carry, and names each one missing.
  It checks `binference --version` and loads each package. Then the installed `binference`,
  started with this Node and only the variables the smoke names, runs `init --yes` in a fresh
  state folder, `start --foreground`, a paper trade by chat and `stop`.
- **The world it runs in.** The e2e fake Privy and the synthetic Bot API serve TLS on the loopback,
  with a P-256 certificate made by Node's crypto for their two names, which the install trusts
  through `NODE_EXTRA_CA_CERTS`. A stand-in proxy on the loopback, which init writes as
  `network.proxy`, opens tunnels to those two names to the fakes and every other tunnel to the
  host it names. The model is an OpenAI-compatible stand-in on the loopback, set with
  `--model-provider openai-compatible`: init's checks get the fake provider's answer, and the
  agent's first turn calls `swap` for USDT with 0.001 BNB, then reports. The owner pairs with the
  link init printed, the paper portfolio gets its starting balances over IPC, the owner's message
  reaches the agent, and the smoke taps Confirm on the card and waits for the paper fill and the
  report. Each step has a time limit; a failure prints the engine log's last 40 lines and the
  hosts the proxy tunnelled to.
- **The dry run.** `pnpm release:dry` makes the same install outside the repository, with the same
  file check, and writes its SBOM from there; it does not trade.
- **The nightly pack.** `pnpm release:dry --pack-only <version>` takes only a nightly version,
  `YYYY.M.PATCH-nightly.N`, a prerelease no release tag names. It skips the tag, channel and
  version order checks, writes no notes, no SBOM and no publish dry run, marks every published
  manifest `"private": true`, so npm refuses to publish its tarballs from anywhere, and writes a
  `release.json` on the `nightly` channel.
- **The publish check.** Before it publishes anything, the release workflow's npm job runs
  `scripts/release-publish-check.mts` on Node alone, with no install, on the files it got: only a
  stable or beta version on its own channel passes. Its refusal stops npm, the image push and the
  GitHub release.
- **CI.** `release.yml`'s smoke job runs on Linux, macOS and Windows, and npm publishes only when
  all three pass. A new nightly workflow, `packed.yml` at 00:37 UTC and by hand, packs once on
  Linux with `--pack-only` at `YYYY.M.0-nightly.<run number>` of the month and runs the smoke on
  the three runners. Each smoke job has 15 minutes; no job holds a key, and nothing is published.
- **Proof.** `check:gates` packs a package whose `exports` names a file it lacks, and
  `pnpm release:smoke` must fail, naming the package, the entry and the file. It runs the publish
  check on a nightly manifest, and on a nightly version relabelled as a beta, and both must fail,
  and `--pack-only` must refuse any version that is not a nightly.

Jobs:

| Event                  | Before | After                                                   |
| ---------------------- | ------ | ------------------------------------------------------- |
| A pushed release tag   | 3      | 5: dry run, smoke on three OSes, image                  |
| A run by hand, publish | 5      | 7                                                       |
| Each night             | 34     | 38: the packed-install workflow's pack and three smokes |
| A push to `master`     | 12     | 12                                                      |

## Consequences

- A tarball that lacks an entry, a process file the install cannot start, or a worker it cannot
  load fails the night it lands, on the OS where it fails, before a release tag. A new entry point,
  process file or plugin is covered once it runs in the paper trade or names its file in a
  manifest.
- The smoke takes about 30 seconds after the install on a laptop, of which the trade is about 9.
  Linux, macOS and Windows minutes grow by three short jobs a night.
- The paper trade depends on BNB Smart Chain's public RPCs and KyberSwap's API, as the image suite
  does; an outage there fails a night's smoke, and the failure names the hosts it tunnelled to.
- The smoke proves the proxy path end to end, since every request but the model's goes through it.
- The dry run's install moves out of `reports/release/<version>/smoke`, so the workflow keeps no
  smoke folder.
- A nightly's tarballs differ from a release's only in their version and the `private` field.
- Linux and Windows are proved by CI only; it stays off until the owner turns it on.

## Alternatives

- **Config keys for Privy's and Telegram's addresses.** A test-only switch in every owner's config,
  which an attacker who edits the file could point elsewhere.
- **openssl for the certificate.** The image's build stage has it; a Windows runner's PATH does
  not promise it.
- **The image suite alone.** Linux and Docker only, and it trades over IPC, not by chat.
- **A nightly dry run at a beta version.** It passed the version order check only because a
  shallow checkout holds no tags, and a beta version can be published.
- **A smoke per OS that packs for itself.** Three builds a night instead of one, and the tarballs
  tested would differ from the ones a release publishes.
- **Every request offline, against anvil.** The fork needs anvil on every runner and the network
  to fork from; the bare crash chain holds no KyberSwap or token contracts for a real quote.
