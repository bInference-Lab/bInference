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

`binference init` sets up a new install (keys spec, section 2) under the engine lock: the Privy
app's id and secret, checked with one read; the owner key, shown once as its `bnok1` code, whose
last 6 characters the owner types back; the rescue address; the bot token, checked with `getMe`;
the default limits. Then it stores this machine's agent key where the unlock mode keeps it
(the keychain with a desktop session, an owner-only file without one, a file sealed with a
passphrase in `manual` mode, the owner's secret manager in `command` mode), makes the key quorums,
the ceiling and the first wallet on Privy and reads the wallet back, records the custody, the
rescue address, the first agent (paper mode, manual approval) and its wallet in `engine.sqlite`,
issues the bot's pairing link, and writes `config.json5` last, owner-only, with secrets only as
secret sources. A person answers its questions through a prompter over `@clack/prompts`
(`src/term/`); with `--yes`, `--json` or no terminal, every answer comes from a flag and the
owner key's code is printed once. A folder set up before is refused unless the owner passes
`--start-over`, and a stored agent key is never replaced.

`binference status` and `binference health` sign in over IPC with the CLI token and call
`engine/status`; `status` prints the state, the agents and the health signals, and `health`
exits 0 only when the engine is ready. `binference logs` reads the engine log itself, so it works
while the engine is stopped; `--follow` keeps reading until a stop signal. Every command takes
`--json` and `--yes`, prints every word in the owner's language (messages in the i18n `cli`
area), and exits 0 when done, 1 on an error and 2 when policy refuses.

The commands on one agent (`approval`, `live`, `paper`, `wallet address`) act on the agent
`--agent` names, or on the only agent the engine has; with several and none named they list the
ids to choose from. A call the engine refuses prints the message of its protocol error code from
the i18n `error` area, and exits 2 when a rule refused it (`auth.scope`, `auth.local_only`,
`wallet.unfunded` and the others a rule decides). Going live is terminal only: the CLI reaches the
engine over its IPC endpoint alone, and the server takes `agent/goLive` over IPC only.

`binference check` works with or without a running engine. Each finding has a stable check id:
`config.valid`, `permissions.*` (the state folder, config.json5, the CLI token, the IPC sockets'
folder and the agent's keys, read through the platform's `FileAccess`), `unlock.mode` (a warning in
`file` mode) and `engine.reachable`. `--fix` makes owner-only each of those paths others can open;
on Windows, where the access list is not read, it restricts them all the same.

It also loads `config.json5`: one strict schema, four layers (defaults, the file, `BINFERENCE_*`
variables, `--set` flags), issues that name each key's path and fix, secret sources read only when
needed, and the config migrations behind `binference check --fix`.

`src/compose/` holds `ProfileParts`, the ports whose adapter depends on the profile, and the test
composition root `composeCloudTestRoot`, which fills them with fakes shaped like the bInference
Cloud adapters so a test can run the engine on either profile's parts. `composeEngine` wires the
engine and its protocol server on the parts both profiles fill (custody, the store ports and the
prices): the server signs callers in through the access store and routes calls to the engine's
handlers, and the engine's pushes reach the server. With the owner's bot (`telegram`),
`composeTelegram` joins it: each new card version shows in the owner's chat, a press is answered
through the engine for the owner only, and a card answered elsewhere or expired becomes its
receipt. `paper-swap.test.ts` runs one paper swap through every layer on both compositions, then
the owner's switch to live and a live trade that reaches the executor. `mcp-paper-swap.test.ts`
runs a paper swap from an MCP client to a Telegram tap: the client proposes a swap and retries it
with the same request id, the card reaches the synthetic Bot API, the owner's tap fills it on
paper, and the client reads the fill and the ledger.

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
| `binference init`                    | Sets up an install: Privy, owner key, first wallet and bot          |
| `binference start [--set key=value]` | Runs the engine in this terminal until Ctrl+C or `engine/stop`      |
| `binference status`                  | The engine's state, release, agents and health signals              |
| `binference health`                  | Exits 0 when the engine runs and is ready; a container health check |
| `binference logs [-n N] [--follow]`  | The engine log's last lines, then new ones until Ctrl+C             |
| `binference approval [manual\|auto]` | Shows the agent's approval mode, or sets it                         |
| `binference confirm <intent>`        | Confirms the intent's newest card version, as its button does       |
| `binference deny <intent>`           | Cancels the intent's card, as its button does                       |
| `binference live`                    | Switches the agent to live, over IPC only; its first card says so   |
| `binference paper`                   | Switches the agent back to paper mode                               |
| `binference wallet list`             | The agent wallets with their labels and addresses                   |
| `binference wallet address`          | The address to fund the agent's default wallet at                   |
| `binference check [--fix]`           | Checks the config, file access, unlock mode and the engine          |

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
