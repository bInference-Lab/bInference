# @binference/plugin-host

The plugin host: runs each community plugin in a sandboxed Node process of its own, checks its
channel and fetches for it only from its declared hosts (ARCHITECTURE.md section 14, decisions
0300, 0343 and 0344).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- A community plugin's code is anyone's. Nothing a plugin sends is trusted: every message parses
  with the schemas in `src/channel/`, a line over 1 MiB or a message out of order ends the
  process, and a call's input and output meet the tool's declared schemas. A new message is a row
  of decision 0300 first.
- `src/process/plugin-process.ts` is the program every plugin runs in, built into one file,
  `dist/plugin-process.mjs`. A grant a plugin gets is added to `pluginNodeArguments` and nowhere
  else, with the probe act that proves the rest still refused, and to the flags `isSealedRun`
  allows. No grant of the network, a process, a worker, an addon, WASI, FFI or the inspector is
  ever added. `lockDown` runs before a plugin's code loads; a new setter of the process or of V8
  that Node does not gate joins it, with a probe act.
- `src/probe/sandbox-probe.ts` tries each act of `probeActs`; `src/process/plugin-sandbox.test.ts`
  builds the program and the probe and holds each act to its refusal (gate check Z11). A new gap
  of Node's permission model becomes an act there and a reason in `notice.pluginSandboxOff` and
  `check.pluginSandbox.off`, in English and Chinese.
- A plugin's schemas use only the keywords the community manifest allows, so the host checks
  its answers in time linear in their size on the engine's own thread. A keyword that runs a
  plugin's regex or costs more never joins that list. What the host writes waits unread up to 4
  MiB, and a plugin's process holds at most 512 MiB resident; past either it is ended.
- A plugin reaches the network only through `createPluginFetches`: `https`, the default port, a
  declared host exactly, the URL guard and public addresses only. A refusal reaches the plugin as
  its code, never an error's text.
- `PluginStarter` has its contract suite in `src/contracts/`; the direct starter and the image's
  launcher starter run it. `src/launcher/` holds the image's three programs: the image entry, the
  one root process; the plugin launcher, which starts a plugin or removes its data folder by its
  id alone (decision 0351); and the shell launcher, which runs the agent's commands as
  `binference-shell` through `@binference/platform/image-shell` (decision 0412). Each takes no
  argument; a change to what they do is a change to decision 0344 or 0412.
- Tests that start a plugin build the programs with `buildPluginBundles` into a folder of the
  package's `dist` and remove it; each test stops every process it started.
