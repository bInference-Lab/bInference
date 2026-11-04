---
title: "配置项"
description: "config.json5 中的每个配置项：取值、默认值和环境变量。"
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

此版本的 binference 读取第 13 版的 `config.json5`。每个配置项可以在文件中、通过对应的变量或用 `--set <key>=<value>` 设置，后面的层优先。密钥始终写成密钥来源，从不写密钥本身。

## `version`

此文件的格式版本。

- `version`: 此文件的格式版本。取值：不小于 1 的整数。默认：`1`。变量：`BINFERENCE_VERSION`。

## `owner`

所有者。

- `owner.locale`: 所有界面使用的语言。取值：以下之一："en", "zh"。默认：跟随操作系统。变量：`BINFERENCE_OWNER__LOCALE`。
- `owner.timezone`: 定时任务、每日摘要和显示时间所用的 IANA 时区。取值：IANA 时区，例如 Asia/Shanghai。默认：跟随操作系统。变量：`BINFERENCE_OWNER__TIMEZONE`。

## `engine`

引擎进程。

- `engine.port`: 控制台、Mini App 和 WebSocket 使用的端口。取值：1024 到 65535 之间的数字。默认：`7456`。变量：`BINFERENCE_ENGINE__PORT`。
- `engine.webhookPort`: Webhook 监听器的端口。取值：1024 到 65535 之间的数字。默认：`7457`。变量：`BINFERENCE_ENGINE__WEBHOOK_PORT`。
- `engine.extraOrigins`: 允许访问引擎的其他浏览器来源。取值：列表，每一项为URL。默认：`[]`。变量：`BINFERENCE_ENGINE__EXTRA_ORIGINS`。
- `engine.unlock.mode`: 启动时从哪里读取 Agent 密钥和 Privy 应用密钥。取值：以下之一："keychain", "file", "manual", "command"。默认：有桌面会话时为 keychain（钥匙串），否则为 file。变量：`BINFERENCE_ENGINE__UNLOCK__MODE`。
- `engine.unlock.command`: 输出 Agent 密钥的命令；解锁方式为 command 时使用。取值：密钥来源 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_ENGINE__UNLOCK__COMMAND`。
- `engine.shutdownBudgetMs`: 关闭流程的时限，单位为毫秒。取值：不小于 1000 的整数。默认：`30000`。变量：`BINFERENCE_ENGINE__SHUTDOWN_BUDGET_MS`。

## `custody`

由谁托管 Agent 钱包。

- `custody.provider`: 托管服务商。取值："privy"。默认：`"privy"`。变量：`BINFERENCE_CUSTODY__PROVIDER`。
- `custody.privy.appId`: 所有者的 Privy 应用 ID（公开）。取值：文本。默认：无。变量：`BINFERENCE_CUSTODY__PRIVY__APP_ID`。
- `custody.privy.appSecret`: 所有者的 Privy 应用密钥，写成密钥来源。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_CUSTODY__PRIVY__APP_SECRET`。
- `custody.privy.ownerKeyPublic`: 所有者密钥的公钥部分，由 binference init 写入。取值：文本。默认：无。变量：`BINFERENCE_CUSTODY__PRIVY__OWNER_KEY_PUBLIC`。

## `telegram`

所有者的 Telegram 机器人。

- `telegram.botToken`: 所有者从 BotFather 得到的机器人 Token。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。必填。变量：`BINFERENCE_TELEGRAM__BOT_TOKEN`。
- `telegram.mode`: 接收更新的方式。取值：以下之一："polling", "webhook"。默认：`"polling"`。变量：`BINFERENCE_TELEGRAM__MODE`。
- `telegram.webhookSecret`: 用于校验 Webhook 调用；使用 webhook 方式时必填。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_TELEGRAM__WEBHOOK_SECRET`。
- `telegram.confirmBotToken`: 只发送确认卡片的第二个机器人。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_TELEGRAM__CONFIRM_BOT_TOKEN`。
- `telegram.groups`: 机器人是否在群组对话中回答。取值：true 或 false。默认：`false`。变量：`BINFERENCE_TELEGRAM__GROUPS`。
- `telegram.topicsPerAgent`: 机器人开启话题后，每个 Agent 使用一个私聊话题。取值：true 或 false。默认：`false`。变量：`BINFERENCE_TELEGRAM__TOPICS_PER_AGENT`。

