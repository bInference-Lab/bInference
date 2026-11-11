---
title: "命令"
description: "binference 的每个命令及其参数和选项。"
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

`binference` 的每个命令及其参数和选项，与命令帮助中显示的一致。在终端运行 `binference <command> --help` 可看到相同的文字。每个命令还接受以下选项：

- `--json`: 输出供脚本使用的 JSON，而不是文字。
- `--yes`: 对每个问题都回答是。
- `-h, --help`: 显示命令的帮助。

## `binference init`

设置 binference：你的 Privy 应用、所有者密钥、第一个钱包和机器人。

选项：

- `--privy-app-id <id>`: 你的 Privy 应用 ID。
- `--privy-app-secret <source>`: Privy 应用密钥的密钥来源，按 config.json5 的写法。
- `--bot-token <source>`: 机器人 Token 的密钥来源，按 config.json5 的写法。
- `--rescue <address>`: 你在 BNB Chain 上的紧急转出地址。
- `--owner-key-public <key>`: `binference owner-key create` 打印的所有者密钥公钥部分；init 随后不再创建所有者密钥。
- `--unlock <mode>`: 此机器保存 Agent 密钥的位置：`keychain`、`file`、`manual` 或 `command`。取值为 `keychain`, `file`, `manual`, `command` 之一。
- `--unlock-command <source>`: 与 --unlock command 一起使用：输出 Agent 密钥的程序，按 config.json5 的写法。
- `--model-provider <provider>`: 模型服务商：`binference`、`openai`、`anthropic`、`openrouter`、`openai-compatible` 或 `anthropic-compatible`。
- `--model-base-url <url>`: 使用兼容的服务商时：它的接口地址。
- `--model <id>`: 模型在服务商处的 ID。
- `--model-key <source>`: 服务商 API 密钥的密钥来源，按 config.json5 的写法。
- `--proxy <url-or-source>`: 你的代理：按 config.json5 写法的密钥来源；init 的检查经它发送，init 也会把它写入 config.json5。
- `--accept-disclaimer`: 终端前无人时：完整显示免责声明和隐私声明，并接受它们。
- `--answers <file>`: 按选项名（驼峰写法）给出回答的 JSON5 文件，密钥只写密钥来源。
- `--set <key=value>`: 在 init 写入的文件中设置一个配置项，写作 `key=value`。
- `--start-over`: 用新的所有者密钥和新钱包重新设置一个已设置过的文件夹。
- `--attach`: 用新的 Agent 密钥和所有者密钥让此机器成为该安装各钱包的签名方；被替换的密钥不再能签名。
- `--restore <file>`: 与 --attach 一起使用：接入前先恢复这个备份文件，用所有者密钥打开。

## `binference start`

以后台服务启动引擎，每次登录时都会再次启动。

选项：

- `--set <key=value>`: 为本次运行设置一个配置项，写作 `key=value`。
- `--foreground`: 改为在此终端中运行引擎，直到你按下 Ctrl+C；后台服务就是这样运行它的。

## `binference restart`

停止引擎，然后以后台服务再次启动它。

选项：

- `--set <key=value>`: 为本次运行设置一个配置项，写作 `key=value`。

## `binference status`

显示引擎是否在运行、它的 Agent 和健康信号。

## `binference health`

检查引擎是否在运行并已就绪。

## `binference stop`

停止引擎；你登录时，后台服务会再次启动它。

## `binference console`

生成一次性链接，将浏览器与控制台配对。

## `binference report`

生成可分享的诊断包：版本、配置、检查结果和最新的日志，不含任何密钥。

## `binference unlock`

打开 Agent 密钥，让 binference 可以签名；手动解锁方式下会询问密码短语。

## `binference logs`

显示引擎的日志。

选项：

- `-n, --lines <count>`: 显示最后多少行。
- `-f, --follow`: 持续显示新行，直到你按 Ctrl+C。

## `binference approval`

显示 Agent 的批准模式，或把它设为手动或自动。

参数：

