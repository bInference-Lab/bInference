# Config keys

This file is generated from the config schema by `pnpm check:config-schema --write`. Change the schema in `packages/cli/src/config/schema/`, never this file.

This binference reads `config.json5` version 2. Each key is set in the file, by its variable, or by `--set <key>=<value>`, and a later layer wins. A secret is always a secret source, never the secret itself.

## `version`

The shape of this file.

- `version`: The shape of this file. Takes a whole number of at least 1. Default: `1`. Variable: `BINFERENCE_VERSION`.

## `owner`

The owner.

- `owner.locale`: The language of every surface. Takes one of "en", "zh". Default: from the OS. Variable: `BINFERENCE_OWNER__LOCALE`.
- `owner.timezone`: The IANA time zone for schedules, the daily summary and times shown. Takes an IANA time zone such as Asia/Shanghai. Default: from the OS. Variable: `BINFERENCE_OWNER__TIMEZONE`.

## `engine`

The engine process.

- `engine.port`: The console, Mini App and WebSocket port. Takes a number from 1024 to 65535. Default: `7456`. Variable: `BINFERENCE_ENGINE__PORT`.
- `engine.webhookPort`: The webhook listener's port. Takes a number from 1024 to 65535. Default: `7457`. Variable: `BINFERENCE_ENGINE__WEBHOOK_PORT`.
- `engine.extraOrigins`: More browser origins allowed to reach the engine. Takes a list in which each item is a URL. Default: `[]`. Variable: `BINFERENCE_ENGINE__EXTRA_ORIGINS`.
- `engine.unlock.mode`: Where the agent key and the Privy app secret are read at start. Takes one of "keychain", "file", "manual", "command". Default: keychain with a desktop session, else file. Variable: `BINFERENCE_ENGINE__UNLOCK__MODE`.
- `engine.unlock.command`: The command that prints the agent key; used when mode is command. Takes a secret source { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_ENGINE__UNLOCK__COMMAND`.
- `engine.shutdownBudgetMs`: The time limit of the shutdown order, in milliseconds. Takes a whole number of at least 1000. Default: `30000`. Variable: `BINFERENCE_ENGINE__SHUTDOWN_BUDGET_MS`.

## `custody`

Who holds the agent wallets.

- `custody.provider`: The custody provider. Takes "privy". Default: `"privy"`. Variable: `BINFERENCE_CUSTODY__PROVIDER`.
- `custody.privy.appId`: The owner's Privy app id (public). Takes text. Default: none. Variable: `BINFERENCE_CUSTODY__PRIVY__APP_ID`.
- `custody.privy.appSecret`: The owner's Privy app secret, as a secret source. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_CUSTODY__PRIVY__APP_SECRET`.
- `custody.privy.ownerKeyPublic`: The owner key's public half, written by binference init. Takes text. Default: none. Variable: `BINFERENCE_CUSTODY__PRIVY__OWNER_KEY_PUBLIC`.

## `telegram`

The owner's Telegram bot.

- `telegram.botToken`: The owner's BotFather token. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Required. Variable: `BINFERENCE_TELEGRAM__BOT_TOKEN`.
- `telegram.mode`: How updates arrive. Takes one of "polling", "webhook". Default: `"polling"`. Variable: `BINFERENCE_TELEGRAM__MODE`.
- `telegram.webhookSecret`: Checks webhook calls; required with the webhook mode. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_TELEGRAM__WEBHOOK_SECRET`.
- `telegram.confirmBotToken`: A second bot that only sends confirmations. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_TELEGRAM__CONFIRM_BOT_TOKEN`.
- `telegram.groups`: Whether the bot answers in group chats. Takes true or false. Default: `false`. Variable: `BINFERENCE_TELEGRAM__GROUPS`.
- `telegram.topicsPerAgent`: One direct-message topic per agent. Takes true or false. Default: `true`. Variable: `BINFERENCE_TELEGRAM__TOPICS_PER_AGENT`.

## `models`

Model providers and the models the agent uses.

- `models.providers`: The model providers, by name. Takes an object. Default: `{}`. Variable: `BINFERENCE_MODELS__PROVIDERS`. Keys: text.
- `models.providers.<provider>.kind`: The provider's wire format. Takes one of "binference", "openai", "anthropic". Required. Variable: `BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__KIND`.
- `models.providers.<provider>.baseUrl`: Where to call; the binference AI gateway for the binference kind. Takes a URL. Default: none. Variable: `BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__BASE_URL`.
- `models.providers.<provider>.apiKey`: The provider's key. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__API_KEY`.
- `models.main`: The model that talks and proposes. Takes a model written as provider/model. Default: none. Variable: `BINFERENCE_MODELS__MAIN`.
- `models.fast`: The model that writes summaries, compacts and classifies. Takes a model written as provider/model. Default: none. Variable: `BINFERENCE_MODELS__FAST`.
- `models.vision`: The model that reads images when the main one cannot. Takes a model written as provider/model. Default: none. Variable: `BINFERENCE_MODELS__VISION`.
- `models.fallbacks.main`: Models tried in order when the main one fails. Takes a list in which each item is a model written as provider/model. Default: `[]`. Variable: `BINFERENCE_MODELS__FALLBACKS__MAIN`.
- `models.fallbacks.fast`: Models tried in order when the fast one fails. Takes a list in which each item is a model written as provider/model. Default: `[]`. Variable: `BINFERENCE_MODELS__FALLBACKS__FAST`.
- `models.idleTimeoutMs`: No output for this many milliseconds aborts a model request. Takes a whole number of at least 1. Default: `120000`. Variable: `BINFERENCE_MODELS__IDLE_TIMEOUT_MS`.
- `models.cooldownMs`: How long a failing provider rests, in milliseconds. Takes a whole number of at least 1. Default: `60000`. Variable: `BINFERENCE_MODELS__COOLDOWN_MS`.
- `models.maxToolCallsPerTurn`: Tool calls allowed per turn. Takes a whole number of at least 1. Default: `25`. Variable: `BINFERENCE_MODELS__MAX_TOOL_CALLS_PER_TURN`.
- `models.loopDetection`: Stops a turn that repeats its tool calls. Takes true or false. Default: `true`. Variable: `BINFERENCE_MODELS__LOOP_DETECTION`.
- `models.prices`: Model prices that replace the built-in table. Takes an object. Default: `{}`. Variable: `BINFERENCE_MODELS__PRICES`. Keys: a model written as provider/model.
- `models.prices.<model>.inputPerMTokUsd`: US dollars per million input tokens. Takes a number of at least 0. Required. Variable: `BINFERENCE_MODELS__PRICES__<MODEL>__INPUT_PER_MTOK_USD`.
- `models.prices.<model>.outputPerMTokUsd`: US dollars per million output tokens. Takes a number of at least 0. Required. Variable: `BINFERENCE_MODELS__PRICES__<MODEL>__OUTPUT_PER_MTOK_USD`.
- `models.prices.<model>.cachedPerMTokUsd`: US dollars per million cached input tokens. Takes a number of at least 0. Required. Variable: `BINFERENCE_MODELS__PRICES__<MODEL>__CACHED_PER_MTOK_USD`.

## `defaults`

What each new agent starts with; copied into its rows once, at creation.

- `defaults.limits.perTradeUsd`: The most one trade may move, in US dollars. Takes a number of at least 0. Default: `100`. Variable: `BINFERENCE_DEFAULTS__LIMITS__PER_TRADE_USD`.
- `defaults.limits.rollingDayUsd`: The most trades and sends may move in 24 hours, in US dollars. Takes a number of at least 0. Default: `500`. Variable: `BINFERENCE_DEFAULTS__LIMITS__ROLLING_DAY_USD`.
- `defaults.limits.slippageBps.registry`: Slippage allowed on registry tokens, in basis points. Takes a number from 0 to 10000. Default: `100`. Variable: `BINFERENCE_DEFAULTS__LIMITS__SLIPPAGE_BPS__REGISTRY`.
- `defaults.limits.slippageBps.other`: Slippage allowed on every other token, in basis points. Takes a number from 0 to 10000. Default: `500`. Variable: `BINFERENCE_DEFAULTS__LIMITS__SLIPPAGE_BPS__OTHER`.
- `defaults.limits.priceImpactBps`: The largest price impact allowed, in basis points. Takes a number from 0 to 10000. Default: `300`. Variable: `BINFERENCE_DEFAULTS__LIMITS__PRICE_IMPACT_BPS`.
- `defaults.limits.taxBps`: The largest token tax allowed, in basis points. Takes a number from 0 to 10000. Default: `1000`. Variable: `BINFERENCE_DEFAULTS__LIMITS__TAX_BPS`.
- `defaults.limits.liquidityFloorUsd`: The least pool liquidity a trade needs, in US dollars. Takes a number of at least 0. Default: `10000`. Variable: `BINFERENCE_DEFAULTS__LIMITS__LIQUIDITY_FLOOR_USD`.
- `defaults.limits.minHealthFactor`: The lowest lending health factor a move may leave. Takes a number of at least 1. Default: `1.5`. Variable: `BINFERENCE_DEFAULTS__LIMITS__MIN_HEALTH_FACTOR`.
- `defaults.limits.gasReserve.<chain>`: The native coin kept for gas, per chain. Takes a decimal number in quotes, such as "0.002". Default: `{"eip155:56":"0.002"}`. Variable: `BINFERENCE_DEFAULTS__LIMITS__GAS_RESERVE__<CHAIN>`. Keys: a chain id such as eip155:56.
- `defaults.limits.venues`: The venues allowed. Takes a list in which each item is text. Default: every installed core venue. Variable: `BINFERENCE_DEFAULTS__LIMITS__VENUES`.
- `defaults.limits.allowTokens`: Tokens allowed; empty allows every token that passes the risk check. Takes a list in which each item is text. Default: `[]`. Variable: `BINFERENCE_DEFAULTS__LIMITS__ALLOW_TOKENS`.
- `defaults.limits.denyTokens`: Tokens refused. Takes a list in which each item is text. Default: `[]`. Variable: `BINFERENCE_DEFAULTS__LIMITS__DENY_TOKENS`.
- `defaults.sendLevel`: The send level, 0 to 3. Takes a number from 0 to 3. Default: `0`. Variable: `BINFERENCE_DEFAULTS__SEND_LEVEL`.
- `defaults.approvalMode`: Whether trades within the caps wait for a tap. Takes one of "manual", "auto". Default: `"manual"`. Variable: `BINFERENCE_DEFAULTS__APPROVAL_MODE`.
- `defaults.ceiling.perTxBnb`: The Privy policy's per-transaction cap, in BNB. Takes a decimal number in quotes, such as "0.002". Default: `"1"`. Variable: `BINFERENCE_DEFAULTS__CEILING__PER_TX_BNB`.
- `defaults.cards.tradeExpirySec`: A trade card expires after this many seconds. Takes a whole number of at least 1. Default: `60`. Variable: `BINFERENCE_DEFAULTS__CARDS__TRADE_EXPIRY_SEC`.
- `defaults.cards.otherExpirySec`: Other cards expire after this many seconds. Takes a whole number of at least 1. Default: `600`. Variable: `BINFERENCE_DEFAULTS__CARDS__OTHER_EXPIRY_SEC`.
- `defaults.cards.requoteAfterSec`: A quote older than this many seconds is taken again. Takes a whole number of at least 1. Default: `10`. Variable: `BINFERENCE_DEFAULTS__CARDS__REQUOTE_AFTER_SEC`.
- `defaults.cards.requoteToleranceBps`: A new quote this much worse asks again, in basis points. Takes a number from 0 to 10000. Default: `50`. Variable: `BINFERENCE_DEFAULTS__CARDS__REQUOTE_TOLERANCE_BPS`.
- `defaults.orders.expiryDays`: An auto order expires after this many days. Takes a whole number of at least 1. Default: `30`. Variable: `BINFERENCE_DEFAULTS__ORDERS__EXPIRY_DAYS`.
- `defaults.copy.perBuyUsd`: The most one copied buy may spend, in US dollars. Takes a number of at least 0. Default: `20`. Variable: `BINFERENCE_DEFAULTS__COPY__PER_BUY_USD`.
- `defaults.copy.perLeaderDayUsd`: The most copies of one leader may spend a day, in US dollars. Takes a number of at least 0. Default: `200`. Variable: `BINFERENCE_DEFAULTS__COPY__PER_LEADER_DAY_USD`.
- `defaults.paper.balances.<symbol>`: Paper-mode starting balances. Takes a decimal number in quotes, such as "0.002". Default: `{"BNB":"1","USDT":"500"}`. Variable: `BINFERENCE_DEFAULTS__PAPER__BALANCES__<SYMBOL>`. Keys: text.
- `defaults.modelBudgetUsdPerDay`: The most model calls may cost a day, in US dollars. Takes a number of at least 0. Default: `3`. Variable: `BINFERENCE_DEFAULTS__MODEL_BUDGET_USD_PER_DAY`.

## `chains`

Chains.

- `chains.enabled`: Chains the agent trades on. Takes a list in which each item is a chain id such as eip155:56. Default: `["eip155:56"]`. Variable: `BINFERENCE_CHAINS__ENABLED`.
- `chains.rpc`: RPCs per chain. Takes an object. Default: `{}`. Variable: `BINFERENCE_CHAINS__RPC`. Keys: a chain id such as eip155:56.
- `chains.rpc.<chain>.urls`: Extra or replacement RPCs. Takes a list in which each item is a URL. Default: the public RPCs. Variable: `BINFERENCE_CHAINS__RPC__<CHAIN>__URLS`.
- `chains.rpc.<chain>.key`: A paid RPC's key. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_CHAINS__RPC__<CHAIN>__KEY`.
- `chains.relays.<chain>`: Private relays for sends, per chain. Takes a list in which each item is text. Default: the two fastest, by measurement. Variable: `BINFERENCE_CHAINS__RELAYS__<CHAIN>`. Keys: a chain id such as eip155:56.
- `chains.maxFeePerGasGwei.<chain>`: The network fee cap per chain, in gwei: a higher fee per gas asks the owner. Takes a decimal number in quotes, such as "0.002". Default: `{"eip155:56":"1"}`. Variable: `BINFERENCE_CHAINS__MAX_FEE_PER_GAS_GWEI__<CHAIN>`. Keys: a chain id such as eip155:56.

## `venues`

Routing venues.

- `venues.keys.okx.apiKey`: OKX's API key. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Required. Variable: `BINFERENCE_VENUES__KEYS__OKX__API_KEY`.
- `venues.keys.okx.secret`: OKX's secret. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Required. Variable: `BINFERENCE_VENUES__KEYS__OKX__SECRET`.
- `venues.keys.okx.passphrase`: OKX's passphrase. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Required. Variable: `BINFERENCE_VENUES__KEYS__OKX__PASSPHRASE`.
- `venues.keys.oneinch`: Adds 1inch routing. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_VENUES__KEYS__ONEINCH`.
- `venues.keys.zerox`: Adds 0x routing. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_VENUES__KEYS__ZEROX`.
- `venues.kyberClientId`: The client id sent to KyberSwap. Takes text. Default: `"binference"`. Variable: `BINFERENCE_VENUES__KYBER_CLIENT_ID`.

## `risk`

Risk data.

- `risk.cacheTtlSec`: How long risk answers are kept, in seconds. Takes a whole number of at least 1. Default: `600`. Variable: `BINFERENCE_RISK__CACHE_TTL_SEC`.

## `search`

Web search.

- `search.provider`: The provider behind search_web. Takes one of "duckduckgo", "brave", "tavily". Default: `"duckduckgo"`. Variable: `BINFERENCE_SEARCH__PROVIDER`.
- `search.keys.brave`: Brave Search's key. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_SEARCH__KEYS__BRAVE`.
- `search.keys.tavily`: Tavily's key. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_SEARCH__KEYS__TAVILY`.
- `search.xApiKey`: Turns search_x on. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_SEARCH__X_API_KEY`.

## `remote`

Remote access.

- `remote.mini`: Publishes the Mini App over Tailscale serve. Takes true or false. Default: `false`. Variable: `BINFERENCE_REMOTE__MINI`.
- `remote.webhooks`: Publishes the webhook path over Tailscale funnel. Takes true or false. Default: `false`. Variable: `BINFERENCE_REMOTE__WEBHOOKS`.

## `backups`

Backups.

- `backups.daily`: Takes an encrypted backup every day. Takes true or false. Default: `true`. Variable: `BINFERENCE_BACKUPS__DAILY`.
- `backups.keepDaily`: Daily backups kept. Takes a whole number of at least 1. Default: `7`. Variable: `BINFERENCE_BACKUPS__KEEP_DAILY`.
- `backups.keepWeekly`: Weekly backups kept. Takes a whole number of at least 1. Default: `4`. Variable: `BINFERENCE_BACKUPS__KEEP_WEEKLY`.
- `backups.copyTo`: A folder that gets a second copy. Takes an absolute path, or one that starts with ~/. Default: none. Variable: `BINFERENCE_BACKUPS__COPY_TO`.

## `updates`

Updates.

- `updates.check`: Checks for a newer version once a day. Takes true or false. Default: `true`. Variable: `BINFERENCE_UPDATES__CHECK`.
- `updates.channel`: The release channel. Takes one of "stable", "beta". Default: `"stable"`. Variable: `BINFERENCE_UPDATES__CHANNEL`.

## `telemetry`

Telemetry.

- `telemetry.enabled`: Adds opt-in counts to the daily update check. Takes true or false. Default: `false`. Variable: `BINFERENCE_TELEMETRY__ENABLED`.

## `network`

The outbound network.

- `network.proxy`: An HTTP or HTTPS proxy URL, credentials included. Takes a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or { fromCommand: ["program", "argument"] }. Default: none. Variable: `BINFERENCE_NETWORK__PROXY`.
- `network.noProxy`: Hosts reached without the proxy. Takes a list in which each item is text. Default: `["127.0.0.1","localhost"]`. Variable: `BINFERENCE_NETWORK__NO_PROXY`.

## `chats`

Chats.

- `chats.keepDays`: Days chats are kept, or forever. Takes a whole number of at least 1 or "forever". Default: `90`. Variable: `BINFERENCE_CHATS__KEEP_DAYS`.
- `chats.newMessageMode`: Whether a message during a turn merges in or waits for the turn to end. Takes one of "merge", "after". Default: `"merge"`. Variable: `BINFERENCE_CHATS__NEW_MESSAGE_MODE`.

## `logging`

Logs.

- `logging.level`: The log level. Takes one of "error", "warn", "info", "debug". Default: `"info"`. Variable: `BINFERENCE_LOGGING__LEVEL`.
- `logging.keepDays`: Days log files are kept. Takes a whole number of at least 1. Default: `14`. Variable: `BINFERENCE_LOGGING__KEEP_DAYS`.
- `logging.maxFileMb`: A log file rotates at this many megabytes. Takes a whole number of at least 1. Default: `20`. Variable: `BINFERENCE_LOGGING__MAX_FILE_MB`.

## `cex`

Centralized exchanges.

- `cex.binance.enabled`: Turns on the Binance Agent OS plugin. Takes true or false. Default: `false`. Variable: `BINFERENCE_CEX__BINANCE__ENABLED`.

## `plugins`

Each plugin's settings, by plugin id.

- `plugins`: Each plugin's settings, by plugin id. Takes an object. Default: `{}`. Variable: `BINFERENCE_PLUGINS`. Keys: text.
- `plugins.<plugin>.<setting>`: One plugin's settings, as its own schema reads them. Takes any JSON value. Default: none. Variable: `BINFERENCE_PLUGINS__<PLUGIN>__<SETTING>`. Keys: text.
