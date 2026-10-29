# binference

The `binference` command and the composition root. Today it holds the config: the
`config.json5` schema, its layers, validation, secret sources and config migrations. The spec is
[docs/specs/config.md](../../docs/specs/config.md).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is the composition root: it may import every package, and it alone reads `process.env`,
  `process.argv` and the config file. It still opens no file itself: files go through
  `@binference/platform` (`readTextFile`), programs through `runCommand`.
- It is the only package that knows the profile. `src/compose/` names the profile parts
  (`ProfileParts`) and builds their adapters; `composeCloudTestRoot` is the test composition root
  on the Cloud-shaped fakes. Every other package takes the ports, and `guards/no-profile-mention`
  fails it when it names a profile.
- `startSelfHosted` is the self-hosted composition root, in the startup order of ARCHITECTURE.md
  section 24: it opens the lock, the config, the log and the stores, then `serveEngine` listens at
  once (calls answer `engine.starting`), opens the keys, recovers, and turns `ready`. Each part it
  opens adds its closer, so a start that fails part way closes what it opened, and the shutdown
  sequence closes the parts in the reverse order: a part that must close before another, such as
  the executor before the store, opens after it. Every part that reads a chain (prices, wallet
  facts, the simulators, the executor) shares the chain's one RPC failover from
  `composeChainReads`, so they share its endpoints' health, which the `rpc` signal shows. Log
  queries go through the chain's log failover, whose resting endpoints make the signal at least
  `warn` (decision 0272).
- Commands live in `src/commands/`, one file each, and run on a `CliHost`, never on `process`
  directly: only `src/main.ts` reads `process`. Every command takes `--json` and `--yes`; people
  get messages from the i18n `cli` area through `CliOutput`, scripts get JSON. Log lines and JSON
  stay English.
- `startSelfHosted` opens the owner's bot from `telegram.botToken` (`src/compose/open-bot.ts`):
  grammY over `host.http` with the token's throttler. Its owner and card copies come from
  `engine.sqlite` (`botParts`, decision 0139), so a pairing outlasts a restart. The bot's channel (`bot-channel.ts`) adds its closer at the channels
  step and begins only once the engine is `ready`: the menu once, the outbox, the stored updates,
  then the poll worker. A token that cannot be read leaves the engine running without the bot.
- `binference start` runs the engine as the background service through the platform's
  `ServiceManager` (decision 0138), the OS's own unless the host names one; the service runs
  `binference start --foreground`, which is `startSelfHosted`; `binference service remove` stops
  the engine as `stop` does and removes the service (decision 0141). Every test host gets a
  service manager that refuses, so no test touches the machine's login items; a test of the service passes
  `src/e2e/test-services.ts`, which runs the service's command line in the test's process. The CI
  job `Background service at login` runs `pnpm service:smoke` on each runner, with the OS's own
  logout and login between its phases; it installs a real service, so never run it on your own
  machine.
- Tests run commands end to end through `runCli` on a host with a temporary state folder
  (`src/e2e/test-host.ts`), a manual clock and an emitter for stop signals; store workers run the
  TypeScript source. Each test stops its engine through the shutdown sequence. What only separate
  processes prove, such as the engine lock, runs `src/main.ts` as a process of its own
  (`engine-process.test.ts`).
- Fork tests in `src/fork/` run engine steps over the real chain parts they are composed from,
  such as the simulation check over the EVM transaction simulator, on the fork suite's BSC fork
  through `@binference/chain-evm/fork`. `self-hosted-start.test.ts` runs `binference start
--foreground` itself there, with the fake Privy, the test signer and KyberSwap's public API.
  They run in `pnpm test:fork`, never in `pnpm check`.
- `src/fork/exit-orders.replay.test.ts` replays the recorded day with exit orders on three tokens
  and no runtime, and measures each fill in blocks from its trigger (decision 0209). It runs in
  `pnpm test:replay`, never in `pnpm test:fork`.
- Crash tests in `src/crash/` run `src/crash/crash-engine.ts` as a process of its own:
  `binference start --foreground` through `runCli`, as `src/main.ts` runs it, on a state folder
  `binference init` set up (decision 0135). They kill it at each kill point and start it again.
  The engine reaches the chain only through the test's relays and RPC in front of anvil, which
  count every send and place the kills; Privy and KyberSwap's API are the test's, on loopback,
  where Privy counts each signature; the signer runs in the engine with its agent key. Like
  `src/main.ts`, the crash engine reads `process` itself. They run in `pnpm test:crash`, never in
  `pnpm check`.
- `composeEngine` is the one place that joins the engine to its protocol server, and to the
  owner's bot through `composeTelegram`. The server and the bot's fast commands run the same
  handlers: the engine's and the root's own, such as `engine/status`. The bot alone also gets
  `ownerChat`: the `config/change` that sets `owner.locale` in config.json5 in place
  (`src/compose/owner-locale-change.ts`, decision 0134), which the live reload then applies. Every push, a notice too,
  goes through the engine's one `publish`, so the server and the bot both get it; `publish` stores
  each notice first through the notice log (`src/compose/notice-log.ts`, decision 0133), and the
  push carries its id. Cards and notices reach the owner's chat in one line
  (`src/compose/telegram-relay.ts`), notices from the outbox once `start` is called at the channels
  step of the startup order. A push that fails, and a card that does not reach
  Telegram, is logged and never stops the money path. The skeleton tests run on every composition
  with `describe.each` through `src/compose/test-skeleton.ts`; a new profile part joins both
  compositions there.