- `[mode]`: 要设置的批准模式：手动或自动。取值为 `manual`, `auto` 之一。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference chat`

在终端中与 Agent 对话：查看它的回答、卡片、问题和通知。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference live`

把 Agent 切换到实盘：它的交易使用其钱包中的真实资金。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference paper`

把 Agent 切换回模拟模式，不会发送链上交易。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference agent`

单个 Agent 的命令：它的链上身份。

### `binference agent identity`

查看 Agent 的链上身份，或用所有者密钥让它加入，并打开登记它的卡片。

选项：

- `--description <text>`: 关于 Agent 的简短说明，将永久公开在链上；1 到 280 个字符。
- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference confirm`

确认某个操作的卡片，与点按其“确认”按钮相同。

参数：

- `<intent>`: 该操作的 ID，以 int_ 开头。必填。

## `binference deny`

取消某个操作的卡片，与点按其“取消”按钮相同。

参数：

- `<intent>`: 该操作的 ID，以 int_ 开头。必填。

## `binference wallet`

列出 Agent 钱包，并显示充值地址。

### `binference wallet list`

列出 Agent 钱包，以及每个钱包的标签和地址。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

### `binference wallet address`

显示 Agent 默认钱包的充值地址。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--wallet <id>`: 钱包的 ID；不填时使用 Agent 的默认钱包。

### `binference wallet export`

在警告之后显示一次钱包的私钥；需要所有者密钥。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--wallet <id>`: 钱包的 ID；不填时使用 Agent 的默认钱包。

### `binference wallet create`

新建一个有自己上限的 Agent 钱包；需要所有者密钥。

选项：

- `--label <text>`: 钱包的名称，例如储蓄。必填。
- `--launch`: 创建该 Agent 的发射钱包，只有它能在发射项目自身的联合曲线上交易。
- `--bridge`: 创建该 Agent 的跨链钱包，只有它能向不指定收款人的跨链桥（如 Relay）存入。
- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference ceiling`

显示托管方保存的钱包上限：它的链、平台、单笔上限、转账可以转入的地址，以及 24 小时上限。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--wallet <id>`: 钱包的 ID；不填时使用 Agent 的默认钱包。

### `binference ceiling set`

用所有者密钥修改该 Agent 所有钱包的上限：合约调用可以使用的平台，以及一次合约调用最多可携带的金额；或修改所有钱包共用的 24 小时上限。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--wallet <id>`: 钱包的 ID；不填时使用 Agent 的默认钱包。
- `--venues <ids>`: 合约调用可以使用的全部平台，用逗号分隔，例如 kyberswap,okx。
- `--per-tx <amount>`: 一次合约调用最多可携带的原生币数量，例如 0.5。
- `--day-cap-usd <dollars>`: 每个 24 小时上限按底价计算的美元金额，例如 2000。

## `binference freeze`

冻结所有 Agent 和本安装，或 --agent 指定的 Agent：其已打开的卡片和未签名的操作都会被取消。

选项：

- `--agent <id>`: Agent 的 ID；不填时针对所有 Agent 和本安装。

## `binference unfreeze`

为所有已冻结的 Agent 或 --agent 指定的 Agent 打开解除冻结卡片；确认后即解除冻结。

选项：

- `--agent <id>`: Agent 的 ID；不填时针对所有 Agent 和本安装。

## `binference rescue`

打开紧急转出卡片：把每个 Agent 钱包中的全部资产转到你的紧急转出地址。

### `binference rescue set`

24 小时后将某个地址设为紧急转出地址；需要所有者密钥。

参数：

- `<address>`: 你自己钱包在 BNB Chain 上的地址，以 0x 开头。必填。

### `binference rescue cancel`

取消等待生效的紧急转出地址更改；当前生效的紧急转出地址保持不变。

## `binference safety`

显示哪些已冻结、正在进行的紧急转出和紧急转出地址。

### `binference safety status`

显示哪些已冻结、正在进行的紧急转出和紧急转出地址。

## `binference telegram`

