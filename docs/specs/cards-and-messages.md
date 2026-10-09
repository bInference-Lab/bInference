# Spec 4: cards and messages

Status: accepted on 2026-10-06 ([decision 0096](../DECISIONS.md#d0096)), amended by decisions
[0101](../DECISIONS.md#d0101), [0102](../DECISIONS.md#d0102) and [0103](../DECISIONS.md#d0103).

Every string here lives in `packages/i18n/messages/{en,zh}/<area>.json` as an ICU message; this spec
names the keys and fixes the wording.

<a id="section-1"></a>

## 1. Rules for every message

- **Drawn from data, never from model text.** Cards and receipts use the intent's stored fields
  ([rule 3](../ARCHITECTURE.md#rule-3)). Model words appear in one place only: the "Agent says"
  line, escaped and cut to 200 characters.
- **Escaping token-controlled text.** Token names and symbols are set by whoever deployed the token.
  Before display:
  - control characters, bidi overrides (U+202A to U+202E, U+2066 to U+2069) and zero-width
    characters (U+200B to U+200D, U+2060, U+FEFF) become `\u{…}`;
  - a symbol over 16 characters or a name over 40 is cut with `…`;
  - mixed scripts or look-alike characters (for example a Cyrillic "а" in a Latin symbol) add a
    warning: "Unusual characters in this token's name" / 「此代币名称含有不常见字符」;
  - an unverified token's symbol is always followed by its short address: `PEPE (0x6982…1933)`.
- **Numbers** use the one formatter ([ENGINEERING.md section 24.4](../ENGINEERING.md#section-24-4)):
  token amounts to 6 significant digits, USD with 2 decimals, percentages with 2 decimals, `<$0.01`
  below a cent.
- **Telegram** messages use HTML formatting, at most 4,096 characters; a longer message splits at a
  line break (`telegram/src/split/`). Buttons are inline keyboards.
- **Status icons** are allowed only where this spec names them
  ([ENGINEERING.md section 16](../ENGINEERING.md#section-16)): 🟡 waiting, ✅ done or passed, ❌
  refused or failed, ⚠️ warning, 🧪 paper, 🔴 live.
- **Times** are shown in the owner's timezone, `HH:mm:ss` for expiries.

<a id="section-2"></a>

## 2. Buttons and callback data

| Button       | English      | 中文       |
| ------------ | ------------ | ---------- |
| Confirm      | ✅ Confirm   | ✅ 确认    |
| Cancel       | ❌ Cancel    | ❌ 取消    |
| Details      | Details      | 详情       |
| Open console | Open console | 打开控制台 |

- Callback data: `bnf1:<kind>:<decision>:<ref>`, at most 64 bytes. `kind` is `c` (card); `decision`
  is `y` (confirm), `n` (cancel) or `d` (details); `ref` is a random 12-byte base64url reference
  stored with the card version, never an id the presser could guess.
- The engine checks that the presser is the owner's numeric Telegram id, writes the decision
  durably, then answers `answerCallbackQuery`.
- First answer wins: the other surfaces' buttons are removed, and every copy becomes the receipt.

<a id="section-3"></a>

## 3. The card

<a id="section-3-1"></a>

### 3.1 Shape

Every card has these lines, in order; a line without data is left out.

| Line       | Key                  | Content                                                         |
| ---------- | -------------------- | --------------------------------------------------------------- |
| Header     | `card.header`        | Status icon, the action, the agent's name, 🧪 Paper or 🔴 Live  |
| Action     | `card.<kind>.action` | The kind's main line (section 3.3)                              |
| Route      | `card.route`         | Venues with their shares, price impact, maximum slippage        |
| Fees       | `card.fees`          | Network fee in USD, and "private send"                          |
| Check      | `card.check`         | Simulation result and token verdict                             |
| Warnings   | `card.warn.*`        | Outside content, unusual characters, new address, risk warnings |
| Agent says | `card.reason`        | The agent's reason, escaped                                     |
| Expiry     | `card.expiry`        | "Expires at 14:32:05"                                           |

<a id="section-3-2"></a>

### 3.2 The swap card, in full

English:

```text
🟡 Confirm swap · main · 🔴 Live
Sell 0.5 BNB → at least 312.4 USDT
Route  KyberSwap: PancakeSwap v3 92%, Infinity 8% · impact 0.08% · max slippage 0.50%
Fees   network <$0.01 · private send
Check  ✅ simulation: you receive 313.95 USDT · ✅ USDT verified
Agent says  "Taking profit as you asked at $625"
Expires at 14:32:05
[ ✅ Confirm ]  [ ❌ Cancel ]  [ Details ]
```

中文:

```text
🟡 确认兑换 · main · 🔴 实盘
卖出 0.5 BNB → 至少收到 312.4 USDT
路由  KyberSwap：PancakeSwap v3 92%，Infinity 8% · 价格影响 0.08% · 滑点上限 0.50%
费用  网络费 <$0.01 · 私密发送
检查  ✅ 模拟：你将收到 313.95 USDT · ✅ USDT 已验证
Agent 说明  “按你的要求在 $625 止盈”
过期时间 14:32:05
[ ✅ 确认 ]  [ ❌ 取消 ]  [ 详情 ]
```

<a id="section-3-3"></a>

### 3.3 Action lines by kind

| Kind               | Key                       | English                                                                                              | 中文                                                                                    |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `swap`             | `card.swap.action`        | Sell {in} → at least {minOut}                                                                        | 卖出 {in} → 至少收到 {minOut}                                                           |
| `buy`              | `card.buy.action`         | Buy {token} with {spend} · on {place}                                                                | 用 {spend} 买入 {token} · 在 {place}                                                    |
| `sell`             | `card.sell.action`        | Sell {amount} → at least {minOut} · on {place}                                                       | 卖出 {amount} → 至少收到 {minOut} · 在 {place}                                          |
| `send`             | `card.send.action`        | Send {amount} to {recipient}                                                                         | 向 {recipient} 转账 {amount}                                                            |
| `revokeApproval`   | `card.revoke.action`      | Remove {spender}'s approval for {token}                                                              | 撤销 {spender} 对 {token} 的授权                                                        |
| `lend` supply      | `card.lend.supply`        | Supply {amount} to {venue} · health factor {hf}                                                      | 向 {venue} 存入 {amount} · 健康因子 {hf}                                                |
| `lend` withdraw    | `card.lend.withdraw`      | Withdraw {amount} from {venue} · health factor {hf}                                                  | 从 {venue} 取出 {amount} · 健康因子 {hf}                                                |
| `lend` borrow      | `card.lend.borrow`        | Borrow {amount} from {venue} · health factor {hf}                                                    | 从 {venue} 借款 {amount} · 健康因子 {hf}                                                |
| `lend` repay       | `card.lend.repay`         | Repay {amount} to {venue} · health factor {hf}                                                       | 向 {venue} 还款 {amount} · 健康因子 {hf}                                                |
| `stake` stake      | `card.stake.stake`        | Stake {amount} with {validator}                                                                      | 向 {validator} 质押 {amount}                                                            |
| `stake` unstake    | `card.stake.unstake`      | Unstake {amount} from {validator} · ready in {days} days                                             | 从 {validator} 解除质押 {amount} · {days} 天后可领取                                    |
| `stake` claim      | `card.stake.claim`        | Claim {amount} from {validator}                                                                      | 从 {validator} 领取 {amount}                                                            |
| `bridge`           | `card.bridge.action`      | Bridge {amount} to {chain} · to {recipient} · about {minutes} min                                    | 跨链 {amount} 到 {chain} · 收款地址 {recipient} · 约 {minutes} 分钟                     |
| `cexOrder`         | `card.cex.action`         | Binance {side} {size} {market} at {price}                                                            | Binance {side} {size} {market}，价格 {price}                                            |
| `registerIdentity` | `card.identity.action`    | Register {agent} on chain (ERC-8004)                                                                 | 在链上登记 {agent}（ERC-8004）                                                          |
| `launchToken`      | `card.launch.action`      | Launch {symbol} ({name}) on {venue}, paired with {pair} · first buy {firstBuy}                       | 在 {venue} 发射 {symbol}（{name}），与 {pair} 配对交易 · 首笔买入 {firstBuy}            |
| rescue             | `card.rescue.action`      | Move everything to your rescue address {address}: {count} tokens from {wallets} wallets, about {usd} | 将全部资产转到你的紧急转出地址 {address}：{wallets} 个钱包中的 {count} 种代币，约 {usd} |
| auto order         | `card.order.action`       | Approve {orderKind}: {summary} · up to {maxFills} fills until {expiry}                               | 批准{orderKind}：{summary} · 最多成交 {maxFills} 次，截至 {expiry}                      |
| webhook rule       | `card.webhookRule.action` | Approve alert rule "{name}": {summary} · at most {rate} a minute                                     | 批准提醒规则“{name}”：{summary} · 每分钟最多 {rate} 次                                  |

`{place}` is "the Flap curve" / 「Flap 联合曲线」, "the four.meme curve" / 「four.meme 联合曲线」,
"the Genius.fun curve" / 「Genius.fun 联合曲线」, or the venue's name for a pool.

<a id="section-3-4"></a>

### 3.4 Warning lines

| Key                        | English                                                            | 中文                                                  |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `card.warn.outsideContent` | ⚠️ This came after reading outside content (web, X or token data)  | ⚠️ 此请求发生在读取外部内容（网页、X 或代币信息）之后 |
| `card.warn.newAddress`     | ⚠️ You have never sent to this address                             | ⚠️ 你从未向此地址转账                                 |
| `card.warn.unusualName`    | ⚠️ Unusual characters in this token's name                         | ⚠️ 此代币名称含有不常见字符                           |
| `card.warn.unverified`     | ⚠️ Not a verified token: risk checks passed, but check the address | ⚠️ 非已验证代币：风险检查已通过，但请核对地址         |
| `card.warn.highTax`        | ⚠️ This token takes {tax} tax on every trade                       | ⚠️ 此代币每笔交易收取 {tax} 交易税                    |
| `card.warn.requoted`       | ⚠️ The price moved: this is a new quote                            | ⚠️ 价格已变动：这是新的报价                           |
| `card.warn.paper`          | 🧪 Paper mode: nothing is sent on chain                            | 🧪 模拟模式：不会发送链上交易                         |
| `card.warn.autoAsks`       | Auto mode asks you here: {why}                                     | 自动模式在此需要你确认：{why}                         |

`{why}` ([decision 0088](../DECISIONS.md#d0088)) is one of `autoAsks.overCap` "over your auto caps"
/ 「超出自动交易限额」, `autoAsks.send` "sends always ask" / 「转账总是需要确认」,
`autoAsks.outside` "the idea came from outside content" / 「该想法来自外部内容」, `autoAsks.mcp`
"proposed from {client}" / 「由 {client} 提出」, `autoAsks.kind` "this kind always asks"
/ 「此类操作总是需要确认」, `autoAsks.spender` "it approves a contract that is not verified"
/ 「需要向未验证的合约授权」, `autoAsks.deniedToken` "it sells a token on your deny list"
/ 「卖出的是你禁止列表中的代币」 ([decision 0101](../DECISIONS.md#d0101)), `autoAsks.overFeeCap`
"the network fee is above your cap" / 「网络费高于你设定的上限」
([decision 0102](../DECISIONS.md#d0102)), `autoAsks.locked` "binference is locked; run
`binference unlock` on the machine" / 「binference 已锁定；请在本机运行 `binference unlock`」
([decision 0103](../DECISIONS.md#d0103)). The codes are those of the auto test in spec 6, section 5.

<a id="section-3-5"></a>

### 3.5 Receipts

The card's message is edited into its receipt; the buttons go away.

| Outcome         | Key                 | English                                           | 中文                                      |
| --------------- | ------------------- | ------------------------------------------------- | ----------------------------------------- |
| Confirmed       | `receipt.confirmed` | ✅ Confirmed on {surface} at {time} · sending     | ✅ 已于 {time} 在 {surface} 确认 · 发送中 |
| Filled          | `receipt.filled`    | ✅ Done: {result} · {explorerLink}                | ✅ 已完成：{result} · {explorerLink}      |
| Paper fill      | `receipt.paper`     | 🧪 Paper fill: {result}                           | 🧪 模拟成交：{result}                     |
| Auto trade      | `receipt.auto`      | ⚡ Auto trade: {result} · {explorerLink}          | ⚡ 自动交易：{result} · {explorerLink}    |
| Cancelled       | `receipt.denied`    | ❌ Cancelled on {surface}                         | ❌ 已在 {surface} 取消                    |
| Expired         | `receipt.expired`   | ❌ Expired with no reply                          | ❌ 未回复，已过期                         |
| Refused         | `receipt.refused`   | ❌ Not sent: {reason}                             | ❌ 未发送：{reason}                       |
| Failed on chain | `receipt.failed`    | ❌ Failed on chain: {reason} · {explorerLink}     | ❌ 链上失败：{reason} · {explorerLink}    |
| Unknown         | `receipt.unknown`   | ⚠️ Sent, result not known yet; checking the chain | ⚠️ 已发送，结果待确认；正在检查链上记录   |

`{reason}` comes from `reason.<code>` (section 6).

<a id="section-4"></a>

## 4. Notices

The owner notifications of [ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27).

| Notice                | Key                     | English                                                                                 | 中文                                                                                |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Fill                  | `notice.fill`           | ✅ {orderKind} filled: {result}                                                         | ✅ {orderKind}已成交：{result}                                                      |
| Skipped fill          | `notice.skipped`        | ⚠️ {orderKind} skipped: {reason}. The order stays active.                               | ⚠️ {orderKind}已跳过：{reason}。订单仍然有效。                                      |
| Low gas               | `notice.lowGas`         | ⚠️ {wallet} has {balance} left for network fees. Add BNB.                               | ⚠️ {wallet} 仅剩 {balance} 可付网络费。请充值 BNB。                                 |
| Order expiring        | `notice.orderExpiring`  | {orderKind} ends {when}                                                                 | {orderKind}将于 {when} 到期                                                         |
| Frozen                | `notice.frozen`         | 🔴 {agent} is frozen from {surface}. Unfreeze in the CLI, the console or the Mini App.  | 🔴 已从 {surface} 冻结 {agent}。请在命令行、控制台或 Mini App 中解除冻结。          |
| Rescue started        | `notice.rescue`         | 🔴 Rescue confirmed: moving everything to {address}                                     | 🔴 已确认紧急转出：正在将全部资产转到 {address}                                     |
| New device            | `notice.newDevice`      | A new console device was paired: {label}                                                | 已配对新的控制台设备：{label}                                                       |
| Limit change          | `notice.limitChange`    | Limit changed by {surface}: {change}                                                    | {surface} 修改了限额：{change}                                                      |
| Send level change     | `notice.sendLevel`      | Send level {from} → {to} {when}                                                         | 转账级别 {from} → {to}，{when}                                                      |
| Rescue address change | `notice.rescueAddress`  | ⚠️ Rescue address changes to {address} at {when}. Not you? Cancel now.                  | ⚠️ 紧急转出地址将于 {when} 改为 {address}。不是你操作？请立即取消。                 |
| Plaintext secret      | `notice.plainSecret`    | ⚠️ A secret is written as plain text in config. Run `binference check --fix`.           | ⚠️ 配置文件中有明文密钥。请运行 `binference check --fix`。                          |
| Budget reached        | `notice.budget`         | {agent} used today's model budget ({budget}). Chat resumes {when}; orders keep running. | {agent} 已用完今日模型预算（{budget}）。对话将于 {when} 恢复；自动订单继续运行。    |
| Loop stopped          | `notice.loop`           | {agent} repeated the same step and was stopped                                          | {agent} 重复执行同一步骤，已停止                                                    |
| Back online           | `notice.resumed`        | Engine was off {duration}: {checked} orders checked, {filled} filled, {skipped} skipped | 引擎停止了 {duration}：已检查 {checked} 个订单，成交 {filled} 个，跳过 {skipped} 个 |
| Update available      | `notice.update`         | binference {version} is out: {summary}. Run `binference update`.                        | binference {version} 已发布：{summary}。请运行 `binference update`。                |
| Backup failed         | `notice.backupFailed`   | ⚠️ Last night's backup failed: {reason}                                                 | ⚠️ 昨晚的备份失败：{reason}                                                         |
| Locked                | `notice.locked`         | 🔴 binference restarted and is locked. Run `binference unlock`.                         | 🔴 binference 已重启并处于锁定状态。请运行 `binference unlock`。                    |
| Unknown transaction   | `notice.unknownTx`      | ⚠️ {wallet}'s nonce {nonce} was used by a transaction binference did not sign           | ⚠️ {wallet} 的随机数 {nonce} 被一笔非 binference 签名的交易占用                     |
| Binance agent refused | `notice.binanceRefused` | ⚠️ {agent} tried a trade over its limit: {trade}. Refused.                              | ⚠️ {agent} 尝试了超出限额的交易：{trade}。已拒绝。                                  |
| Binance agent paused  | `notice.binancePaused`  | {agent} paused from {surface}                                                           | 已从 {surface} 暂停 {agent}                                                         |
| Approval mode         | `notice.approvalMode`   | {agent} is now in {mode} mode, from {surface}                                           | {agent} 已切换为{mode}模式，来自 {surface}                                          |

**Daily summary** (`notice.daily`), at 09:00 owner time: total value and its 24-hour change,
realized P&L, fills, skipped fills, open orders, model spend, and anything waiting for the owner.

<a id="section-5"></a>

## 5. Fast commands

| Command      | Reply key       | Reply                                                           |
| ------------ | --------------- | --------------------------------------------------------------- |
| `/balance`   | `cmd.balance`   | Each wallet's total in USD and its top holdings                 |
| `/positions` | `cmd.positions` | Each position: amount, value, average cost, P&L                 |
| `/orders`    | `cmd.orders`    | Active auto orders with their triggers and fills                |
| `/cancel`    | `cmd.cancel`    | A list of orders with buttons to cancel one                     |
| `/freeze`    | `cmd.freeze`    | Freezes at once; the reply is `notice.frozen`                   |
| `/rescue`    | `cmd.rescue`    | Opens the rescue card                                           |
| `/paper`     | `cmd.paper`     | Switches the agent to paper (braking); going live needs the CLI |
| `/agents`    | `cmd.agents`    | Agents with mode and state; `/use <agent>` picks one            |
| `/limits`    | `cmd.limits`    | The agent's limits; buttons tighten a value                     |
| `/status`    | `cmd.status`    | Engine state, mode, frozen or not, health                       |
| `/spend`     | `cmd.spend`     | Model spend today and this month against the budget             |
| `/ai`        | `cmd.ai`        | The agent's models, with buttons to pick another configured one |
| `/clear`     | `cmd.clear`     | Starts a new chat session                                       |
| `/schedules` | `cmd.schedules` | Schedules with buttons to cancel                                |
| `/console`   | `cmd.console`   | A button that opens the Mini App                                |
| `/lang`      | `cmd.lang`      | Buttons: English, 中文                                          |
| `/help`      | `cmd.help`      | The commands, one line each                                     |

Command descriptions are registered with `setMyCommands` in both languages (`language_code`).

<a id="section-6"></a>

## 6. Reasons and errors

- Every policy, risk, check and failure reason of spec 6 has a key `reason.<code>`, for example
  `reason.daily_cap`: "it would pass your 24-hour cap ({used} of {cap} used)"
  / 「将超过你的 24 小时上限（已用 {used}，上限 {cap}）」, and the failure reason
  `reason.reverted`: "the transaction reverted; only the network fee was spent"
  / 「交易已回滚，只扣除了网络费」.
- Every protocol error code has a key `error.<area>.<reason>` with a next step, for example
  `error.engine.locked`: "binference is locked. Run `binference unlock` on the machine."
  / 「binference 已锁定。请在本机运行 `binference unlock`。」
- A code without a message fails the i18n check in CI.

<a id="section-7"></a>

## 7. Glossary additions

These terms were added to the glossary for this spec. The glossary's
[Chinese terms](../GLOSSARY.md#chinese-terms) hold them now, and a message uses a new term only
after it is there ([ENGINEERING.md section 14](../ENGINEERING.md#section-14)):

| English                                            | 中文                         |
| -------------------------------------------------- | ---------------------------- |
| auto order                                         | 自动订单                     |
| approval mode, manual, auto                        | 批准模式, 手动, 自动         |
| auto trade                                         | 自动交易                     |
| ceiling (the wallet policy's hard limit)           | 上限                         |
| limit order, take-profit, stop-loss, trailing stop | 限价单, 止盈, 止损, 追踪止损 |
| DCA                                                | 定投                         |
| copy trade                                         | 跟单                         |
| paper mode, live                                   | 模拟模式, 实盘               |
| freeze, unfreeze                                   | 冻结, 解除冻结               |
| rescue, rescue address                             | 紧急转出, 紧急转出地址       |
| send level                                         | 转账级别                     |
| address book                                       | 地址簿                       |
| gas reserve                                        | 网络费预留                   |
| per-trade cap, 24-hour cap                         | 单笔上限, 24 小时上限        |
| outside content                                    | 外部内容                     |
| health factor                                      | 健康因子                     |
| supply, withdraw, borrow, repay                    | 存入, 取出, 借款, 还款       |
| bridge (verb)                                      | 跨链                         |
| revert (a transaction fails on chain)              | 回滚                         |
| route, minimum received                            | 路由, 至少收到               |
| private send                                       | 私密发送                     |
| console                                            | 控制台                       |
| alert rule                                         | 提醒规则                     |
| model budget                                       | 模型预算                     |
| honeypot (a token you cannot sell)                 | 貔貅盘                       |
| catch a new launch (buy early)                     | 抢先买入                     |
| Binance agent (one run on Binance Agent OS)        | Binance Agent                |
| research                                           | 调研                         |
| market intelligence                                | 市场情报                     |
| smart money                                        | 聪明钱                       |
| chain access                                       | 链上访问                     |
| private execution                                  | 私密执行                     |
| front-running bot                                  | 抢跑机器人                   |
| portfolio                                          | 投资组合                     |
| skill (Agent Skills)                               | 技能                         |