- `binference chat` (`src/commands/chat-command.ts`) runs terminal chat from `@binference/tui`
  (decision 0253): it signs in with the CLI's token as `tui`, which keeps its connection, picks the
  agent, and hands the client and `host.chatTerminal` to `runTerminalChat`. Only `src/main.ts`
  fills `chatTerminal`, when standard input and output are both a terminal. Its round trip runs
  `src/main.ts` in a pseudo-terminal through `node-pty` (`src/e2e/terminal-chat.test.ts`), the
  same test on macOS, Linux and Windows.
- Browser push lives in `src/web-push/` (decision 0158): the VAPID key in `keys/web-push-vapid`,
  made by init and at start when missing; the message encryption of RFC 8291 and the token of
  RFC 8292 on `node:crypto`, checked against the RFCs' worked examples; the sender through the
  `Http` port; and the relay, which `composeEngine` hands every push, as the bot's relay, so each
  card version that opens or closes reaches the owner's browsers. A log line names an answer's
  status, never an endpoint, which works as a capability.
- `binference init` lives in `src/init/`, one step per file, each answering an `InitStep`: its
  value or a refusal with a code and an `init` message. The language step runs first, and the
  context is made again in the language picked; the service step runs last, in
  `src/commands/init-summary.ts`, once the engine lock is let go (decision 0222). The model step checks the key with
  `checkModel` of `@binference/runtime` over `host.http`; tests answer it with
  `src/e2e/model-fixtures.ts`, never a real provider. Every question and check runs before
  anything is stored or made on Privy; the config file is written last. Questions go through the
  `Prompter` of `src/term/`: the terminal's over `@clack/prompts`, a scripted one in tests, and
  one that only prints when nobody answers, so every answer then comes from a flag. Secrets come
  from flags only as secret sources, never as values.
- A part that follows a reload of `config.json5` reads its key from `Opened.settings`, the config
  cell, on each use, and its path joins `keysReadOnEachUse` in `src/config/config-changes.ts`;
  a part that copies a key at start reads `Opened.config`, and the reload says that key waits
  for a restart (decision 0118).
- The config has one strict schema in `src/config/schema/`. Every key has a `.describe()` text,
  a default through `.prefault()` or none, and a type declared before its schema. Secrets are
  `secretSourceSchema` or `commandSourceSchema`, never text.
- A change to the config's shape ships a config migration in
  `src/config/migrations/config-migrations.ts` in the same commit. Run
  `pnpm check:config-schema --write` after any schema change and commit
  `snapshots/config-schema.generated.json` and `docs/config-keys.generated.md`; never edit them
  by hand.
- A config issue is data: a path, a problem, a fix and the layer the value came from. People see
  it through i18n messages chosen by the problem and the fix; `formatConfigIssue` is the
  English line for logs and developers.
- A secret is read only when its key is needed, through `createSecretReader`, and stays a
  `Secret` until the one call that uses it. No issue, error, log field or origin ever holds a
  secret value, a program's output or a `--set` flag's value; `secret-leak.test.ts` proves it.
- `unlockKeys` (`src/unlock/`) is the one reader of the agent key and the Privy app secret at
  start, by `engine.unlock.mode` (keys spec, section 3). A secret that is not there is a lock
  reason, never a guess or a fallback to another mode; only the `file` mode reads systemd's
  credentials. Its keychain test runs on the real OS keychain in CI only, under a service name of
  its own.
- The engine lock (`src/unlock/engine-lock.ts`) opens the keys at start and through
  `engine/unlock`, one call at a time. `onUnlocked` in `src/compose/compose-lock.ts` is the one
  place the opened keys go: `openCustody` (`src/compose/open-custody.ts`) checks the app with
  Privy, starts the signer through the host's `startSigner` (the built signer's process unless a
  test passes its own) and builds the `privy-owner` adapter; a failure there is a lock reason,
  never a failed start (decision 0117). The engine signs through the custody cell, which refuses
  while locked. A passphrase comes only from the terminal's hidden prompt of `binference unlock`,
  never from a flag, and is never logged.
- The agent runtime (spec 8, section 2) starts last in `serveEngine` and stops first:
  `src/compose/compose-runtime.ts` starts it through the host's `startRuntime` (the built
  runtime's process unless a test passes its own; tests default to the runtime run in-process),
  and `src/agent-runtime/` holds its supervisor, its per-start token, its settings and the routed
  operations. It gets no variable of the engine's environment and no key; its settings, with the
  model keys read from their secret sources, cross only its standard input.
