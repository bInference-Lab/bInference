# binference

## Purpose

The `binference` command and the composition root, the one place that builds adapters and wires
them in.

`binference start` installs the background service and starts it (decision 0138): the OS runs
`binference start --foreground` at each login and after a crash, from the state folder, with the
`--set` flags of the `start` that installed it (`engineServiceDefinition` in `src/compose/`).
It checks the config first, waits until the engine answers past `starting`, and names the engine
log and the service's own output, `logs/service.log`. A service that runs is left as it is; an
engine in a terminal, and a run with `BINFERENCE_HOME` set, are refused. `binference stop` asks
the engine for its shutdown sequence over IPC, then has the OS stop the service, which starts it
again at the next login; `binference restart` is a stop, then a start. `binference service remove`
stops the engine the same way, then has the OS remove the service, so it no longer starts at login
(decision 0141); the state folder, the config and the keys stay, and a machine with no service only
stops its engine. A machine another one replaced runs it.

`binference init --attach` makes this machine's new agent key the one signer of every live wallet
of the install, each in one change the owner key signs (decision 0140), from `src/attach/`. For a
planned move (decision 0142), the owner runs `binference service remove` on the old machine and
copies its state folder without `keys/` to this one. Attach then refuses a copy whose
`engine.sqlite` was left open, which `isDatabaseLeftOpen` reads from its `-wal` and `-shm` files,
and a copied `keys/agent-key` that holds the key the wallets name now. It moves the secret sources
of `config.json5` that name the old folder's `keys/` to this folder's `keys/`, asks for the Privy
app secret and the bot token where this machine does not hold them, and keeps them there. On an
empty folder, for a machine lost with no backup, attach rebuilds what Privy holds instead
(`runRebuild`): it warns that history, settings, labels, saved addresses and the bot's pairing
start fresh, finds the wallets the owner key owns with `findOwnedWallets` of
`@binference/custody-privy`, reads the rescue address when every ceiling shares exactly one send
address, else asks for one of the shared ones, and changes nothing on Privy until the owner types
the number of wallets found. It then sets the folder up as `init` does, around those wallets.
`binference signer revoke` removes another machine's agent key from every wallet.

