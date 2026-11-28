<p><a href="CHANGELOG.md">English</a> · <b>简体中文</b></p>

# 更新日志

binference 每个版本中对所有者有影响的变化，最新的在前。

## 2026.11.0-beta.2

跨链，以及测试版第一周的修复。

它能做什么：

- 你的 Agent 可以把 USDC、USDT 和 ETH 从 BNB Smart Chain 跨链到 Ethereum、Base、Arbitrum、Solana 和
  Robinhood Chain。它同时向 Across 和 Relay 询价，选择到账最多的路由。
- 跨链只付款给你用所有者密钥保存的地址，或在可以支付时付给你的紧急转出地址。卡片写明收款地址、至少到账的数量、
  费用和时间；费用达到 1% 时还会写明占比。binference 会读取目标链，到账后通知你。
- 新建的 Agent 可以直接通过 Across 跨链。Relay 跨链从跨链钱包转出，用
  `binference wallet create --bridge` 创建，并由你自己充值。
- 把跨链平台加入 Agent 的可用平台会立即生效，保存地址后跨链也可以立即付给它。
- 交易结算后，Agent 不再重复回执。空闲时引擎占用的内存更少。

已修复：

- 运行 `binference init --start-over` 之后，钱包命令失败并提示“钱包服务暂无响应”。
- Agent 在目标链上查找跨链代币，没有提出跨链就停止了。

已知限制：

- 用 2026.11.0-beta.1 创建的 Agent 没有跨链平台：按跨链指南，用 `binference ceiling set --venues` 和
  `binference limit set limits.venues=` 加入 `across`。
- 在 Base、Ethereum 和 Arbitrum 上，binference 要等该链把区块最终确认后才记为到账，可能在钱包显示到账后
  约一小时。
- 仅支持 macOS。自动订单和 webhook 规则只在模拟模式下成交。

## 2026.11.0-beta.1

首个公开测试版，适用于 macOS。用以下命令安装：
`curl -fsSL https://agent.binference.io/install.sh | sh -s -- --beta`。

它能做什么：

- 一个在你的 Mac 上替你在 BNB Smart Chain 上交易的 AI Agent。可在 Telegram、网页控制台或
  `binference chat` 打开的终端对话中与它对话。
- 它从模拟模式开始：真实的报价、检查和卡片，不动用任何资金。模拟投资组合初始有 1 BNB 和
  500 USDT。
- 在默认的手动模式下，每笔交易都以一张列明准确条款的卡片出现，你确认之前不会动用任何资金。
- 在“终端”中运行 `binference live`，即可用 Agent 钱包中的真实资金交易；运行 `binference paper`
  或发送 `/paper` 切换回模拟模式。
- `/freeze` 或 `binference freeze` 立即停止一切。`/rescue` 或 `binference rescue` 在你确认卡片后，
  把每个 Agent 钱包中的资金转到你的紧急转出地址，并留下 0.002 BNB 用作网络费。
- 你的钱包保存在 Privy 中，受上限约束，只有你的所有者密钥能修改。

已知限制：

- 只支持 macOS。安装脚本在其他系统上会停止；Linux 和 Windows 将在之后的版本中支持。
- 自动订单和 webhook 规则只在模拟模式下成交。
- 没有 Docker 镜像。
