---
title: 安全
description: 哪些操作需要你点按、自动模式可以做什么、限额、即使密钥被盗也有效的上限，以及如何冻结和紧急转出。
---

binference 用三层保护你的资金。**限额**是 Agent 的额度，引擎在每张卡片之前检查。**卡片**是你点按确认的条款。**上限**是每个钱包在托管服务商 Privy 那里的策略：即使有人盗走了引擎的密钥，它依然有效，并且只有你的所有者密钥能修改它。

## 模拟模式和实盘

新的 Agent 从模拟模式开始：它读取真实报价，运行每一项检查并显示真实卡片，但按确认时的报价记录每笔成交，不在链上发送任何交易。模拟卡片会注明这一点。

`binference live` 把 Agent 切换到实盘。它只能在引擎所在机器的终端中运行：它会显示免责声明和隐私声明，并要求你输入确认你已理解。Agent 的钱包有资金之前，它会拒绝切换。第一张实盘卡片会说明这笔交易使用真实资金。

`binference paper`，或 Telegram 中的 `/paper`，可以在任何界面把 Agent 切换回模拟模式。每个操作保持它被提议时的模式。转账、撤销授权、跨链、代币发射和身份登记只能在实盘进行。

## 哪些操作需要你点按

在默认的手动模式下，每笔链上交易都要等你在卡片上点按，你确认过一次的自动订单或提醒规则的成交除外。交易卡片 60 秒后过期，其他卡片 10 分钟后过期。你点按一张报价超过 10 秒的交易卡片时，binference 会重新报价；如果新的至少收到的数量差了超过 0.5%，会打开一张新卡片，之前的点按不生效。

以下操作在任何模式下都会打开卡片：

- 转账、跨链和紧急转出
- 解除质押
- 代币发射和身份登记
- 撤销授权
- 解除冻结
- 自动订单和提醒规则，在你创建时各一次

## 自动模式

