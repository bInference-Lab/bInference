---
title: 发射代币
description: 从发射钱包在 Flap、Genius.fun 或 Brew 上发射代币；Agent 可以起草，只有你可以开始。
---

binference 可以在 BNB Smart Chain 上的三个发射台发射代币：Flap、Genius.fun 和 Brew。只有你可以开始发射。Agent 可以根据你在 Telegram 中的对话起草一次发射，在你点按“开始发射”并确认卡片之前，什么都不会公开。binference 不从任何发射中收取佣金。

发射会永久公开代币的名称、文字和图片，因此只能在实盘进行：模拟模式下发射会被拒绝。自动模式从不发射。

## 发射钱包

每次发射都从 Agent 的发射钱包进行：这是一个独立的小钱包，只有它的上限允许发射台的创建调用。用你的所有者密钥创建它：

```sh
binference wallet create --launch --label launch
```

请从你自己的钱包给它充值。Agent 的其他钱包都不能给它转账，它也不能作为你的紧急转出地址或已保存的地址，因此盗走引擎密钥的人最多只能损失它里面的资金。紧急转出会像清空其他 Agent 钱包一样清空它。每个 Agent 有一个发射钱包。

发射钱包也负责 Agent 在发射代币自己的联合曲线上的实盘交易，例如 Genius.fun 代币。

发射台必须在 Agent 的平台列表中。Flap 默认就在；要添加 Genius.fun 或 Brew，运行 `binference limit set limits.venues=<已有的平台>,geniusfun`，或在控制台的「交易限额」页面添加，它在 24 小时后生效。`binference limit` 和该页面显示 Agent 已有的平台。

## 在 Telegram 中起草发射

1. 在机器人的对话中告诉 Agent 要发射什么：发射台、名称和代币符号、描述和链接、与什么配对交易，以及首笔买入。在 Flap 或 Brew 上发射时，把图片随这条消息一起发送。
2. Agent 起草这次发射。机器人会连同图片显示草稿的每一行，并附上两个按钮：“开始发射”和“放弃”。草稿 10 分钟内有效，更新的草稿会替换它。
3. 点按“开始发射”。binference 以你的点按发起提议，而不是 Agent 的。
4. 随后会出现发射卡片，列出每项设置、费用和首笔买入。请在 10 分钟内确认它。

控制台会显示草稿，但不能开始发射：请在 Telegram 中开始。Agent 和 MCP 客户端都不能自己提议发射（`intent.owner_only`），每个 Agent 同一时间只能进行一次发射。

## 发射台

### Flap

- binference 把图片和文字上传到 Flap，然后最多等待 5 分钟，等 Flap 固定它们后再打开卡片。如果 Flap 没有按时固定，发射会停止并发送 [`launchStopped`](/zh-cn/reference/notices/#launchstopped) 通知，此时图片和文字可能已经公开。
- binference 只发射带交易税的代币：对每笔买入、每笔卖出或两者收税，每项 1% 到 10%，持续若干天，支付到你指定的地址，并可以销毁其中一部分。
- 可以与 BNB、USDT 或 USD1 配对交易。Flap 不收发射手续费。
- 首笔买入在创建调用内进行，链上没有最低数量。卡片显示前，模拟会确保它达到最低数量，卡片也会就此提醒你。

### Genius.fun

- Genius.fun 没有图片上传接口：请提供一个你自己托管的图片地址，`ipfs://` 或 `https://`。binference 从不打开它。
- 指定创建者费用接收地址，即领取每笔交易手续费中创建者部分的地址。它不能是你的任何 Agent 钱包，因为 binference 无法领取这些费用。
- 可以与 BNB、USDT 或 USDC 配对交易。发射手续费在报价时从 Genius.fun 的合约读取。
- 首笔买入在链上保留最低数量。

### Brew

- 图片直接写入创建调用，因此必须很小：图片和文字共用 2,048 字节。
- 代币从一个手续费为 1% 的交易池开始，全部 1,000,000,000 的供应量放在一个价格区间内，锁定在 Brew 的锁仓合约中。起始市值为 8 BNB、5,000 USDT 或 USDC，其他配对资产则按 binference 的价格约为 $5,000，除非你另行指定。
- 指定交易池手续费的接收地址，或者开启持有者奖励：这样交易池手续费中创建者的部分会用于买入该代币并永久销毁。
- 可以与 BNB、USDT、USDC、FDUSD、BTCB、ETH、Cake、slisBNB 或 USD1 配对交易。发射手续费在报价时从 Brew 的合约读取。
- 每张 Brew 卡片都会提醒：Brew 的网站称其不向美国公民提供服务。

## 发射停止时

- [`launchStopped`](/zh-cn/reference/notices/#launchstopped)：发射在显示卡片之前结束，例如没有等到固定。
- [`launchNotSigned`](/zh-cn/reference/notices/#launchnotsigned)：你确认之后、签名之前 binference 停止了。没有创建代币。
- [`launchStepUnsent`](/zh-cn/reference/notices/#launchstepunsent)：授权已上链，但创建调用从未签名。通知会写明发射台仍可以花费的数量。

停止之后，binference 从不再为这次发射签名。如果你仍想发射，请重新提议。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`wallet create --launch`。
- [自动订单和提醒](/zh-cn/guides/auto-orders/)：发射提醒。
- [安全](/zh-cn/guides/safety/)：上限。