## `models`

模型服务商和 Agent 使用的模型。

- `models.providers`: 模型服务商，按名称列出。取值：对象。默认：`{}`。变量：`BINFERENCE_MODELS__PROVIDERS`。名称：文本。
- `models.providers.<provider>.kind`: 服务商的接口格式。取值：以下之一："binference", "openai", "anthropic"。必填。变量：`BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__KIND`。
- `models.providers.<provider>.baseUrl`: 调用的接口地址；binference 类型使用 binference AI 网关。取值：URL。默认：无。变量：`BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__BASE_URL`。
- `models.providers.<provider>.apiKey`: 服务商的 API 密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_MODELS__PROVIDERS__<PROVIDER>__API_KEY`。
- `models.main`: 负责对话和提议的模型。取值：写作 provider/model 的模型，即服务商名加模型名。默认：无。变量：`BINFERENCE_MODELS__MAIN`。
- `models.fast`: 负责写摘要、压缩上下文和分类的模型。取值：写作 provider/model 的模型，即服务商名加模型名。默认：无。变量：`BINFERENCE_MODELS__FAST`。
- `models.vision`: 主模型无法读取图片时，负责读取图片的模型。取值：写作 provider/model 的模型，即服务商名加模型名。默认：无。变量：`BINFERENCE_MODELS__VISION`。
- `models.imageInput`: 能以图片作为输入的模型；其他模型收到视觉模型写的图片描述。取值：列表，每一项为写作 provider/model 的模型，即服务商名加模型名。默认：`[]`。变量：`BINFERENCE_MODELS__IMAGE_INPUT`。
- `models.fallbacks.main`: 主模型失败时依次尝试的备用模型。取值：列表，每一项为写作 provider/model 的模型，即服务商名加模型名。默认：`[]`。变量：`BINFERENCE_MODELS__FALLBACKS__MAIN`。
- `models.fallbacks.fast`: 快速模型失败时依次尝试的备用模型。取值：列表，每一项为写作 provider/model 的模型，即服务商名加模型名。默认：`[]`。变量：`BINFERENCE_MODELS__FALLBACKS__FAST`。
- `models.idleTimeoutMs`: 模型请求在这么多毫秒内没有输出时中止。取值：不小于 1 的整数。默认：`120000`。变量：`BINFERENCE_MODELS__IDLE_TIMEOUT_MS`。
- `models.cooldownMs`: 失败的服务商暂停使用的时长，单位为毫秒。取值：不小于 1 的整数。默认：`60000`。变量：`BINFERENCE_MODELS__COOLDOWN_MS`。
- `models.maxToolCallsPerTurn`: 每轮允许的工具调用次数。取值：不小于 1 的整数。默认：`25`。变量：`BINFERENCE_MODELS__MAX_TOOL_CALLS_PER_TURN`。
- `models.loopDetection`: 停止重复相同工具调用的一轮。取值：true 或 false。默认：`true`。变量：`BINFERENCE_MODELS__LOOP_DETECTION`。
- `models.prices`: 替换内置价格表的模型价格。取值：对象。默认：`{}`。变量：`BINFERENCE_MODELS__PRICES`。名称：写作 provider/model 的模型，即服务商名加模型名。
- `models.prices.<model>.inputPerMTokUsd`: 每百万输入 Token 的美元价格。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。必填。变量：`BINFERENCE_MODELS__PRICES__<MODEL>__INPUT_PER_MTOK_USD`。
- `models.prices.<model>.outputPerMTokUsd`: 每百万输出 Token 的美元价格。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。必填。变量：`BINFERENCE_MODELS__PRICES__<MODEL>__OUTPUT_PER_MTOK_USD`。
- `models.prices.<model>.cachedPerMTokUsd`: 每百万缓存输入 Token 的美元价格。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。必填。变量：`BINFERENCE_MODELS__PRICES__<MODEL>__CACHED_PER_MTOK_USD`。

## `defaults`

每个新 Agent 的初始设置；只在创建时复制一次。

- `defaults.limits.perTradeUsd`: 单笔交易最多可动用的金额，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"100"`。变量：`BINFERENCE_DEFAULTS__LIMITS__PER_TRADE_USD`。
- `defaults.limits.rollingDayUsd`: 24 小时内交易和转账最多可动用的金额，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"500"`。变量：`BINFERENCE_DEFAULTS__LIMITS__ROLLING_DAY_USD`。
- `defaults.limits.slippageBps.registry`: 代币列表内代币允许的滑点，单位为基点。取值：0 到 10000 之间的数字。默认：`100`。变量：`BINFERENCE_DEFAULTS__LIMITS__SLIPPAGE_BPS__REGISTRY`。
- `defaults.limits.slippageBps.other`: 其他代币允许的滑点，单位为基点。取值：0 到 10000 之间的数字。默认：`500`。变量：`BINFERENCE_DEFAULTS__LIMITS__SLIPPAGE_BPS__OTHER`。
- `defaults.limits.priceImpactBps`: 允许的最大价格影响，单位为基点。取值：0 到 10000 之间的数字。默认：`300`。变量：`BINFERENCE_DEFAULTS__LIMITS__PRICE_IMPACT_BPS`。
- `defaults.limits.taxBps`: 允许的最大代币交易税，单位为基点。取值：0 到 10000 之间的数字。默认：`1000`。变量：`BINFERENCE_DEFAULTS__LIMITS__TAX_BPS`。
- `defaults.limits.liquidityFloorUsd`: 交易所需的最低交易池流动性，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"10000"`。变量：`BINFERENCE_DEFAULTS__LIMITS__LIQUIDITY_FLOOR_USD`。
- `defaults.limits.gasReserve.<chain>`: 每条链上为网络费预留的原生币。取值：写成文本的小数，例如 "0.002"。默认：`{"eip155:56":"0.002"}`。变量：`BINFERENCE_DEFAULTS__LIMITS__GAS_RESERVE__<CHAIN>`。名称：链 id，例如 eip155:56。
- `defaults.limits.venues`: 允许使用的平台。取值：列表，每一项为文本。默认：所有已安装的核心平台。变量：`BINFERENCE_DEFAULTS__LIMITS__VENUES`。
- `defaults.limits.allowTokens`: 允许的代币；留空则允许所有通过风险检查的代币。取值：列表，每一项为文本。默认：`[]`。变量：`BINFERENCE_DEFAULTS__LIMITS__ALLOW_TOKENS`。
- `defaults.limits.denyTokens`: 拒绝的代币。取值：列表，每一项为文本。默认：`[]`。变量：`BINFERENCE_DEFAULTS__LIMITS__DENY_TOKENS`。
- `defaults.sendLevel`: 转账级别，0 到 3。取值：0 到 3 之间的数字。默认：`0`。变量：`BINFERENCE_DEFAULTS__SEND_LEVEL`。
- `defaults.approvalMode`: 上限以内的交易是否等待点按确认。取值：以下之一："manual", "auto"。默认：`"manual"`。变量：`BINFERENCE_DEFAULTS__APPROVAL_MODE`。
- `defaults.ceiling.perTxBnb`: Privy 策略的单笔交易上限，单位为 BNB。取值：写成文本的小数，例如 "0.002"。默认：`"1"`。变量：`BINFERENCE_DEFAULTS__CEILING__PER_TX_BNB`。
- `defaults.cards.tradeExpirySec`: 交易卡片在这么多秒后过期。取值：不小于 1 的整数。默认：`60`。变量：`BINFERENCE_DEFAULTS__CARDS__TRADE_EXPIRY_SEC`。
- `defaults.cards.otherExpirySec`: 其他卡片在这么多秒后过期。取值：不小于 1 的整数。默认：`600`。变量：`BINFERENCE_DEFAULTS__CARDS__OTHER_EXPIRY_SEC`。
- `defaults.cards.requoteAfterSec`: 超过这么多秒的报价会重新获取。取值：不小于 1 的整数。默认：`10`。变量：`BINFERENCE_DEFAULTS__CARDS__REQUOTE_AFTER_SEC`。
- `defaults.cards.requoteToleranceBps`: 新报价差出这么多时再次询问，单位为基点。取值：0 到 10000 之间的数字。默认：`50`。变量：`BINFERENCE_DEFAULTS__CARDS__REQUOTE_TOLERANCE_BPS`。
- `defaults.orders.expiryDays`: 自动订单在这么多天后过期。取值：不小于 1 的整数。默认：`30`。变量：`BINFERENCE_DEFAULTS__ORDERS__EXPIRY_DAYS`。
- `defaults.copy.perBuyUsd`: 每笔跟单买入最多花费的金额，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"20"`。变量：`BINFERENCE_DEFAULTS__COPY__PER_BUY_USD`。
- `defaults.copy.perLeaderDayUsd`: 每天跟单同一个带单钱包最多花费的金额，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"200"`。变量：`BINFERENCE_DEFAULTS__COPY__PER_LEADER_DAY_USD`。
- `defaults.paper.balances.<symbol>`: 模拟模式的初始余额。取值：写成文本的小数，例如 "0.002"。默认：`{"BNB":"1","USDT":"500"}`。变量：`BINFERENCE_DEFAULTS__PAPER__BALANCES__<SYMBOL>`。名称：文本。
- `defaults.modelBudgetUsdPerDay`: 每天模型调用最多花费的金额，单位为美元。取值：写成文本的美元金额，例如 "100" 或 "0.25"，最多六位小数。默认：`"3"`。变量：`BINFERENCE_DEFAULTS__MODEL_BUDGET_USD_PER_DAY`。
- `defaults.notifications.muted`: 已静音的通知类型；安全通知不能静音。取值：列表，每一项为以下之一："fill", "skipped", "lowGas", "orderExpiring", "daily", "claimReady", "alertPrice", "alertWallet", "alertLaunch", "alertHeld", "ordersEnded", "exitEnded", "update", "updateBare", "updated", "updatedBare"。默认：`[]`。变量：`BINFERENCE_DEFAULTS__NOTIFICATIONS__MUTED`。
- `defaults.notifications.dailySummaryTime`: 按所有者时间发送每日摘要的时刻，格式为 HH:mm。取值：文本。默认：`"09:00"`。变量：`BINFERENCE_DEFAULTS__NOTIFICATIONS__DAILY_SUMMARY_TIME`。