将机器人的所有者换成另一个 Telegram 账户。

### `binference telegram pair`

生成新链接，将另一个 Telegram 账户设为机器人的所有者；链接被打开前，当前所有者保持不变。

## `binference backup`

创建和查看安装的备份。

### `binference backup create`

立即创建一个备份，用所有者密钥加密，保留到你删除为止。

### `binference backup list`

列出备份，最新的在前。

### `binference backup restore`

恢复此安装的备份：停止 binference，放入备份，再按原来的方式启动 binference。

参数：

- `<file>`: 备份文件，扩展名为 .bnfbak。必填。

选项：

- `--set <key=value>`: 为本次运行设置一个配置项，写作 `key=value`。

## `binference signer`

管理为钱包签名的机器及其 Agent 密钥。

### `binference signer revoke`

从所有钱包移除一台机器的 Agent 密钥；需要所有者密钥。

参数：

- `<signer>`: 签名方 ID：该机器 Agent 密钥的密钥组，即 `binference init --attach` 显示的 ID。必填。

## `binference owner-key`

在有终端的机器上创建所有者密钥，用于在没有终端的机器上设置的安装。

### `binference owner-key create`

创建所有者密钥，在此终端中只显示一次其代码，并打印其公钥部分。

## `binference service`

管理在你登录时启动 binference 的后台服务。

### `binference service remove`

停止 binference，并从此机器移除它的后台服务；状态文件夹保留。

## `binference address`

列出、保存和删除转账可用的收款地址。

### `binference address list`

列出 Agent 已保存的地址，以及每个地址何时可以接收转账。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

### `binference address add`

把地址保存到地址簿和各钱包的上限中，在其所在链上转账或跨链到该链时可向其付款；需要所有者密钥。

参数：

- `<address>`: 按所在链的写法填写地址：EVM 链上为 0x 加 40 位十六进制，Solana 上为 base58。必填。

选项：

- `--label <text>`: 地址的名称，例如冷钱包。必填。
- `--chain <key>`: 地址所在的链，用其在注册表中的名称填写，例如 base-mainnet 或 solana；不填时为 BNB Smart Chain。
- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

### `binference address remove`

删除一个已保存的地址：此后 binference 不会再向它转账。

参数：

- `<entry>`: 地址簿条目的 ID，以 adr_ 开头。必填。

## `binference webhook`

创建、列出、更换地址和删除提醒规则：每当有提醒到达规则的地址，规则就在其范围内以模拟方式成交。

### `binference webhook list`

列出已生效或正在等待卡片确认的提醒规则。

### `binference webhook create`

按给定范围创建提醒规则，只显示一次其地址，然后显示其卡片供你确认。

选项：