- The owner key code comes only from the terminal's hidden prompt of an owner-key command, such as
  `binference rescue set`, travels only over IPC and is never logged or stored. The Privy ceiling
  editor (`src/compose/privy-ceiling-editor.ts`) uses it for one request and checks it is the key
  that owns the install's ceilings before Privy hears of it. A new owner key's code is shown only
  to a person at a terminal, by `init` or `binference owner-key create`; a headless `init` takes
  the public half from `--owner-key-public`, and no output or JSON answer carries a code
  (decision 0148).
- `binference init --attach` lives in `src/attach/` (decision 0140): on a folder that holds the
  install, it takes the owner key from the hidden prompt only, makes this machine's agent key where
  the unlock mode keeps it, and makes it each live wallet's one signer on Privy through
  `swapSigner` of `@binference/custody-privy`, then records it with `InstallStore.attach`. At each
  start and unlock, `checkAttached` (`src/compose/check-attached.ts`) locks an engine whose key a
  wallet no longer lists with `signer_revoked`, and such an engine never starts the bot. A
  planned move's copy is checked first (decision 0142): a database left open stops attach, and so
  does a copied `keys/agent-key` holding the key the wallets name now. On an empty folder,
  `runRebuild` rebuilds the install from what Privy holds, reusing init's steps, and changes
  nothing on Privy before the owner types the number of wallets found.
- Backups live in `src/backups/` (keys spec, section 7; decision 0055). A backup file is a header
  line, then a tar archive encrypted in 64 KiB AES-256-GCM chunks under a fresh data key, which
  HPKE seals to the owner key's public half through `src/hpke/`, the one HPKE module, which the
  wallet export shares. `takeBackup` snapshots the databases with `VACUUM INTO`, writes, reads the
  file back with the data key and zeroes it, copies to `backups.copyTo`, marks it verified, then
  applies retention. `startNightlyBackups` runs it at 03:30 owner time, and at once when the
  engine starts or the machine wakes (a jump of the wall clock between the timer's ticks) with
  the newest nightly backup more than 24 hours old, and raises `notice.backupFailed`; `openEngineStores` takes one before a migration, and a failed one stops
  the start before the migration runs. Crypto comes from `node:crypto` and `@hpke/core` only.
  `binference backup create` and `backup list` go over IPC: `backup/create`
  (`src/compose/backup-operations.ts`) answers a job at once and takes a `manual` backup in the
  engine, one at a time, and its end goes to the `job` topic, which the command watches from
  before its call (`src/commands/job-ends.ts`).
- `binference init --attach --restore <file>` (`src/commands/restore-attach.ts`) takes the owner
  key from the hidden prompt only, opens the backup's data key with it before any chunk is read,
  unpacks and checks every file into a folder of the state folder, refuses a newer schema, then
  moves the replaced state to `replaced/<time>/` (kept 7 days) and puts the restored files in
  place. Attach then signs with that owner key and checks the backup's wallets against Privy
  before it makes a key; a refusal before a wallet moves undoes the restore.
- `binference backup restore <file>` (`src/commands/backup-restore-command.ts`, decision 0152)
  restores on this machine's install in the CLI: the same owner key prompt, unpack and checks
  (`unpackRestore`), then, while the engine still runs, the Privy app, the wallets and the signer
  they list now (`src/attach/prepare-restore.ts`), so a refusal changes nothing. It stops the
  engine as `binference stop` does, swaps the files under the engine lock, and starts the engine
  as it ran: the service again, or in the foreground in its own terminal.
- `binference report` (`src/report/`, decision 0263) writes the support bundle in the CLI, so it
  works while the engine is stopped. It never opens a key, a database or the keychain. An engine
  log line passes only by the field rules of `report-log-line.ts`; every other value passes
  `redactReportJson`. A new log field needs its rule there, or the bundle shows it as `[omitted]`.
- `binference uninstall` (`src/uninstall/`, decision 0264) stops the engine, removes the service,
  then with `--state` the state folder and the keychain entries its config names, then the npm
  package it runs from. It removes a folder only when it holds `config.json5` or `engine.sqlite`
  and not the home folder. Its tests pass a keychain and a program runner of their own: the test
  host's runner refuses, so no test runs npm.
- `binference reset` (`src/reset/`, decision 0265) stops the engine as `backup restore` does
  (`src/commands/engine-runs.ts`), and under the engine lock refuses while a live intent is
  `executing`, takes a `manual` backup, then clears chats, notes, the agent inbox, questions and
  the risk cache through the store's reset tasks and journals `state.reset`. It starts the engine
  again as it ran.
- The model evaluation lives in `src/evaluation/` (decision 0291): scenarios as YAML in
  `scenarios/en/` and `scenarios/zh/`, run on the runtime's own turns through
  `startEvaluationChat`, with a scenario engine, web and images in place of the engine, and scored
  by `score-scenario.ts`. `evaluate-models.ts`, run by `pnpm eval:models`, reads `process` like
  `src/main.ts`; the model key it reads never reaches its output. Every scenario's right answer
  must pass and each wrong answer must miss the checks it names (`scenarios.test.ts`). The risk
  scenarios' reads are checked on a fork by `src/fork/evaluation-risk.test.ts`.
- Tests pass a `readFile` and a `run` of their own, or the platform's fakes, and time comes from
  a manual clock.