## `chains`

链。

- `chains.enabled`: Agent 交易使用的链。取值：列表，每一项为链 id，例如 eip155:56。默认：`["eip155:56"]`。变量：`BINFERENCE_CHAINS__ENABLED`。
- `chains.rpc`: 每条链的 RPC。取值：对象。默认：`{}`。变量：`BINFERENCE_CHAINS__RPC`。名称：链 id，例如 eip155:56。
- `chains.rpc.<chain>.urls`: 追加或替换的 RPC。取值：列表，每一项为URL。默认：公共 RPC。变量：`BINFERENCE_CHAINS__RPC__<CHAIN>__URLS`。
- `chains.rpc.<chain>.key`: 付费 RPC 的 API 密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_CHAINS__RPC__<CHAIN>__KEY`。
- `chains.rpc.<chain>.tracer`: 你的 RPC 中能回答 debug_traceTransaction 的地址，例如付费节点。公共 RPC 丢弃旧区块后，binference 通过它查询一笔交易收到了什么。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_CHAINS__RPC__<CHAIN>__TRACER`。
- `chains.rpc.<chain>.ws`: 你的 RPC 中推送新区块的 wss:// 地址，例如付费节点。价格监控通过它跟进每个新区块，它断开时改为轮询 RPC。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_CHAINS__RPC__<CHAIN>__WS`。
- `chains.relays.<chain>`: 每条链用于发送交易的私密中继。取值：列表，每一项为文本。默认：实测最快的两个。变量：`BINFERENCE_CHAINS__RELAYS__<CHAIN>`。名称：链 id，例如 eip155:56。
- `chains.maxFeePerGasGwei.<chain>`: 每条链的网络费上限，单位为 gwei：每单位 gas 的手续费更高时询问所有者。取值：写成文本的小数，例如 "0.002"。默认：`{"eip155:56":"1"}`。变量：`BINFERENCE_CHAINS__MAX_FEE_PER_GAS_GWEI__<CHAIN>`。名称：链 id，例如 eip155:56。

