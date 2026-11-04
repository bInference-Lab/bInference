---
title: 远程访问和提醒规则
description: 通过 Tailscale 从 Telegram 打开 Mini App，并让 TradingView 或其他发送方的提醒按你确认过一次的规则成交。
---

引擎只在你的机器上监听。`binference expose` 通过 Tailscale 发布其中两部分：在你的 tailnet 内发布 Mini App；如果你要求，还会在互联网上发布提醒规则接收提醒的路径。

## 远程访问

### 准备

- 在引擎所在的机器上安装 Tailscale，并用 `tailscale up` 登录。
- 在 Tailscale 管理后台的 DNS 页面开启 HTTPS 证书。
- 如果要接收来自互联网的提醒：在 tailnet 的策略文件中允许这台机器使用 Funnel。
- 在 Linux 上，运行一次 `sudo tailscale set --operator=$USER`，让你的账号可以修改 Tailscale 的设置。

### 发布 Mini App

```sh
binference expose
```

Tailscale 会在这台机器的 Tailscale 名称的 443 端口上提供引擎，仅限你的 tailnet 内访问。binference 会把这个地址写入 `remote.publicUrl`，除非你已在那里填写了自己的地址。运行 `binference restart` 后，Telegram 中的 `/console` 会在这个地址打开 Mini App。你的手机必须在同一个 tailnet 中。

### 发布提醒路径

```sh
binference expose --webhooks
```

这会通过 Tailscale Funnel，在 8443 端口额外发布提醒规则接收提醒的路径 `/hook/`。互联网上的任何人都能访问它，因此 binference 会先说明地址并询问你；在脚本中可用 `--yes` 代为回答。只有规则的密钥 URL 才会触发成交，而且只有 `/hook/` 路径是公开的：引擎和 Mini App 仍只在你的 tailnet 内。

binference 会完整占用 443 和 8443 端口。如果 Tailscale 已在那里提供了不是 binference 设置的服务，它不会做任何修改，并会告诉你（`remote.port_taken`）。

### 取消发布

```sh
binference expose --off
```

它只移除 binference 发布的、且仍保持 binference 设置原样的内容。其他仍在发布引擎端口的内容会被列出，并附上移除它们的 `tailscale` 命令，此时命令以 1 退出。提醒规则保留它们的 URL。

`binference check` 总会读取 Tailscale 实际发布的内容，不依赖 `config.json5` 中的记录。引擎出现在互联网上，或者除提醒路径之外的任何内容出现在互联网上时，它都会报错。`config.json5` 中的 `remote.mini` 和 `remote.webhooks` 只是记录：修改它们不会发布任何内容。

## 提醒规则

提醒规则让传入的提醒（例如 TradingView 提醒的 webhook）在你确认过一次的卡片范围内触发一笔交易。提醒从不决定数量、方向或代币：这些都由规则决定。

:::caution[提醒规则只在模拟模式下成交]
实盘提醒规则的成交目前是关闭的。Agent 处于实盘时，binference 会拒绝新的提醒规则，错误为 `order.live_fills_off`。请在 Agent 处于模拟模式时创建规则，每条提醒都会以真实价格模拟成交。
:::

### 创建规则

只有你可以创建规则，在命令行或控制台的提醒规则页面中创建。Agent 和 MCP 客户端都不能创建。在命令行中：

```sh
binference webhook create --name "CAKE breakout" --token CAKE --side buy --usd 20 --rate 1
```

用 `--usd`、`--amount` 或 `--percent` 之一给出每次成交的数量。其他范围：

- `--spend`：买入时花费的资产；默认为链的原生币。
- `--worst-price`：成交接受的最差价格，单位为每个代币的美元价格。
- `--slippage`：成交接受的最大滑点；不能超过 Agent 的限额。
- `--max-fills`：规则结束前的最多成交次数。
- `--rate`：规则每分钟接受的提醒数量，1 到 60；默认 1。
- `--ttl`：规则的有效期，最长 `365d`；默认 30 天。

命令会显示一次规则的 URL，然后显示卡片。确认卡片后 URL 才会生效。binference 只保存 URL 中密钥的哈希；如果丢失了 URL，请更换它。

每个 Agent 最多有 20 条规则。在你运行 `binference expose --webhooks` 之前创建的规则，其 URL 只在这台机器上有效；更换 URL 即可获得公开地址。

### 在 TradingView 中使用

1. 在 TradingView 中创建或编辑一个提醒。
2. 在它的通知设置中开启 Webhook URL，并粘贴规则的 URL。
3. 消息内容可以随意填写。binference 读取消息正文只是为了识别重复：10 分钟内正文相同的提醒是重复提醒，不会成交；JSON 中 `id` 字段与之前相同的提醒也是如此。如果提醒会以相同的文字多次触发，请在消息中加入一个会变化的值，例如 TradingView 的 `{{timenow}}`。

任何能发送 HTTPS POST 请求的发送方都可以这样使用。正文最大 16 KiB。

### 提醒会做什么

- 提醒只在到达后 60 秒内成交；更晚的会被跳过，也不会补做。
- 超过规则速率的提醒会被记录，但不会成交；发送方收到状态码 429。
- 未知或错误的 URL 收到 404，所有情况都是同样的回答。
- 每次成交都计入 Agent 的 24 小时上限，与其他交易相同。
- 成交和跳过都会发送通知，每条规则每小时最多 5 条，其余的由一条 [`webhookHeld`](/zh-cn/reference/notices/#webhookheld) 汇总。
- 连续 5 次成交失败后，规则会被删除，并发送 [`webhookRuleFailing`](/zh-cn/reference/notices/#webhookrulefailing) 通知。
- 冻结会停止所有规则的成交。

### 管理规则

| 命令                               | 用途                                |
| ---------------------------------- | ----------------------------------- |
| `binference webhook list`          | 列出生效中或等待卡片确认的规则      |
| `binference webhook events <rule>` | 列出规则收到的提醒及每条的结果      |
| `binference webhook rotate <rule>` | 给规则一个新的 URL；旧 URL 立即失效 |
| `binference webhook delete <rule>` | 删除规则；它的 URL 立即失效         |

更换 URL 后，旧 URL 收到但仍在等待的提醒会被丢弃。你会收到 [`webhookRotated`](/zh-cn/reference/notices/#webhookrotated) 通知；如果不是你更换的，请删除这条规则。

监听器运行在 `engine.webhookPort`，默认 7457。如果这个端口被占用，引擎会在没有监听器的情况下运行，并发送 [`webhookPortTaken`](/zh-cn/reference/notices/#webhookporttaken) 通知。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`expose` 和 `webhook`。
- [配置项](/zh-cn/reference/config/)：`remote.*` 和 `engine.webhookPort`。
- [自动订单](/zh-cn/guides/auto-orders/)：其他无需卡片即可成交的交易。
