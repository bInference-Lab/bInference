<p><a href="CHANGELOG.md">English</a> · <b>简体中文</b></p>

# 更新日志

binference 每个版本中对所有者有影响的变化，最新的在前。

## 2026.11.0-beta.1

首个公开测试版，适用于 macOS。用以下命令安装：
`curl -fsSL https://binference.io/install.sh | sh -s -- --beta`。

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
