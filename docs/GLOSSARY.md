# Glossary

This page names every part of binference and gives each English term its Chinese. Every name in
code, files, commands, config, the protocol, tools, docs and the UI comes from here. Never borrow a
file name, command, config key, protocol name, tool name or term from another agent framework; add a
new name here first, in the change that uses it.

## Names

### Processes and surfaces

- **engine**: the long-running process that owns the money path, the Telegram bot, the protocol,
  auto orders and the store. It runs no model.
- **agent runtime**: the separate process that runs the model loop, sessions, context, skills and
  notes. It can only read and propose.
- **signer**: the child process that holds the agent key and checks the hard rules before every
  signature.
- **console**: the open-source web interface the engine serves on localhost.
- **Mini App**: the console opened inside Telegram with `/console`.
- **terminal chat**: chat in the terminal (`binference chat`), from the `tui` package.
- **MCP server**: `binference mcp`, which gives any MCP client the read and propose tools.
- **surfaces**: the places the owner reads cards and acts: Telegram, the console, the Mini App and
  the CLI.
- **composition root**: the one place, `cli/src/compose/`, that builds adapters and wires them in.

### Money and safety

- **intent**: one action the owner may confirm, such as a swap, a send, a rescue or an order fill.
  One module moves it through its states.
- **card**: the message that shows an intent's terms on every surface, drawn from the stored intent.
- **card version**: the card's terms at one moment. A worse re-quote opens a new version, and a tap
  on an old one fails.
- **confirmation**: the owner's recorded yes to one card version.
- **receipt**: the card after it settles, edited to show the outcome.
- **card copy**: one message that shows a card version on a surface, such as the card in the
  owner's Telegram chat. The first answer turns every copy into the receipt.
- **callback reference**: the random 12 bytes a card version's buttons carry in place of any id,
  so a press names a card no one could guess.
- **auto order**: a limit, take-profit, stop-loss, trailing, DCA or copy-trade order, confirmed
  once. Each fill runs inside its bounds without a card.
- **fill**: one execution of an auto order or a webhook rule.
- **watcher**: code that reads blocks, prices, leader wallets or launches and triggers fills. No
  model runs in it.
- **alert**: a price or wallet condition that notifies and sends no transaction.
- **webhook rule**: a rule confirmed once that lets an inbound webhook fill inside its bounds.
- **schedule**: a model turn that runs at set times. It moves no money.
- **paper mode**: real quotes, checks and cards, with fills recorded at the confirmed quote and
  nothing sent on chain. New agents start in it; **live** is the opposite.
- **paper fill**: the fill paper mode records when a paper intent is confirmed: the confirmed
  quote's input for its expected output, kept with the move to `paper_filled` and its ledger entry.
- **paper portfolio**: an agent's paper money, held as its wallets' paper positions with their own
  P&L. A **paper reset** starts it again from the starting balances, 1 BNB and 500 USDT by default.
- **live switch**: `agent/goLive`, the one step that moves an agent from paper to live. The **first
  live card** after it says that the trade uses real money.
- **approval mode**: per agent, **manual** (every transaction outside an auto order needs a tap; the
  default) or **auto** (buys, sells, swaps and moves inside the agent's own positions run within the
  caps without a tap).
- **limits**: the per-agent caps and lists the engine checks under the ceiling.
- **ceiling**: each wallet's Privy policy, the hard limit behind the limits. Only the owner key
  raises it.
- **gas reserve**: the BNB a wallet keeps for network fees. Trades never spend it.
- **wallet facts**: what the money path reads about an agent's wallets outside the store ports:
  which wallets the agent owns, the native balance (the paper balance in paper mode), the ceiling's
  cap per transaction, the fee per gas, the network fee cap and the agent's recent outflows.
- **network fee cap**: per chain, the most fee per gas a transaction pays without the owner's tap
  (`chains.maxFeePerGasGwei`). A higher fee opens a card.
