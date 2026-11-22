---
title: 开始使用
description: 在你的 Mac 上设置 binference，配对你的 Telegram 机器人，通过对话完成一笔模拟交易并确认它的卡片，设置限额，切换到实盘，以及在需要时冻结或紧急转出。
---

本页带你从安装走到第一笔交易。binference 目前只支持 macOS。

## 你需要准备

- 一台 Mac，以及其中的“终端”。
- 一个 Privy 账号，在 [dashboard.privy.io](https://dashboard.privy.io) 注册。binference 把你的 Agent 钱包放在你自己的 Privy 应用中。
- 一个 Telegram 账号，用来通过 @BotFather 创建你自己的机器人。
- 一个模型服务商的 API 密钥：bInference Router、OpenAI、Anthropic、OpenRouter，或任何其他提供 OpenAI 或 Anthropic API 的服务商。
- 一个只有你能控制的 BNB Chain 钱包（例如硬件钱包），用作你的紧急转出地址。

## 安装

打开“终端”并运行：

```sh
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

[安装指南](/zh-cn/guides/install/)说明了脚本把什么放在哪里。脚本最后会运行 `binference init`。

## 用 binference init 完成设置

`binference init` 按下面的顺序提问，并在保存或创建任何内容之前检查每个答案：

1. **语言**，英文或简体中文。
2. **免责声明和隐私声明。** 输入 `我明白` 表示接受。
3. **匿名的使用次数统计**，是否分享。
4. **你的模型：** 服务商、模型 ID 和它的 API 密钥。binference 先用一次很小的调用检查密钥，然后才保存它。
5. **你的 Privy 应用：** 它的应用 ID 和应用密钥，位于 Privy 管理后台的 Configuration、App settings、Basics 中。
6. **你的所有者密钥。** binference 以 `bnok1` 开头的代码只显示一次，只保留它的公开部分。请把它写下来并离线保存，然后输入它的最后 6 个字符。它用于提高钱包的上限、保存 Agent 可以转账的地址、导出钱包和接入新机器。
7. **你的紧急转出地址**，BNB Chain 上以 `0x` 开头的地址。
8. **你的机器人 Token。** 在 Telegram 中与 @BotFather 开始对话，输入 `/newbot`，然后粘贴它给你的机器人 Token。
9. **你的限额：** 以美元计的单笔上限和 24 小时上限，除非你输入其他数值，否则为 100 美元和 500 美元。

然后 init 在 Privy 上创建你的 Agent 钱包及其上限，并创建这台 Mac 的 Agent 密钥，它在这个上限之内签名。在 Mac 的桌面会话中，密钥存入钥匙串；init 会说明它把密钥放在哪里。它把你的设置写入 `~/.binference/config.json5`，并询问是否现在就把 binference 作为后台服务启动，之后每次登录时它都会启动。如果你选择否，之后用 `binference start` 启动它。

## 配对你的 Telegram 机器人

init 最后会打印一个指向你的机器人的链接，以及它失效的时间。binference 运行后，在 Telegram 中打开这个链接。最先打开它的人成为所有者，此后机器人只在私聊中回复这个 Telegram 账号。

如果链接已失效，或者要配对另一个账号，请运行 `binference telegram pair`。它会打印一个新链接，10 分钟内有效。

## 第一笔交易，在模拟模式中

你的 Agent 从模拟模式开始。它读取真实报价，运行每一项检查并显示真实卡片，但按确认时的报价记录每笔成交，不在链上发送任何交易。它的模拟资产从 1 BNB 和 500 USDT 开始。像对人说话一样给你的机器人发消息，例如：

```text
用 BNB 买 10 USDT。
```

Agent 会用一张卡片提议这笔交易。确认它，然后发送 `/positions` 查看你的模拟持仓。

## 卡片和确认

一张卡片显示一个操作的条款：从钱包转出什么、至少收到多少、费用，以及任何警告。模拟卡片会注明这一点。点按“确认”继续，或点按“取消”。交易卡片 60 秒后过期，其他卡片 10 分钟后过期，没有人回复的卡片不会发送任何内容。

在默认的手动模式下，每笔链上交易都要等你在卡片上点按。[安全指南](/zh-cn/guides/safety/)说明了哪些操作在任何模式下都需要卡片。

你可以在任何界面回复卡片：Telegram、控制台、`binference chat` 打开的终端对话，或者在命令行运行 `binference confirm <id>` 和 `binference deny <id>`。最先的回复生效。运行 `binference console` 可以得到一个在浏览器中打开控制台的链接。

## 你的限额

引擎在每张卡片之前检查限额。用下面的命令查看：

```sh
binference limit
```

用 `binference limit set` 修改，每个限额写成 `key=value`：

```sh
binference limit set limits.perTradeUsd=50
```

更严格的限额立即生效。更宽松的限额要等 24 小时，并且你会收到通知，所以不是你做的更改可以用 `binference limit cancel` 阻止。在 Telegram 中，`/limits` 显示限额，它的按钮只能让限额更严格。

## 切换到实盘

当你想用真实资金交易时：

1. 运行 `binference wallet address` 查看你的 Agent 钱包地址，并向它转入 BNB Chain 上的 BNB。Agent 会从中留出 0.002 BNB 支付网络手续费。
2. 在这台 Mac 的“终端”中运行 `binference live`。除非你在 init 时已经接受，它会显示免责声明和隐私声明，并要求你输入 `我明白`。钱包有资金之前，它会拒绝切换。

第一张实盘卡片会说明这笔交易使用真实资金。要切换回去，请运行 `binference paper`，或在 Telegram 中发送 `/paper`。

## 冻结和紧急转出

- **冻结**立即停止一切：在 Telegram 中发送 `/freeze`，或运行 `binference freeze`。每张打开的卡片和每个尚未签名的操作都会被取消，自动订单暂停。要解除冻结，请运行 `binference unfreeze` 并确认它打开的卡片。
- **紧急转出**把每个 Agent 钱包中的一切转到你的紧急转出地址：在 Telegram 中发送 `/rescue`，或运行 `binference rescue`，然后确认它的卡片。冻结时和模拟模式下也能使用，在模拟模式下它转移的是真实资金。

## 接下来

- [与 Agent 对话](/zh-cn/guides/chat/)：Telegram 命令、控制台和终端对话。
- [安全](/zh-cn/guides/safety/)：自动模式、上限和你的两把密钥。
- [自动订单和提醒](/zh-cn/guides/auto-orders/)：限价单、止盈、止损等。
