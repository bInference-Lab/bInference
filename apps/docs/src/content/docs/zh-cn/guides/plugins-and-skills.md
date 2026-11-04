---
title: 插件、技能和 MCP
description: 添加在沙箱中为 Agent 提供新读取工具的社区插件，了解 Agent 遵循的技能，并连接 MCP 客户端。
---

## 社区插件

社区插件为 Agent 提供读取数据的新工具，例如某个市场指数。它只读取：从不签名、不持有密钥、不提议交易，也不访问它没有声明的主机。每个插件在自己独立的 Node 进程中、在沙箱内运行，binference 只替它发出其清单允许的网络请求。

### 添加插件

在引擎所在机器的终端中运行，npm 包要写明确切版本：

```sh
binference plugin add npm:fear-index@1.2.0
```

binference 从 npm 读取这个包，按 npm 的完整性校验值检查它（也可以用 `--hash` 自己提供），然后显示权限审核：

- 插件可以访问的主机
- 它添加的工具及各自的描述
- 它从 `config.json5` 的 `plugins.<id>` 读取的配置项
- 它的 npm 来源证明：发布它的代码仓库和构建，离线核验

接受审核即可添加。没有 npm 来源证明的插件会要求你输入它的名称，在脚本中可以用 `--name` 传入。添加插件只能在终端中进行；其他界面都不显示审核。

### 更新

binference 从不自动更新插件。用新版本运行 `binference plugin add`。没有声明更多内容且发布者不变的更新会立即安装。增加主机、工具或配置项、更换发布者或退回旧版本的更新会再次显示审核，并列出变化。更新失败时，原来的版本保留。

### 管理插件

| 命令                               | 用途             |
| ---------------------------------- | ---------------- |
| `binference plugin list`           | 列出已安装的插件 |
| `binference plugin enable <name>`  | 启用插件         |
| `binference plugin disable <name>` | 立即停用插件     |
| `binference plugin remove <name>`  | 移除插件及其数据 |

### 插件对 Agent 的影响

Agent 看到的插件工具名称为 `<plugin>__<tool>`，例如 `fear_index__score`。插件的回答属于外部内容。只要有已启用的插件提供工具，每个对话从一开始就算作读过外部内容，因此[自动模式](/zh-cn/guides/safety/#自动模式)会在每张卡片上询问你。停用插件即可恢复自动模式。

### 沙箱

- 插件没有自己的网络连接，不能启动程序，也不能打开它自己的包和数据文件夹之外的文件。
- 它的网络请求由 binference 发出：只能是 `https`，只能访问它声明的主机，且必须是公网地址，每个请求 15 秒。
- 它最多使用 256 MiB 堆内存，总内存 512 MiB。每次调用限时 30 秒。
- 崩溃后它会重新启动，每次等待更久。10 分钟内崩溃 5 次后会被关闭，并发送 [`pluginStopped`](/zh-cn/reference/notices/#pluginstopped) 通知。
- 在任何插件启动之前，binference 会检查沙箱在这台机器上是否有效。`binference check` 中显示为 `plugins.sandbox`。沙箱无效时，任何插件都不会运行，你会收到 [`pluginSandboxOff`](/zh-cn/reference/notices/#pluginsandboxoff) 通知。
- 每次启动前，binference 都会检查插件的文件是否仍是你添加时的文件。

在 Docker 中，插件以独立的用户运行；[Docker 指南](/zh-cn/guides/docker-vps/)说明了如何为此启动容器。

## 技能

技能是 Agent Skills 格式（`SKILL.md`）的操作手册，任务匹配时 Agent 会打开它。技能不添加工具，也不改变限额：它引出的任何操作仍要经过 Agent 的工具、卡片和上限。binference 自带以下技能：

| 技能                  | Agent 用它做什么                                                  |
| --------------------- | ----------------------------------------------------------------- |
| `safe-swap`           | 查找代币，检查其风险、你的限额和余额，然后提议一笔交易            |
| `token-due-diligence` | 检查代币的风险、交易税、流动性、内部钱包和 K 线，并注明每项的来源 |
| `meme-hunting`        | 扫描新发射或热门代币，筛选后最多提议一笔小额买入                  |
| `dca-plan`            | 把定期买入的想法变成一个在你限额内的定投订单                      |
| `copy-trading`        | 把跟随某个钱包的想法变成一个带上限的跟单订单                      |

这些技能从不替你决定金额，也从不起草发射。

## MCP 客户端

`binference mcp` 向 Claude Code 或 Codex 等 MCP 客户端提供 binference 的工具。MCP 客户端可以读取和提议，但不能确认：每个提议都会打开一张等你确认的卡片，自动模式也从不执行来自 MCP 客户端的提议。

- `binference mcp setup --client claude-code` 为客户端提供它自己的访问令牌、MCP 服务器配置和 `binference-tools` 技能。`--remove` 会把它们收回，`--dry-run` 只显示改动，`--ttl 7d` 让访问令牌到期失效。
- `binference mcp session --client codex` 启动客户端一次，所用的访问令牌随会话结束而失效，默认一小时。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`plugin` 和 `mcp`。
- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：每个工具。
- [通知](/zh-cn/reference/notices/)：每条插件通知。