- `--name <text>`: 提醒的名称，显示在规则的卡片上，1 到 64 个字符。必填。
- `--token <token>`: 每次提醒交易的代币：其符号（例如 CAKE）或地址。必填。
- `--side <side>`: 每次提醒买入还是卖出该代币。必填。取值为 `buy`, `sell` 之一。
- `--usd <dollars>`: 每次成交的金额（美元），例如 20。
- `--amount <amount>`: 每次成交的数量，例如 0.5：买入时为所花费的资产，卖出时为所卖出的代币。
- `--percent <percent>`: 每次成交占余额的百分比，例如 25：买入时为所花费的资产，卖出时为所卖出的代币。
- `--spend <token>`: 买入时花费的资产：符号或地址；不填写时为该链的原生币。
- `--worst-price <dollars>`: 每次成交接受的最差价格，单位为美元每枚代币；不填写时不设最差价格。
- `--slippage <percent>`: 每次成交的滑点上限，百分比，例如 0.5；不填写时使用 Agent 的限额。
- `--max-fills <count>`: 规则结束前最多成交的次数；不填写时不限次数。
- `--rate <count>`: 规则每分钟最多接收的提醒数，1 到 60；不填写时为 1。
- `--ttl <duration>`: 规则的有效期，例如 7d，最长 365d；不填写时为 30 天。
- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--wallet <id>`: 钱包的 ID；不填时使用 Agent 的默认钱包。

### `binference webhook events`

列出规则地址收到的提醒及每条提醒的结果，最新的在前。

参数：

- `<rule>`: 提醒规则的 ID，以 whr_ 开头，可通过 `binference webhook list` 查看。必填。

选项：

- `--before <event>`: 显示比这条更早的提醒，按列表中显示的编号。

### `binference webhook rotate`

为提醒规则更换新地址，只显示一次；旧地址立即失效。

参数：

- `<rule>`: 提醒规则的 ID，以 whr_ 开头，可通过 `binference webhook list` 查看。必填。

### `binference webhook delete`

删除提醒规则；其地址立即失效。

参数：

- `<rule>`: 提醒规则的 ID，以 whr_ 开头，可通过 `binference webhook list` 查看。必填。

## `binference credential`

列出、存储和删除 Agent 请求的凭据，Agent 永远看不到它们。

### `binference credential list`

按名称列出已存储的凭据，以及每个凭据可发送到的主机。

### `binference credential set`

在隐藏输入框中输入并存储凭据，以及它可发送到的主机。

参数：

- `<name>`: 凭据名称，例如 API 密钥的名称 DUNE_API_KEY。必填。

选项：

- `--allow-host <host>`: 凭据可发送到的主机，例如 api.dune.com；可重复以添加更多。

### `binference credential delete`

删除已存储的凭据。

参数：

- `<name>`: 凭据名称，例如 API 密钥的名称 DUNE_API_KEY。必填。

## `binference plugin`

添加、列出、启用、停用和移除社区插件。

### `binference plugin add`

经权限审核后从 npm 添加或更新社区插件。

参数：

- `<source>`: 插件的 npm 包及确切版本，例如 npm:fear-index@1.2.0。必填。

选项：

- `--hash <integrity>`: 该版本的 npm 完整性值（sha512-...）；省略时从 npm 读取。
- `--name <name>`: 插件名称，没有 npm 来源证明的插件需要输入。

### `binference plugin list`

列出已安装的社区插件。

### `binference plugin enable`

启用一个已安装的插件。

参数：

- `<name>`: 插件名称，与 `binference plugin list` 显示的一致。必填。

### `binference plugin disable`

立即停用一个已安装的插件。

参数：

- `<name>`: 插件名称，与 `binference plugin list` 显示的一致。必填。

### `binference plugin remove`

移除一个已安装的插件及其数据。

参数：

- `<name>`: 插件名称，与 `binference plugin list` 显示的一致。必填。

## `binference skill`

审阅 Agent 提议的技能，以及等待你接受的工作区技能。

### `binference skill proposals`

列出 Agent 的技能提案及其待接受的工作区技能。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。
- `--all`: 同时列出已应用、已拒绝和已过时的提案。

### `binference skill show`

完整显示一个技能提案：扫描结果和改动。

参数：

- `<proposal>`: 技能提案的 skp_ id。必填。

### `binference skill apply`

阅读后应用一个技能提案。

参数：

- `<proposal>`: 技能提案的 skp_ id。必填。

### `binference skill reject`

拒绝一个技能提案。

参数：

- `<proposal>`: 技能提案的 skp_ id。必填。

选项：

- `--reason <text>`: 原因，一行文字，Agent 在下一轮读取。

### `binference skill accept`

按当前文件接受一个待接受的工作区技能。

参数：

- `<name>`: 待接受的工作区技能的名称。必填。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference limit`

显示 Agent 当前生效的限额，以及等待生效的较宽松限额。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

### `binference limit set`

修改 Agent 的限额，每项写作 `key=value`：更严格的立即生效，更宽松的 24 小时后生效。

参数：

- `<sets...>`: 每项限额写作 `key=value`，名称和单位与 config.json5 中的 `defaults` 相同，例如 limits.perTradeUsd=50。必填。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

### `binference limit cancel`

放弃等待生效的较宽松限额；当前生效的限额保持不变。