- **owner key**: the key that owns the wallets and their policy. It is shown once as a `bnok1` code
  and kept offline.
- **agent key**: the key the signer holds on one machine. It can ask for signatures inside the
  ceiling only.
- **rescue address**: the owner's own wallet, where a rescue sends everything. Changing it takes 24
  hours.
- **saved address**: an address saved in the ceiling with the owner key. Sends go only to saved
  addresses and the rescue address.
- **address book**: the agent's saved addresses with their labels.
- **send level**: from 0 (Open) to 3 (Locked), where sends may go among the saved addresses.
- **freeze**: stops an agent or the whole install at once. Unfreezing needs the CLI, the console or
  the Mini App.
- **rescue**: one intent that moves every token and the BNB of every agent wallet to the rescue
  address, even while frozen.
- **braking** and **loosening**: a change that makes the agent safer works at once; one that makes
  it less safe needs the CLI, the console or the Mini App.
- **hard rules**: the checks the signer runs itself before it signs.
- **wallet queue**: the queue per wallet, one transaction at a time, that owns the nonce, signs and
  sends.
- **lowest free nonce**: the rule the wallet queue gives nonces by: the lowest nonce the chain has
  not used that no signed or sent transaction of the wallet holds. A nonce never signed, or freed by
  a dropped transaction, goes to the next step, so no gap is left.
- **slot**: one work's turn on a wallet queue, the only way to take a nonce and store a signed
  transaction. It closes when the work ends.
- **executor**: the execute step for live intents: it takes each confirmed live intent onto its
  wallet's queue. A paper intent never reaches it.
- **ledger**: the append-only, hash-chained record of every intent, tap, signature and fill.
- **execution**: one trade as it settled on chain or filled on paper: what the wallet sold and
  bought, the fee and the gas, each valued in USD at the time. Positions are built from executions
  and arrivals, the CSV export from executions.
- **arrival**: funds that reach a wallet without a trade, such as a deposit or the paper starting
  balance, valued in USD when they arrive. It opens a position at that value.
- **position**: what one wallet holds of one asset at average cost: the quantity, its cost with
  fees and gas, and the realized profit or loss. Paper and live keep separate positions.
- **venue**: a protocol the agent trades, lends or stakes on, such as PancakeSwap or Venus.
- **venue host**: the engine part that runs venue code. It sets each trade's terms, and checks
  every transaction a venue builds against them before anything is signed.
- **transaction draft**: a transaction a venue built, before the wallet queue gives it its nonce
  and fees.
- **registry**: the verified contract addresses in `@binference/chains`.

### Chat and the agent

- **turn**: one run of the model loop, from the owner's message to the agent's answer.
- **committed turn**: a turn in which a propose tool ran. No retry and no model fallback follow.
- **outside-content mark**: the mark on a turn that read the web, X, a Telegram group or token data.
  Its cards carry a warning.
- **queues**: the wallet queue and the chat queue, one per session. A message that arrives during a
  turn is merged at the next tool boundary (**merge**, the default) or waits for the turn to end
  (**after**).
- **session**: one conversation between the owner and an agent, with an id `ses_…`.
- **workspace files**: each agent's `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md`
  and `FIRST-CHAT.md`.
- **notes**: the agent's long-term memory, each item labelled by its origin.
- **skills**: `SKILL.md` playbooks in the Agent Skills format, read when a task matches.
- **read, propose and control tools**: tools that read data, tools that create an intent and a card,
  and tools that cancel or schedule.
- **vision model**: `models.vision`, which reads images when the main model cannot.
- **model budget**: the daily dollar budget for an agent's model calls.

### Setup and operations

- **self-hosted**: the profile where the owner runs binference on their own machine with their own
  keys.
- **bInference Cloud**: the hosted profile on binference.io, on the same packages.
- **profile**: self-hosted or Cloud. Only the composition root knows which.
- **profile parts**: the parts whose adapter depends on the profile: custody (the `Signer` port),
  the bot's updates, model billing, secrets, the store and market data. Each is a port.
