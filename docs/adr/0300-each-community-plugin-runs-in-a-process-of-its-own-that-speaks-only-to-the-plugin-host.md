# 0300. Each community plugin runs in a process of its own that speaks only to the plugin host

Status: Accepted

Accepted by the owner on 2026-10-30.

## Context

[Decision 0092](../DECISIONS.md#d0092) chose Node 26 so that community plugins can run under Node's
permission model. [ARCHITECTURE.md section 14](../ARCHITECTURE.md#section-14) says what the sandbox
refuses: reads outside the plugin's folder, writes outside its data folder, child processes,
workers, native addons, `node:sqlite` and a network of its own; a plugin reaches its declared hosts
only through a fetch the engine makes for it. Node's `--allow-net` is all or nothing, so the engine
must make every fetch. Running a plugin as an OS user of its own is the only thing that stops it
from signalling the engine.

The section does not say how the engine and a plugin talk, what a plugin may ask for, what happens
when one crashes, how a machine whose sandbox does not hold is caught, or what the owner accepts
when a plugin is added. A community plugin is code from anyone, so each of these is a hole if left
open.

## Decision

- **One process per plugin**, started by the plugin host with `--permission`, a file read grant for
  the plugin's folder, a file write grant for its data folder, `--no-experimental-sqlite`, a heap
  of at most 256 MiB, no other grant, an environment that holds no secret, and its data folder as
  its working folder. The engine runs with `--disable-sigusr1`.
- **One channel.** The plugin talks only over the IPC channel the host opens, in JSON messages of
  at most 1 MiB that each side parses with zod. The host sends `start` (the plugin's config values
  and declared hosts), `call` (one tool call or data read, with its deadline) and `fetched` (a
  fetch's answer). The plugin sends `ready` (its tools, which must equal its manifest's),
  `result`, `fetch` (a URL, method, headers and a body of at most 1 MiB) and `log` (a level and a
  code, at most 20 a second). Any other message stops the plugin.
- **Fetches.** The host fetches only HTTPS URLs whose host the manifest declares, through the
  engine's URL guard and outbound proxy, at most 8 at a time, each in 15 seconds with an answer of
  at most 1 MiB. Any other host is refused, and the owner gets `notice.pluginHostRefused` once per
  plugin and host a day.
- **Calls.** A call ends in 30 seconds. Its output is parsed by the schema the tool declares, and
  marks the agent's turn as outside content. A community plugin's tools are read tools: none
  proposes, signs or reaches the protocol.
- **Crashes.** A plugin that exits or breaks the channel starts again after 1 second, the wait
  doubling up to 5 minutes. After 5 crashes in 10 minutes the host turns it off
  (`disabled_reason: crashes`) and the owner gets `notice.pluginStopped`.
- **A sandbox check before any plugin.** At start the host runs a probe plugin that tries each act
  the sandbox refuses. If one succeeds, no community plugin starts on this machine,
  `binference check` fails with what passed, and the owner gets `notice.pluginSandboxOff`. While
  plugins run as the owner's own OS user, `binference check` warns that a plugin could signal the
  engine.
- **The review.** `plugin/add` pins the plugin's files by hash in the plugin lock and shows the
  permission review: its kinds, declared hosts, tools and config keys, its publisher and whether
  npm provenance backs it. The owner accepts the review's digest. An update that declares nothing
  more installs on the old acceptance; one that declares more waits for a new review, the old
  version running meanwhile. A plugin with no npm provenance installs only after the owner types
  its name. Symlinks in a plugin are refused.

## Consequences

- A plugin cannot read the engine's files, keys or config, reach a host it did not declare, start
  a process, load an addon, or open a database; on a machine where any of that fails, none runs.
- A plugin is slower than code in the engine: every fetch crosses the channel. Read tools and data
  sources can carry that.
- The built-package smoke starts the probe plugin on each OS, and the sandbox suite runs on the
  three runners.
- The "Signatures checked" protection of section 14 waits for the Verified tier and its registry
  in v2; v1 shows npm provenance instead.

## Alternatives

- **Plugins in worker threads.** Node's permission model applies per process, so a worker shares
  the engine's grants.
- **A network grant for each plugin.** `--allow-net` cannot name a host; it would open every one.
- **Restart a crashing plugin forever.** A plugin that crashes on start would take the engine's
  time and fill the log.
- **Trust a package's publisher name alone.** Anyone can publish under a name that looks like
  another's; npm provenance at least ties the package to its source build.