## `venues`

路由平台。

- `venues.keys.okx.apiKey`: OKX 的 API 密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。必填。变量：`BINFERENCE_VENUES__KEYS__OKX__API_KEY`。
- `venues.keys.okx.secret`: OKX 的密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。必填。变量：`BINFERENCE_VENUES__KEYS__OKX__SECRET`。
- `venues.keys.okx.passphrase`: OKX 的密码短语。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。必填。变量：`BINFERENCE_VENUES__KEYS__OKX__PASSPHRASE`。
- `venues.keys.oneinch`: 启用 1inch 路由。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_VENUES__KEYS__ONEINCH`。
- `venues.keys.zerox`: 启用 0x 路由。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_VENUES__KEYS__ZEROX`。
- `venues.keys.relay`: Relay 的 API 密钥，随每个 Relay 请求发送。没有它时 Relay 的回答速率较低，且 Relay 跨链存款的状态只能读取到 2026-11-24 Relay 停用该读取为止。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_VENUES__KEYS__RELAY`。
- `venues.kyberClientId`: 发送给 KyberSwap 的客户端 ID。取值：文本。默认：`"binference"`。变量：`BINFERENCE_VENUES__KYBER_CLIENT_ID`。

## `risk`

风险数据。

- `risk.cacheTtlSec`: 风险检查的回答保留的时长，单位为秒。取值：不小于 1 的整数。默认：`600`。变量：`BINFERENCE_RISK__CACHE_TTL_SEC`。

## `search`

联网搜索。

- `search.provider`: search_web 背后的服务商。取值：以下之一："brave", "tavily"。默认：brave 和 tavily 中第一个设置了 API 密钥的。变量：`BINFERENCE_SEARCH__PROVIDER`。
- `search.keys.brave`: Brave Search 的 API 密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_SEARCH__KEYS__BRAVE`。
- `search.keys.tavily`: Tavily 的 API 密钥。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_SEARCH__KEYS__TAVILY`。
- `search.xApiKey`: 开启 search_x。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_SEARCH__X_API_KEY`。