- **update source**: where the engine reads a bot's inbound updates, by long polling or through a
  webhook relay. The engine stores each update in the inbox before it acknowledges it.
- **model billing**: what pays for an agent's model calls and says what the agent may still spend:
  the model budget, or bInference AI credit.
- **market data**: the blocks and prices the watchers stream.
- **plugin**: an installable integration of one kind: venue, data, surface, skills or provider.
- **surface plugin**: a plugin that adds a chat surface.
- **plugin tiers**: **Core** (bundled and reviewed), **Verified** (a reviewed, signed publisher) and
  **Community** (anyone; read-only, in a sandbox).
- **permission review**: the consent step when a plugin is added or an update widens what it
  declares.
- **secret sources**: how config names a secret without its value: `{ fromKeychain }`,
  `{ fromEnv }`, `{ fromFile }` and `{ fromCommand }`.
- **config migration**: what `binference check --fix` runs to move older config or data to the
  current shape.
- **engine lock**: the file lock that allows one engine per state folder.
- **store worker**: a worker thread that holds one connection to `engine.sqlite` or
  `agent.sqlite`: the database's one **writer**, or one of its **readers**.
- **store task**: a named, synchronous unit of database work that a store worker runs; a write task
  runs in one transaction.
- **store ports**: the engine's ports for the state it keeps: intents with their cards and
  confirmations, the ledger, the inbox, idempotency keys, access, agents and the config journal.
  `store` holds their SQLite adapters; each port has one contract suite and an in-memory fake.
- **stored intents**: the engine's one writer of intents. It stores each new intent and every move
  the state machine decides through the intent store, pushes each write as it lands, and is the
  confirmation store the confirmations answer through.
- **start code**: the single-use code in the `t.me/<bot>?start=<code>` link `binference init`
  prints; only its SHA-256 is stored. The first person who opens the link becomes the **owner
  binding**: the owner's numeric Telegram id, the only Telegram user binference obeys.
- **update intake**: where Telegram updates come in. Long polling and a webhook relay both feed
  it, and Telegram learns an update arrived only after the intake has stored it, cut to its ids
  when a text in it looks like a secret.
- **poll worker**: the worker thread that calls `getUpdates` for the engine; a **poller lease**
  keeps one poller per bot token in a process.
- **throttler**: one per bot token; it paces the bot's Bot API calls by Telegram's limits and owns
  every wait Telegram asks for with a 429.
- **state folder**: `~/.binference`, moved by `BINFERENCE_HOME`.
- **unlock mode**: where the agent key and the Privy app secret are read at start: `keychain`,
  `file`, `command` or `manual`.
- **passphrase store**: secrets in owner-only files in `~/.binference/keys/`, each sealed with the
  owner's passphrase; the fallback where no OS keychain answers, such as headless Linux and Docker.
- **background service**: the engine started at the owner's login and restarted after a crash: a
  LaunchAgent on macOS, a `systemctl --user` unit on Linux, a scheduled task on Windows.
- **scopes**: what a protocol client may do: `read`, `propose`, `chat`, `agent`, `confirm`, `loosen`
  and `admin`.
- **operation**: a protocol call named `domain/action`, such as `intent/propose`.
- **frames**: the protocol's messages: `open`, `challenge`, `prove`, `ready`, `call`, `reply`,
  `fail`, `push` and `bye`.
- **push topic**: a stream of pushes, such as `intent` or `chat:<agent id>`, numbered by its own
  `seq`. A client that sees a gap in `seq` refetches the topic's state once.
- **operation table**: every operation with its args and result schemas and whether it writes; the
  typed client is built over it.
- **operation handlers**: the functions, one per operation, that the engine and the agent runtime
  give the protocol server. The server checks each call's scopes, transport and idempotency key, then
  routes it to its handler.