选项：

- `--agent <id>`: Agent 的 ID；不填时使用唯一的 Agent。

## `binference config`

查看和修改 config.json5 中的配置。

### `binference config get`

显示加载后的配置或其中一个配置项，每个密钥只显示其来源的类型。

参数：

- `[key]`: 配置项，各部分用点连接，例如 `engine.port`。

### `binference config set`

通过引擎修改 config.json5 中的一个配置项，并保留文件中的注释。

参数：

- `<key>`: 配置项，各部分用点连接，例如 `engine.port`。必填。
- `[value]`: 值，按 JSON5 读取（7460、true、"text"、[1, 2]，null 表示删除该配置项），否则按文本读取。

选项：

- `--from-env <variable>`: 把该配置项设为读取此环境变量的密钥来源。
- `--from-keychain <name>`: 把该配置项设为读取此钥匙串条目的密钥来源。
- `--from-credential <name>`: 把该配置项设为读取引擎中保存的此凭据的密钥来源。
- `--reason <text>`: 修改原因，记入配置日志。

## `binference mcp`

通过 stdio 向 MCP 客户端提供 MCP 工具；由客户端启动。

选项：

- `--client <name>`: 用哪个 MCP 客户端的访问令牌登录：claude-code 或 codex。取值为 `claude-code`, `codex` 之一。

### `binference mcp setup`

设置 MCP 客户端：它自己的访问令牌、MCP 服务器条目和 binference-tools 技能。

选项：

- `--client <name>`: 要设置的 MCP 客户端：claude-code 或 codex。必填。取值为 `claude-code`, `codex` 之一。
- `--dry-run`: 只显示改动，不做任何改动。
- `--remove`: 撤销设置：移除 MCP 服务器条目和技能，并撤销访问令牌。
- `--ttl <duration>`: 新建一个在这段时间后过期的访问令牌：如 30m、12h 或 7d，最长 90d。不加此项则访问令牌不会过期。

### `binference mcp session`

以 binference 工具和一个随会话结束的访问令牌启动一次 Claude Code 或 Codex。

参数：

- `[clientArgs...]`: 传给客户端的参数，写在 -- 之后。

选项：

- `--client <name>`: 要启动的 MCP 客户端：claude-code 或 codex。必填。取值为 `claude-code`, `codex` 之一。
- `--ttl <duration>`: 本次会话的访问令牌有效多久：如 30m、2h 或 1d，最长 24h；不加此项则为 1h。
- `--print-config`: 为你自己启动的客户端打印配置和访问令牌，不启动任何程序。

## `binference check`

检查此安装：配置、谁可以打开它的文件、解锁方式和引擎。

选项：

- `--fix`: 修复检查可以修复的问题：让其他账户可以打开的文件和文件夹只归你所有。

## `binference reset`

在做好加密备份后清除 Agent 的对话、笔记和缓存；钱包、密钥、限额、订单和历史记录保留。

选项：

- `--set <key=value>`: 为本次运行设置一个配置项，写作 `key=value`。

## `binference expose`

通过 Tailscale 在你的 tailnet 内发布 Mini App；加 --webhooks 时也发布提醒规则接收提醒的路径。

选项：

- `--webhooks`: 同时通过 Tailscale Funnel 将提醒规则接收提醒的路径发布到互联网；会先询问你。
- `--off`: 移除 binference 通过 Tailscale 发布的内容；Tailscale 提供的其他服务保持不变。

## `binference update`

从 npm 安装更新的 binference 版本并检查；检查未通过时恢复旧版本。

选项：

- `--to <version>`: 要安装的版本，例如 2026.11.0；不填时为 updates.channel 上的最新版本。
- `--set <key=value>`: 为本次运行设置一个配置项，写作 `key=value`。

## `binference uninstall`

移除 binference 的后台服务和程序；加 --state 时也移除状态文件夹。

选项：

- `--state`: 同时移除状态文件夹：其中的配置、数据库、密钥、日志和备份。