## `remote`

远程访问。

- `remote.mini`: binference expose 是否已通过 Tailscale serve 发布 Mini App；这只是记录，修改它不会发布任何内容。取值：true 或 false。默认：`false`。变量：`BINFERENCE_REMOTE__MINI`。
- `remote.webhooks`: binference expose --webhooks 是否已通过 Tailscale funnel 发布 Webhook 路径；这只是记录，修改它不会发布任何内容。取值：true 或 false。默认：`false`。变量：`BINFERENCE_REMOTE__WEBHOOKS`。
- `remote.publicUrl`: 所有者自己的代理发布引擎端口的 HTTPS 地址：/console 在 Telegram 中打开它的 /mini，它的来源可以连接引擎的 socket、控制台和 Mini App 的图片上传，但不能配对；它不能提供其他任何内容。取值：不带路径的 HTTPS 地址，例如 `https://owner.example.ts.net`。默认：无。变量：`BINFERENCE_REMOTE__PUBLIC_URL`。

## `backups`

备份。

- `backups.daily`: 每天生成一份加密备份。取值：true 或 false。默认：`true`。变量：`BINFERENCE_BACKUPS__DAILY`。
- `backups.keepDaily`: 保留的每日备份数量。取值：不小于 1 的整数。默认：`7`。变量：`BINFERENCE_BACKUPS__KEEP_DAILY`。
- `backups.keepWeekly`: 保留的每周备份数量。取值：不小于 1 的整数。默认：`4`。变量：`BINFERENCE_BACKUPS__KEEP_WEEKLY`。
- `backups.copyTo`: 再存一份副本的文件夹。取值：绝对路径，或以 ~/ 开头的路径。默认：无。变量：`BINFERENCE_BACKUPS__COPY_TO`。