- **Binance Agent**: an agent the owner runs on Binance Agent OS and connects to binference.
- **decision record**: a file in `docs/adr/` that records one decision (ADR).
- **fork suite**: the tests in each package's `src/fork/`, run by `pnpm test:fork` and nightly in
  CI against an anvil fork of BSC at a block pinned 20 behind the head. Its **test account** is
  anvil's first default account with its EIP-7702 code cleared; its **logs node** is a loopback
  endpoint that reads history from a public node serving `eth_getLogs`.

### Files, commands and tools

- **files**: `config.json5` (the config), `engine.sqlite` and `agent.sqlite` (the databases),
  `NOTICES.md` (third-party notices).
- **commands**: `binference init`, `start`, `check`, `check --fix`, `check security`, `report`,
  `console`, `chat`, `mcp`, `live`, `freeze`, `rescue`, `unlock`, `expose`.
- **chat commands**: `/spend` (model spend), `/ai` (models), `/clear` (new session), `/freeze`,
  `/rescue`, `/console`, and `/confirm` as the text fallback for a button.
- **agent tools**: `ask_owner`, `open_skill`, `search_web`, `read_page`, `search_x`, `notes_search`,
  `notes_write`.
- **MCP tools**: the MCP server's read and propose tools, one per operation and named
  `binference_`, such as `binference_propose` for `intent/propose`.
- **coding-agent skills**: `clean-diff`, `review-diff`, `shape-commit`, `review-money-path`,
  `add-migration`, `write-adr`.

## Chinese terms

Every Chinese message uses these terms. A term missing here is added first, in the change that needs
it. Write Chinese the way Binance's own Chinese docs do:

- Address the reader as 你, never 您.
- Put a half-width space between Chinese and Latin letters, digits, `$` and `{arguments}`:
  `连接 BNB Chain`, `7 天`.
- Use full-width punctuation inside Chinese sentences (`，。：；！？（）“”`) and no dashes of any
  kind.
- Write numbers and money exactly as in English: `$1.20`, `0.005 BNB`, `1.2M`.
- Keep product, chain, protocol and token names in English: binference, bInference, Binance, Binance
  Agent OS, BNB Chain, BSC, PancakeSwap, Flap, MCP, BNB, USDT. Code, field names, error codes and
  commands stay as they are.

### The agent and chat

| English                                 | 中文                    | Notes                       |
| --------------------------------------- | ----------------------- | --------------------------- |
| agent, AI agent                         | Agent, AI Agent         | "your agent" = 你的 Agent   |
| agent key                               | Agent 密钥              |                             |
| Binance agent (one on Binance Agent OS) | Binance Agent           |                             |
| engine                                  | 引擎                    |                             |
| console                                 | 控制台                  |                             |
| CLI                                     | 命令行                  |                             |
| Mini App                                | Mini App                | Stays English               |
| skill (Agent Skills)                    | 技能                    |                             |
| plugin                                  | 插件                    |                             |
| model                                   | 模型                    |                             |
| model budget                            | 模型预算                |                             |
| fallback model                          | 备用模型                |                             |
| prompt                                  | 提示词                  |                             |
| answer, response                        | 回答                    |                             |
| answer (to a card)                      | 回复                    |                             |
| request                                 | 请求                    |                             |
| streaming                               | 流式输出                |                             |
| context, context window                 | 上下文, 上下文窗口      |                             |
| summarize, summary                      | 总结, 摘要              |                             |
| input, output (tokens)                  | 输入, 输出              |                             |
| token (of a model)                      | Token                   | Never 代币 for model tokens |
| reasoning                               | 推理                    |                             |
| provider (of a model)                   | 服务商                  |                             |
| usage                                   | 用量                    |                             |
| session, turn                           | 会话, 轮                |                             |
| chat (with your agent)                  | 对话                    |                             |
| notes                                   | 笔记                    |                             |
| scheduled turn, wake                    | 定时轮, 唤醒            |                             |
| tool calling, function calling          | 工具调用, 函数调用      |                             |
| web search, web fetch                   | 联网搜索, 网页抓取      |                             |
| research                                | 调研                    |                             |
| market intelligence                     | 市场情报                |                             |
| outside content                         | 外部内容                |                             |
| gateway                                 | 网关                    |                             |
| MCP server                              | MCP 服务器              |                             |
| picture (one the owner sends)           | 图片                    |                             |
| notification                            | 通知                    |                             |
| console device                          | 控制台设备              |                             |
| pairing code, confirmation code         | 验证码, 确认码          |                             |
| facts, not advice                       | 只陈述事实，不构成建议  |                             |
| docs                                    | 文档                    |                             |
| Binance Square                          | 币安广场                | Binance's own Chinese name  |
| timeline                                | 时间线                  |                             |
| track record                            | 业绩记录                |                             |
| checked on chain (a trade)              | 已核验                  |                             |
| brakes (pause, resume, stop)            | 刹车 (暂停, 恢复, 停止) |                             |
| approve (an agent, an order, a rule)    | 批准                    | Token approvals are 授权    |