`binference approval auto` 让 Agent 自己的交易无需点按即可执行；`binference approval manual` 切换回手动模式。每次切换都会发送 [`approvalMode`](/zh-cn/reference/notices/#approvalmode) 通知。

只有以下各项全部满足时，自动模式才会不经卡片执行一个操作：

- 它是买入、卖出或兑换，或者是用 Agent 自己的钱包进行的质押或领取
- 它在单笔上限和 24 小时上限之内
- 网络费不超过网络费上限
- 它不卖出禁止交易列表中的代币
- 它设置的每个授权都给注册表中列出的地址
- 它由 Agent 提议，而不是 MCP 客户端
- 促成它的对话没有读过外部内容，且没有启用任何社区插件
- 引擎没有锁定

其他情况都会打开卡片，卡片会说明自动模式为什么询问你。

## 限额

每个 Agent 在创建时从 `config.json5` 的 `defaults` 复制限额：

| 限额                        | 配置项                                      | 默认值               |
| --------------------------- | ------------------------------------------- | -------------------- |
| 单笔交易最多金额            | `defaults.limits.perTradeUsd`               | $100                 |
| 24 小时内交易和转账最多金额 | `defaults.limits.rollingDayUsd`             | $500                 |
| 注册表代币的滑点            | `defaults.limits.slippageBps.registry`      | 1%                   |
| 其他代币的滑点              | `defaults.limits.slippageBps.other`         | 5%                   |
| 最大价格影响                | `defaults.limits.priceImpactBps`            | 3%                   |
| 最高代币交易税              | `defaults.limits.taxBps`                    | 10%                  |
| 交易池最低流动性            | `defaults.limits.liquidityFloorUsd`         | $10,000              |
| 网络费预留的 BNB            | `defaults.limits.gasReserve.eip155:56`      | 0.002 BNB            |
| Agent 可以使用的平台        | `defaults.limits.venues`                    | 所有已安装的核心平台 |
| 可交易和禁止交易的代币      | `defaults.limits.allowTokens`、`denyTokens` | 无                   |

24 小时上限是滚动计算的：它统计过去 24 小时内交易、转账、跨链和质押动用的金额，从每笔被确认时开始计算。解除质押和领取不计入任何上限。

`binference limit` 显示生效中的限额。`binference limit set` 修改限额，每项写成 `key=value`，键名与 `defaults` 中的相同，例如：

```sh
binference limit set limits.perTradeUsd=50 limits.rollingDayUsd=300
```

更严格的限额立即生效。更宽松的限额要等 24 小时，你会收到 [`limitChange`](/zh-cn/reference/notices/#limitchange) 通知，以便阻止不是你做的修改：`binference limit cancel` 会撤销等待中的宽松限额。在 Telegram 中，`/limits` 显示限额，其按钮只能让限额更严格。

## 代币检查

买入注册表未列出的代币之前，binference 会先检查它：查询 GoPlus，然后在链的当前状态上试运行一次买入、转账和卖出。貔貅盘、无法卖出的代币、隐藏的所有者、黑名单、超过你限额的交易税，或低于你下限的流动性，在任何模式下都会被拒绝。卖出不做这项检查，由它的模拟结果决定。

## 网络费上限

`chains.maxFeePerGasGwei` 限制每单位 gas 的费用，BNB Smart Chain 上默认为 1 gwei。网络要求的费用更高时，交易会等待，并在每个区块重试。超过上限的交易永远不会被签名。

## 上限

上限是每个钱包在 Privy 的策略。超出上限的任何交易 Privy 都会拒绝签名，因此即使引擎或其所在机器被接管，它依然有效。它只允许：

- **转账**：只能转到你的紧急转出地址，以及你用所有者密钥保存的地址。
- **合约调用**：只能调用上限中列出的平台，只能调用每个平台声明的函数，授权也只能给它们声明的地址。
- **每次调用的原生币**：每次合约调用最多 1 BNB（`defaults.ceiling.perTxBnb`）。StakeHub 和 Lista 的质押最多可以带 100 BNB。
- **24 小时上限**：由本安装的所有钱包共用，包括所有交易发送的 BNB，以及对 WBNB、USDT、USDC 和 ETH 的授权。`binference init` 把每项上限设为 `defaults.limits.rollingDayUsd` 的两倍，按底价计算：每个 BNB 或 WBNB $100，每个稳定币 $1，每个 ETH $1,000。按默认的 $500 计算，即每天 10 BNB、10 WBNB、1,000 USDT、1,000 USDC 和 1 ETH。

盗走引擎密钥的人仍然可以在这些上限内以不利价格交易，但无法把你的资金转到你没有保存的地址。

`binference ceiling` 显示 Privy 中保存的钱包上限。`binference ceiling set` 用你的所有者密钥修改它：

- `--venues <ids>` 设置合约调用可以使用的所有平台，用逗号分隔，作用于 Agent 的每个钱包。请先运行 `binference ceiling`，列出你要保留的每个平台：Agent 的限额仍在使用的平台，binference 会拒绝移除。
- `--per-tx 0.5` 设置一次合约调用最多可带的原生币数量。
- `--day-cap-usd 2000` 设置每项 24 小时上限的大小，作用于所有 Agent 的每个钱包。它必须单独使用。

每次修改都会发送 [`ceilingChange`](/zh-cn/reference/notices/#ceilingchange) 通知。

## 你的两个密钥

- **所有者密钥**拥有钱包及其上限。`binference init` 只显示它一次，形式是 `bnok1` 开头的代码：请离线保存。`rescue set`、`address add`、`ceiling set`、`wallet create`、`wallet export`、`signer revoke`、`agent identity`、接入另一台机器和恢复备份时，你需要在隐藏的提示中输入它。它从不存入钥匙串。
- **Agent 密钥**保存在引擎所在的机器上，只能在上限内请求 Privy 签名。签名进程持有它，并在每次签名前自行检查规则：链、合约和函数、精确的金额和授权、网络费上限，以及针对这些条款的有效确认或授权。

## 冻结

冻结立即生效。它会取消每张未回复的卡片和每个尚未签名的操作，结束 Agent 正在进行的回答，并暂停它的自动订单。已经发送的交易会继续完成。

- `binference freeze` 冻结所有 Agent 和本安装，之后创建的 Agent 也处于冻结状态。`binference freeze --agent <id>` 只冻结一个 Agent。
- Telegram 中的 `/freeze` 冻结全部。

冻结期间，Agent 不能提议任何操作，撤销授权除外，它仍需要卡片。

要解除冻结，运行 `binference unfreeze`（加 `--agent <id>` 只针对一个 Agent）。它会打开一张卡片，在任何界面确认它即可解除冻结。自动模式从不确认它。`binference safety status` 显示冻结情况、进行中的紧急转出和紧急转出地址。

## 紧急转出

紧急转出会把每个 Agent 钱包中的全部资产转到你的紧急转出地址：每个注册表代币、钱包持有仓位的每个代币，最后是网络费预留之外的 BNB。它不卖出任何资产。冻结期间和模拟模式下它同样可用，在模拟模式下它转出的是真实资金。

用 `binference rescue` 或 Telegram 中的 `/rescue` 打开它，然后确认卡片。模拟失败的转账会被跳过，每一步最多重试 3 次。[`rescue`](/zh-cn/reference/notices/#rescue) 通知会告诉你它已开始。

紧急转出地址在 `binference init` 时设置。要修改它，用你的所有者密钥运行 `binference rescue set <address>`：新地址在 24 小时后生效，在此之前旧地址仍然有效。你会收到 [`rescueAddress`](/zh-cn/reference/notices/#rescueaddress) 通知；如果不是你要求的，运行 `binference rescue cancel`。

## 转账级别

在每个级别，转账都只能转到你的紧急转出地址或已保存的地址。Agent 的转账级别会进一步收紧：0 和 1 允许任何已保存的地址，2 只允许保存满 24 小时的地址，3 不允许任何转账。新的 Agent 从 `defaults.sendLevel` 开始，默认为 0。[转账和跨链指南](/zh-cn/guides/sends-and-bridges/)介绍地址簿。

## 检查你的安装

`binference check` 读取配置、谁能打开它的文件、解锁方式、引擎、钱包的上限、远程访问和插件沙箱，并为每个问题给出修复方法。`binference check --fix` 会让只有你能打开那些文件和文件夹。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`limit`、`approval`、`ceiling`、`freeze`、`rescue` 和 `safety`。
- [通知](/zh-cn/reference/notices/)：关于冻结、限额、上限或紧急转出地址的每条通知。
