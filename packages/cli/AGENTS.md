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
  `composeChainReads`, so they share its endpoints' health, which the `rpc` signal shows.
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
  `binference start --foreground`, which is `startSelfHosted`. Every test host gets a service
  manager that refuses, so no test touches the machine's login items; a test of the service passes
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
- `binference init` lives in `src/init/`, one step per file, each answering an `InitStep`: its
  value or a refusal with a code and an `init` message. Every question and check runs before
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
- The owner key code comes only from the terminal's hidden prompt of an owner-key command, such as
  `binference rescue set`, travels only over IPC and is never logged or stored. The Privy ceiling
  editor (`src/compose/privy-ceiling-editor.ts`) uses it for one request and checks it is the key
  that owns the install's ceilings before Privy hears of it.
- `binference init --attach` lives in `src/attach/` (decision 0140): on a folder that holds the
  install, it takes the owner key from the hidden prompt only, makes this machine's agent key where
  the unlock mode keeps it, and makes it each live wallet's one signer on Privy through
  `swapSigner` of `@binference/custody-privy`, then records it with `InstallStore.attach`. At each
  start and unlock, `checkAttached` (`src/compose/check-attached.ts`) locks an engine whose key a
  wallet no longer lists with `signer_revoked`, and such an engine never starts the bot.
- Tests pass a `readFile` and a `run` of their own, or the platform's fakes, and time comes from
  a manual clock.
