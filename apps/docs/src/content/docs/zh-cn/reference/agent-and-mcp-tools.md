---
title: "Agent 工具和 MCP 工具"
description: "Agent 的模型调用的工具，以及 binference mcp 提供给 MCP 客户端的工具。"
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

## Agent 工具

Agent 的模型在一轮中可以调用的工具，按每轮提供的顺序排列。读取工具只读取；提议工具打开一张卡片，由所有者确认；控制工具设置提醒或定时任务、保存笔记或询问所有者。网络工具需要搜索 API 密钥，`search_x` 需要 X 的 API 密钥。每个已启用的社区插件会加入自己的工具。

- `token_search` (读取): 按代币符号、名称或合约地址查找代币的 id。
- `addresses` (读取): 读取所有者为这个 Agent 保存的地址簿。
- `wallets` (读取): 读取 Agent 自己的钱包：每个钱包的用途、所在链和地址，以及它的模式。
- `portfolio` (读取): 读取 Agent 的余额、持仓和盈亏。
- `token_info` (读取): 读取代币的符号、名称、精度和最近一次风险检查。
- `token_risk` (读取): 检查代币是否为貔貅盘，以及它的交易税和流动性。
- `quote` (读取): 获取兑换的报价，不发起提议。
- `bridge_quote` (读取): 获取跨链到另一条链的报价，不发起提议。
- `staking_options` (读取): 列出 Agent 可以质押的验证者和质押池，以及它的质押。
- `orders` (读取): 列出 Agent 的自动订单。
- `tx_status` (读取): 读取一个提议的状态、卡片和链上交易。
- `market_scan` (读取): 列出一条链上的新发射或热门代币。
- `chart` (读取): 读取代币的价格 K 线。
- `wallet_activity` (读取): 读取 Agent 关注的钱包的交易。
- `schedule_list` (读取): 列出 Agent 的定时任务。
- `search_web` (读取): 联网搜索。
- `read_page` (读取): 读取一个公开网页。
- `search_x` (读取): 搜索 X 上的近期帖子。
- `look_at_image` (读取): 查看公开网址或所有者机器上文件中的图片，并描述其内容。
- `look_at_screen` (读取): 在所有者要求时截取所有者的屏幕并描述其内容；它从不点击或输入。
- `read_pdf` (读取): 读取公开地址或所有者机器上的 PDF（包括扫描页），并回答与之相关的问题。
- `notes_search` (读取): 搜索 Agent 的笔记。
- `notes_get` (读取): 完整读取 Agent 的一条笔记。
- `settings_read` (读取): 读取所有者的设置或其中一个键，密钥只显示其来源类型，并附上每个键的规则。
- `agent_status` (读取): 读取 Agent 自身的状态：模型、模型预算、对话、助手和当前时间；在自己的对话中可以切换该对话的模型。
- `open_skill` (读取): 打开 Agent 的一个技能。
- `swap` (提议): 提议把一种代币兑换为另一种。
- `buy` (提议): 提议买入一种代币。
- `sell` (提议): 提议卖出一种代币。
- `send` (提议): 提议转账到已保存的地址、紧急转出地址或 .bnb 域名。
- `approval_revoke` (提议): 提议把代币授权改回零。
- `order_create` (提议): 提议一个自动订单。
- `stake` (提议): 提议向验证者或质押池质押。
- `unstake` (提议): 提议解除质押。
- `claim` (提议): 提议领取平台允许钱包取回的资金。
- `bridge` (提议): 提议跨链到另一条链。
- `settings_change` (提议): 在卡片中提出对所有者设置的更改，显示每项设置更改前后的值；所有者确认前不会有任何更改。
- `order_cancel` (控制): 立即取消一个自动订单。
- `alert_create` (控制): 立即设置价格提醒、钱包提醒或发射提醒。
- `schedule_create` (控制): 设置一个到时开始一轮的定时任务。
- `schedule_cancel` (控制): 取消一个定时任务。
- `notes_write` (控制): 把一条笔记存入 Agent 的记忆。
- `notes_forget` (控制): 删除 Agent 的一条笔记。
- `workspace_write` (控制): 保存所有者的交易策略或 Agent 的人设。
- `first_chat_end` (控制): 保存所有者的回答后结束初次对话。
- `launchpads` (读取): 列出一条链上的发射台及其设置。
- `launch_draft` (控制): 起草一次代币发射，只有所有者可以开始。
- `deposit_address` (控制): 向所有者显示每个钱包的地址及其二维码，用于向 Agent 转账资金。
- `show_images` (控制): 在对话中向所有者显示机器上已有的图片，例如 Agent 之前生成的图片。
- `send_files` (控制): 在对话中把机器上的文件作为文档发送给所有者保存，例如报告或 CSV。
- `show_chart` (控制): 在对话中向所有者显示图表：饼图、柱状图、面积图或折线图；无法绘制时显示其文本。
- `make_image` (控制): 用所有者的图片模型生成图片，例如代币的标志；图片稍后出现在对话中。
- `make_video` (控制): 用所有者在 bInference 网关上的视频模型生成短视频；几分钟后出现在对话中。
- `speak` (控制): 只在所有者要求听时，把话语作为语音消息发到对话中。
- `helper_start` (控制): 启动一个助手：在后台为一项有限的任务运行模型，Agent 在之后的一轮中根据其结果回答。
- `helper_list` (读取): 列出 Agent 的助手及其状态和时间。
- `helper_read` (读取): 读取 Agent 的一个助手：它正在做什么、它的报告和最新的消息。
- `helper_send` (控制): 给助手发送后续消息，开始它的又一次运行。
- `helper_stop` (控制): 停止 Agent 的一个正在运行的助手。
- `goal_set` (控制): 按所有者的请求设定此对话的目标：Agent 会一轮接一轮地推进，直到完成。
- `goal_read` (读取): 读取此对话的目标、目标轮、花费和进度说明。
- `goal_update` (控制): 将此对话的目标标记为已完成或受阻，并附上简短说明。
- `progress_note` (控制): 维护此对话的进度说明：所有者在对话旁看到的简短状态和步骤计划。
- `skill_proposal` (控制): 提议一个技能，或修改 Agent 自己的某个技能，由所有者应用或拒绝；读取技能和 Agent 的提案。
- `shell` (本机): 在所有者的机器上运行一条命令，不触及 binference 自己的文件，并读取输出。
- `shell_job` (本机): 读取运行中命令的新输出，或停止它。
- `browse` (本机): 在所有者的机器上使用 Agent 自己的浏览器：打开页面、阅读、点击、输入和截图。
- `file_read` (读取): 逐页读取所有者机器上的文本文件，或描述图片文件。
- `file_write` (本机): 在所有者机器上整体写入文件，并创建所需文件夹。
- `file_edit` (本机): 在所有者机器上的文件中进行精确替换。
- `file_patch` (本机): 用一个补丁修改多个文件，默认只在 Agent 工作区内。
- `credentials` (控制): 列出所有者存储的凭据，在隐藏输入框中向所有者请求缺少的凭据，或删除凭据。
- `ask_owner` (控制): 用回答按钮向所有者提一个问题。