`binference start --foreground` runs the self-hosted engine in this process (`startSelfHosted` in
`src/compose/`). In order it takes the engine lock on the state folder, loads `config.json5` with
its layers and secret sources, opens the engine log, opens `engine.sqlite` on its store workers
(migrations, then the integrity check), makes sure the CLI token in `auth/cli.token` is known,
builds the engine on the self-hosted parts and venues (KyberSwap always, OKX's DEX aggregator when
`venues.keys.okx` names the owner's key; the money path keeps the best plan across them), and
listens for the protocol on the engine's IPC
endpoint and on `127.0.0.1:<engine.port>` (`serveEngine`). From there every call but
`engine/status` answers `engine.starting` while the startup order goes on: the agent key and the
Privy app secret open through the unlock mode, Privy checks the app with one read, and the signer
starts as a child process under Node's permission model with the agent key and must answer its
public half; custody then signs through the `privy-owner` adapter. A failure in that step leaves
the engine locked with its reason, and `binference unlock` runs it again (decision 0117). While
it serves, a watch on `config.json5` reloads the settings 500 ms after the file last changed
(`startConfigReload`, decision 0118): a file with problems keeps the running config and says why;
otherwise each changed key is journaled, and the parts that read the config cell
(`createConfigCell`) apply it at once. After a
start that found Privy out of reach, the engine retries the step by itself for five minutes
(decision 0119). The
executor recovers every unfinished live intent by hash and nonce, and once unlocked takes the
confirmed intents an earlier run left; timers run the engine's settle and its gas check every
minute, the gas check raising the low-gas alert for a live wallet below twice its reserve; then the
engine is `ready`, or `locked`. Each enabled chain gets one RPC failover over `chains.rpc` and
the chain's public RPCs (`composeChainReads`), which every part that reads the chain shares: the
Chainlink prices, the wallet facts (balances in one Multicall3 call, the fee per gas, the
ceiling's cap and the day's trades), the `eth_simulateV1` simulator and the executor. The
executor (`composeExecutor`) sends live intents through every private relay each enabled chain
lists or `chains.relays` names and pays at most `chains.maxFeePerGasGwei` without a tap; its
health signal follows the relays' last answers, and the `rpc` signal the RPC endpoints'. Positions
live in `engine.sqlite`. A signer that stops while the engine runs locks it again, with
`notice.signerStopped`. A stop signal, or `engine/stop` over IPC, runs the
shutdown sequence within `engine.shutdownBudgetMs`, which closes the parts in the reverse order:
the bot's polling; the settle timer; server and IPC, so nothing new comes in; the bot's line to
the chat; the health probe; the executor, which lets a signature or a send under way end; the
signer; the store, the log and the lock. A second `start` on the same state folder refuses while
the first runs, in another process too.

The owner's bot joins the engine when `telegram.botToken` can be read (`openBot`): grammY over the
engine's outbound HTTP, with the token's throttler, its notices queued in the outbox from the
start. Once the engine is ready, the bot's channel (`startBotChannel`) registers the fast
commands' menu, sends the outbox's notices, handles the updates an earlier run stored but did not
handle, and long-polls from the poll worker into the ingress; Telegram's calls skip the server's
check for an engine still starting, so none runs before. The owner binding and the card copies
last one run, as `engine.sqlite` has no table for them yet. A token that cannot be read is logged
as `telegram.bot_skipped`, and the engine runs without the bot.

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
(`src/term/`); with `--yes`, `--json` or no terminal, every answer comes from a flag. Such a run
never makes an owner key: it takes the public half `--owner-key-public` gives, which
`binference owner-key create` made on a machine with a terminal, and is refused without it, so no
owner key code reaches a log (decision 0148). A folder set up before is refused unless the owner
passes `--start-over`, and a stored agent key is never replaced.

`binference mcp` is the MCP server an MCP client starts (protocol spec, section 11). It signs in
over IPC with the client's token, `auth/mcp-<client>.token` for `--client <client>` or else
`auth/mcp.token`, which holds `read` and `propose` only, and serves the tools over stdin and stdout
until the client closes them or a stop signal arrives. Stdout carries MCP messages only; its log
lines go to stderr. A missing token file is one message and exit 1.

`binference mcp setup --client claude-code` or `--client codex` sets an MCP client up
(`src/mcp-setup/`, decision 0154), against the running engine. It gives the client a client token
of its own: the CLI makes the secret, writes it owner-only to `auth/mcp-<client>.token` and sends
only its SHA-256 through `token/register`; a token file that still signs in and has no expiry is
kept, and the client's earlier tokens are revoked. `--ttl <duration>` (`30m`, `12h`, `7d`, at most
`90d`) makes a new token that expires that long after it is made (decision 0159). It then writes the client's MCP server entry, which starts
this binference as the background service does with `mcp --client <client>` and
`BINFERENCE_HOME` when set, and holds no secret: for Claude Code at user scope through
`claude mcp add-json --scope user` when `claude` is on PATH, else in `.claude.json` (in
`CLAUDE_CONFIG_DIR` when set, else the home folder); for Codex as the `[mcp_servers.binference]`
table of `config.toml` in `CODEX_HOME` (`~/.codex` when unset), every other line kept. Last it
installs the bundled `binference-tools` skill, after `lintSkill` passes it, into
`skills/binference-tools/` of Claude Code's config folder (`CLAUDE_CONFIG_DIR` or `~/.claude`) or
into `~/.agents/skills/binference-tools/` for Codex. A second run changes only what differs, and
each part prints whether it was made, updated or unchanged. `--dry-run` prints the changes and
makes none; `--remove` takes the entry and the skill away and revokes the client's tokens. A config
that names the server another way, or that is not the client's format, is left as it is. The npm
package ships the skill in `skills/`, which `prepack` copies from the repo's `skills/`.

