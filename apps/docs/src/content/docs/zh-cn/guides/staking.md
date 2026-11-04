---
title: 质押 BNB
description: 把 Agent 的 BNB 质押给 StakeHub 上的验证者，或质押到 Lista 的质押池换取 slisBNB，然后解除质押并领取回来。
---

你的 Agent 可以在 BNB Smart Chain 上的两个地方用 BNB 获得收益：

- **StakeHub**，BNB Smart Chain 的原生质押：你质押给一个验证者，你的质押获得该验证者扣除佣金后的奖励。
- **Lista**，它为你的 BNB 铸造 slisBNB：你质押到它唯一的质押池，不需要选择验证者。

每个平台只把资金记入签名的钱包。binference 从不转交你质押的投票权。质押分三步：**质押**；**解除质押**，开始解绑期；**领取**，在解绑期结束后把 BNB 取回钱包。

## 质押

告诉 Agent，例如“我可以质押给谁？”或“把 2 BNB 质押给佣金最低的验证者”。它会读取可选项，然后在卡片上提议质押。卡片显示：

- 在 StakeHub 上，验证者及其佣金，以及能读取时，根据最近一天奖励算出的年化收益率
- 在 Lista 上，这次质押至少铸造的 slisBNB 数量
- 解除质押后要等多少天才能领取

质押与交易一样，计入 Agent 的单笔上限和 24 小时上限。在[自动模式](/zh-cn/guides/safety/#自动模式)下，上限之内的质押可以无需卡片执行。

低于平台最低数量（binference 从链上读取）的质押、质押给被监禁的验证者，以及平台暂停期间的任何操作，binference 都会拒绝。

## 解除质押

解除质押在任何模式下都会显示卡片，因为它会在解绑期内锁定 BNB。卡片会说明 BNB 何时可以领取。

- 在 StakeHub 上，指定验证者和 BNB 数量，或者全部解除。
- 在 Lista 上，指定要解除的 slisBNB 数量。binference 先精确授权这些 slisBNB，然后请求 Lista 提取。Lista 自己的队列会释放它，所需时间可能比卡片上的估计更长。

解除质押和领取不计入任何上限。

## 领取

binference 每分钟检查一次，可以领取时会发送 [`claimReady`](/zh-cn/reference/notices/#claimready) 通知。告诉 Agent 领取即可；在自动模式下，领取可以无需卡片执行。如果某笔 Lista 提取在 binference 之外（例如在 Lista 的网站上）被领取，你会收到 [`claimedElsewhere`](/zh-cn/reference/notices/#claimedelsewhere) 通知，binference 只记录一次。

## 100 BNB 质押规则

[上限](/zh-cn/guides/safety/#上限)把每次合约调用限制在 1 BNB。StakeHub 和 Lista 的质押有自己的规则，一笔交易最多可以带 100 BNB；其他调用仍然是 1 BNB。

如果钱包的上限是在这条规则之前写入的，质押仍被限制在 1 BNB。此时 binference 会在显示卡片前拒绝更大的质押（`stake_over_ceiling`）。要修复，请用你的所有者密钥重新写入上限，列出这个钱包保留的每个平台：

```sh
binference ceiling
binference ceiling set --venues <它列出的平台>
```

## 模拟模式

模拟质押按平台的报价把模拟 BNB 转入模拟质押仓位。模拟解除质押同样要等待平台真实的解绑期，之后才能模拟领取。

## 你会看到什么

Telegram 中的 `/positions` 和控制台的投资组合都有“质押”部分：每笔质押按当前价值显示，包含奖励；解绑中和可领取的部分单独列出。slisBNB 的价格是 BNB 的价格乘以 Lista 的汇率，并且只有在这个汇率与 Chainlink 的 slisBNB 价格源相差不超过 1% 时才会显示；否则不显示价值。在 binference 之外进行的质押不会列出。

## 通知

- [`claimReady`](/zh-cn/reference/notices/#claimready)：一笔解除质押现在可以领取。
- [`claimedElsewhere`](/zh-cn/reference/notices/#claimedelsewhere)：一笔 Lista 提取在 binference 之外被领取。
- [`stakeMintedFewer`](/zh-cn/reference/notices/#stakemintedfewer)：Lista 的汇率变动后，一笔 Lista 质押铸造的 slisBNB 少于卡片承诺的数量。
- [`stakeApprovalLeft`](/zh-cn/reference/notices/#stakeapprovalleft)：一笔 Lista 解除质押在授权上链后停止；再次提议即可完成。

## 另请参阅

- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：`staking_options`、`stake`、`unstake` 和 `claim`。
- [安全](/zh-cn/guides/safety/)：上限和交易限额。
