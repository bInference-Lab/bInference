# binference

[English](README.md) · **简体中文**

binference 是一个开源的 AI Agent，在 BNB Smart Chain 上替所有者交易。它运行在你自己的电脑上，通过 Telegram、网页控制台和终端与你对话，每笔交易前都会先问你。它只在你设定的限额内，用它自己的钱包交易。

> binference 目前是测试版。请先用模拟模式，不要存入超出你能承受损失的资金。

## 安装

binference 需要 Node 26.1 或更高版本。

```sh
npm install --global binference
binference --version
```

## 第一步

```sh
binference init     # 语言、模型、钱包、紧急转出地址、Telegram 机器人和限额
binference start    # 在后台运行引擎，处于模拟模式
binference chat     # 在终端里和你的 Agent 对话
```

1. `binference init` 逐个提问，结束时处于模拟模式：真实的报价、检查和卡片，不移动任何资金。
2. `binference start` 以后台服务启动引擎，`binference status` 显示它的运行状态。
3. 在 `binference chat` 或 Telegram 里让你的 Agent 做一笔小额兑换。它会回复一张卡片，列出交易、价格和限额；确认后，这笔模拟交易按报价成交。
4. 当你信任所看到的结果后，用 `binference live` 切换到实盘。

## 链接

- 网站：<https://binference.io>
- 源码和文档：<https://github.com/bInference-Lab/bInference>
- 报告安全问题：见仓库中的 `SECURITY.md`。

MIT 许可证。第三方声明见 `NOTICES.md`。
