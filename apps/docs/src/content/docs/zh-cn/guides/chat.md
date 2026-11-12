---
title: 与 Agent 对话
description: 在 Telegram、控制台和终端中与 Agent 对话，回答它的问题和卡片，并完成初次对话。
---

你的 Agent 同一时间只和你进行一个对话，每个界面显示的都是同一个对话：你在 Telegram 发的消息，也会出现在控制台和终端对话中。Agent 会回答你，用卡片提议交易，并用按钮向你提问。除了你在[自动模式](/zh-cn/guides/safety/#自动模式)中允许的操作，以及你确认过一次的[自动订单](/zh-cn/guides/auto-orders/)或[提醒规则](/zh-cn/guides/remote-and-webhooks/)的成交，它从不在你确认卡片之前动用资金。

## Telegram

`binference init` 会要求你提供 BotFather 给的机器人 Token，并打印一个指向你的机器人的链接。第一个打开该链接的人成为所有者，机器人只在私聊中回复这个 Telegram 账号。群组、频道和其他人的消息都会被忽略。

要改用另一个 Telegram 账号，在机器上运行 `binference telegram pair`。它会打印一个新链接，10 分钟内有效。在有人打开它之前，当前所有者保持不变；有人打开后，原所有者会在自己的对话中收到通知。

像给人发消息一样给机器人写消息即可。一条消息最多可以附带 4 张图片，每张为 PNG、JPEG 或 WebP，最大 5 MiB。看起来像私钥或其他密钥的消息会在读取前被删除，机器人会告诉你。

### 命令

这些命令会立即回答，不经过 Agent 的模型。`/help` 会列出它们：

| 命令         | 用途                                                    |
| ------------ | ------------------------------------------------------- |
| `/balance`   | 每个钱包的美元总额和主要持仓                            |
| `/wallet`    | Agent 的钱包：每个地址、所在链和模式                    |
| `/positions` | 每个持仓的数量、市值、平均成本和盈亏                    |
| `/orders`    | 生效中的自动订单，及其触发条件和成交次数                |
| `/cancel`    | 列出每张等待你回复的卡片，以便取消                      |
| `/freeze`    | 立即冻结所有 Agent                                      |
| `/rescue`    | 打开紧急转出卡片                                        |
| `/paper`     | 将 Agent 切换回模拟模式                                 |
| `/agents`    | 你的 Agent，以及此对话使用的 Agent                      |
| `/use`       | 按名称选择此对话使用的 Agent                            |
| `/status`    | binference 的状态、Agent、冻结情况和健康状况            |
| `/limits`    | Agent 的限额；其按钮只能让限额更严格                    |
| `/spend`     | 今日及本月的模型花费与预算                              |
| `/ai`        | Agent 的模型，可用按钮选择其他主模型                    |
| `/stop`      | 停止 Agent 的回答、助手和命令，并暂停目标               |
| `/clear`     | 开始新的对话；笔记、交易策略和人设保留                  |
| `/goal`      | 给 Agent 设定要推进的目标，或查看、暂停、恢复、清除目标 |
| `/skills`    | Agent 的技能提案和待接受的技能，每项都有操作按钮        |
| `/schedules` | Agent 的定时任务                                        |
| `/console`   | 在 Telegram 中以 Mini App 打开控制台                    |
| `/replies`   | Agent 回复和推理在此对话中的显示方式，每个选项一个按钮  |
| `/config`    | 查看或更改设置；更改会打开一张由你确认的卡片            |
| `/restart`   | 重启 binference，恢复服务后会在这里告诉你               |
| `/lang`      | binference 与你沟通使用的语言                           |
| `/help`      | 所有命令，每行一个                                      |

`/console` 需要引擎有一个 HTTPS 地址：用 [`binference expose`](/zh-cn/guides/remote-and-webhooks/) 设置，或在 `remote.publicUrl` 中填写你自己的地址。没有地址时，机器人会告诉你如何发布一个。

## 控制台

控制台是引擎在你的机器上提供的网页界面。运行 `binference console` 获取一个一次性链接，10 分钟内有效，用于将浏览器与控制台配对。控制台的对话与 Telegram 中的是同一个，并有“发送”和“新对话”按钮。Agent 回答时会显示“停止”；对话上方的“停止 Agent”无论 Agent 是否正在回答都会停止它，与 `/stop` 相同。在这里同样可以附带最多 4 张图片，限制相同。

## 终端对话

`binference chat` 在终端中打开对话。有多个 Agent 时，加上 `--agent <id>`。

| 按键                      | 用途                                                   |
| ------------------------- | ------------------------------------------------------ |
| Enter                     | 发送消息                                               |
| Esc                       | 停止回答                                               |
| `/stop`                   | 无论是否正在回答都停止 Agent：结束助手和命令，暂停目标 |
| Ctrl+Y                    | 确认最下方的卡片                                       |
| Ctrl+N                    | 取消最下方的卡片                                       |
| 1 到 9                    | 在输入行为空时回答当前的问题                           |
| Ctrl+U                    | 清空输入行                                             |
| Ctrl+C，或在空行按 Ctrl+D | 退出对话                                               |

`/clear` 开始新的对话，`/help` 列出按键。终端对话不能发送图片。

## 卡片

Agent 提议交易、转账、质押或其他操作时，会用一张卡片显示条款：从钱包转出什么、至少收到多少、费用，以及任何警告。每个界面都会显示这张卡片；最先的回复生效，随后每份副本都会变成回执。在 Telegram 和控制台中，点按“确认”或“取消”。在终端对话中，按 Ctrl+Y 或 Ctrl+N，也可以在命令行运行 `binference confirm <id>` 或 `binference deny <id>`。

交易卡片 60 秒后过期，其他卡片 10 分钟后过期。Agent 每次回答只提议一个操作；如果它打算做更多，会先说明，并在你回复这张卡片后再提议下一个。[安全指南](/zh-cn/guides/safety/)说明哪些操作需要卡片，以及卡片会检查什么。

## 问题

Agent 可能会向你提一个问题，并附上两到四个回答按钮。点按其中一个，或者在下一条消息中直接输入你的回答。Agent 提出更新的问题、你发送 `/clear`，或 24 小时后，问题会关闭。

## 回答期间的消息

`chats.newMessageMode` 决定 Agent 仍在回答时你发的消息如何处理。默认值 `merge` 会让消息在下一步并入正在进行的回答；`after` 会让消息等到回答结束。带图片的消息总会等待。

## 外部内容

Agent 读取网页、X、代币数据或图片后，binference 会把这个对话标记为读过外部内容。之后的卡片会带有警告，自动模式会在每张卡片上询问你，Agent 也不能转账到地址簿之外的地址。这个标记会保留到你发送 `/clear`。

## 初次对话

新的 Agent 会先进行初次对话。它的文件 `FIRST-CHAT.md` 中有 8 个关于你交易方式的问题：Agent 可以交易多少资金、你通常持有多久、你对哪些代币感兴趣、什么时候卖出、哪些要避开、什么时候先问你，以及多久汇报一次。Agent 会先完成你第一条消息的请求，再逐个提问。第 2 题和第 3 题附带回答按钮；你随时可以输入其他回答。回答“跳过”可提前结束提问。

Agent 根据你的回答写入 `STRATEGY.md` 和 `PERSONA.md`，然后删除 `FIRST-CHAT.md`。它只会在没有读过外部内容的对话中保存这些文件；如果对话已被标记，请发送 `/clear` 后重新回答。任何回答都不会设置限额：限额只能用 `binference limit set` 修改。Agent 处于实盘时会跳过初次对话。

## 工作区文件

每个 Agent 在状态文件夹的 `workspace/<agent>/` 下保存 `RULES.md`、`PERSONA.md`、`OWNER.md`、`STRATEGY.md`、`NOTES.md`，以及初次对话结束前的 `FIRST-CHAT.md`。每个文件最多 12,000 个字符，全部文件合计最多 40,000 个字符。修改会从 Agent 的下一次回答开始生效。Agent 自己只能写入 `STRATEGY.md` 和 `PERSONA.md`。

## 模型预算

每个 Agent 都有每日模型调用预算 `defaults.modelBudgetUsdPerDay`，默认 $3。预算用完后，对话会暂停到第二天，你会收到 [`budget`](/zh-cn/reference/notices/#budget) 通知；自动订单继续运行。`/spend` 显示花费。`binference limit set modelBudgetUsdPerDay=5` 修改预算：调低立即生效，调高在 24 小时后生效。

## 定时任务

你可以让 Agent 在固定时间做某件事，例如“每天早上 9 点检查我的投资组合”。它会设置一个定时任务，你会收到 [`scheduleSet`](/zh-cn/reference/notices/#scheduleset) 通知。定时任务只会在设定时间开始 Agent 的一次回答：它不动用资金，它提议的任何操作与对话中的提议一样，要经过同样的卡片和上限。每个 Agent 最多有 50 个定时任务。`/schedules` 会列出它们；要取消某个定时任务，告诉 Agent 即可。

## 删除对话

binference 会把每个对话保留 `chats.keepDays` 天（默认 90 天），之后将其删除。要立即删除对话，请在终端中运行 `binference chat delete`：加 `--agent <id>` 只删除一个 Agent 的对话，不加则删除每个 Agent 的对话；它询问时输入 `删除对话` 即可。脚本中可加 `--yes` 跳过这个问题。在控制台中，“删除对话”位于 Agent 对话中的“新对话”旁边。

正在进行的回答会先停止。然后该 Agent 对话中的每条消息、每一轮、目标、进度说明和助手会一并立即删除，等待 Agent 处理的消息和尚未回答的问题也会删除；控制台和终端对话会清空所显示的内容，Agent 收到下一条消息时会开始一个新的对话。笔记、工作区文件、设置、自动订单、交易、持仓、通知和模型花费都会保留，Telegram 对话中已有的消息也会保留。此前生成的备份在被清理前仍保留这些对话。binference 必须正在运行：Agent 离线时，命令会提示你运行 `binference start` 后再试。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`chat`、`chat delete`、`console`、`confirm`、`deny` 和 `telegram pair`。
- [配置项](/zh-cn/reference/config/)：`telegram.*`、`models.*` 和 `chats.*`。
- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：Agent 可以读取和提议什么。
