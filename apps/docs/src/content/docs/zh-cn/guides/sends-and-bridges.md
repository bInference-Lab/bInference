---
title: 转账和跨链
description: 保存 Agent 可以转账的地址，在 BNB Smart Chain 上向它们转账，撤销授权，以及跨链到 Ethereum、Base、Arbitrum、Robinhood Chain 和 Solana。
---

Agent 只能转账到你用所有者密钥保存的地址，以及你的紧急转出地址。这条规则写在每个钱包在 Privy 的[上限](/zh-cn/guides/safety/#上限)中，因此即使引擎的密钥被盗，它依然有效。转账、撤销授权和跨链只能在实盘进行，总会显示卡片，并且从不在自动模式下执行。

## 地址簿

用你的所有者密钥保存地址：

```sh
binference address add 0x9F3c...41aB --label "cold wallet"
```

binference 会把它写入地址簿和每个钱包的上限。每个地址只保存在一条链上：默认是 BNB Smart Chain，也可以用 `--chain` 指定跨链的目标链：

| 链              | `--chain`      |
| --------------- | -------------- |
| Ethereum        | `ethereum`     |
| Base            | `base-mainnet` |
| Arbitrum        | `arbitrum`     |
| Robinhood Chain | `robinhood`    |
| Solana          | `solana`       |

已保存的地址只在它自己的链上收款。binference 会拒绝代币合约、平台合约、Agent 的跨链钱包或发射钱包，以及 Solana 上的程序账户或代币账户。每条链最多保存 100 个地址。

`binference address list` 显示每个条目及转账何时可以支付它。`binference address remove <adr_...>` 立即移除一个条目；此后 binference 不再向它转账。

## 转账

告诉 Agent，例如“转 50 USDT 到 cold wallet”。它会在卡片上提议这笔转账，卡片写明条目及其地址。转账可以支付：

- 你的紧急转出地址
- 钱包所在链上已保存的地址
- 指向已保存地址的 `.bnb` 域名，详见[域名指南](/zh-cn/guides/names-and-identity/)

Agent 读过外部内容后，不能转账到地址簿之外的地址。转账计入单笔上限和 24 小时上限。

[转账级别](/zh-cn/guides/safety/#转账级别)可以进一步收紧转账：级别 2 时，条目保存满 24 小时后才能收款；级别 3 不允许任何转账。

## 撤销授权

告诉 Agent 撤销一个代币授权。它会提议把注册表中列出的某个地址的授权额度改回零。撤销授权不计入任何上限，并且在 Agent 冻结期间也可以进行，同样需要卡片。

## 跨链

跨链把代币从 BNB Smart Chain 转到另一条链。binference 通过两个平台跨链：

| 目标链          | Across                          | Relay                      |
| --------------- | ------------------------------- | -------------------------- |
| Ethereum        | USDC、USDT、ETH                 | USDC、USDT                 |
| Base            | USDC、USDT、ETH                 | USDC、USDT                 |
| Arbitrum        | USDC、USDT（到账为 USDT0）、ETH | USDC、USDT（到账为 USDT0） |
| Robinhood Chain | ETH                             | USDC 和 USDT，到账为 USDG  |
| Solana          |                                 | USDC、USDT                 |

ETH 到达普通钱包时就是 ETH。BNB 不能跨链。

- **Across** 从 Agent 的主钱包跨链。它的存入交易写明收款地址和目标链，上限会把两者限制在你保存的地址上。
- **Relay** 只从 Agent 的**跨链钱包**跨链。Relay 的存入交易不写明收款地址，因此任何上限都无法检查它付给谁。用一个由你充值的小钱包，可以把这个风险限制在钱包里的资金。

### 开启跨链

新的 Agent 默认不开启这两个平台。先用你的所有者密钥把平台加入上限，再加入 Agent 的平台列表。运行 `binference ceiling` 查看钱包保留的平台，然后把它们连同新平台一起列出：

```sh
binference ceiling set --venues <它列出的平台>,across
binference limit set limits.venues=<它列出的平台>,across
```

添加平台会放宽限额，因此在 24 小时后生效。

使用 Relay 之前，先用你的所有者密钥创建跨链钱包，并从外部给它充值：

```sh
binference wallet create --bridge --label bridge
```

它的上限只允许存入 Relay，以及转账到你的紧急转出地址和已保存的地址。Agent 的其他钱包都不能给它转账，所以请从你自己的钱包充值。然后用 `binference limit set` 把 `relay` 加入 Agent 的平台列表。

### 发起跨链

先保存目标链上的收款地址，然后告诉 Agent，例如“跨链 20 USDC 到我的 Base 钱包”。binference 同时为每条路由报价，并选择至少到账数量最高的一条。卡片写明收款地址、目标链、至少到账的数量、大约需要的时间、费用和平台；从跨链钱包转出时还会写明该钱包。如果路由到账的是另一种代币，例如 Robinhood Chain 上的 USDG，卡片会显示兑换汇率；超过 0.5% 的路由会被拒绝。

跨链计入单笔上限和 24 小时上限。没有指定收款地址时，如果可以支付，binference 会按你在该链上的紧急转出地址报价。

### 其他链上的紧急转出地址

在 EVM 链上，只有当你的紧急转出地址在 BNB Smart Chain 和目标链上都没有代码时，跨链才会支付给它：这时它很可能是同一个私钥控制的普通钱包。它在 Solana 上永远不会被支付。你在某条链上保存过地址后，binference 才会把紧急转出地址加入该链的跨链规则。你会收到 [`rescueBridged`](/zh-cn/reference/notices/#rescuebridged) 或 [`rescueNotBridged`](/zh-cn/reference/notices/#rescuenotbridged) 通知；如果不能支付，请在那条链上保存一个你控制的地址。

### 存入之后

binference 每 30 秒读取一次目标链，直到资金到账，回执会写明到账的数量。跨链永远不会超时：

- 2 小时后仍未到账即为延迟，你会收到一次 [`bridgeLate`](/zh-cn/reference/notices/#bridgelate) 通知，附有平台的状态页面。binference 会继续读取。
- 延迟的跨链到账时，[`bridgeArrived`](/zh-cn/reference/notices/#bridgearrived) 会通知你。
- 平台把资金退回钱包时，[`bridgeRefunded`](/zh-cn/reference/notices/#bridgerefunded) 会通知你。

到账之前，`/positions` 按转出时的价值显示在途的跨链。

### Relay 的 API 密钥

binference 不用密钥使用 Relay。Relay 将在 2026-11-24 停止无密钥读取存入状态；此后请把 `venues.keys.relay` 设置为 Relay 后台提供的密钥，否则 binference 无法得知 Relay 跨链何时到账，并会发送 [`bridgeKeyNeeded`](/zh-cn/reference/notices/#bridgekeyneeded) 通知。

## binference 在其他链上不做什么

binference 在其他链上不持有任何密钥，也不在那里签名。它读取目标链只是为了确认跨链已到账。要在那里继续转移资金，请使用你自己的钱包。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`address`、`wallet create` 和 `ceiling set`。
- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：`addresses`、`send`、`approval_revoke`、`bridge_quote` 和 `bridge`。
