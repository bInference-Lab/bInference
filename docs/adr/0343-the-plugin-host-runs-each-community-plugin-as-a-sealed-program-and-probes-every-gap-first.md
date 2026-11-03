# 0343. The plugin host runs each community plugin as a sealed program and probes every gap first

Status: Accepted

Accepted by the tech lead on 2026-11-03.

## Context

[Decision 0300](0300-each-community-plugin-runs-in-a-process-of-its-own-that-speaks-only-to-the-plugin-host.md)
sets what the plugin host does. It leaves open where the host lives, what a community plugin
declares and exports, how its process is started, and how the host learns that Node's permission
model holds on a machine. Node's own page on the permission model says it is not a security
boundary. Measured on Node 26.10 under the plugin's flags with no grant:

- refused: reads, `stat`, `watch` and `openAsBlob` outside the grants; writes outside the data
  folder; symbolic and hard links; `/proc/self` and `/dev/fd`; TCP, UDP, DNS, `fetch` and Unix
  sockets; child processes, workers and `module.register`; every function of `node:ffi`; WASI;
  the inspector; native addons; `process.binding`;
- open: `process._debugProcess(pid)` opens the debugger of any Node process of the same OS user
  that runs without `--disable-sigusr1`; `process.kill(pid)` and `process.kill(-1)` reach every
  process of that user; `v8.setFlagsFromString("--allow-natives-syntax")` turns on V8's internal
  functions, which read a value the plugin chose as a heap pointer; `node:sqlite` ignores the file
  grants; `--max-old-space-size` bounds the heap only, and eight 256 MiB buffers took 2 GiB;
- the host's own work in the engine's process: a regex a plugin's schema names runs on the
  engine's event loop (`^(a+)+$` doubles its time per character), and what the host writes to a
  plugin that stops reading waits in the engine's memory.

## Decision

- **A package of its own.** `@binference/plugin-host` holds the host, the program each plugin runs
  in, the probe plugin and the image's launcher. The engine package does no I/O, so the host
  cannot live there; the composition root wires it.
- **The manifest.** A community plugin's `binference` field (`@binference/plugin-sdk/community`)
  holds `api: 1`, its id, its kinds (`data`, `skills` only), its entry module, at most 16 HTTPS
  host names and at most 32 tools, each with a JSON Schema for its input and output, and a config
  schema. The schema is strict: a contract, a call, a transaction cap such as `maxValueBase` or
  any other field is refused, so nothing a community plugin declares can widen a ceiling. Its
  schemas use only `type`, `title`, `description`, `properties`, `required`,
  `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`,
  `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `enum`, `const`, `anyOf`,
  `oneOf` and `allOf`, at most 8 levels deep and 16,384 characters long: no `pattern`,
  `patternProperties`, `format`, `uniqueItems` or `$ref`, so checking a plugin's answer costs
  time linear in the answer, which is at most 1 MiB. The host reads a stored manifest again before
  each start and refuses one these rules refuse (`bad_manifest`).
- **The exports.** The entry module exports `tools`, made with `defineTools`; each tool gets its
  input, its config, its data folder, a signal and a `fetch` that goes through the host.
- **The program.** A plugin runs in `plugin-process.mjs`, one bundled file, started with
  `--permission`, a read grant for its package and data folders, a write grant for its data
  folder, `--no-experimental-sqlite`, `--no-addons`, `--disable-sigusr1`,
  `--disallow-code-generation-from-strings` and `--max-old-space-size=256`, in its package
  folder, which it may only read, with no variable but what the OS needs to run Node, and no file
  descriptor but its standard input and output. It stops at once unless it runs under the
  permission model with no grant beyond its folders, with exactly those flags and no
  `NODE_OPTIONS`, so `--allow-natives-syntax`, `--expose-internals` or a loader never reaches a
  plugin. Before the plugin's code loads it replaces `v8.setFlagsFromString` with one that throws
  `ERR_ACCESS_DENIED`, in every import form (`syncBuiltinESMExports`), and pins `process.exit`,
  `reallyExit`, `kill` and `_kill`, so the plugin can neither turn V8's internals on nor outlive
  its channel. Node reads no flag from the plugin's folder: not from `.npmrc`, not from
  `package.json`, and from `node.config.json` only with a flag the host never passes, and the
  working folder is the read-only package folder in any case.
- **Every engine process turns the debug signal off.** The `binference` command's own line
  (`#!/usr/bin/env -S node --disable-sigusr1`) starts a foreground engine and the image's default
  command with it; the background service, the image entry, the agent runtime and the signer
  start Node with it. `engine/status` says whether the running engine has it (`debugSignalOff`).
