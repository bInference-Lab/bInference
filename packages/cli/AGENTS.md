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
- `startSelfHosted` is the self-hosted composition root. Each part it opens adds its closer, so a
  start that fails part way closes what it opened, and the shutdown sequence closes the parts in
  the reverse order. A part without an adapter is a missing part (`createMissingParts`): it
  refuses, never fakes a balance, a price or a signature, and shows as a failed health signal.
- Commands live in `src/commands/`, one file each, and run on a `CliHost`, never on `process`
  directly: only `src/main.ts` reads `process`. Every command takes `--json` and `--yes`; people
  get messages from the i18n `cli` area through `CliOutput`, scripts get JSON. Log lines and JSON
  stay English.
- Tests run commands end to end through `runCli` on a host with a temporary state folder
  (`src/e2e/test-host.ts`), a manual clock and an emitter for stop signals; store workers run the
  TypeScript source. Each test stops its engine through the shutdown sequence.
- Fork tests in `src/fork/` run engine steps over the real chain parts they are composed from,
  such as the simulation check over the EVM transaction simulator, on the fork suite's BSC fork
  through `@binference/chain-evm/fork`. They run in `pnpm test:fork`, never in `pnpm check`.
- `composeEngine` is the one place that joins the engine to its protocol server, and to the
  owner's bot through `composeTelegram`. A push that fails, and a card that does not reach
  Telegram, is logged and never stops the money path. The skeleton tests run on every composition
  with `describe.each` through `src/compose/test-skeleton.ts`; a new profile part joins both
  compositions there.
- `binference init` lives in `src/init/`, one step per file, each answering an `InitStep`: its
  value or a refusal with a code and an `init` message. Every question and check runs before
  anything is stored or made on Privy; the config file is written last. Questions go through the
  `Prompter` of `src/term/`: the terminal's over `@clack/prompts`, a scripted one in tests, and
  one that only prints when nobody answers, so every answer then comes from a flag. Secrets come
  from flags only as secret sources, never as values.
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
- Tests pass a `readFile` and a `run` of their own, or the platform's fakes, and time comes from
  a manual clock.
