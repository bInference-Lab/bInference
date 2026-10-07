# binference

## Purpose

The `binference` command and the composition root, the one place that builds adapters and wires
them in.

`binference start` runs the self-hosted engine in the foreground (`startSelfHosted` in
`src/compose/`). In order it takes the engine lock on the state folder, loads `config.json5` with
its layers and secret sources, opens the engine log, opens `engine.sqlite` on its store workers
(migrations, then the integrity check), makes sure the CLI token in `auth/cli.token` is known,
builds the engine on the self-hosted parts, and serves the protocol on the engine's IPC endpoint
and on `127.0.0.1:<engine.port>`. Parts that have no adapter yet (custody through Privy, Chainlink
prices, the wallet facts, the simulator) are missing parts: they refuse every live action and show
as failed health signals. A stop signal, or `engine/stop` over IPC, runs the shutdown sequence,
which closes the parts in the reverse order: server, IPC, health probe, store, log, lock. A second
`start` on the same state folder refuses while the first runs.

`binference status` and `binference health` sign in over IPC with the CLI token and call
`engine/status`; `status` prints the state, the agents and the health signals, and `health`
exits 0 only when the engine is ready. `binference logs` reads the engine log itself, so it works
while the engine is stopped; `--follow` keeps reading until a stop signal. Every command takes
`--json` and `--yes`, prints every word in the owner's language (messages in the i18n `cli`
area), and exits 0 when done, 1 on an error and 2 when policy refuses.

It also loads `config.json5`: one strict schema, four layers (defaults, the file, `BINFERENCE_*`
variables, `--set` flags), issues that name each key's path and fix, secret sources read only when
needed, and the config migrations behind `binference check --fix`.

`src/compose/` holds `ProfileParts`, the ports whose adapter depends on the profile, and the test
composition root `composeCloudTestRoot`, which fills them with fakes shaped like the bInference
Cloud adapters so a test can run the engine on either profile's parts. `composeEngine` wires the
engine and its protocol server on the parts both profiles fill (custody, the store ports and the
prices): the server signs callers in through the access store and routes calls to the engine's
handlers, and the engine's pushes reach the server. `paper-swap.test.ts` runs one paper swap
through every layer on both compositions, then the owner's switch to live and a live trade that
reaches the executor.

The reference of every key, generated from the schema, is
[docs/config-keys.generated.md](docs/config-keys.generated.md).

## API

| Export                                          | What it does                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `loadConfig`                                    | Reads the config in its layers and validates it                                |
| `configSchema`, `BinferenceConfig`              | The strict schema of `config.json5` and the config it gives                    |
| `ConfigIssue`, `ConfigProblem`, `ConfigFix`     | One problem as data: the key's path, what is wrong, the next step              |
| `formatConfigIssue`                             | An issue as one English line for logs and developers                           |
| `createSecretReader`, `SecretReader`            | Reads `fromEnv`, `fromKeychain`, `fromFile` and `fromCommand` sources          |
| `SecretSource`, `secretSourceSchema`            | Where a secret lives; the file never holds the secret itself                   |
| `migrateConfig`, `configMigrations`             | Moves an older file to the current shape, one named step at a time             |
| `applyEdits`, `ConfigEdit`                      | The set, remove and move edits a migration makes                               |
| `currentConfigVersion`                          | The `version` this binference reads and writes                                 |
| `describeConfigSchema`, `renderConfigReference` | The JSON Schema and the key reference that `check:config-schema` keeps current |

## Commands

| Command                              | What it does                                                        |
| ------------------------------------ | ------------------------------------------------------------------- |
| `binference start [--set key=value]` | Runs the engine in this terminal until Ctrl+C or `engine/stop`      |
| `binference status`                  | The engine's state, release, agents and health signals              |
| `binference health`                  | Exits 0 when the engine runs and is ready; a container health check |
| `binference logs [-n N] [--follow]`  | The engine log's last lines, then new ones until Ctrl+C             |

In development, run the source: `node --conditions=@binference/source --import tsx
packages/cli/src/main.ts status`. The store workers get the same Node options.

## Example

```ts
import { createSecretReader, formatConfigIssue, loadConfig } from "binference";

const loaded = await loadConfig({
  file: platform.stateFolder.configFile,
  env: process.env,
  sets: ["engine.port=7460"],
  system: { locale: "zh", timezone: "Asia/Shanghai", unlockMode: "keychain" },
  signal,
});
if (!loaded.ok) {
  throw new Error(loaded.issues.map(formatConfigIssue).join("\n"));
}

const secrets = createSecretReader({ env: process.env, keychain, homeDir, clock });
const botToken = await secrets.read("telegram.botToken", loaded.config.telegram.botToken, signal);
```

An invalid key reads, in English:
`engine.port: must be a number from 1024 to 65535 (got "abc"). Set it in config.json5 or remove it.`
