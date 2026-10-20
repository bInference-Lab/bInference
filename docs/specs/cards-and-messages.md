# Spec 4: cards and messages

Status: accepted on 2026-10-06 ([decision 0096](../DECISIONS.md#d0096)), amended by decisions
[0101](../DECISIONS.md#d0101), [0102](../DECISIONS.md#d0102), [0103](../DECISIONS.md#d0103),
[0108](../DECISIONS.md#d0108), [0109](../DECISIONS.md#d0109), [0115](../DECISIONS.md#d0115),
[0117](../DECISIONS.md#d0117), [0118](../DECISIONS.md#d0118), [0119](../DECISIONS.md#d0119),
[0120](../DECISIONS.md#d0120), [0128](../DECISIONS.md#d0128), [0134](../DECISIONS.md#d0134),
[0177](../DECISIONS.md#d0177), [0178](../DECISIONS.md#d0178), [0185](../DECISIONS.md#d0185),
[0186](../DECISIONS.md#d0186), [0189](../DECISIONS.md#d0189), [0190](../DECISIONS.md#d0190) and
[0243](../DECISIONS.md#d0243).
Accepted by the owner on 2026-10-12: callback kind `q` (section 2); sales by share, the paper
launch refusal, the P&L card and the auto order summaries (sections 3.6 to 3.8); the new notices on
by default (section 4); update notes (section 4.2); the alert, launch feed, fill and exit messages
(section 4.3); the glossary rows they need (section 7); the chat's status lines, the agent's
questions and the first chat (section 8); and the disclaimer and privacy statement as version 2,
which owners accept again (section 9).

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
  refused or failed, ⚠️ warning, 🧪 paper, 🔴 live. Telegram shows them as emoji; the console
  draws each as a thin line icon in the same place, with its name for screen readers.
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
- A `/limits` button carries `bnf1:t:h:<limit>`: it halves the limit its field names
  (`perTradeUsdMicros`, `rollingDayUsdMicros`, `slippageRegistryBps` or `slippageOtherBps`) for the
  only agent. It names no id: a press can only make the owner's own limit stricter. A `/lang`
  button carries `bnf1:l:s:<en|zh>`: it sets the owner's language. An `/ai` button carries
  `bnf1:m:s:<digest>`, the first 16 base64url characters of the SHA-256 of a configured model's
  reference: it sets that model for the agent's `main` role ([decision 0204](../DECISIONS.md#d0204)).
- A button of the agent's question ([section 8.2](#section-8-2)) carries `bnf1:q:<choice>:<ref>`:
  `choice` is `0` to `3`, the choice's place in the question; `ref` is the question's random
  12-byte base64url reference (spec 3, `questions.ref`). A press answers the question; it confirms
  nothing. A press on a question that is no longer open answers `answerCallbackQuery` with
  `question.closedToast` and changes nothing.
- A button of the agent's launch draft ([section 8.5](#section-8-5)) carries
  `bnf1:s:<y|n>:<ref>`: `y` is Start launch, `n` is Drop; `ref` is the draft's random 12-byte
  base64url reference, kept in engine memory with the draft. Start proposes the draft's launch as
  the owner on Telegram, the one proposal the owner's chat makes; it confirms nothing, and the
  launch card asks again ([decision 0285](../DECISIONS.md#d0285)). A press on a draft no longer
  open changes nothing.
- The engine checks that the presser is the owner's numeric Telegram id, writes the decision
  durably, then answers `answerCallbackQuery`.
- First answer wins: the other surfaces' buttons are removed, and every copy becomes the receipt.

<a id="section-3"></a>

## 3. The card

<a id="section-3-1"></a>

### 3.1 Shape

Every card has these lines, in order; a line without data is left out.

| Line             | Key                   | Content                                                                       |
| ---------------- | --------------------- | ----------------------------------------------------------------------------- |
| Header           | `card.header`         | Status icon, the action, the agent's name, 🧪 Paper or 🔴 Live                |
| Header (console) | `card.header.console` | The same, without the mode: the Paper label marks a paper card, 🔴 Live stays |
| Action           | `card.<kind>.action`  | The kind's main line (section 3.3)                                            |
| Route            | `card.route`          | Venues with their shares, price impact, maximum slippage                      |
| Fees             | `card.fees`           | Network fee in USD, and "private send"                                        |
| Check            | `card.check`          | Simulation result and token verdict                                           |
| Warnings         | `card.warn.*`         | Outside content, unusual characters, new address, risk warnings               |
| Agent says       | `card.reason`         | The agent's reason, escaped                                                   |
| Expiry           | `card.expiry`         | "Expires at 14:32:05"                                                         |

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

| Kind               | Key                                        | English                                                                                                                                       | 中文                                                                                                                           |
| ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `swap`             | `card.swap.action`                         | Sell {in} → at least {minOut}                                                                                                                 | 卖出 {in} → 至少收到 {minOut}                                                                                                  |
| `buy`              | `card.buy.action`                          | Buy {token} with {spend} · on {place}                                                                                                         | 用 {spend} 买入 {token} · 在 {place}                                                                                           |
| `sell`             | `card.sell.action`                         | Sell {amount} → at least {minOut} · on {place}                                                                                                | 卖出 {amount} → 至少收到 {minOut} · 在 {place}                                                                                 |
| `send`             | `card.send.action`                         | Send {amount} to {recipient}                                                                                                                  | 向 {recipient} 转账 {amount}                                                                                                   |
| `revokeApproval`   | `card.revoke.action`                       | Remove {spender}'s approval for {token}                                                                                                       | 撤销 {spender} 对 {token} 的授权                                                                                               |
| `lend` supply      | `card.lend.supply`                         | Supply {amount} to {venue} · health factor {hf}                                                                                               | 向 {venue} 存入 {amount} · 健康因子 {hf}                                                                                       |
| `lend` withdraw    | `card.lend.withdraw`                       | Withdraw {amount} from {venue} · health factor {hf}                                                                                           | 从 {venue} 取出 {amount} · 健康因子 {hf}                                                                                       |
| `lend` borrow      | `card.lend.borrow`                         | Borrow {amount} from {venue} · health factor {hf}                                                                                             | 从 {venue} 借款 {amount} · 健康因子 {hf}                                                                                       |
| `lend` repay       | `card.lend.repay`                          | Repay {amount} to {venue} · health factor {hf}                                                                                                | 向 {venue} 还款 {amount} · 健康因子 {hf}                                                                                       |
| `stake` stake      | `card.stake.stake`                         | Stake {amount} with {validator}                                                                                                               | 向 {validator} 质押 {amount}                                                                                                   |
| `stake` unstake    | `card.stake.unstake`                       | Unstake {amount} from {validator} · ready in {days} days                                                                                      | 从 {validator} 解除质押 {amount} · {days} 天后可领取                                                                           |
| `stake` claim      | `card.stake.claim`                         | Claim {amount} from {validator}                                                                                                               | 从 {validator} 领取 {amount}                                                                                                   |
| `bridge`           | `card.bridge.action`                       | Bridge {amount} to {chain} · to {recipient} · about {minutes} min                                                                             | 跨链 {amount} 到 {chain} · 收款地址 {recipient} · 约 {minutes} 分钟                                                            |
| `cexOrder`         | `card.cex.action`                          | Binance {side} {size} {market} at {price}                                                                                                     | Binance {side} {size} {market}，价格 {price}                                                                                   |
| `registerIdentity` | `card.identity.action`                     | Register {agent} on chain (ERC-8004)                                                                                                          | 在链上登记 {agent}（ERC-8004）                                                                                                 |
| `launchToken`      | `card.launch.action`                       | Launch {symbol} ({name}) on {venue}, paired with {pair} · first buy {firstBuy}                                                                | 在 {venue} 发射 {symbol}（{name}），与 {pair} 配对交易 · 首笔买入 {firstBuy}                                                   |
| rescue             | `card.rescue.action`                       | Move everything to your rescue address {address}: {count} tokens from {wallets} wallets, about {usd}                                          | 将全部资产转到你的紧急转出地址 {address}：{wallets} 个钱包中的 {count} 种代币，约 {usd}                                        |
| unfreeze           | `card.unfreeze.agent`, `card.unfreeze.all` | Unfreeze {agent}: it trades again within its limits; for every agent: Unfreeze every agent: {count} frozen now, and new agents start unfrozen | 对 {agent} 解除冻结：它可以在交易限额内再次交易；全部：对全部 Agent 解除冻结：目前有 {count} 个已冻结，新建的 Agent 也不再冻结 |
| auto order         | `card.order.action`                        | Approve {orderKind}: {summary} · up to {maxFills} fills until {expiry}                                                                        | 批准{orderKind}：{summary} · 最多成交 {maxFills} 次，截至 {expiry}                                                             |
| webhook rule       | `card.webhookRule.action`                  | Approve alert rule "{name}": {summary} · at most {rate} a minute                                                                              | 批准提醒规则“{name}”：{summary} · 每分钟最多 {rate} 次                                                                         |

A `launchToken` shows, right after its action line, each line below that has its facts
([decision 0235](../DECISIONS.md#d0235)), then `card.launchWallet`:

| Line              | Key                          | English                                                                                                       | 中文                                                                                    |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token             | `card.launch.token`          | New token {token}                                                                                             | 新代币 {token}                                                                          |
| First buy's least | `card.launch.firstBuyMin`    | First buy gets at least {minOut}                                                                              | 首笔买入至少获得 {minOut}                                                               |
| Launch fee        | `card.launch.fee`            | Launch fee {fee}                                                                                              | 发射手续费 {fee}                                                                        |
| Description       | `card.launch.description`    | Description: {description}                                                                                    | 简介：{description}                                                                     |
| Link, each        | `card.launch.link`           | {site}: {url} (Website, X, Telegram)                                                                          | {site}：{url}（网站、X、Telegram）                                                      |
| Picture           | `card.launch.picture`        | Picture sent: {format}, {kib} KB, SHA-256 {digest} · metadata at {uri}                                        | 已发送图片：{format}，{kib} KB，SHA-256 {digest} · 元数据位于 {uri}                     |
| Picture written   | `card.launch.writtenPicture` | Picture written on chain with the token: {format}, {bytes} bytes, {width} x {height} pixels, SHA-256 {digest} | 随代币写入链上的图片：{format}，{bytes} 字节，{width} x {height} 像素，SHA-256 {digest} |
| Draft photo       | `card.launch.photo`          | Picture: your photo from the chat, {format}, {kib} KB, SHA-256 {digest}                                       | 图片：你在对话中发送的图片，{format}，{kib} KB，SHA-256 {digest}                        |
| Picture, paper    | `card.launch.upload`         | Picture: upload {upload}                                                                                      | 图片：上传 {upload}                                                                     |
| Picture link      | `launch.option.pictureLink`  | Picture at {link} (binference never opens it)                                                                 | 图片地址 {link}（binference 从不打开它）                                                |
| Setting, each     | `launch.option.<name>`       | One per launchpad setting, such as `launch.option.taxBps`: Tax on every trade: {value}                        | 如 `launch.option.taxBps`：每笔交易的交易税：{value}                                    |
| Account setting   | `launch.option.<name>`       | Such as `launch.option.taxRecipient`: Tax paid to {address}, the whole address                                | 如 `launch.option.taxRecipient`：交易税支付给 {address}，完整地址                       |
| Public already    | `card.launch.pinned`         | ⚠️ The picture and words are already public on {venue}'s storage, and stay public if you cancel               | ⚠️ 图片和文字已在 {venue} 的存储中公开，即使取消也会保持公开                            |

A launch whose launchpad declares that its create call's first buy carries no minimum shows
`card.warn.unboundFirstBuy` among the warnings, right after where `card.warn.noDeadline` would
show ([decision 0270](../adr/0270-a-launch-s-first-buy-may-carry-no-minimum-when-it-runs-inside-the-create-call.md)):
the simulation before the card held the first buy to the least the card shows.

A launchpad's own warnings, `launch.warn.<name>`, show among the warnings right after
`card.warn.unboundFirstBuy`, one line each, such as Brew's `launch.warn.notForUsCitizens`: ⚠️ Brew's
site says it is not available to U.S. citizens / ⚠️ Brew 的网站称其不向美国公民提供服务
([decision 0281](../DECISIONS.md#d0281)).

An `amount` setting's `{value}` is an amount of the launch's pair, and a setting its launchpad
worked out at its quote or its build shows like one the owner gave
([decision 0280](../DECISIONS.md#d0280)).

`{digest}` is the first 16 hex digits of the picture's SHA-256; the terms hash binds all of it.
A launchpad that writes the picture into its create call shows `card.launch.writtenPicture` in
place of `card.launch.picture`, and no `card.launch.pinned`: nothing is public before the
signature ([decision 0279](../DECISIONS.md#d0279)).
A launch draft ([section 8.5](#section-8-5)) shows the owner's photo with `card.launch.photo` before anything is
uploaded; the launch's card then shows the picture line its launchpad's place calls for
([decision 0286](../DECISIONS.md#d0286)).
A card cuts `{description}` at 1,000 characters and `{url}` and `{uri}` at 200, and shows `{link}`
whole, up to its 512 bytes, as it shows a launch setting's `{address}` whole: an account a
launch pays. A launchpad that takes its picture as a link uploads nothing, so its
card shows neither the picture line nor the public one
([decision 0276](../DECISIONS.md#d0276)). A launchpad's
setting names its own message, which must exist in both languages before the engine hosts the
launchpad.

A trade that runs from the agent's launch wallet shows `card.launchWallet` right after its action
line: "From your launch wallet {wallet}" / 「从你的发射钱包 {wallet} 发起」, `{wallet}` the label the
owner gave it ([decision 0217](../DECISIONS.md#d0217)).

`{place}` is "the Flap curve" / 「Flap 联合曲线」, "the four.meme curve" / 「four.meme 联合曲线」,
"the Genius.fun curve" / 「Genius.fun 联合曲线」, or the venue's name for a pool.

<a id="section-3-4"></a>

### 3.4 Warning lines

| Key                         | English                                                                                                                                                      | 中文                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `card.warn.outsideContent`  | ⚠️ This came after reading outside content (web, X, token data or an image)                                                                                  | ⚠️ 此请求发生在读取外部内容（网页、X、代币信息或图片）之后                                                |
| `card.warn.newAddress`      | ⚠️ You have never sent to this address                                                                                                                       | ⚠️ 你从未向此地址转账                                                                                     |
| `card.warn.unusualName`     | ⚠️ Unusual characters in this token's name                                                                                                                   | ⚠️ 此代币名称含有不常见字符                                                                               |
| `card.warn.unverified`      | ⚠️ Not a verified token: risk checks passed, but check the address                                                                                           | ⚠️ 非已验证代币：风险检查已通过，但请核对地址                                                             |
| `card.warn.highTax`         | ⚠️ This token takes {tax} tax on every trade                                                                                                                 | ⚠️ 此代币每笔交易收取 {tax} 交易税                                                                        |
| `card.warn.poolFee`         | Includes a {fee} {maker} pool fee                                                                                                                            | 含 {fee} 的 {maker} 交易池手续费                                                                          |
| `card.warn.requoted`        | ⚠️ The price moved: this is a new quote                                                                                                                      | ⚠️ 价格已变动：这是新的报价                                                                               |
| `card.warn.noDeadline`      | ⚠️ This trade has no time limit: if it is delayed, it can still fill later, never below the minimum received                                                 | ⚠️ 此交易没有时限：如有延迟，之后仍可能成交，但绝不会低于至少收到的数量                                   |
| `card.warn.unboundFirstBuy` | ⚠️ The first buy has no minimum on chain: it runs in the call that makes the token, before any other trade, and the simulation got at least the amount above | ⚠️ 首笔买入在链上没有最低数量：它在创建代币的同一笔调用中执行，早于任何其他交易，模拟结果至少为上面的数量 |
| `card.warn.paper`           | 🧪 Paper mode: nothing is sent on chain                                                                                                                      | 🧪 模拟模式：不会发送链上交易                                                                             |
| `card.warn.paperEstimate`   | ⚠️ Estimate: binference cannot simulate a sale of this token, so the paper fill uses the quote                                                               | ⚠️ 估算：binference 无法模拟卖出此代币，模拟成交按报价计算                                                |
| `card.warn.autoAsks`        | Auto mode asks you here: {why}                                                                                                                               | 自动模式在此需要你确认：{why}                                                                             |

A `swap`, `buy` or `sell` whose route passes pool hooks that keep a share shows
`card.warn.poolFee` right after the tax line, once for each maker of those pools: `{fee}` is what
the maker's hooks keep along the route, which the amounts already hold back, and `{maker}` the
name the chain registry gives them, such as Genius.fun
([decision 0215](../adr/0215-a-pool-hook-s-fee-shows-on-the-card-and-counts-toward-the-maximum-tax.md)).
The fee counts toward the agent's maximum tax; `card.warn.highTax` keeps the token's own tax.

A `swap`, `buy` or `sell` whose route uses a venue that declares no deadline on the trade's chain
shows `card.warn.noDeadline` ([decision 0180](../adr/0180-a-curve-call-with-no-deadline-is-bound-by-its-minimum-out.md)):
its trade call has no time limit, so a delayed send can still fill later, at no less than its
minimum out. It follows `card.warn.placeChanged` when both show.

A paper sale of a token whose balance no simulation can set, such as a reflection or rebasing
token, shows `card.warn.paperEstimate` instead of the check line: nothing was simulated, and the
paper fill uses the quote. A live trade always needs its simulation.

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
Every card auto mode opens instead of filling its intent shows the line, last among the warnings:
the card version keeps the code (`cards.auto_ask`), each later version of the card keeps it too,
the line shows only while its reason holds (none once the agent is in manual mode, and
`autoAsks.locked` only while binference is locked), and the `{client}` of `autoAsks.mcp` is the label of the client token or console device that
proposed, or Telegram. A card of an agent in manual mode shows no such line.

<a id="section-3-5"></a>

### 3.5 Receipts

The card's message is edited into its receipt; the buttons go away.

| Outcome                | Key                     | English                                                  | 中文                                                  |
| ---------------------- | ----------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Confirmed              | `receipt.confirmed`     | ✅ Confirmed on {surface} at {time} · sending            | ✅ 已于 {time} 在 {surface} 确认 · 发送中             |
| Filled                 | `receipt.filled`        | ✅ Done: {result} · {explorerLink}                       | ✅ 已完成：{result} · {explorerLink}                  |
| Launched               | `receipt.launched`      | ✅ Launched {token}: first buy {result} · {explorerLink} | ✅ 已发射 {token}：首笔买入 {result} · {explorerLink} |
| Launched, no first buy | `receipt.launchedAlone` | ✅ Launched {token} · {explorerLink}                     | ✅ 已发射 {token} · {explorerLink}                    |
| Paper fill             | `receipt.paper`         | 🧪 Paper fill: {result}                                  | 🧪 模拟成交：{result}                                 |
| Auto trade             | `receipt.auto`          | ⚡ Auto trade: {result} · {explorerLink}                 | ⚡ 自动交易：{result} · {explorerLink}                |
| Cancelled              | `receipt.denied`        | ❌ Cancelled on {surface}                                | ❌ 已在 {surface} 取消                                |
| Expired                | `receipt.expired`       | ❌ Expired with no reply                                 | ❌ 未回复，已过期                                     |
| Refused                | `receipt.refused`       | ❌ Not sent: {reason}                                    | ❌ 未发送：{reason}                                   |
| Failed on chain        | `receipt.failed`        | ❌ Failed on chain: {reason} · {explorerLink}            | ❌ 链上失败：{reason} · {explorerLink}                |
| Unknown                | `receipt.unknown`       | ⚠️ Sent, result not known yet; checking the chain        | ⚠️ 已发送，结果待确认；正在检查链上记录               |

`{reason}` comes from `reason.<code>` (section 6).

A confirmed live intent's receipt says `receipt.confirmed` while it sends, and every copy turns
into how it ended once it did: `receipt.filled` for a trade that reconciled, with what it sold and
bought; `receipt.launched` for a token launch, with its new token (its symbol and short address)
and what its first buy spent and got, or `receipt.launchedAlone` with no first buy; and
`receipt.failed` for one that failed on chain. `{explorerLink}` is its last transaction's page on
the first block explorer the chain registry lists, shown whole.

<a id="section-3-6"></a>

### 3.6 Places, sales by share and paper launches

The engine picks where a `buy` or `sell` runs ([spec 6, section 5](intent-states.md#section-5)), and
`{place}` names it: `card.place.curve`, "the {launchpad} curve" / 「{launchpad} 联合曲线」, while
the token is on its launchpad's curve; otherwise the aggregator's name, and the route line names
the pools.

| Line          | Key                      | English                                                                                                                                         | 中文                                                                                              |
| ------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sell a share  | `card.sell.share`        | Sell {share} of your {token} ({amount}) → at least {minOut} · on {place}                                                                        | 卖出你持有的 {token} 的 {share}（{amount}）→ 至少收到 {minOut} · 在 {place}                       |
| Sell all      | `card.sell.all`          | Sell all your {token} ({amount}) → at least {minOut} · on {place}                                                                               | 卖出你持有的全部 {token}（{amount}）→ 至少收到 {minOut} · 在 {place}                              |
| Place changed | `card.warn.placeChanged` | ⚠️ {token} graduated since the last quote: this trade now runs in the pools                                                                     | ⚠️ 自上次报价以来 {token} 已毕业：此交易现在在交易池中进行                                        |
| Paper launch  | `card.launch.paperOnly`  | A launch publishes the token's name and picture for good, and a paper token would have no address. Go live with `binference live` to launch it. | 发射会永久公开代币的名称和图片，而模拟代币没有地址。请运行 `binference live` 切换到实盘后再发射。 |

- A `sell` by `percentBps` shows `card.sell.share`, or `card.sell.all` at 100%; `{amount}` is
  what that share was when the quote was built.
- A new card version whose place differs from the version before carries `card.warn.placeChanged`.
- A `launchToken` refused with `paper_only` (spec 6, section 4) shows its card's lines, every
  setting included, with 🧪 Paper in the header and no buttons, followed by `receipt.refused` and
  `card.launch.paperOnly`, so the owner can check the settings before going live.

<a id="section-3-7"></a>

### 3.7 The P&L card

A text card drawn from `portfolio/pnl` and the ledger, never from model text, in Telegram
(`/positions`) and the console, in both languages. One card per position: an open one while the
wallet holds the token, a closed one after a sale emptied it. A paper position's card says
🧪 Paper, as cards do. A shareable picture comes later.

Open position, English:

```text
PEPE (0x6982…1933) · main · 🔴 Live
Holding 1.25M PEPE · value $14.20
Average cost <$0.01 · cost $11.80
P&L  unrealized +$2.40 (+20.34%) · realized +$0.85
Fees  venue $0.04 · network $0.02
Since 2026-10-02 14:05
```

中文:

```text
PEPE (0x6982…1933) · main · 🔴 实盘
持有 1.25M PEPE · 市值 $14.20
平均成本 <$0.01 · 成本 $11.80
盈亏  未实现盈亏 +$2.40（+20.34%）· 已实现盈亏 +$0.85
费用  平台手续费 $0.04 · 网络费 $0.02
开始于 2026-10-02 14:05
```

Closed trade, English:

```text
PEPE (0x6982…1933) · main · 🔴 Live · closed
Bought for $11.80 · sold for $14.65
P&L  realized +$2.85 (+24.15%)
Fees  venue $0.06 · network $0.03
Held 2026-10-02 14:05 → 2026-10-09 09:12 (7 days)
```

中文:

```text
PEPE (0x6982…1933) · main · 🔴 实盘 · 已清仓
买入花费 $11.80 · 卖出收到 $14.65
盈亏  已实现盈亏 +$2.85（+24.15%）
费用  平台手续费 $0.06 · 网络费 $0.03
持有 2026-10-02 14:05 → 2026-10-09 09:12（7 天）
```

| Line              | Key                  | English                                                       | 中文                                                             |
| ----------------- | -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Header            | `pnl.header`         | {token} · {agent} · {mode}                                    | {token} · {agent} · {mode}                                       |
| Header, closed    | `pnl.headerClosed`   | {token} · {agent} · {mode} · closed                           | {token} · {agent} · {mode} · 已清仓                              |
| Holding           | `pnl.holding`        | Holding {amount} · value {value}                              | 持有 {amount} · 市值 {value}                                     |
| Cost              | `pnl.cost`           | Average cost {average} · cost {cost}                          | 平均成本 {average} · 成本 {cost}                                 |
| P&L, open         | `pnl.open`           | P&L unrealized {unrealized} ({percent}) · realized {realized} | 盈亏 未实现盈亏 {unrealized}（{percent}）· 已实现盈亏 {realized} |
| P&L, closed       | `pnl.closed`         | P&L realized {realized} ({percent})                           | 盈亏 已实现盈亏 {realized}（{percent}）                          |
| Bought and sold   | `pnl.trades`         | Bought for {bought} · sold for {sold}                         | 买入花费 {bought} · 卖出收到 {sold}                              |
| Fees              | `pnl.fees`           | Fees venue {venue} · network {network}                        | 费用 平台手续费 {venue} · 网络费 {network}                       |
| Since             | `pnl.since`          | Since {openedAt}                                              | 开始于 {openedAt}                                                |
| Held              | `pnl.held`           | Held {openedAt} → {closedAt} ({duration})                     | 持有 {openedAt} → {closedAt}（{duration}）                       |
| No price          | `pnl.noPrice`        | P&L unrealized: no price now · realized {realized}            | 盈亏 未实现盈亏：暂无价格 · 已实现盈亏 {realized}                |
| Holding, no price | `pnl.holdingNoValue` | Holding {amount}                                              | 持有 {amount}                                                    |
| No percentage     | `pnl.noPercent`      | n/a                                                           | 不适用                                                           |
| Days held         | `pnl.days`           | {count} days (1 day)                                          | {count} 天                                                       |
| Hours held        | `pnl.hours`          | {count} hours (1 hour)                                        | {count} 小时                                                     |
| Minutes held      | `pnl.minutes`        | {count} minutes (1 minute)                                    | {count} 分钟                                                     |

- `{mode}` is 🧪 Paper / 🧪 模拟 or 🔴 Live / 🔴 实盘; the console draws the mode as its card header
  does.
- An open position's `{percent}` is the unrealized P&L over its cost; a closed one's is the
  realized P&L over what its buys cost (`boughtUsdMicros`). Amounts carry their sign, `+` or `-`.
- `{average}` is the cost per whole token at average cost
  ([decision 0058](../DECISIONS.md#d0058)), rounded up and shown in USD with 2 decimals (section 1),
  so a token under a cent shows `<$0.01`; the venue fees and network fees are those of
  every execution that bought or sold the asset in the position's span.
- A position is the agent's rows of the asset in one mode, across its wallets. Its span runs from
  its first trade or valued arrival, a paper one's from the last paper reset. `{realized}` is the
  rows' realized P&L minus the venue fees and gas of the span's sales, so it is net of every fee
  and gas; `{bought}` is what the buys cost with their fees and gas, plus funds that arrived at
  their value; `{sold}` is each sale's value minus its gas
  ([decision 0243](../DECISIONS.md#d0243)).
- A percentage rounds toward minus infinity; with a base of zero it is `pnl.noPercent`. A position
  with no price now shows `pnl.holdingNoValue` and `pnl.noPrice`. A token whose decimals are not
  known is named by its short address, and its holding and cost lines are left out.
- `{duration}` is whole days, else whole hours, else whole minutes.

<a id="section-3-8"></a>

### 3.8 Auto order cards

An auto order's card (`card.order.action`, "Approve {orderKind}: {summary} · up to {maxFills} fills
until {expiry}") takes `{orderKind}` from the kind's name, as `/orders` words it, and `{summary}`
from this table. `{sell}` is `card.order.sell` for the order's size, `{spend}` is `card.order.spend`
for a buy's, and `{condition}` is "at or above {price}" or "at or below {price}" / 「达到或高于
{price}」 or 「达到或低于 {price}」.

| Kind           | Key                             | English                                                                                                                                                    | 中文                                                                                                                                         |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Size of a sale | `card.order.sell`               | sell {size, select, share {{share} of your {token}} usd {{usd} of {token}} all {all your {token}} other {{amount}}}                                        | {size, select, share {卖出你持有的 {token} 的 {share}} usd {卖出价值 {usd} 的 {token}} all {卖出你持有的全部 {token}} other {卖出 {amount}}} |
| Size of a buy  | `card.order.spend`              | {size, select, share {{share} of your spendable {asset}} usd {{usd} of {asset}} usdOnly {{usd}} other {{amount}}}                                          | {size, select, share {用你可用的 {asset} 的 {share}} usd {用价值 {usd} 的 {asset}} usdOnly {用 {usd}} other {用 {amount}}}                   |
| Limit buy      | `card.order.summary.limitBuy`   | buy {token} with {spend} when the price is {condition}                                                                                                     | 当价格{condition} 时，{spend} 买入 {token}                                                                                                   |
| Limit sell     | `card.order.summary.limitSell`  | {sell} when the price is {condition}                                                                                                                       | 当价格{condition} 时，{sell}                                                                                                                 |
| Take-profit    | `card.order.summary.takeProfit` | {sell} when the price reaches {price}                                                                                                                      | 当价格达到 {price} 时，{sell}                                                                                                                |
| Stop-loss      | `card.order.summary.stopLoss`   | {sell} when the price falls to {price}                                                                                                                     | 当价格跌至 {price} 时，{sell}                                                                                                                |
| Trailing stop  | `card.order.summary.trailing`   | {sell} when the price falls {distance} below its highest since the order started                                                                           | 当价格从下单以来的最高点回落 {distance} 时，{sell}                                                                                           |
| DCA            | `card.order.summary.dca`        | buy {token} with {spend} {schedule}, {count, plural, =0 {until the order ends} one {once} other {# times}}                                                 | {schedule}{spend} 买入 {token}，{count, plural, =0 {直到订单结束} other {共 # 次}}                                                           |
| DCA period     | `card.order.schedule`           | on the schedule {cron} ({zone}), first at {first}, then at {second}                                                                                        | 按计划 {cron}（{zone}），首次 {first}，第二次 {second}，                                                                                     |
| Copy trade     | `card.order.summary.copy`       | copy {leader}'s buys with {spend}, at up to {perBuy} each and never more than the leader spent, at most {daily} a day, and sell the share the leader sells | 用 {spend} 跟单 {leader} 的买入，每笔最多 {perBuy} 且不超过带单钱包的买入金额，每天最多 {daily}；按带单钱包卖出的持仓比例同步卖出            |
| Copy leader    | `card.order.leader`             | {label} ({account})                                                                                                                                        | {label}（{account}）                                                                                                                         |
| Linked exits   | `card.order.exitsLinked`        | When an exit order sells all your {token}, your other exit orders on it end                                                                                | 当一个平仓订单卖出你持有的全部 {token} 时，该持仓的其他平仓订单随之结束                                                                      |
| Worst price    | `card.order.worstPrice`         | Every fill trades at {price} or better                                                                                                                     | 每次成交都以不差于 {price} 的价格交易                                                                                                        |

- `{leader}` is the leader wallet's short address (`0x12ab…cd34`), after its address book label in
  `card.order.leader` when it has one, so a label never hides the address; `{spend}` is the asset
  a copy buys with, the chain's coin unless the order names a listed token.
- `{schedule}` is `card.order.schedule`: the DCA order's five cron fields and the zone they run
  in, its own or the owner's at creation, which the order keeps, with its first two runs after
  the card was drawn, so the owner reads how often it buys
  ([decision 0246](../DECISIONS.md#d0246)); `{count}` is its number of buys, its `maxFills` when it
  names no count, 0 for no limit.
- The card's header confirms an "auto order" / 「自动订单」, and `{maxFills}` counts the fills its
  terms allow: an order with no limit says "no fill limit" / 「不限成交次数」 in place of "up to
  {maxFills} fills" ([decision 0189](../DECISIONS.md#d0189)).
- `{condition}` is `card.order.condition`: "at or above {price}" / 「达到或高于 {price}」 for
  `direction: above`, "at or below {price}" / 「达到或低于 {price}」 for `below`; the Chinese
  summary names the price (「价格」) before it.
- `{spend}` is what a buy spends ([decision 0190](../DECISIONS.md#d0190)): a dollar value of the
  asset it spends (`usd`), an amount of it (`other`), or a share of what the wallet may spend of it
  (`share`), which leaves out the gas reserve when it spends the chain's coin. `{asset}` is that
  asset: the chain's coin unless the order names a token. An order stored before buys named what
  they spend shows its dollar value alone (`usdOnly`). In Chinese the line carries its own 「用」, so
  the summary does not repeat it.
- An auto order's card carries the "Agent says" line (`card.reason`) when its request has a
  `reason` (spec 1, section 8.2), in the same place as an intent's card.
- An exit order's card carries `card.order.exitsLinked` when its position already has another
  active exit order, so the owner knows a full sale by one ends the others
  ([spec 6, section 5](intent-states.md#section-5)).

<a id="section-4"></a>

## 4. Notices

The owner notifications of [ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27).

| Notice                          | Key                             | English                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 中文                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fill                            | `notice.fill`                   | ✅ {orderKind} filled: {result}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ {orderKind}已成交：{result}                                                                                                                                                                             |
| Skipped fill                    | `notice.skipped`                | ⚠️ {orderKind} skipped: {reason}. The order stays active.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ⚠️ {orderKind}已跳过：{reason}。订单仍然有效。                                                                                                                                                             |
| Low gas                         | `notice.lowGas`                 | ⚠️ {wallet} has {balance} left for network fees. Add BNB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ⚠️ {wallet} 仅剩 {balance} 可付网络费。请充值 BNB。                                                                                                                                                        |
| Order expiring                  | `notice.orderExpiring`          | {orderKind} ends {when}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | {orderKind}将于 {when} 到期                                                                                                                                                                                |
| Frozen                          | `notice.frozen`                 | 🔴 {agent} is frozen from {surface}. Unfreeze in the CLI, the console or the Mini App.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 🔴 已从 {surface} 冻结 {agent}。请在命令行、控制台或 Mini App 中解除冻结。                                                                                                                                 |
| Unfrozen                        | `notice.unfrozen`               | 🟢 {agent} is unfrozen from {surface}; for every agent: 🟢 Every agent is unfrozen from {surface}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🟢 已从 {surface} 对 {agent} 解除冻结；全部：🟢 已从 {surface} 对全部 Agent 解除冻结                                                                                                                       |
| Rescue started                  | `notice.rescue`                 | 🔴 Rescue confirmed: moving everything to {address}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔴 已确认紧急转出：正在将全部资产转到 {address}                                                                                                                                                            |
| New device                      | `notice.newDevice`              | A new console device was paired: {label}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 已配对新的控制台设备：{label}                                                                                                                                                                              |
| Sign-ins locked                 | `notice.signInsLocked`          | ⚠️ Too many failed attempts to sign in {what}, so binference refuses them until {until}. None of them signed in. ({what}: an address, a device or token label, or the Mini App)                                                                                                                                                                                                                                                                                                                                                                                                                                          | ⚠️ {what}登录失败次数过多，binference 在 {until} 前拒绝这些登录。这些尝试都没有登录成功。                                                                                                                  |
| Limit change                    | `notice.limitChange`            | Limit changed by {surface}: {limit} changed now; a looser limit: Limit changed by {surface}: {limit} changes at {when}. Not you? Cancel now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | {surface} 修改了限额：{limit}已立即更改；更宽松的限额：{surface} 修改了限额：{limit}将于 {when} 更改。不是你操作？请立即取消。                                                                             |
| Limit change cancelled          | `notice.limitChangeCancelled`   | Limit change cancelled for {limit}; the limit in effect stays                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 已取消对{limit}的修改，当前限额保持不变                                                                                                                                                                    |
| Ceiling change                  | `notice.ceilingChange`          | ⚠️ The owner key changed the ceiling of {agent}'s wallets from {surface}: {change}. Not you? Freeze now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ⚠️ 已从 {surface} 用所有者密钥修改 {agent} 钱包的上限：{change}。不是你操作？请立即冻结。                                                                                                                  |
| Signer revoked                  | `notice.signerRevoked`          | ⚠️ The owner key removed the agent key of signer {signer} from every wallet, from {surface}. The machine that held it signs nothing more. Not you? Freeze now.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ⚠️ 已从 {surface} 用所有者密钥从所有钱包移除签名方 {signer} 的 Agent 密钥。持有它的机器无法再签名。不是你操作？请立即冻结。                                                                                |
| Send level change               | `notice.sendLevel`              | Send level {from} → {to} now; a looser level: Send level {from} → {to} at {when}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 转账级别 {from} → {to}，立即生效；更宽松的级别：转账级别 {from} → {to}，将于 {when} 生效                                                                                                                   |
| Send level change cancelled     | `notice.sendLevelCancelled`     | Send level change to {to} cancelled; it stays {level}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 已取消将转账级别改为 {to}，仍为 {level}                                                                                                                                                                    |
| Rescue stopped                  | `notice.rescueStopped`          | 🔴 A rescue stopped part way: the rescue address changed while it ran. What was not sent stays in the wallets. Check them, then start a rescue again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🔴 紧急转出中途停止：执行期间紧急转出地址已更改。未转出的资产仍在钱包中。请检查钱包，然后重新发起紧急转出。                                                                                                |
| Rescue address change           | `notice.rescueAddress`          | ⚠️ Rescue address changes to {address} at {when}. Not you? Cancel now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⚠️ 紧急转出地址将于 {when} 改为 {address}。不是你操作？请立即取消。                                                                                                                                        |
| Rescue address change cancelled | `notice.rescueAddressCancelled` | Rescue address change to {address} cancelled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 已取消将紧急转出地址改为 {address}                                                                                                                                                                         |
| Ceiling outdated                | `notice.ceilingOutdated`        | ⚠️ The wallets' ceilings still let sends pay {address}. Run `binference rescue set` with the owner key to update them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⚠️ 各钱包的上限仍允许向 {address} 转账。请用所有者密钥运行 `binference rescue set` 更新。                                                                                                                  |
| Plaintext secret                | `notice.plainSecret`            | ⚠️ A secret is written as plain text in config. Run `binference check --fix`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ⚠️ 配置文件中有明文密钥。请运行 `binference check --fix`。                                                                                                                                                 |
| Budget reached                  | `notice.budget`                 | {agent} used today's model budget ({budget}). Chat resumes {when}; orders keep running.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | {agent} 已用完今日模型预算（{budget}）。对话将于 {when} 恢复；自动订单继续运行。                                                                                                                           |
| Schedule set                    | `notice.scheduleSet`            | New schedule for {agent}, set {by, select, agent {by the agent} telegram {from Telegram} console {from the console} mini {from the Mini App} cli {from the CLI} other {in binference}}, next run {next}: {prompt}                                                                                                                                                                                                                                                                                                                                                                                                        | {agent} 有新的定时任务，{by, select, agent {由 Agent 自己设置} telegram {来自 Telegram} console {来自控制台} mini {来自 Mini App} cli {来自命令行} other {来自 binference}}，下次运行时间 {next}：{prompt} |
| Schedule cancelled              | `notice.scheduleCancelled`      | Schedule of {agent} cancelled {by, select, agent {by the agent} telegram {from Telegram} console {from the console} mini {from the Mini App} cli {from the CLI} other {in binference}}: {prompt}                                                                                                                                                                                                                                                                                                                                                                                                                         | {agent} 的定时任务已{by, select, agent {由 Agent 自己} telegram {从 Telegram} console {从控制台} mini {从 Mini App} cli {从命令行} other {在 binference 中}}取消：{prompt}                                 |
| Loop stopped                    | `notice.loop`                   | {agent} repeated the same step and was stopped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | {agent} 重复执行同一步骤，已停止                                                                                                                                                                           |
| Watcher behind                  | `notice.watcherLag`             | ⚠️ Prices on {chain} are read {blocks} blocks behind the chain, so auto orders may fill late. Add a paid RPC under `chains.rpc` in config.json5, or check this machine's network.                                                                                                                                                                                                                                                                                                                                                                                                                                        | ⚠️ {chain} 的价格读取落后链上 {blocks} 个区块，自动订单可能延迟成交。请在 config.json5 的 `chains.rpc` 中添加付费 RPC，或检查本机网络。                                                                    |
| Watcher has no price            | `notice.watcherUnpriced`        | ⚠️ Price watching on {chain} has no price for {count} watched tokens, {token} first, so their auto orders cannot trigger until a price returns. A price comes from a launchpad curve, or a PancakeSwap pool that trades at least $1,000 of WBNB or a stablecoin.                                                                                                                                                                                                                                                                                                                                                         | ⚠️ {chain} 的价格监控无法获取 {count} 个监控中代币的价格（首个为 {token}），在价格恢复之前，这些代币的自动订单无法触发。价格来自发射台联合曲线，或可交易至少 $1,000 WBNB 或稳定币的 PancakeSwap 交易池。   |
| Watcher stopped                 | `notice.watcherStopped`         | 🔴 Price watching on {chain} stopped on a fault and starts again by itself; auto orders there fill nothing until it does. Run `binference logs` to see why.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🔴 {chain} 的价格监控因故障停止，会自动重新启动；在此之前，该链上的自动订单不会成交。请运行 `binference logs` 查看原因。                                                                                   |
| Wallet trades cut               | `notice.walletOverflow`         | ⚠️ {wallet}'s trades in {blocks} blocks were too many to read; copy orders and alerts missed them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ⚠️ {wallet} 在 {blocks} 个区块中的交易过多，无法读取；跟单和提醒错过了这些交易。                                                                                                                           |
| Back online                     | `notice.resumed`                | {cause, select, wake {Engine paused {duration}} clock {The clock was set back {duration}} other {Engine was off {duration}}}: {checked} orders checked, {filled} filled, {skipped} skipped                                                                                                                                                                                                                                                                                                                                                                                                                               | {cause, select, wake {引擎暂停了 {duration}} clock {时钟被调回了 {duration}} other {引擎停止了 {duration}}}：已检查 {checked} 个订单，成交 {filled} 个，跳过 {skipped} 个                                  |
| Update available                | `notice.update`                 | binference {version} is out: {summary}. Run `binference update`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | binference {version} 已发布：{summary}。请运行 `binference update`。                                                                                                                                       |
| Backup failed                   | `notice.backupFailed`           | ⚠️ Last night's backup failed: {reason}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ⚠️ 昨晚的备份失败：{reason}                                                                                                                                                                                |
| Locked                          | `notice.locked`                 | 🔴 binference restarted and is locked. Run `binference unlock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 🔴 binference 已重启并处于锁定状态。请运行 `binference unlock`。                                                                                                                                           |
| Signer stopped                  | `notice.signerStopped`          | 🔴 The signer stopped, so binference signs nothing. Fix what `binference logs` shows, then run `binference unlock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔴 签名进程已停止，binference 不会签名。请先处理 `binference logs` 显示的问题，再运行 `binference unlock`。                                                                                                |
| Signer refused                  | `notice.signerRefused`          | ⚠️ The signer refused to sign a step of a trade: {rule}. Nothing was sent for it. ({rule} names the hard rule of spec 5, section 5.2, in plain words)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ⚠️ 签名进程拒绝为一笔交易的一个步骤签名：{rule}。该步骤未发送任何内容。                                                                                                                                    |
| Privy unreachable               | `notice.privyUnreachable`       | 🔴 binference could not reach Privy for five minutes after it started, so it stays locked. Check this machine's network, then run `binference unlock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 🔴 binference 启动后五分钟内都无法连接 Privy，因此仍处于锁定状态。请检查本机网络，然后运行 `binference unlock`。                                                                                           |
| Config refused                  | `notice.configInvalid`          | ⚠️ binference kept the settings it runs on: config.json5 {problem}. Run `binference check` to see the fix. ({problem} names the first problem: the line of a file it cannot read, or the key)                                                                                                                                                                                                                                                                                                                                                                                                                            | ⚠️ binference 保留了当前运行的设置：config.json5 {problem}。请运行 `binference check` 查看修复方法。                                                                                                       |
| Config reloaded                 | `notice.configChanged`          | Settings changed in config.json5: {changed}. They apply now, or: These apply after binference restarts: {afterRestart}. The rest apply now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | config.json5 中的设置已更改：{changed}。它们已立即生效，或：以下设置在 binference 重启后生效：{afterRestart}。其余已立即生效。                                                                             |
| Unknown transaction             | `notice.unknownTx`              | ⚠️ {wallet}'s nonce {nonce} was used by a transaction binference did not sign                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ⚠️ {wallet} 的随机数 {nonce} 被一笔非 binference 签名的交易占用                                                                                                                                            |
| Fill differs                    | `notice.fillDiffers`            | ⚠️ A trade settled more than 1% away from its simulation. Check the trade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ⚠️ 一笔交易的成交结果与模拟结果相差超过 1%，请核对该笔交易。                                                                                                                                               |
| Block shared                    | `notice.blockShared`            | ⚠️ Two trades of {wallet} landed in one block, so its positions and P&L may count the coin that block paid it twice. Check the wallet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⚠️ {wallet} 的两笔交易在同一个区块上链，持仓和盈亏可能把该区块转入的币重复计算。请检查钱包。                                                                                                               |
| Fill unknown                    | `notice.fillUnknown`            | ⚠️ A trade settled, but no RPC can say what it received any more. Add a tracing RPC to the config and restart binference to finish it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ⚠️ 一笔交易已上链，但已没有 RPC 能说明它收到了多少。请在配置中添加追踪 RPC 并重启 binference，以完成这笔交易的记录。                                                                                       |
| Not signed                      | `notice.notSigned`              | ⚠️ A trade was cancelled before its first transaction was signed. Nothing was sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ⚠️ 一笔交易在第一笔链上交易签名前已取消，未发送任何内容。                                                                                                                                                  |
| Confirmation lapsed             | `notice.confirmationLapsed`     | ⚠️ A trade was not sent: its confirmation ran out before it could go out. Nothing was signed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ⚠️ 一笔交易未发送：它的确认在发出之前已过期。未签名任何内容。                                                                                                                                              |
| Fee above cap                   | `notice.feeAboveCap`            | ⚠️ A trade waited because the network fee was above your cap, and its confirmation ran out. Confirm it again on its new card, or cancel it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ⚠️ 网络费高于你设定的上限，一笔交易一直在等待，它的确认已过期。请在新卡片上再次确认，或取消它。                                                                                                            |
| Launch unsent                   | `notice.launchUnsent`           | ⚠️ A trade on a launch's curve was not sent: {reason}. Nothing was signed. ({reason}: binference could not read the launch from its launchpad, or the launchpad no longer holds the token on that curve, as after its graduation; [decision 0218](../DECISIONS.md#d0218))                                                                                                                                                                                                                                                                                                                                                | ⚠️ 一笔在发射项目联合曲线上的交易未发送：{reason}。未签名任何内容。                                                                                                                                        |
| Launch stopped                  | `notice.launchStopped`          | ⚠️ The launch of {symbol} on {venue} stopped: {reason}. Nothing was signed, but its picture and words may be public on the launchpad (from a launchpad that uploads nothing: Nothing was signed or made public). Propose the launch again if you still want it. ({reason}: the launchpad could not pin its picture and words, or did not within 5 minutes; it stopped before its steps were ready; binference stopped before its card opened and its plan is too old; or the launchpad's steps failed a check; decisions [0234](../DECISIONS.md#d0234), [0237](../DECISIONS.md#d0237) and [0276](../DECISIONS.md#d0276)) | ⚠️ {symbol} 在 {venue} 的发射已停止：{reason}。未签名任何内容，但其图片和文字可能已在发射台公开（不上传任何内容的发射台：未签名任何内容，也没有公开任何内容）。如仍需要，请重新发起发射。                  |
| Step unsent                     | `notice.stepUnsent`             | ⚠️ A trade stopped part way: an earlier step landed on chain, but a later one was never signed. Check the wallet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ⚠️ 一笔交易中途停止：前面的步骤已上链，但后面的步骤从未签名。请检查钱包。                                                                                                                                  |
| Step dropped                    | `notice.stepDropped`            | ⚠️ A trade was stuck and did not go through. Nothing moved, and the wallet is free again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ⚠️ 一笔交易长时间未上链，没有完成。没有任何资产变动，钱包已可再次使用。                                                                                                                                    |
| Step dropped part way           | `notice.stepDroppedPartWay`     | ⚠️ A trade stopped part way: an earlier step landed on chain, but a later one was stuck and did not go through. The wallet is free again. Check the wallet.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ⚠️ 一笔交易中途停止：前面的步骤已上链，但后面的步骤长时间未上链，没有完成。钱包已可再次使用。请检查钱包。                                                                                                  |
| Dropped step landed             | `notice.droppedLanded`          | 🔴 A trade binference reported as stuck went through after all. binference has now counted it toward your limits and positions. Check the wallet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🔴 一笔 binference 报告为长时间未上链的交易最终还是上链了。binference 已把它计入你的限额和持仓。请检查钱包。                                                                                               |
| Wallet held                     | `notice.walletHeld`             | ⚠️ A transaction of {wallet} is stuck, so the wallet's later trades wait behind it. binference keeps sending it until a block holds it or every relay drops it.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ⚠️ {wallet} 的一笔链上交易卡住了，该钱包之后的交易都在其后等待。binference 会继续发送它，直到区块收录它或所有中继都丢弃它。                                                                                |
| Binance agent refused           | `notice.binanceRefused`         | ⚠️ {agent} tried a trade over its limit: {trade}. Refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ⚠️ {agent} 尝试了超出限额的交易：{trade}。已拒绝。                                                                                                                                                         |
| Binance agent paused            | `notice.binancePaused`          | {agent} paused from {surface}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 已从 {surface} 暂停 {agent}                                                                                                                                                                                |
| Approval mode                   | `notice.approvalMode`           | {agent} is now in {mode} mode, from {surface}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | {agent} 已切换为{mode}模式，来自 {surface}                                                                                                                                                                 |

**Daily summary** (`notice.daily`, [decision 0273](../DECISIONS.md#d0273)), at 09:00 owner time
or the agent's own time: total value and its 24-hour change, realized P&L, fills, skipped fills,
open orders, model spend, and anything waiting for the owner, over the 24 hours before it. It goes
once per agent and owner's date, a summary missed while the engine was off at the first run of the
same date, and none for an agent with nothing to tell: no live funds, no trade, fill, skip or
model spend in the 24 hours, no open order and nothing waiting. Live and paper each get a line; a line with
nothing to tell is left out, and each skip reason, the most frequent first, follows on a line of
its own, at most four. A summary takes at most twelve lines; the skip reasons take what is left.

| Line                | Key                               | English                                                                                                                                                                                                                                                                              | Chinese                                                                                                                                                                                     |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First line          | `notice.daily`                    | Daily summary for {agent}, the last 24 hours                                                                                                                                                                                                                                         | {agent} 的每日摘要（过去 24 小时）                                                                                                                                                          |
| Live, paper         | `daily.value`                     | 🔴 Live: {value}, {change} in 24 hours; realized P&L {realized} · 🧪 Paper: … · 🔴 Live: the balances could not be read now; realized P&L {realized}                                                                                                                                 | 🔴 实盘：{value}，24 小时变化 {change}；已实现盈亏 {realized} · 🧪 模拟：… · 🔴 实盘：暂时无法读取余额；已实现盈亏 {realized}                                                               |
| Auto orders         | `daily.orders`                    | Auto orders: {filled} filled, {skipped} skipped, {open} open                                                                                                                                                                                                                         | 自动订单：已成交 {filled} 次，跳过 {skipped} 次，挂单 {open} 个                                                                                                                             |
| Model spend         | `daily.spend`                     | Model spend: {spend}, against a daily model budget of {budget}                                                                                                                                                                                                                       | 模型花费：{spend}，每日模型预算 {budget}                                                                                                                                                    |
| Waiting for you     | `notice.daily`                    | {n} cards wait for your answer · The agent waits for your answer to its question · {n} looser limits take effect within 24 hours · {n} wallets wait behind stuck transactions · A looser send level takes effect within 24 hours · A new rescue address takes effect within 24 hours | {n} 张卡片等你回复 · Agent 在等你回答它的问题 · {n} 项放宽的限额将在 24 小时内生效 · {n} 个钱包因链上交易卡住而等待 · 放宽的转账级别将在 24 小时内生效 · 新的紧急转出地址将在 24 小时内生效 |
| Skips, by reason    | `daily.skips`, `daily.skipsOther` | {count} skips: {reason} · {count} skips for other reasons                                                                                                                                                                                                                            | 跳过 {count} 次：{reason} · 因其他原因跳过 {count} 次                                                                                                                                       |
| A cap's skip reason | `daily.overCap`                   | it would pass your 24-hour cap · it would pass a leader's daily cap                                                                                                                                                                                                                  | 将超过你的 24 小时上限 · 将超过该带单钱包的每日上限                                                                                                                                         |

**On by default.** A new agent gets [decision 0057](../DECISIONS.md#d0057)'s set, and, accepted by
the owner on 2026-10-12, every notice of sections 4.2 and 4.3 as well: the alert notices (price,
wallet and launch alerts, with their wake-up lines), the exit order notices, and the update
notices. The owner set each alert, so its notice is what it is for; the update notices carry the
release notes and the rollback. `defaults.notifications` ([spec 2](config.md#section-6-4)) holds
the set, and each kind can be turned off per agent.

**Muting** ([decision 0185](../DECISIONS.md#d0185)). An agent may mute `fill`, `skipped`,
`lowGas`, `orderExpiring`, `daily`, the alert notices (`alertPrice`, `alertWallet`,
`alertLaunch`, `alertHeld`), the exit order notices (`ordersEnded`, `exitEnded`) and the update notices
(`update`, `updateBare`, `updated`, `updatedBare`) with `notice/setSettings`. Every other notice
always goes: it tells of a security event, of a trade or money that needs a look, of the engine
or the agent stopping, or of a schedule that wakes the agent set or cancelled
([decision 0233](../DECISIONS.md#d0233)). A muted notice is still stored and listed by `notice/list`, and no surface
sends it. A notice that names no agent is muted only when every agent muted its kind.

**In Telegram** ([decision 0186](../DECISIONS.md#d0186)). With `telegram.topicsPerAgent` on and
the bot's topics in private chats turned on at BotFather, a notice about an agent goes to the
agent's topic, made the first time with the agent's name. Otherwise, and for a notice whose words do
not name the agent, the agent's name comes first: `telegram.notice.agent`, "{agent} · {notice}" /
「{agent} · {notice}」. A notice that names no agent goes to the chat itself.

**Parts.** `{orderKind}` is `order.kind`, the kind's name as `/orders` words it: "{kind, select,
limit {Limit order} takeProfit {Take-profit} stopLoss {Stop-loss} trailing {Trailing stop} dca
{DCA} copy {Copy trade} other {Auto order}}" / 「{kind, select, limit {限价单} takeProfit {止盈}
stopLoss {止损} trailing {追踪止损} dca {定投} copy {跟单} other {自动订单}}」. A notice carries such
arguments as parts, each a key with its own arguments, which a surface writes in the owner's
language before the notice (spec 1, section 6).

<a id="section-4-1"></a>

### 4.1 Browser push

A console device that turned browser notifications on gets one when a card version opens and when
it closes, so the owner can answer with Telegram closed
([decision 0158](../DECISIONS.md#d0158)). The engine writes the words in the owner's language; the
message names the intent and the card only, never an amount, an address, a token or an agent. A
click opens the console at the card. The second message takes the first one's place.

| Moment      | Key                    | English                                              | 中文                             |
| ----------- | ---------------------- | ---------------------------------------------------- | -------------------------------- |
| Card opens  | `webPush.opened.title` | A card waits for your answer                         | 有一张卡片在等你回复             |
|             | `webPush.opened.body`  | Open the console to read it, then confirm or cancel. | 打开控制台查看，然后确认或取消。 |
| Card closes | `webPush.closed.title` | This card no longer waits                            | 这张卡片已不再等待               |
|             | `webPush.closed.body`  | It was answered or it expired.                       | 它已被回复或已过期。             |

<a id="section-4-2"></a>

### 4.2 Update notes

The daily update check reads each release's notes in both languages (`update/check`'s
`releaseNotes`, spec 1 section 7.9): at most 5 lines of at most 200 characters in each, written for
owners, saying what changed for them; never commit subjects. `{summary}` is the lines in the
owner's language, each on its own line in Telegram and the console; `notice.update` (section 4)
takes it too. A release without notes in the owner's language gets the notice without them, never
the other language's lines.

| Notice            | Key                       | English                                                                                                                                              | 中文                                                                                                   |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Without notes     | `notice.updateBare`       | binference {version} is out. Run `binference update`.                                                                                                | binference {version} 已发布。请运行 `binference update`。                                              |
| Updated           | `notice.updated`          | binference is now {version}. What changed: {summary}                                                                                                 | binference 已更新到 {version}。更新内容：{summary}                                                     |
| Updated, no notes | `notice.updatedBare`      | binference is now {version}.                                                                                                                         | binference 已更新到 {version}。                                                                        |
| Rolled back       | `notice.updateRolledBack` | ⚠️ binference {version} failed its check after the update, so binference went back to {previous}. Your settings and records are as they were before. | ⚠️ binference {version} 更新后未通过检查，binference 已回退到 {previous}。你的设置和记录与更新前一致。 |

- `notice.update` goes out once per version and channel, the day the check first sees it.
- `notice.updated` goes out once, when the new version first starts after `binference update`;
  `notice.updateRolledBack` goes out instead when `update` put the previous version back.

<a id="section-4-3"></a>

### 4.3 Alerts, the launch feed, fills and exits

Token names and symbols in these lines are escaped as section 1 says; a token from the launch feed
is never verified, so its short address always follows its symbol.

| Message                   | Key                       | English                                                                                                                                                                                                         | 中文                                                                                                                                                            |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price alert               | `notice.alertPrice`       | {token} is {direction, select, above {at or above} other {at or below}} {price}: now {now}                                                                                                                      | {token} 价格{direction, select, above {达到或高于} other {达到或低于}} {price}：现价 {now}                                                                      |
| Wallet alert              | `notice.alertWallet`      | {wallet} {side, select, buy {bought {amount} for {value}} other {sold {amount}, {share} of its holding, for {value}}}                                                                                           | {wallet} {side, select, buy {用 {value} 买入 {amount}} other {卖出 {amount}（占其持仓的 {share}），收到 {value}}}                                               |
| Launch alert              | `notice.alertLaunch`      | New launch passed your filters: {launch}                                                                                                                                                                        | 有新发射的代币通过了你的筛选条件：{launch}                                                                                                                      |
| Matches held back         | `notice.alertHeld`        | {count, plural, one {# more match} other {# more matches}} this hour, see the console                                                                                                                           | 本小时另有 {count, plural, other {# 次匹配}}，请在控制台查看                                                                                                    |
| Copy skips held back      | `notice.copyHeld`         | {count, plural, one {# more copy trade} other {# more copy trades}} skipped this hour, see the console                                                                                                          | 本小时另有 {count, plural, other {# 笔跟单交易}}被跳过，请在控制台查看                                                                                          |
| Woke the agent            | `alert.woke`              | {agent} is looking into it.                                                                                                                                                                                     | {agent} 正在查看。                                                                                                                                              |
| Wake-ups held back        | `alert.wakeSkipped`       | {count, plural, one {# more match} other {# more matches}} did not wake {agent}: at most 10 wake-ups an hour.                                                                                                   | 另有 {count} 个匹配未唤醒 {agent}：每小时最多唤醒 10 次。                                                                                                       |
| Launch feed line          | `launch.line`             | {token} · {launchpad} · {age} ago · {curve} · tax {tax} · {insiders, plural, =0 {no insider wallets} one {# insider wallet} other {# insider wallets}} · creator's other launches in 30 days: {creatorLaunches} | {token} · {launchpad} · {age}前 · {curve} · 交易税 {tax} · {insiders, plural, =0 {无内部钱包} other {# 个内部钱包}} · 创建者 30 天内其他发射：{creatorLaunches} |
| Curve state               | `launch.curve`            | {graduated, select, yes {graduated} other {curve {progress}}}                                                                                                                                                   | {graduated, select, yes {已毕业} other {曲线进度 {progress}}}                                                                                                   |
| Launch age                | `launch.age`              | {unit, select, minute {{count} min} hour {{count} h} other {{count} d}}                                                                                                                                         | {unit, select, minute {{count} 分钟} hour {{count} 小时} other {{count} 天}}                                                                                    |
| Buy fill                  | `fill.buy`                | bought {amount} for {spent} at {price}                                                                                                                                                                          | 以 {price} 用 {spent} 买入 {amount}                                                                                                                             |
| Sell fill                 | `fill.sell`               | sold {amount} for {received} at {price}                                                                                                                                                                         | 以 {price} 卖出 {amount}，收到 {received}                                                                                                                       |
| Copied buy                | `fill.copyBuy`            | copied {leader}: bought {amount} for {spent}                                                                                                                                                                    | 跟单 {leader}：用 {spent} 买入 {amount}                                                                                                                         |
| Copied sale               | `fill.copySell`           | copied {leader} selling {share}: sold {amount} for {received}                                                                                                                                                   | 跟单 {leader} 卖出 {share}：卖出 {amount}，收到 {received}                                                                                                      |
| Copied sale, late         | `fill.copySellLate`       | copied {leader} selling {share} at {when}, late, at the price now: sold {amount} for {received}                                                                                                                 | 跟单 {leader} 于 {when} 卖出的 {share}，延后以当前价格执行：卖出 {amount}，收到 {received}                                                                      |
| Copy buy, risk warned     | `fill.copyRiskWarn`       | ⚠️ The risk check warned about this token{flags, select, none {} other { ({flags})}}; the order's caps bound what a copy can lose.                                                                              | ⚠️ 风险检查对该代币发出了警告{flags, select, none {} other {（{flags}）}}；订单的上限限制了跟单可能的损失。                                                     |
| Other exits ended         | `notice.ordersEnded`      | {orderKind} sold all your {token}, so {count, plural, one {your other exit order on it ended} other {your # other exit orders on it ended}}                                                                     | {orderKind}已卖出你持有的全部 {token}，该持仓的其他 {count} 个平仓订单已结束                                                                                    |
| Exit on an empty position | `notice.exitEnded`        | {orderKind} on {token} ended: the wallet holds none of it any more                                                                                                                                              | {token} 的{orderKind}已结束：钱包中已没有这种代币                                                                                                               |
| Copy cap reached          | `reason.copy_daily_cap`   | it would pass this leader's daily cap ({used} of {cap} used)                                                                                                                                                    | 将超过该带单钱包的每日上限（已用 {used}，上限 {cap}）                                                                                                           |
| Copied trade, skipped     | `fill.copyTrade`          | Copy trade of {leader}'s {side, select, buy {buy} other {sale}} of {token}                                                                                                                                      | 跟单 {leader} {side, select, buy {买入} other {卖出}} {token} 的交易                                                                                            |
| Share not read            | `reason.share_unread`     | the share of its holding the leader sold could not be read                                                                                                                                                      | 无法读取带单钱包卖出的持仓比例                                                                                                                                  |
| Token not read            | `reason.token_unreadable` | the token's contract did not give its symbol and decimals                                                                                                                                                       | 该代币合约未返回其符号和小数位数                                                                                                                                |
| Leader not valued         | `reason.leader_unpriced`  | the leader's buy could not be valued in dollars                                                                                                                                                                 | 无法以美元估值带单钱包的这笔买入                                                                                                                                |
| Sale given up             | `reason.copy_sale_lapsed` | the leader's sale could not be mirrored within an hour of it; the order still holds the token                                                                                                                   | 在带单钱包卖出后一小时内未能跟随卖出；订单仍持有该代币                                                                                                          |
| Copy too small            | `reason.copy_too_small`   | the copy would buy less than $5                                                                                                                                                                                 | 跟单买入金额将低于 $5                                                                                                                                           |
| Copies an hour            | `reason.copy_hourly`      | this copy order bought 10 times in the last hour                                                                                                                                                                | 该跟单订单在过去一小时内已买入 10 次                                                                                                                            |
| Nothing to sell           | `reason.nothing_to_sell`  | the wallet holds too little of this token                                                                                                                                                                       | 钱包中这种代币不足                                                                                                                                              |
| Skips of a reason         | `resume.skips`            | {count} skipped: {reason}                                                                                                                                                                                       | 跳过 {count} 个：{reason}                                                                                                                                       |
| Other skips               | `resume.other`            | {count} skipped for other reasons                                                                                                                                                                               | 因其他原因跳过 {count} 个                                                                                                                                       |
| Under a minute            | `resume.underMinute`      | under a minute                                                                                                                                                                                                  | 不到 1 分钟                                                                                                                                                     |
| Trigger not met now       | `reason.trigger_not_met`  | the price now does not reach its trigger price; the order waits on                                                                                                                                              | 当前价格未达到其触发价格；订单继续等待                                                                                                                          |
| Waits to re-arm           | `reason.rearming`         | it filled before and fires again once its price has left the trigger price and come back                                                                                                                        | 它此前已成交，价格离开触发价格再回来后才会再次触发                                                                                                              |
| Behind another fill       | `reason.behind_fill`      | it waited behind another fill of the agent or after its last skips; a later price fires it again                                                                                                                | 它在该 Agent 的另一笔成交之后或最近几次跳过之后等待；之后的价格会再次触发它                                                                                     |
| Sent, not settled         | `resume.sent`             | {count} sent and not settled yet                                                                                                                                                                                | 已发送 {count} 笔，尚未结算                                                                                                                                     |
| No fresh price            | `reason.no_fresh_price`   | no price of its token was read after binference came back                                                                                                                                                       | binference 恢复后未读到该代币的价格                                                                                                                             |
| Position sold             | `reason.position_closed`  | its position was already sold                                                                                                                                                                                   | 其持仓已卖出                                                                                                                                                    |
| Price before a pause      | `reason.price_stale`      | the price it fired at was read before binference paused; it waits for a new price                                                                                                                               | 触发它的价格是在 binference 暂停前读取的；它会等待新的价格                                                                                                      |

- `notice.fill` and `notice.skipped` (section 4) take `{result}` from `fill.*` and `{reason}` from
  `reason.*`. A copy order's skip takes `{orderKind}` from `fill.copyTrade`, which names the
  leader's trade and its token ([decision 0260](../DECISIONS.md#d0260)). Every copy skip is told,
  at most five an hour per copy order, counted as an alert's notices are; the rest are told in one
  `notice.copyHeld` when the hour ends or before the next hour's first skip, and a mute of
  `skipped` mutes it too. A paper fill's notice starts with 🧪, as its receipt does: its `mode` is `paper`.
- An alert's notice is followed by `alert.woke` when it started a turn, and by `alert.wakeSkipped`
  when wake-ups were held back that no notice told yet (spec 1, section 8.4).
- One alert sends at most five notices an hour, from its first; its later matches in that hour
  are counted and told once, in `notice.alertHeld`, when the hour ends or with the first notice
  of its next hour ([decision 0245](../DECISIONS.md#d0245)). `{age}` of `launch.line` is
  `launch.age`, the launch's age in minutes within the hour, hours within two days, else days.
- `{wallet}` and `{leader}` are the address book label, else the short address.
- `notice.resumed` goes out once per resume, after a start, a pause of the engine (as when the
  machine slept) or its clock set back, when the re-check checked at least one order; a resume
  with none stays silent ([decision 0267](../DECISIONS.md#d0267)). `{cause}` is `start`, `wake` or
  `clock`, and `{duration}` is `pnl.days`, `pnl.hours` or `pnl.minutes`, else
  `resume.underMinute`. A line `resume.sent` for live fills sent and not settled comes
  first, then up to three `resume.skips` lines in all, one per skip reason, the commonest
  first, then one `resume.other` with the rest. The skip of the fill a re-check's own first
  judgment started, and a DCA or copy order's first skip of the downtime, are told in it alone;
  every other skip keeps its own `notice.skipped`.
  `{creatorLaunches}` is a number.
- The console's launch list shows each launch with the launch feed line.

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
| `/use`       | `cmd.use`       | Picks the agent the chat talks to, by name or id                |
| `/limits`    | `cmd.limits`    | The agent's limits; a button halves a cap or a slippage limit   |
| `/status`    | `cmd.status`    | Engine state, mode, frozen or not, health                       |
| `/spend`     | `cmd.spend`     | Model spend today and this month against the budget             |
| `/ai`        | `cmd.ai`        | The agent's models, with buttons to pick another configured one |
| `/clear`     | `cmd.clear`     | Starts a new chat session                                       |
| `/schedules` | `cmd.schedules` | Schedules with buttons to cancel                                |
| `/console`   | `cmd.console`   | A button that opens the Mini App                                |
| `/lang`      | `cmd.lang`      | Buttons: English, 中文                                          |
| `/help`      | `cmd.help`      | The commands, one line each                                     |

Command descriptions are registered with `setMyCommands` in both languages (`language_code`).

`/orders` writes a copy order, which trades every token its leader trades, as its leader and its
dollars per buy, `cmd.orders.copyItem` with `cmd.orders.copy`: "Copy trade · copying {leader} at up
to {perBuy} a buy · {fills} · ends {expiry}", instead of a side and a token
([decision 0261](../DECISIONS.md#d0261)).

`/positions` shows each position as its P&L card ([section 3.7](#section-3-7)), open ones first,
then the positions closed in the last 7 days, for every agent not archived. Live positions come
first under `cmd.positions.section`, "🔴 Live positions" / 「🔴 实盘持仓」, paper ones after them under
"🧪 Paper positions" / 「🧪 模拟持仓」, never added together ([decision 0134](../DECISIONS.md#d0134)).
Cards are separated by a blank line, and a message holds as many whole cards as fit in 4,096 characters,
so no card is split. With none: "No positions yet." / 「还没有持仓。」

A `/limits` button halves the per-trade cap, the 24-hour cap, or the slippage limit on verified or
other tokens, rounding down: "Halve the per-trade cap" / 「单笔上限减半」. Half is always stricter,
so it applies at once through `limit/set` and is announced like any limit change
([decision 0111](../DECISIONS.md#d0111)); a second tap halves it again, and a limit at zero has no
button. Nothing in Telegram loosens a limit.

A `/lang` button names its language in that language, the same in every language: `English`,
`中文`. A tap sets `owner.locale` in config.json5 through `config/change`, the one setting the
owner's chat changes ([decision 0134](../DECISIONS.md#d0134)), and answers in the new language:
"binference uses Chinese with you now." / 「binference 现在与你沟通使用中文。」 The live reload journals
the change and announces it on every surface.

Topics stay off ([decision 0186](../DECISIONS.md#d0186)), so one chat serves every agent. With one
agent not archived the chat talks to it; `/use <name or id>` picks another, and the pick outlasts a
restart. While more than one agent is not archived, each answer and status line of an agent starts
with its name: "{agent} · {text}" ([decision 0204](../DECISIONS.md#d0204)). `/ai` shows the main
and fast models the agent uses now, with one button per configured model; a tap sets it for the
`main` role through `model/set`, and the configured `models.main` brings its fallbacks back.
`/schedules` says when no schedule is set.

`/console` sends one button, "Open the console" / 「打开控制台」, that opens the Mini App at
`remote.publicUrl` followed by `/mini` ([spec 2, section 6.6](config.md#section-6-6)), with a new
single-use launch ticket in the fragment, `#ticket=<ticket>`, valid 5 minutes
([decision 0161](../DECISIONS.md#d0161)). Telegram opens a Mini App only from an HTTPS address,
and only in a private chat. Without that address the
reply has no button and says how to set it: "The console opens inside Telegram only from an HTTPS
address, and binference has none yet. Publish binference's port over HTTPS, …" /
「控制台只能从 HTTPS 地址在 Telegram 中打开，而 binference 还没有这样的地址。请先通过 HTTPS 发布 binference 的端口，…」

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
| question (the agent asks the owner)                | 问题                         |
| status line                                        | 状态行                       |
| first chat                                         | 初次对话                     |
| disclaimer, privacy statement                      | 免责声明, 隐私声明           |
| release notes, roll back (an update)               | 更新说明, 回退               |
| price alert, wallet alert, launch alert            | 价格提醒, 钱包提醒, 发射提醒 |
| exit order                                         | 平仓订单                     |
| P&L card                                           | 盈亏卡片                     |
| share (of a holding)                               | 持仓比例                     |
| DEX pools                                          | DEX 交易池                   |
| venue fee                                          | 平台手续费                   |
| launch feed, curve progress, snipe tax             | 发射动态, 曲线进度, 狙击税   |
| insider wallets, creator (of a token)              | 内部钱包, 创建者             |
| trending (tokens), chart, candle                   | 热门, K 线图, K 线           |
| leader wallet, tracked wallet                      | 带单钱包, 关注的钱包         |

<a id="section-8"></a>

## 8. The agent's chat

<a id="section-8-1"></a>

### 8.1 Status lines

The one line a turn ends with when the owner should know why
([spec 8, section 4.4](runtime.md#section-4-4)). The runtime sends the key with `turn/status`
(spec 1, section 7.7); each surface shows it under the agent's last message, in a quieter style
than the agent's words (italics in Telegram).

| When                                 | Key                           | English                                                                                                                                                                              | 中文                                                                                                                                                 |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A proposal waits for the owner       | `turn.proposalWaits`          | 🟡 Waiting for your answer on its card                                                                                                                                               | 🟡 等待你在卡片上回复                                                                                                                                |
| Proposals held back                  | `turn.moreProposals`          | {count, plural, one {One more proposal follows} other {# more proposals follow}} once you answer this card                                                                           | 你回复此卡片后，还会有 {count, plural, other {# 个提议}}                                                                                             |
| The budget is spent                  | `turn.budget`                 | Chat paused until {when}: today's model budget is spent. Orders keep running.                                                                                                        | 对话暂停至 {when}：今日模型预算已用完。自动订单继续运行。                                                                                            |
| Stopped                              | `turn.stopped`                | Stopped. Anything you already confirmed still goes through.                                                                                                                          | 已停止。你已确认的操作仍会执行。                                                                                                                     |
| Stopped, a proposal's card open      | `turn.stoppedCardOpen`        | 🟡 Stopped. The card of its proposal is still open: answer it there.                                                                                                                 | 🟡 已停止。其提议的卡片仍待处理，请在卡片上回复。                                                                                                    |
| 25 tool calls                        | `turn.toolCallLimit`          | Stopped: this answer reached its limit of 25 tool calls. Ask again to go on.                                                                                                         | 已停止：本次回答已达到 25 次工具调用上限。请再次提问以继续。                                                                                         |
| 40 model calls                       | `turn.modelCallLimit`         | Stopped: this answer reached its limit of 40 model calls. Ask again to go on.                                                                                                        | 已停止：本次回答已达到 40 次模型调用上限。请再次提问以继续。                                                                                         |
| The loop guard                       | `turn.loop`                   | Stopped: the agent repeated the same step three times.                                                                                                                               | 已停止：Agent 连续三次重复同一步骤。                                                                                                                 |
| Failed, `transient`                  | `turn.failed.transient`       | The model provider did not answer, even after retries. Try again in a minute.                                                                                                        | 多次重试后模型服务商仍未回答。请稍后再试。                                                                                                           |
| Failed, `context`                    | `turn.failed.context`         | This chat is too long to go on. Send /clear to start a new one; your notes and strategy stay.                                                                                        | 此对话过长，无法继续。请发送 /clear 开始新对话；你的笔记和策略会保留。                                                                               |
| Failed, `auth`                       | `turn.failed.auth`            | The model provider refused the key. Run `binference check` on the machine.                                                                                                           | 模型服务商拒绝了密钥。请在本机运行 `binference check`。                                                                                              |
| Failed, `billing`                    | `turn.failed.billing`         | The model key reached its spending limit. Raise it with the provider, or pick another model with /ai.                                                                                | 模型密钥已达到消费上限。请在服务商处提高上限，或用 /ai 选择其他模型。                                                                                |
| Failed, `request`                    | `turn.failed.request`         | The model provider refused the request. Pick another model with /ai, or run `binference check`.                                                                                      | 模型服务商拒绝了该请求。请用 /ai 选择其他模型，或运行 `binference check`。                                                                           |
| Failed, `refused`                    | `turn.failed.refused`         | The model stopped under its provider's own safety rules.                                                                                                                             | 模型按其服务商自身的安全规则停止了回答。                                                                                                             |
| Failed, `aborted`                    | `turn.failed.aborted`         | Stopped before the answer was complete.                                                                                                                                              | 回答完成前已停止。                                                                                                                                   |
| Failed, the 10 minutes               | `turn.failed.timeLimit`       | Stopped: this answer ran for 10 minutes. Ask again to go on.                                                                                                                         | 已停止：本次回答已运行 10 分钟。请再次提问以继续。                                                                                                   |
| Failed, a proposal's outcome unknown | `turn.failed.proposalUnknown` | ⚠️ binference did not hear back about a proposal, so it was not sent again. Check your open cards.                                                                                   | ⚠️ binference 未收到某个提议的结果，因此没有再次发送。请查看你未处理的卡片。                                                                         |
| Failed, the engine                   | `turn.failed.engine`          | Stopped: the agent lost its link to the engine. It starts again by itself.                                                                                                           | 已停止：Agent 与引擎的连接中断。它会自动重新启动。                                                                                                   |
| A message holds over 4 images        | `turn.image.tooMany`          | Not read: a message takes at most {count} images. Send the rest in another message.                                                                                                  | 未读取：每条消息最多 {count} 张图片。请在另一条消息中发送其余图片。                                                                                  |
| An image is over 5 MiB               | `turn.image.tooLarge`         | Not read: an image is over the {mib} MiB limit. Send a smaller one.                                                                                                                  | 未读取：有图片超过 {mib} MiB 的上限。请发送更小的图片。                                                                                              |
| An image in another format           | `turn.image.format`           | Not read: only PNG, JPEG and WebP images can be read. Send the image in one of these formats.                                                                                        | 未读取：只能读取 PNG、JPEG 和 WebP 图片。请以其中一种格式发送图片。                                                                                  |
| An image binference cannot fetch     | `turn.image.unreadable`       | Not read: binference could not fetch an image. Send it again.                                                                                                                        | 未读取：binference 无法获取图片。请重新发送。                                                                                                        |
| No model reads the image             | `turn.image.noVision`         | Not read: the agent's model cannot read images and no vision model is set. Set `models.vision` in config.json5, or list the model in `models.imageInput`, then send the image again. | 未读取：Agent 的模型无法读取图片，且未设置视觉模型。请在 config.json5 中设置 `models.vision`，或将该模型列入 `models.imageInput`，然后重新发送图片。 |
| The first chat is done               | `turn.firstChatDone`          | Saved your answers to STRATEGY.md and PERSONA.md. Ask the agent to change them any time.                                                                                             | 你的回答已保存到 STRATEGY.md 和 PERSONA.md。你可以随时让 Agent 修改。                                                                                |

- `{count}` is the number of propose calls held back (`turns.held_back`); `turn.moreProposals`
  goes out with `turn.proposalWaits`, after it.
- `{when}` is `resumesAt` in the owner's timezone, as a time today or tomorrow.
- A proposal whose outcome is unknown after a restart ([spec 8, section 2.4](runtime.md#section-2-4))
  gets `turn.failed.proposalUnknown` too.
- The loop guard also sends `notice.loop` (section 4); the status line says it in the chat.
- A turn stopped after the engine took its proposal ends with `turn.stoppedCardOpen` in place of
  `turn.stopped` ([decision 0173](../DECISIONS.md#d0173)).
- `{count}` in `turn.image.tooMany` is 4 and `{mib}` in `turn.image.tooLarge` is 5, the limits of
  spec 1 section 7.7. A `turn.image.*` line ends a turn that called no model: its images are
  checked before the first model call ([decision 0227](../DECISIONS.md#d0227)).
- A turn the runtime repairs after a restart with no proposal in doubt gets `turn.failed.engine`,
  and a committed turn whose proposal the engine refused gets no line: its settle message starts
  the turn that reports it ([decision 0174](../DECISIONS.md#d0174)).

<a id="section-8-2"></a>

### 8.2 The agent's questions

A question from `ask_owner` (spec 1, section 7.7) is the agent's words, escaped like the "Agent
says" line and cut to 500 characters, under a fixed header, with one button per choice:

```text
main asks
Which exit should I set for PEPE first?
[ Take-profit at +50% ]  [ Stop-loss at -20% ]
[ Both, one after the other ]
Or write your own answer.
```

```text
main 想问你
PEPE 先设置哪种平仓方式？
[ +50% 止盈 ]  [ -20% 止损 ]
[ 两个都要，依次设置 ]
也可以直接输入你的回答。
```

| Line               | Key                      | English                                                                                                                       | 中文                                                                                                  |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Header             | `question.header`        | {agent} asks                                                                                                                  | {agent} 想问你                                                                                        |
| Typed answers      | `question.typeHint`      | Or write your own answer.                                                                                                     | 也可以直接输入你的回答。                                                                              |
| Answered           | `question.answered`      | Answered: {choice}                                                                                                            | 已回答：{choice}                                                                                      |
| Answered by text   | `question.answeredTyped` | Answered in the chat                                                                                                          | 已在对话中回答                                                                                        |
| Closed             | `question.closed`        | Closed: {reason, select, replaced {{agent} asked a newer question} cleared {the chat was cleared} other {it waited 24 hours}} | 已关闭：{reason, select, replaced {{agent} 提出了新问题} cleared {对话已清空} other {已等待 24 小时}} |
| Closed, on a press | `question.closedToast`   | This question is closed.                                                                                                      | 此问题已关闭。                                                                                        |

- The choices are the agent's labels, escaped, at most 64 characters each, never with a status
  icon (spec 1 refuses one). Telegram puts two buttons on a row when both labels are 20
  characters or less, else one; the console draws them as plain buttons, never in a card's
  Confirm or Cancel style.
- When the question closes, every copy is edited: the buttons go away and the last line becomes
  `question.answered`, `question.answeredTyped` or `question.closed`.

<a id="section-8-3"></a>

### 8.3 The first chat

New agents start in paper mode, and the first chat learns how the owner trades
([decision 0061](../DECISIONS.md#d0061)).

- **The welcome.** When Telegram pairing finishes, and for each agent created after it, binference
  itself, not the model, sends `firstChat.welcome` once in that agent's chat.
- **The questions.** `FIRST-CHAT.md` is made at the agent's creation in the owner's language with
  the eight questions below, and the agent follows it on the owner's first message. The owner's
  own request always comes first: when the first message asks for something, the agent does that,
  and asks the questions after. It asks one question at a time, with `ask_owner` buttons where the
  answer is a choice. "Skip" or 「跳过」 ends the questions, and the agent writes what it has.
- **The end.** The agent writes `STRATEGY.md` and `PERSONA.md` from the answers and removes
  `FIRST-CHAT.md`; the turn that removes it ends with `turn.firstChatDone`. It writes only from a
  turn whose context holds no outside content, and a live agent never runs the first chat
  ([decision 0242](../DECISIONS.md#d0242)).
- **Limits stay out of chat.** No answer sets a limit: the budget answer guides the strategy only,
  and limits change in the CLI or the console.

| Key                 | English                                                                                                                                                                                                                                                 | 中文                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firstChat.welcome` | Hi, I'm {agent}, your trading agent. I'm in paper mode: nothing I do uses real money until you go live. To trade the way you like, I'll ask you about 8 short questions when you write to me. If you want something first, ask; the questions can wait. | 你好，我是 {agent}，你的交易 Agent。我现在处于模拟模式：在你切换到实盘之前，我的任何操作都不会动用真实资金。为了按你的方式交易，你给我发消息后，我会问你大约 8 个简短的问题。如果你想先让我做别的事，直接告诉我，问题可以稍后再答。 |

The questions of `FIRST-CHAT.md`, in this order:

| #   | Topic        | English                                                                                                                          | 中文                                                                                                             |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Budget       | How much of your money is for me to trade, and how much at most in one trade?                                                    | 你打算交给我交易多少资金？单笔交易最多用多少？                                                                   |
| 2   | Holding time | How long do you like to hold a token: minutes, hours, days or weeks?                                                             | 你通常持有一个代币多久：几分钟、几小时、几天还是几周？                                                           |
| 3   | Sectors      | Which tokens interest you: new launches on Flap, four.meme, Genius.fun or Brew, memes, AI tokens, large caps, or something else? | 你对哪些代币感兴趣：Flap、four.meme、Genius.fun 或 Brew 上的新发射代币、Meme 币、AI 代币、大市值代币，还是其他？ |
| 4   | Entries      | What makes a token worth buying for you?                                                                                         | 什么样的代币值得你买入？                                                                                         |
| 5   | Exits        | When should I sell: at what gain should I take profit, and at what loss should I cut it?                                         | 什么时候卖出：涨多少止盈，跌多少止损？                                                                           |
| 6   | Never        | Which tokens or kinds of tokens should I never touch?                                                                            | 哪些代币或哪类代币我绝对不要碰？                                                                                 |
| 7   | When to ask  | When should I ask you first, and when may I act within your limits without asking?                                               | 什么情况下我要先问你，什么情况下可以在你的限额内直接操作？                                                       |
| 8   | Reports      | How often should I report to you, and how short should my messages be?                                                           | 我应该多久向你汇报一次？消息要多简短？                                                                           |

<a id="section-8-4"></a>

### 8.4 The chat in Telegram

How the owner's messages reach the agent and its replies reach the owner in Telegram
([decision 0178](../DECISIONS.md#d0178)).

- **The owner's messages.** A message that is not a fast command goes to the agent with
  `chat/post` (spec 1, section 7.7). Messages that come within 300 ms of each other, such as a
  paste Telegram split or an album, go as one, a line apart, at most 12 messages, 50,000
  characters or 3 seconds of them. An edit, a forwarded message, and a message with neither text
  nor a photo go nowhere and are answered at once.
- **Photos.** A message carries at most 4 photos of at most 5 MiB each; the others are left out
  and the owner is told how many. Each goes as `tg:<file_id>` of its largest size.
- **The reply.** When the agent's turn starts, one status message shows how long it has worked,
  or the text it has written so far, edited about once a second. The final answer goes as new
  messages, split at 4,096 characters, and the status message is deleted. A status line of
  section 8.1 follows in italics. The agent's words are always shown as text: escaped, with every
  character a reader cannot see written as `\u{…}`.
- **Rate limits.** An edit of the status message is a preview: when Telegram asks the bot to wait,
  or another message waits for the chat, the edit is dropped and the next one carries its text.
  Answers, status lines and cards wait and go.

| When                     | Key                           | English                                                                                                                                                                              | 中文                                                                                                    |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| The status message       | `telegram.chat.working`       | Working on it · {seconds} s                                                                                                                                                          | 处理中 · {seconds} 秒                                                                                   |
| Photos past 4            | `telegram.chat.photosLeftOut` | The agent reads 4 photos of a message at most, so {count, plural, one {# photo was} other {# photos were}} left out. Send {count, plural, one {it} other {them}} in another message. | Agent 每条消息最多读取 4 张图片，因此有 {count, plural, other {# 张图片}}未发送。请在另一条消息中发送。 |
| A photo over 5 MiB       | `telegram.chat.photoTooLarge` | The agent reads photos of 5 MiB at most, so {count, plural, one {# photo was} other {# photos were}} left out. Send a smaller copy.                                                  | Agent 只读取不超过 5 MiB 的图片，因此有 {count, plural, other {# 张图片}}未发送。请发送更小的图片。     |
| A forwarded message      | `telegram.chat.forwarded`     | A forwarded message does not reach the agent. Write what you want it to read in a message of your own.                                                                               | 转发的消息不会发送给 Agent。请把你想让它读取的内容写在你自己的消息中。                                  |
| An edit                  | `telegram.chat.edited`        | An edit does not reach the agent. Send a new message instead.                                                                                                                        | 编辑后的消息不会发送给 Agent。请发送一条新消息。                                                        |
| Neither text nor a photo | `telegram.chat.unsupported`   | The agent reads text and photos. Send this as text or as a photo.                                                                                                                    | Agent 只读取文字和图片。请以文字或图片的形式发送。                                                      |

<a id="section-8-5"></a>

### 8.5 The agent's launch drafts

The agent never starts a token launch; it drafts one with `launch_draft`, and the owner starts it
in Telegram ([decisions 0285](../DECISIONS.md#d0285) and [0286](../DECISIONS.md#d0286)). The bot
sends the draft to the owner's private chat as one message: the header, every line the launch's
card shows from the draft (`card.launch.action`, the description, each link, the picture with
`card.launch.photo`, `card.launch.writtenPicture` or the picture link, and every launchpad setting
with its default filled in), the outside content warning when the drafting turn read any, and the
footer. Every value of the draft is outside text, cut and made visible as a card's is. Its two
buttons are Start launch and Drop (section 2). After Start, the launch runs as any launch: its card
follows, with the fee, the new token and the least the first buy gets.

Once the draft ends, its message loses its buttons and becomes the line of how it ended. The
answer to a press is under 200 characters.

| Moment                 | Key                             | English                                                                                                                                                      | 中文                                                                                                               |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Header                 | `telegram.draft.header`         | {agent} drafted this token launch. Nothing is uploaded or public until you tap Start launch.                                                                 | {agent} 起草了这次代币发射。在你点按“开始发射”之前，不会上传或公开任何内容。                                       |
| Footer                 | `telegram.draft.footer`         | After Start launch, the launch card shows the launch fee, the new token and the least the first buy gets, and you confirm there. This draft ends at {time}.  | 点按“开始发射”后，发射确认卡片会显示发射手续费、新代币和首笔买入的最少所得，你在卡片上确认。此草稿在 {time} 失效。 |
| Buttons                | `telegram.draft.start`, `.drop` | Start launch · Drop                                                                                                                                          | 开始发射 · 放弃                                                                                                    |
| Started                | `telegram.draft.started`        | ✅ Launch started. Its card follows: confirm there before anything is signed.                                                                                | ✅ 发射已开始。确认卡片随后发送：签名前请在卡片上确认。                                                            |
| Dropped                | `telegram.draft.dropped`        | ❌ Launch draft dropped. Nothing was uploaded.                                                                                                               | ❌ 已放弃发射草稿，没有上传任何内容。                                                                              |
| Ended after 10 minutes | `telegram.draft.expired`        | ❌ This launch draft ended after 10 minutes. Nothing was uploaded. Ask your agent to draft it again.                                                         | ❌ 此发射草稿已在 10 分钟后失效，没有上传任何内容。如需发射，请让 Agent 重新起草。                                 |
| Replaced               | `telegram.draft.replaced`       | ❌ A newer launch draft replaced this one. Nothing was uploaded.                                                                                             | ❌ 较新的发射草稿已取代此草稿，没有上传任何内容。                                                                  |
| Refused                | `telegram.draft.failed`         | ❌ The launch did not start: {reason}                                                                                                                        | ❌ 发射未开始：{reason}                                                                                            |
| Press answers          | `telegram.draft.answer.*`       | Launch started. Its card follows. · Draft dropped. · This draft has ended. Ask your agent to draft it again. · The launch did not start. The draft says why. | 发射已开始，确认卡片随后发送。· 草稿已放弃。· 此草稿已失效。请让 Agent 重新起草。· 发射未开始，原因见草稿消息。    |

`{reason}` is the error message of the code the proposal was refused with.

<a id="section-9"></a>

## 9. The disclaimer and the privacy statement

Shown before an agent can go live ([decision 0060](../DECISIONS.md#d0060)): in `binference init`
after the language step, and by `binference live` when the owner has not accepted the current
text. The owner types the phrase in either language, in any letter case; with nobody at the
terminal, `binference init --accept-disclaimer` prints both texts in full before it accepts them
([decision 0223](../DECISIONS.md#d0223)). `safety.disclaimer_version` records the version
accepted, and a change of meaning in either text raises the version, so going live asks again.

The text below is **version 2**, accepted by the owner on 2026-10-12: its privacy statement names
more of what leaves the machine than version 1, the text `binference live` showed before. An
install that accepted version 1 is asked again:

- `binference live` and the console's go-live step show version 2 and refuse with
  `agent.disclaimer` until the owner types the phrase. For an agent already live, `binference live`
  asks for version 2 too and changes nothing else.
- Agents already live keep trading. The owner gets `notice.disclaimerChanged` once, and
  `binference status` names the older version until version 2 is accepted.

| Key                        | English                                                                                                                                   | 中文                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `notice.disclaimerChanged` | The privacy statement changed: it now names more of what leaves this machine. Run `binference live` on the machine to read and accept it. | 隐私声明已更新：现在列出了更多会离开本机的信息。请在本机运行 `binference live` 阅读并接受。 |

These keys, in the `disclaimer` message area beside the version, hold the words `init`, `live` and
the console read ([decision 0220](../DECISIONS.md#d0220)).

| Key                       | English                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 中文                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disclaimer.title`        | Read this first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 请先阅读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `disclaimer.text`         | binference gives facts, not advice. You are responsible for every trade you confirm, and for what auto mode does within your caps. binference is open-source software under the MIT license, provided as is and without warranty: it can have bugs, and a transaction on chain cannot be undone.                                                                                                                                                                                                                                                                                                                                                                                                                 | binference 只陈述事实，不构成建议。你对自己确认的每一笔交易负责，也对自动模式在你的上限之内执行的操作负责。binference 是采用 MIT 许可证的开源软件，按原样提供，不附带任何担保：它可能存在缺陷，链上交易一经发出便无法撤回。                                                                                                                                                                                                                                                                             |
| `disclaimer.privacyTitle` | What leaves this machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 离开本机的信息                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `disclaimer.privacy`      | Your model provider sees your chats, your balances and what your agent reads for you. Telegram carries your chats with your bot. Privy, which holds your wallets, sees every transaction they sign, and the private relays see the transactions they send. The RPC nodes see your IP address. The risk and market data services see the addresses of the tokens you trade or look at. A search provider sees your agent's searches, and a launchpad sees the name, picture and description of a token you launch. The update check reports the binference version, your operating system, Node version and CPU type, and, if you agree, the usage counts. Your owner key and agent key never leave this machine. | 你的模型服务商可以看到你的对话、余额，以及 Agent 为你读取的内容。Telegram 传递你与机器人的对话。托管你钱包的 Privy 可以看到钱包签名的每一笔交易，私密中继可以看到它们发送的交易。RPC 节点可以看到你的 IP 地址。风险和市场数据服务可以看到你交易或查看的代币地址。搜索服务商可以看到 Agent 的搜索内容，发射台可以看到你发射代币的名称、图片和描述。更新检查会报告 binference 的版本、你的操作系统、Node 版本和 CPU 类型；如果你同意，还会发送使用次数统计。你的所有者密钥和 Agent 密钥永远不会离开本机。 |
| `disclaimer.ask`          | Type {phrase} to accept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 输入 {phrase} 表示接受                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `disclaimer.phrase`       | I understand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 我明白                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