`binference mcp session --client <client>` starts the client once with a token of its own
(`src/commands/mcp-session-command.ts`, decision 0159): the CLI makes the secret and registers its
SHA-256 with a 1-hour expiry (`--ttl`, at most 24 hours), then starts the client through the
platform's `startTerminalProgram`. `binference mcp` reads the secret from `BINFERENCE_MCP_TOKEN`
before any token file (decision 0165): Claude Code gets `--strict-mcp-config --mcp-config` and a
file in the state folder's `tmp/` whose `binference` server alone has the variable in its `env`,
and never the variable itself; Codex gets the variable in its environment, `-c` overrides that
pass it to the server, and one that keeps it out of its shell commands. The token is revoked when the client exits, after
a stop signal passed on to it, or on a fault; `--print-config` prints the config and the secret
and starts nothing.

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

| Command                                  | What it does                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `binference init`                        | Sets up an install: Privy, owner key, first wallet and bot          |
| `binference init --attach`               | Makes this machine the wallets' signer; asks for the owner key      |
| `binference owner-key create`            | A new owner key shown once in this terminal, for a headless init    |
| `binference start [--set key=value]`     | Runs the engine as the background service, which login starts again |
| `binference start --foreground`          | Runs the engine in this terminal until Ctrl+C or `engine/stop`      |
| `binference stop`                        | Stops the engine; the background service starts again at login      |
| `binference restart`                     | Stops the engine, then starts the background service again          |
| `binference service remove`              | Stops the engine and takes its background service off login         |
| `binference status`                      | The engine's state, release, agents and health signals              |
| `binference health`                      | Exits 0 when the engine runs and is ready; a container health check |
| `binference logs [-n N] [--follow]`      | The engine log's last lines, then new ones until Ctrl+C             |
| `binference approval [manual\|auto]`     | Shows the agent's approval mode, or sets it                         |
| `binference confirm <intent>`            | Shows the open card, asks, then confirms it; `--yes` skips the ask  |
| `binference deny <intent>`               | Cancels the intent's card, as its button does                       |
| `binference live`                        | Goes live once the disclaimer is typed back, over IPC only          |
| `binference paper`                       | Switches the agent back to paper mode                               |
| `binference wallet list`                 | The agent wallets with their labels and addresses                   |
| `binference wallet address`              | The address to fund the agent's default wallet at                   |
| `binference wallet create --label x`     | A new wallet under its own ceiling; asks for the owner key          |
| `binference wallet export`               | Shows a wallet's private key once; asks for the owner key           |
| `binference ceiling [--wallet <id>]`     | The wallet's ceiling as custody holds it now, with its 24-hour caps |
| `binference ceiling set --per-tx x`      | Venues and cap of every agent ceiling; asks for the owner key       |
| `binference ceiling set --day-cap-usd x` | The 24-hour caps every wallet shares; asks for the owner key        |
| `binference freeze [--agent <id>]`       | Freezes every agent and the install, or one agent                   |
| `binference unfreeze`                    | Opens the unfreeze card, which `confirm` or a tap answers           |
| `binference rescue`                      | Opens the rescue card: everything to the rescue address             |
| `binference rescue set <address>`        | A new rescue address in 24 hours; asks for the owner key            |
| `binference rescue cancel`               | Cancels a new rescue address that waits                             |
| `binference safety status`               | What is frozen, the rescue under way and the rescue address         |
| `binference telegram pair`               | A new link that pairs another Telegram account; shown once          |
| `binference signer revoke <signer>`      | Removes a machine's agent key from every wallet; owner key          |
| `binference address list`                | The agent's saved addresses and when a send may pay each            |
| `binference address add <address>`       | Saves a send address in the ceilings; asks for the owner key        |
| `binference address remove <entry>`      | Takes an address out of the book: nothing is sent to it again       |
| `binference limit`                       | The agent's limits in effect, and the looser ones that wait         |
| `binference limit set <key=value>`       | Stricter limits apply now, looser ones in 24 hours                  |
| `binference limit cancel`                | Drops the looser limits that wait                                   |
| `binference check [--fix]`               | Checks the config, file access, unlock mode and the engine          |

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