## `updates`

更新。

- `updates.check`: 每天检查一次是否有新版本。取值：true 或 false。默认：`true`。变量：`BINFERENCE_UPDATES__CHECK`。
- `updates.channel`: 发布渠道。取值：以下之一："stable", "beta"。默认：`"stable"`。变量：`BINFERENCE_UPDATES__CHANNEL`。

## `telemetry`

使用统计。

- `telemetry.enabled`: 在每日更新检查中附上自愿提供的使用次数统计。取值：true 或 false。默认：`false`。变量：`BINFERENCE_TELEMETRY__ENABLED`。

## `network`

对外网络。

- `network.proxy`: 所有者的代理，写成 http:// 或 https:// URL，含用户名和密码：除发往本机、非互联网地址和 noProxy 的请求外，每个对外请求都通过它以隧道方式发出。取值：密钥来源：{ fromKeychain: "name" }、{ fromEnv: "NAME" }、{ fromFile: "path" } 或 { fromCommand: ["program", "argument"] }。默认：无。变量：`BINFERENCE_NETWORK__PROXY`。
- `network.noProxy`: 不经代理访问的主机，最多 256 个：* 表示所有主机；也可以是 punycode 写法的域名（同时包含其下的子域名）、IP 地址或 [IPv6]，均可带 :端口；或地址段，例如 10.0.0.0/8。取值：列表，每一项为文本。默认：`["127.0.0.1","localhost"]`。变量：`BINFERENCE_NETWORK__NO_PROXY`。

## `chats`

对话。

- `chats.keepDays`: 对话保留的天数，或永久保留。取值：不小于 1 的整数或"forever"。默认：`90`。变量：`BINFERENCE_CHATS__KEEP_DAYS`。
- `chats.newMessageMode`: 一轮进行中收到的消息是并入这一轮，还是等这一轮结束。取值：以下之一："merge", "after"。默认：`"merge"`。变量：`BINFERENCE_CHATS__NEW_MESSAGE_MODE`。

## `logging`

日志。

- `logging.level`: 日志级别。取值：以下之一："error", "warn", "info", "debug"。默认：`"info"`。变量：`BINFERENCE_LOGGING__LEVEL`。
- `logging.keepDays`: 日志文件保留的天数。取值：不小于 1 的整数。默认：`14`。变量：`BINFERENCE_LOGGING__KEEP_DAYS`。
- `logging.maxFileMb`: 日志文件达到这么多 MB 时轮换。取值：不小于 1 的整数。默认：`20`。变量：`BINFERENCE_LOGGING__MAX_FILE_MB`。

## `cex`

中心化交易所。

- `cex.binance.enabled`: 开启 Binance Agent OS 插件。取值：true 或 false。默认：`false`。变量：`BINFERENCE_CEX__BINANCE__ENABLED`。

## `plugins`

每个插件的设置，按插件 ID 列出。

- `plugins`: 每个插件的设置，按插件 ID 列出。取值：对象。默认：`{}`。变量：`BINFERENCE_PLUGINS`。名称：文本。
- `plugins.<plugin>.<setting>`: 某个插件的设置，按该插件自己的格式读取。取值：任意 JSON 值。默认：无。变量：`BINFERENCE_PLUGINS__<PLUGIN>__<SETTING>`。名称：文本。
