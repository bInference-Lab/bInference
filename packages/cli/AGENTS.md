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
- `composeEngine` is the one place that joins the engine to its protocol server. A push that fails
  is logged and never stops the money path. The paper swap test runs on every composition with
  `describe.each`; a new profile part joins both compositions there.
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
- Tests pass a `readFile` and a `run` of their own, or the platform's fakes, and time comes from
  a manual clock.