- **The probe.** Before any community plugin starts, and in `binference check`
  (`plugins.sandbox`), the host runs the probe plugin through the same program, arguments and
  starter. Its one tool tries to read and write outside its folders, make a symbolic and a hard
  link, fetch, connect, look up a name, listen, bind UDP, start a process and a worker, load an
  addon, start WASI, open FFI and call it, open the inspector and `node:sqlite`, call
  `process.binding`, set a V8 flag, and signal a decoy: a Node process started with
  `--disable-sigusr1` as the engine is, which reports whether its debugger opened. Every act must
  be refused. A plain signal to the decoy goes through under the engine's own OS user, so it fails
  the check only where the starter promises a user of its own. The host also refuses to start
  plugins when its engine runs without `--disable-sigusr1`; the check reads that from the running
  engine's `engine/status`. The sandbox suite also runs the probe with every grant and no
  lockdown, and sees each act but `process.binding`, which Node refuses whatever it grants, let
  through.
- **Fetches.** An `https` URL on the default port of a declared host, exactly as declared, past
  the URL guard and to public addresses only; no `Host`, hop-by-hop or `Proxy-*` header, no line
  break in a value, a body only on `POST`; 8 open at once, 15 seconds each, the answer in one
  message of at most 1 MiB. The plugin gets its refusal's code, never an error's text.
- **Back pressure.** More than 4 MiB the host wrote and the plugin has not read ends the plugin
  as `stalled`, which counts as a crash, and the owner gets `notice.pluginStalled`.
- **Memory.** A plugin's process may hold at most 512 MiB resident: its 256 MiB heap and what
  Node and its buffers need beside it. The starter reads its resident size every 2 seconds, from
  `/proc` on Linux, `ps` on macOS and `tasklist` on Windows, and in the image the launcher reads
  `/proc` for its own plugins; past the limit the plugin is ended at once, which counts as a
  crash. The image has no cgroup of its own to give each plugin, since Docker does not delegate
  one by default.
- **Calls.** A call has 30 seconds; one past them is answered `timeout` and forgotten, so a late
  answer is dropped and 16 hung calls never keep the plugin `busy`. A plugin not `ready` in 10
  seconds is ended.
- **Notices.** `notice.pluginHostRefused` goes once per plugin and host a day, from a map in the
  host's memory of at most 1,000 pairs, and at most five times an hour per plugin, with the
  decision 0245 notice hour; the rest of that hour go in one `notice.pluginHostsHeld`. The host
  name is cut to 64 characters and shown as code. `notice.pluginStopped` goes once at the 5th
  crash in 10 minutes, `notice.pluginStalled` at each stall, and `notice.pluginSandboxOff` names
  the first act that went through. A plugin so sends at most a dozen notices an hour, so a
  security notice the outbox sends in order waits behind seconds of them at most.
- **Restarts.** The wait doubles from 1 second to 5 minutes per crash in a row, and starts at 1
  second again after a run of 10 minutes.
- **What waits for `plugin/add`.** Installs walk each package folder for links and pin its files
  by hash before each start, refuse the id `sandbox-probe`, and wire the host into the engine's
  start with the plugins the plugin lock holds. A plugin's answers then reach the agent marked as
  outside content, so a trade after one always gets a card. `binference check` warns that plugins
  run as the owner's own user, who can signal every process of that user, once one is installed.

## Consequences

- The sandbox suite (`plugin-sandbox.test.ts`) builds the program and the probe and holds every
  act to its refusal; it runs on Linux, macOS and Windows in CI. Where Windows lets the debug
  signal through despite `--disable-sigusr1`, the probe fails and no community plugin runs there.
- `binference check` spends about two seconds on the probe, and warns, with the next step for its
  reason, while the sandbox does not hold; with no community plugin installed yet, nothing is at
  risk.
- A plugin's JSON Schemas are poorer than JSON Schema allows; a plugin checks a string's form in
  its own code.

## Alternatives

- **The host in the engine package.** The engine does no I/O; a process host there would break
  that rule.
- **Check plugin answers off the engine's thread.** A worker with a hard time limit would allow
  every keyword, at the cost of a worker per check; refusing the keywords keeps the check linear
  and in place.
- **A global `fetch` that goes through the host.** It would let a plugin's libraries fetch as they
  do elsewhere, but it hides the one door a reviewer must see; the context's `fetch` keeps it
  explicit.
- **`--no-experimental-ffi`.** Node 26 releases before `node:ffi` refuse the flag, so a plugin
  would not start on them; the permission model refuses every FFI call already, and the probe
  proves it.
- **Trust the flags without a probe.** A Node release or an OS that behaves otherwise would go
  unseen; the probe costs one short process.