## MCP 工具

`binference mcp` 提供给 MCP 客户端的工具，每个工具调用一个引擎操作。MCP 客户端只有读取和提议权限范围，因此没有工具可以确认。接受请求 id 的工具在用同一 id 重试时，会再次返回第一张卡片。

| 工具 | 用途 | 操作 | 接受请求 id |
| --- | --- | --- | --- |
| `binference_agents` | 列出所有者的 Agent 及其钱包。 | `agent/list` | 否 |
| `binference_token_search` | 按代币符号、名称或合约地址查找代币的 id。 | `asset/search` | 否 |
| `binference_addresses` | 读取一个 Agent 的地址簿。 | `address/list` | 否 |
| `binference_wallets` | 读取一个 Agent 自己的钱包，以及每个钱包的用途和地址。 | `wallet/list` | 否 |
| `binference_portfolio` | 读取一个 Agent 的余额、持仓和盈亏。 | `portfolio/get` | 否 |
| `binference_token_info` | 读取代币的符号、名称、精度和最近一次风险检查。 | `asset/get` | 否 |
| `binference_token_risk` | 检查代币是否为貔貅盘，以及它的交易税和流动性。 | `risk/check` | 否 |
| `binference_quote` | 获取兑换的报价，不发起提议。 | `quote/get` | 否 |
| `binference_bridge_quote` | 获取跨链到另一条链的报价，不发起提议。 | `bridge/quote` | 否 |
| `binference_staking_options` | 列出一个 Agent 可以质押的验证者和质押池。 | `staking/options` | 否 |
| `binference_orders` | 列出一个 Agent 的自动订单。 | `order/list` | 否 |
| `binference_resolve_name` | 读取 .bnb 域名指向的地址。 | `name/resolve` | 否 |
| `binference_propose` | 提议一笔交易、转账、跨链或质押，并打开一张卡片。 | `intent/propose` | 是 |
| `binference_intent_status` | 读取一个提议的状态、卡片和链上交易。 | `intent/get` | 否 |
| `binference_order_create` | 提议一个自动订单，并打开一张卡片。 | `order/create` | 是 |
| `binference_order_cancel` | 取消一个自动订单。 | `order/cancel` | 否 |
| `binference_alert_create` | 设置价格提醒、钱包提醒或发射提醒。 | `alert/create` | 否 |
| `binference_ledger` | 读取一个 Agent 的账本。 | `ledger/list` | 否 |