### Trading

| English                                            | 中文                         | Notes                                   |
| -------------------------------------------------- | ---------------------------- | --------------------------------------- |
| token (crypto)                                     | 代币                         |                                         |
| ticker                                             | 代币符号                     |                                         |
| buy, sell, trade                                   | 买入, 卖出, 交易             |                                         |
| swap                                               | 兑换                         |                                         |
| price, market cap, liquidity                       | 价格, 市值, 流动性           |                                         |
| slippage, price impact                             | 滑点, 价格影响               |                                         |
| slippage limit                                     | 滑点上限                     |                                         |
| route, minimum received                            | 路由, 至少收到               |                                         |
| quote (a price quote)                              | 报价                         |                                         |
| tax (a token's tax)                                | 交易税                       | tax rate = 税率                         |
| network fee, gas                                   | 网络费                       | "Gas" only where the English says gas   |
| fee (a trading fee)                                | 手续费                       |                                         |
| fees (a card's line of costs)                      | 费用                         |                                         |
| launch (a token), launchpad                        | 发射, 发射台                 |                                         |
| opening buy                                        | 首笔买入                     |                                         |
| paired with (a quote token)                        | 与 X 配对交易                |                                         |
| bonding curve                                      | 联合曲线                     |                                         |
| graduate, graduation                               | 毕业                         | A token moving from its curve to a pool |
| pool (a DEX trading pool)                          | 交易池                       |                                         |
| holder, holders (count)                            | 持有者, 持有人数             |                                         |
| supply (of a token)                                | 供应量                       |                                         |
| honeypot (a token you cannot sell)                 | 貔貅盘                       |                                         |
| catch a new launch (buy early)                     | 抢先买入                     |                                         |
| smart money                                        | 聪明钱                       |                                         |
| front-running bot                                  | 抢跑机器人                   |                                         |
| bot                                                | 机器人                       |                                         |
| portfolio                                          | 投资组合                     |                                         |
| position, closed (sold out)                        | 持仓, 已清仓                 |                                         |
| average cost, value                                | 平均成本, 市值               |                                         |
| profit and loss (PnL), realized, unrealized        | 盈亏, 已实现盈亏, 未实现盈亏 |                                         |
| volume (traded)                                    | 交易额                       |                                         |
| win rate (tokens in profit)                        | 盈利占比                     |                                         |
| limit order, take-profit, stop-loss, trailing stop | 限价单, 止盈, 止损, 追踪止损 |                                         |
| DCA                                                | 定投                         |                                         |
| copy trade                                         | 跟单                         |                                         |
| auto order                                         | 自动订单                     |                                         |
| auto trade                                         | 自动交易                     |                                         |
| trigger price                                      | 触发价格                     |                                         |
| filled, cancelled                                  | 已成交, 已取消               |                                         |
| open orders, order history                         | 挂单, 订单记录               |                                         |
| stake, unstake, claim                              | 质押, 解除质押, 领取         |                                         |
| supply, withdraw, borrow, repay (lending)          | 存入, 取出, 借款, 还款       |                                         |
| health factor                                      | 健康因子                     |                                         |
| bridge (verb)                                      | 跨链                         |                                         |
| private send                                       | 私密发送                     |                                         |
| private execution                                  | 私密执行                     |                                         |
| chain access                                       | 链上访问                     |                                         |
| block, nonce                                       | 区块, 随机数                 |                                         |
| finality, final                                    | 最终确认                     |                                         |
| transaction (on chain)                             | 交易, 链上交易               | 链上交易 where "trade" could be meant   |
| a transaction lands                                | 上链                         |                                         |
| revert (a transaction fails on chain)              | 回滚                         |                                         |
| transaction hash                                   | 交易哈希                     |                                         |
| explorer (block explorer)                          | 区块浏览器                   |                                         |
| network (chain)                                    | 网络                         |                                         |
| contract address                                   | 合约地址                     |                                         |
| alerts, alert rule                                 | 提醒, 提醒规则               |                                         |
| venue (where the agent trades, lends or stakes)    | 平台                         | PancakeSwap, Venus                      |

### Wallets and safety

| English                                  | 中文                   | Notes                            |
| ---------------------------------------- | ---------------------- | -------------------------------- |
| agent wallet                             | Agent 钱包             |                                  |
| owner key                                | 所有者密钥             | Shown once as a `bnok1` code     |
| balance                                  | 余额                   |                                  |
| withdraw, fund (a wallet)                | 提取, 充值             | Lending's withdraw is 取出       |
| top up                                   | 充值                   |                                  |
| send (to an address)                     | 转账                   |                                  |
| transfer (between your own accounts)     | 划转                   |                                  |
| recipient address                        | 收款地址               |                                  |
| private key                              | 私钥                   | API keys stay 密钥               |
| recovery phrase                          | 助记词                 |                                  |
| API key, key                             | API 密钥, 密钥         |                                  |
| export (a private key)                   | 导出                   |                                  |
| signature, sign                          | 签名                   |                                  |
| approve (a token allowance), approval    | 授权                   |                                  |
| permit (a signed approval)               | 签名授权               |                                  |
| revoke                                   | 撤销                   |                                  |
| connect wallet                           | 连接钱包               |                                  |
| sign in, sign out                        | 登录, 退出登录         |                                  |
| paper mode, live                         | 模拟模式, 实盘         |                                  |
| approval mode, manual, auto              | 批准模式, 手动, 自动   |                                  |
| ceiling (the wallet policy's hard limit) | 上限                   |                                  |
| per-trade cap, 24-hour cap               | 单笔上限, 24 小时上限  |                                  |
| per-trade limit, daily limit             | 单笔上限, 每日上限     |                                  |
| trade limits                             | 交易限额               |                                  |
| spending limit                           | 消费上限               |                                  |
| gas reserve                              | 网络费预留             |                                  |
| network fee cap                          | 网络费上限             |                                  |
| freeze, unfreeze                         | 冻结, 解除冻结         |                                  |
| rescue, rescue address                   | 紧急转出, 紧急转出地址 |                                  |
| send level                               | 转账级别               |                                  |
| address book                             | 地址簿                 |                                  |
| safety check                             | 安全检查               |                                  |
| verified (a token)                       | 已验证                 |                                  |
| take back access, give access back       | 收回权限, 恢复权限     | The agent's access to its wallet |
| expire, expires, expiry                  | 过期, 到期             |                                  |
| backup                                   | 备份                   |                                  |
| locked                                   | 锁定                   |                                  |
| plaintext secret                         | 明文密钥               |                                  |
