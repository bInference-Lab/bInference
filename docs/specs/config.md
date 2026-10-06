# Spec 2: the config file

Status: accepted on 2026-10-06 ([decision 0094](../DECISIONS.md#d0094)), amended by
[decision 0102](../DECISIONS.md#d0102).

<a id="section-1"></a>

## 1. What lives where

- **The config file** holds what an owner sets once for the install: ports, the bot token's source,
  model providers, chains and venues, defaults for new agents, backups, updates, telemetry, the
  proxy, logging.
- **The engine database** holds what changes while trading: each agent's limits, send level, address
  book, mode (paper or live), rescue address, notification choices and models. Those change through
  protocol operations (spec 1, section 7.6), so every change is journaled; tighter values work from
  Telegram, and looser ones from the CLI, the console or the Mini App
  ([decision 0089](../DECISIONS.md#d0089)).
- **Only self-hosted installs read this file.** Cloud agents are configured by their worker's entry
  and the Cloud database ([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)); no key here
  names a profile ([rule 19](../ARCHITECTURE.md#rule-19)).
- A new agent copies `defaults` from the file into its database rows once, at creation.

<a id="section-2"></a>

## 2. The file

- Path: `~/.binference/config.json5` (`BINFERENCE_HOME` moves the folder; `--config <path>` points
  elsewhere).
- Format: JSON5 (comments and trailing commas allowed). Owner-only permissions; `binference check`
  fixes looser ones.
- `binference init` writes it with comments for every key it sets.
- The engine reads it at startup and on `config/change`; it never rewrites keys the owner did not
  change, and it keeps comments.

<a id="section-3"></a>

## 3. Layers

From lowest to highest; a higher layer replaces a lower one key by key:

1. Built-in defaults (this spec).
2. The file.
3. Environment variables: `BINFERENCE_` plus the key path in capitals, with `__` between segments.
   `BINFERENCE_ENGINE__PORT=7460` sets `engine.port`. Arrays and objects take JSON:
   `BINFERENCE_CHAINS__ENABLED='["eip155:56"]'`.
4. CLI flags: `--set engine.port=7460`, repeatable.

`binference config show` prints the merged result and the layer each value came from, with secrets
shown by kind only.

<a id="section-4"></a>

## 4. Validation

- One strict zod schema; unknown keys are refused (`config.invalid`), with the key's path, the
  problem and the fix, in the owner's language:
  `engine.port: must be a number from 1024 to 65535 (got "abc"). Set it in config.json5 or remove it.`
- A secret written as plain text fails with `config.secret_inline`; `binference check --fix` offers
  to move it to the keychain ([ENGINEERING.md section 11](../ENGINEERING.md#section-11)).
- `version` names the file's shape. A newer binference migrates an older file with
  `binference check --fix` after a backup; an older binference refuses a newer file.

<a id="section-5"></a>

## 5. Secret sources

Any key typed `Secret` takes exactly one of:

| Form                                                      | Reads the secret from                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `{ fromKeychain: "telegram-bot" }`                        | The OS keychain entry `binference/<name>` (`platform` SecretStore)                                       |
| `{ fromEnv: "TELEGRAM_BOT_TOKEN" }`                       | An environment variable of the engine process                                                            |
| `{ fromFile: "~/.binference/secrets/bot" }`               | A file with owner-only permissions; its whole content, trimmed                                           |
| `{ fromCommand: ["op", "read", "op://vault/bot/token"] }` | A command's standard output (1Password, Vault, pass), run with an argument array, no shell, 10 s timeout |

Secrets are read when needed and never logged, returned by `config/read`, or written back.

<a id="section-6"></a>

## 6. Keys

"Live" means a change applies without a restart; "restart" means `config/change` answers
`restartNeeded: true`.

<a id="section-6-1"></a>

### 6.1 `version`, `owner`, `engine`

| Key                       | Type                                                  | Default                                                                                     | Applies | Meaning                                                                                       |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `version`                 | integer                                               | `1`                                                                                         | restart | The file's shape                                                                              |
| `owner.locale`            | `"en"` \| `"zh"`                                      | from the OS                                                                                 | live    | Language of every surface                                                                     |
| `owner.timezone`          | IANA zone                                             | from the OS                                                                                 | live    | Schedules, the daily summary, times shown ([decision 0046](../DECISIONS.md#d0046))            |
| `engine.port`             | integer                                               | `7456`                                                                                      | restart | Console, Mini App and WebSocket (spec 1, section 2)                                           |
| `engine.webhookPort`      | integer                                               | `7457`                                                                                      | restart | The webhook listener                                                                          |
| `engine.extraOrigins`     | string[]                                              | `[]`                                                                                        | live    | More allowed browser origins                                                                  |
| `engine.unlock.mode`      | `"keychain"` \| `"file"` \| `"manual"` \| `"command"` | `"keychain"` with a desktop session, else `"file"` ([decision 0065](../DECISIONS.md#d0065)) | restart | Where the agent key and the Privy app secret are read at start (spec 5)                       |
| `engine.unlock.command`   | Secret (`fromCommand`)                                | none                                                                                        | restart | Used when `mode` is `"command"`                                                               |
| `engine.shutdownBudgetMs` | integer                                               | `30000`                                                                                     | live    | The shutdown order's time limit ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)) |

### 6.1a `custody`

Decided in [decision 0085](../DECISIONS.md#d0085) and [decision 0087](../DECISIONS.md#d0087).

| Key                            | Type      | Default       | Applies | Meaning                                                           |
| ------------------------------ | --------- | ------------- | ------- | ----------------------------------------------------------------- |
| `custody.provider`             | `"privy"` | `"privy"`     | restart | The only custody provider in v1                                   |
| `custody.privy.appId`          | string    | none          | restart | The owner's Privy app id (public)                                 |
| `custody.privy.appSecret`      | Secret    | none          | restart | The owner's Privy app secret; never inline (section 5)            |
| `custody.privy.ownerKeyPublic` | string    | set by `init` | restart | The owner key's public half, to check the wallets' owner (spec 5) |

The agent key is not in this file: the signer reads it through `engine.unlock` (spec 5, 3).

<a id="section-6-2"></a>

### 6.2 `telegram`

| Key                        | Type                       | Default     | Applies | Meaning                                                                                         |
| -------------------------- | -------------------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------- |
| `telegram.botToken`        | Secret                     | required    | restart | The owner's BotFather token                                                                     |
| `telegram.mode`            | `"polling"` \| `"webhook"` | `"polling"` | restart | How updates arrive                                                                              |
| `telegram.webhookSecret`   | Secret                     | none        | restart | Required with `"webhook"`, or the engine refuses to start                                       |
| `telegram.confirmBotToken` | Secret                     | none        | restart | A second bot for confirmations only ([ARCHITECTURE.md section 1](../ARCHITECTURE.md#section-1)) |
| `telegram.groups`          | boolean                    | `false`     | live    | Group chats ([ARCHITECTURE.md section 12](../ARCHITECTURE.md#section-12))                       |
| `telegram.topicsPerAgent`  | boolean                    | `true`      | live    | One DM topic per agent                                                                          |

<a id="section-6-3"></a>

### 6.3 `models`

| Key                               | Type                                                      | Default                                      | Applies | Meaning                                                                  |
| --------------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `models.providers.<name>.kind`    | `"binference"` \| `"openai"` \| `"anthropic"`             | `binference` provider: `"binference"`        | live    | The wire format                                                          |
| `models.providers.<name>.baseUrl` | URL                                                       | the binference AI gateway for `"binference"` | live    | Where to call                                                            |
| `models.providers.<name>.apiKey`  | Secret                                                    | set by `binference init`                     | live    | The provider's key                                                       |
| `models.main`                     | `"<provider>/<model>"`                                    | picked by evaluation (ARCHITECTURE.md 16)    | live    | Talks and proposes                                                       |
| `models.fast`                     | `"<provider>/<model>"`                                    | picked by evaluation                         | live    | Summaries, compaction, classification                                    |
| `models.vision`                   | `"<provider>/<model>"`                                    | none                                         | live    | Reads images when `main` cannot ([decision 0050](../DECISIONS.md#d0050)) |
| `models.fallbacks.main`           | string[]                                                  | `[]`                                         | live    | Tried in order on a provider failure                                     |
| `models.fallbacks.fast`           | string[]                                                  | `[]`                                         | live    |                                                                          |
| `models.idleTimeoutMs`            | integer                                                   | `120000`                                     | live    | No output for this long aborts a request                                 |
| `models.cooldownMs`               | integer                                                   | `60000`                                      | live    | A failing provider rests this long                                       |
| `models.maxToolCallsPerTurn`      | integer                                                   | `25`                                         | live    | [decision 0049](../DECISIONS.md#d0049)                                   |
| `models.loopDetection`            | boolean                                                   | `true`                                       | live    | [decision 0049](../DECISIONS.md#d0049)                                   |
| `models.prices.<provider/model>`  | `{ inputPerMTokUsd, outputPerMTokUsd, cachedPerMTokUsd }` | built-in table                               | live    | For usage views and the budget                                           |

<a id="section-6-4"></a>

### 6.4 `defaults` (copied into each new agent)

| Key                                    | Default ([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28))                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `defaults.limits.perTradeUsd`          | `100`                                                                                                                    |
| `defaults.limits.rollingDayUsd`        | `500`                                                                                                                    |
| `defaults.limits.slippageBps.registry` | `100`                                                                                                                    |
| `defaults.limits.slippageBps.other`    | `500`                                                                                                                    |
| `defaults.limits.priceImpactBps`       | `300`                                                                                                                    |
| `defaults.limits.taxBps`               | `1000`                                                                                                                   |
| `defaults.limits.liquidityFloorUsd`    | `10000`                                                                                                                  |
| `defaults.limits.minHealthFactor`      | `1.5`                                                                                                                    |
| `defaults.limits.gasReserve`           | `{ "eip155:56": "0.002" }` (in the native coin)                                                                          |
| `defaults.limits.venues`               | every installed core venue                                                                                               |
| `defaults.limits.allowTokens`          | `[]` (empty: all, after risk)                                                                                            |
| `defaults.limits.denyTokens`           | `[]`                                                                                                                     |
| `defaults.sendLevel`                   | `0`                                                                                                                      |
| `defaults.approvalMode`                | `"manual"` ([decision 0088](../DECISIONS.md#d0088))                                                                      |
| `defaults.ceiling.perTxBnb`            | `"1"`: the Privy policy's per-transaction BNB cap, set by the owner key (spec 5, [decision 0094](../DECISIONS.md#d0094)) |
| `defaults.cards.tradeExpirySec`        | `60`                                                                                                                     |
| `defaults.cards.otherExpirySec`        | `600`                                                                                                                    |
| `defaults.cards.requoteAfterSec`       | `10`                                                                                                                     |
| `defaults.cards.requoteToleranceBps`   | `50`                                                                                                                     |
| `defaults.orders.expiryDays`           | `30`                                                                                                                     |
| `defaults.copy.perBuyUsd`              | `20`                                                                                                                     |
| `defaults.copy.perLeaderDayUsd`        | `200`                                                                                                                    |
| `defaults.paper.balances`              | `{ "BNB": "1", "USDT": "500" }`                                                                                          |
| `defaults.modelBudgetUsdPerDay`        | `3`                                                                                                                      |
| `defaults.notifications`               | the [decision 0057](../DECISIONS.md#d0057) set, daily summary at `09:00`                                                 |

Dollar values in the file are plain decimals for readability; the engine converts them to
micro-dollars and base units on load.

<a id="section-6-5"></a>

### 6.5 `chains`, `venues`, `risk`, `search`

| Key                                        | Type                                       | Default                                                         | Applies | Meaning                                                                                 |
| ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `chains.enabled`                           | ChainRef[]                                 | `["eip155:56"]` ([decision 0023](../DECISIONS.md#d0023))        | restart | Chains the agent trades on                                                              |
| `chains.rpc.<chain>.urls`                  | URL[]                                      | the chain file's public RPCs                                    | live    | Extra or replacement RPCs                                                               |
| `chains.rpc.<chain>.key`                   | Secret                                     | none                                                            | live    | A paid RPC's key                                                                        |
| `chains.relays.<chain>`                    | string[]                                   | the two fastest, by measurement                                 | live    | Private relays for sends                                                                |
| `chains.maxFeePerGasGwei.<chain>`          | decimal string                             | `{ "eip155:56": "1" }` ([decision 0102](../DECISIONS.md#d0102)) | live    | The network fee cap, in gwei: a higher fee per gas opens a card in either approval mode |
| `venues.keys.okx`                          | `{ apiKey, secret, passphrase }` (Secrets) | none                                                            | live    | Adds OKX routing                                                                        |
| `venues.keys.oneinch`, `venues.keys.zerox` | Secret                                     | none                                                            | live    | Adds those aggregators                                                                  |
| `venues.kyberClientId`                     | string                                     | `"binference"`                                                  | live    | KyberSwap's client id                                                                   |
| `risk.cacheTtlSec`                         | integer                                    | `600`                                                           | live    | GoPlus and honeypot.is answers                                                          |
| `search.provider`                          | `"duckduckgo"` \| `"brave"` \| `"tavily"`  | `"duckduckgo"`                                                  | live    | `search_web`                                                                            |
| `search.keys.<provider>`                   | Secret                                     | none                                                            | live    |                                                                                         |
| `search.xApiKey`                           | Secret                                     | none                                                            | live    | Turns `search_x` on                                                                     |

<a id="section-6-6"></a>

### 6.6 Operations

| Key                    | Type                                           | Default                      | Applies | Meaning                                                                                                 |
| ---------------------- | ---------------------------------------------- | ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `remote.mini`          | boolean                                        | `false`                      | live    | Publish the Mini App over Tailscale `serve` ([decision 0051](../DECISIONS.md#d0051))                    |
| `remote.webhooks`      | boolean                                        | `false`                      | live    | Publish the webhook path over Tailscale `funnel`                                                        |
| `backups.daily`        | boolean                                        | `true`                       | live    | [decision 0055](../DECISIONS.md#d0055)                                                                  |
| `backups.keepDaily`    | integer                                        | `7`                          | live    |                                                                                                         |
| `backups.keepWeekly`   | integer                                        | `4`                          | live    |                                                                                                         |
| `backups.copyTo`       | path                                           | none                         | live    | A second copy                                                                                           |
| `updates.check`        | boolean                                        | `true`                       | live    | The daily update check ([decision 0047](../DECISIONS.md#d0047))                                         |
| `updates.channel`      | `"stable"` \| `"beta"`                         | `"stable"`                   | live    |                                                                                                         |
| `telemetry.enabled`    | boolean                                        | `false`                      | live    | Opt-in counts ([decision 0048](../DECISIONS.md#d0048)); onboarding asks once                            |
| `network.proxy`        | Secret                                         | none                         | restart | An HTTP(S) proxy URL, credentials included                                                              |
| `network.noProxy`      | string[]                                       | `["127.0.0.1", "localhost"]` | restart |                                                                                                         |
| `chats.keepDays`       | integer \| `"forever"`                         | `90`                         | live    | [decision 0056](../DECISIONS.md#d0056)                                                                  |
| `chats.newMessageMode` | `"merge"` \| `"after"`                         | `"merge"`                    | live    | A message during a turn merges in, or waits ([ARCHITECTURE.md section 4](../ARCHITECTURE.md#section-4)) |
| `logging.level`        | `"error"` \| `"warn"` \| `"info"` \| `"debug"` | `"info"`                     | live    |                                                                                                         |
| `logging.keepDays`     | integer                                        | `14`                         | live    |                                                                                                         |
| `logging.maxFileMb`    | integer                                        | `20`                         | live    | Rotation size                                                                                           |
| `cex.binance.enabled`  | boolean                                        | `false`                      | restart | The Binance Agent OS plugin ([decision 0006](../DECISIONS.md#d0006))                                    |
| `plugins.<id>`         | object                                         | the plugin's schema          | live    | Each plugin's settings, validated by its own schema                                                     |

<a id="section-7"></a>

## 7. Example

```json5
// ~/.binference/config.json5
{
  version: 2,
  owner: { locale: "zh", timezone: "Asia/Shanghai" },
  custody: {
    privy: {
      appId: "cm0abc123example",
      appSecret: { fromKeychain: "privy-app-secret" },
      ownerKeyPublic: "<written by binference init>",
    },
  },
  telegram: { botToken: { fromKeychain: "telegram-bot" } },
  models: {
    providers: {
      binference: { kind: "binference", apiKey: { fromKeychain: "binference-key" } },
    },
    main: "binference/main-default",
    fast: "binference/fast-default",
  },
  defaults: { limits: { perTradeUsd: 50, rollingDayUsd: 250 } },
  network: { proxy: { fromEnv: "HTTPS_PROXY" } },
}
```
