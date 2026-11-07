---
title: "引擎操作"
description: "引擎协议的每个操作：调用所需的权限范围、操作类型、接受调用的位置，以及由谁回复。"
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

引擎协议第 1 版的每个操作，按领域分组。客户端按名称调用操作；连接缺少该操作的权限范围时，引擎拒绝调用。读取不改变任何状态，写入改变引擎存储的内容，订阅为其连接开始或停止推送。

## `engine`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `engine/status` | `read` | 读取 | 任何连接 | 引擎 |
| `engine/describe` | `read` | 读取 | 任何连接 | 引擎 |
| `engine/stop` | `admin` | 写入 | 仅 IPC | 引擎 |
| `engine/restart` | `admin` | 写入 | 任何连接 | 引擎 |
| `engine/unlock` | `admin` | 写入 | 仅 IPC | 引擎 |

## `safety`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `safety/status` | `read` | 读取 | 任何连接 | 引擎 |
| `safety/freeze` | `confirm` | 写入 | 任何连接 | 引擎 |
| `safety/unfreeze` | `loosen` | 写入 | 任何连接 | 引擎 |
| `safety/rescue` | `confirm` | 写入 | 任何连接 | 引擎 |
| `safety/setRescueAddress` | `admin` | 写入 | 任何连接 | 引擎 |
| `safety/cancelRescueChange` | `confirm` | 写入 | 任何连接 | 引擎 |

## `notice`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `notice/list` | `read` | 读取 | 任何连接 | 引擎 |
| `notice/getSettings` | `read` | 读取 | 任何连接 | 引擎 |
| `notice/setSettings` | `admin` | 写入 | 任何连接 | 引擎 |

## `telegram`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `telegram/pair` | `admin` | 读取 | 仅 IPC | 引擎 |

## `agent`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `agent/list` | `read` | 读取 | 任何连接 | 引擎 |
| `agent/get` | `read` | 读取 | 任何连接 | 引擎 |
| `agent/create` | `admin` | 写入 | 任何连接 | 引擎 |
| `agent/rename` | `admin` | 写入 | 任何连接 | 引擎 |
| `agent/archive` | `admin` | 写入 | 任何连接 | 引擎 |
| `agent/goLive` | `admin` | 写入 | 仅 IPC | 引擎 |
| `agent/goPaper` | `confirm` | 写入 | 任何连接 | 引擎 |
| `agent/readFile` | `read` | 读取 | 任何连接 | 引擎 |
| `agent/writeFile` | `admin` | 写入 | 任何连接 | 引擎 |
| `agent/editFile` | `agent` | 写入 | 任何连接 | 引擎 |
| `agent/endFirstChat` | `agent` | 写入 | 任何连接 | 引擎 |

## `facts`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `facts/get` | `read` | 读取 | 任何连接 | 引擎 |

## `identity`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `identity/get` | `read` | 读取 | 任何连接 | 引擎 |
| `identity/allow` | `admin` | 写入 | 仅 IPC | 引擎 |
| `identity/register` | `propose` | 写入 | 任何连接 | 引擎 |

## `wallet`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `wallet/list` | `read` | 读取 | 任何连接 | 引擎 |
| `wallet/create` | `admin` | 写入 | 仅 IPC | 引擎 |
| `wallet/rename` | `admin` | 写入 | 任何连接 | 引擎 |
| `wallet/exportKey` | `admin` | 写入 | 仅 IPC | 引擎 |
| `wallet/exportSealed` | `admin` | 读取 | 仅 IPC | 引擎 |
| `wallet/activity` | `read` | 读取 | 任何连接 | 引擎 |

## `ceiling`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `ceiling/get` | `read` | 读取 | 任何连接 | 引擎 |
| `ceiling/set` | `admin` | 写入 | 仅 IPC | 引擎 |

## `signer`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `signer/revoke` | `admin` | 写入 | 仅 IPC | 引擎 |

## `address`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `address/list` | `read` | 读取 | 任何连接 | 引擎 |
| `address/add` | `admin` | 写入 | 仅 IPC | 引擎 |
| `address/remove` | `confirm` | 写入 | 任何连接 | 引擎 |

## `portfolio`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `portfolio/get` | `read` | 读取 | 任何连接 | 引擎 |
| `portfolio/pnl` | `read` | 读取 | 任何连接 | 引擎 |
| `portfolio/resetPaper` | `confirm` | 写入 | 任何连接 | 引擎 |

## `asset`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `asset/get` | `read` | 读取 | 任何连接 | 引擎 |
| `asset/search` | `read` | 读取 | 任何连接 | 引擎 |

## `name`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `name/resolve` | `read` | 读取 | 任何连接 | 引擎 |

## `quote`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `quote/get` | `read` | 读取 | 任何连接 | 引擎 |

## `risk`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `risk/check` | `read` | 读取 | 任何连接 | 引擎 |

## `market`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `market/scan` | `read` | 读取 | 任何连接 | 引擎 |
| `market/chart` | `read` | 读取 | 任何连接 | 引擎 |

## `launch`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `launch/list` | `read` | 读取 | 任何连接 | 引擎 |
| `launch/draft` | `agent` | 写入 | 任何连接 | 引擎 |
| `launch/openDraft` | `read` | 读取 | 任何连接 | 引擎 |
| `launch/draftPicture` | `chat` | 读取 | 任何连接 | 引擎 |

## `launchpad`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `launchpad/list` | `read` | 读取 | 任何连接 | 引擎 |

## `staking`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `staking/options` | `read` | 读取 | 任何连接 | 引擎 |

## `bridge`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `bridge/quote` | `read` | 读取 | 任何连接 | 引擎 |

## `intent`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `intent/propose` | `propose` | 写入 | 任何连接 | 引擎 |
| `intent/get` | `read` | 读取 | 任何连接 | 引擎 |
| `intent/card` | `read` | 读取 | 任何连接 | 引擎 |
| `intent/list` | `read` | 读取 | 任何连接 | 引擎 |
| `intent/confirm` | `confirm` | 写入 | 任何连接 | 引擎 |
| `intent/deny` | `confirm` | 写入 | 任何连接 | 引擎 |
| `intent/cancel` | `confirm`; 调用方取消自己的提议时为 `propose` | 写入 | 任何连接 | 引擎 |

## `order`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `order/create` | `propose` | 写入 | 任何连接 | 引擎 |
| `order/get` | `read` | 读取 | 任何连接 | 引擎 |
| `order/list` | `read` | 读取 | 任何连接 | 引擎 |
| `order/cancel` | `propose` | 写入 | 任何连接 | 引擎 |

## `alert`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `alert/create` | `propose` | 写入 | 任何连接 | 引擎 |
| `alert/list` | `read` | 读取 | 任何连接 | 引擎 |
| `alert/delete` | `propose` | 写入 | 任何连接 | 引擎 |

## `webhookRule`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `webhookRule/create` | `admin` | 写入 | 任何连接 | 引擎 |
| `webhookRule/list` | `read` | 读取 | 任何连接 | 引擎 |
| `webhookRule/events` | `read` | 读取 | 任何连接 | 引擎 |
| `webhookRule/delete` | `confirm` | 写入 | 任何连接 | 引擎 |
| `webhookRule/rotateUrl` | `admin` | 写入 | 任何连接 | 引擎 |

## `schedule`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `schedule/create` | `propose` | 写入 | 任何连接 | 引擎 |
| `schedule/list` | `read` | 读取 | 任何连接 | 引擎 |
| `schedule/cancel` | `propose` | 写入 | 任何连接 | 引擎 |

## `limit`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `limit/get` | `read` | 读取 | 任何连接 | 引擎 |
| `limit/set` | `confirm`; 修改放宽了限额时为 `loosen` | 写入 | 任何连接 | 引擎 |
| `limit/cancelPending` | `confirm` | 写入 | 任何连接 | 引擎 |

## `sendLevel`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `sendLevel/get` | `read` | 读取 | 任何连接 | 引擎 |
| `sendLevel/set` | `confirm`; 修改放宽了限额时为 `loosen` | 写入 | 任何连接 | 引擎 |
| `sendLevel/cancelPending` | `confirm` | 写入 | 任何连接 | 引擎 |

## `approval`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `approval/get` | `read` | 读取 | 任何连接 | 引擎 |
| `approval/set` | `confirm`; 开启自动模式时为 `loosen` | 写入 | 任何连接 | 引擎 |

## `chat`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `chat/post` | `chat` | 写入 | 任何连接 | 引擎 |
| `chat/messages` | `read` | 读取 | 任何连接 | Agent 运行时 |
| `chat/stop` | `chat` | 写入 | 任何连接 | 引擎 |
| `chat/clear` | `chat` | 写入 | 任何连接 | 引擎 |
| `chat/openCredentialRequest` | `read` | 读取 | 任何连接 | 引擎 |
| `chat/answer` | `chat` | 写入 | 任何连接 | 引擎 |
| `chat/openQuestion` | `read` | 读取 | 任何连接 | 引擎 |

## `turn`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `turn/start` | `agent` | 写入 | 任何连接 | 引擎 |
| `turn/mark` | `agent` | 写入 | 任何连接 | 引擎 |
| `turn/say` | `agent` | 写入 | 任何连接 | 引擎 |
| `turn/status` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/progress` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/end` | `agent` | 写入 | 任何连接 | 引擎 |
| `turn/reasoning` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/chart` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/credential` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/deposit` | `agent` | 读取 | 任何连接 | 引擎 |
| `turn/ask` | `agent` | 写入 | 任何连接 | 引擎 |

## `usage`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `usage/record` | `agent` | 写入 | 任何连接 | 引擎 |
| `usage/get` | `read` | 读取 | 任何连接 | 引擎 |

## `inbox`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `inbox/list` | `agent` | 读取 | 任何连接 | 引擎 |
| `inbox/take` | `agent` | 写入 | 任何连接 | 引擎 |
| `inbox/readImage` | `agent` | 读取 | 任何连接 | 引擎 |

## `image`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `image/view` | `agent` | 读取 | 任何连接 | 引擎 |
| `image/store` | `agent` | 读取 | 任何连接 | 引擎 |
| `image/made` | `agent` | 读取 | 任何连接 | 引擎 |
| `image/show` | `agent` | 读取 | 任何连接 | 引擎 |
| `image/read` | `read` | 读取 | 任何连接 | 引擎 |

## `config`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `config/view` | `read` | 读取 | 任何连接 | 引擎 |
| `config/propose` | `propose` | 写入 | 任何连接 | 引擎 |
| `config/read` | `admin` | 读取 | 任何连接 | 引擎 |
| `config/change` | `admin` | 写入 | 任何连接 | 引擎 |
| `config/history` | `read` | 读取 | 任何连接 | 引擎 |

## `shell`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `shell/run` | `agent` | 读取 | 任何连接 | 引擎 |
| `shell/job` | `agent` | 读取 | 任何连接 | 引擎 |

## `file`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `file/read` | `agent` | 读取 | 任何连接 | 引擎 |
| `file/write` | `agent` | 读取 | 任何连接 | 引擎 |
| `file/edit` | `agent` | 读取 | 任何连接 | 引擎 |
| `file/patch` | `agent` | 读取 | 任何连接 | 引擎 |
| `file/send` | `agent` | 读取 | 任何连接 | 引擎 |
| `file/fetch` | `read` | 读取 | 任何连接 | 引擎 |

## `credential`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `credential/answer` | `chat` | 读取 | 任何连接 | 引擎 |
| `credential/skip` | `chat` | 读取 | 任何连接 | 引擎 |
| `credential/list` | `read` | 读取 | 任何连接 | 引擎 |
| `credential/delete` | `propose` | 读取 | 任何连接 | 引擎 |
| `credential/set` | `admin` | 读取 | 任何连接 | 引擎 |

## `notes`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `notes/search` | `read` | 读取 | 任何连接 | Agent 运行时 |
| `notes/list` | `read` | 读取 | 任何连接 | Agent 运行时 |
| `notes/write` | `agent`; 所有者写笔记时为 `admin` | 写入 | 任何连接 | Agent 运行时 |
| `notes/delete` | `admin` | 写入 | 任何连接 | Agent 运行时 |
| `notes/get` | `read` | 读取 | 任何连接 | Agent 运行时 |
| `notes/forget` | `agent` | 写入 | 任何连接 | Agent 运行时 |

## `model`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `model/list` | `read` | 读取 | 任何连接 | 引擎 |
| `model/set` | `confirm` | 写入 | 任何连接 | 引擎 |

## `plugin`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `plugin/list` | `read` | 读取 | 任何连接 | 引擎 |
| `plugin/add` | `admin` | 写入 | 仅 IPC | 引擎 |
| `plugin/enable` | `admin` | 写入 | 任何连接 | 引擎 |
| `plugin/disable` | `confirm` | 写入 | 任何连接 | 引擎 |
| `plugin/remove` | `admin` | 写入 | 任何连接 | 引擎 |
| `plugin/call` | `agent` | 读取 | 任何连接 | 引擎 |

## `skill`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `skill/list` | `read` | 读取 | 任何连接 | 引擎 |
| `skill/read` | `read` | 读取 | 任何连接 | 引擎 |
| `skill/add` | `admin` | 写入 | 仅 IPC | 引擎 |
| `skill/remove` | `admin` | 写入 | 任何连接 | 引擎 |

## `ledger`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `ledger/list` | `read` | 读取 | 任何连接 | 引擎 |
| `ledger/export` | `read` | 写入 | 任何连接 | 引擎 |

## `backup`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `backup/list` | `read` | 读取 | 任何连接 | 引擎 |
| `backup/create` | `admin` | 写入 | 任何连接 | 引擎 |
| `backup/restore` | `admin` | 写入 | 仅 IPC | 引擎 |

## `update`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `update/check` | `read` | 读取 | 任何连接 | 引擎 |
| `update/apply` | `admin` | 写入 | 仅 IPC | 引擎 |

## `check`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `check/run` | `read`; 修复发现的问题时为 `admin` | 写入 | 任何连接 | 引擎 |

## `report`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `report/create` | `admin` | 写入 | 任何连接 | 引擎 |

## `device`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `device/pair` | `admin` | 读取 | 仅 IPC | 引擎 |
| `device/list` | `admin` | 读取 | 任何连接 | 引擎 |
| `device/revoke` | `confirm` | 写入 | 任何连接 | 引擎 |

## `token`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `token/list` | `admin` | 读取 | 任何连接 | 引擎 |
| `token/create` | `admin` | 写入 | 仅 IPC | 引擎 |
| `token/revoke` | `confirm` | 写入 | 任何连接 | 引擎 |
| `token/register` | `admin` | 写入 | 仅 IPC | 引擎 |

## `remote`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `remote/status` | `read` | 读取 | 任何连接 | 引擎 |
| `remote/enable` | `admin` | 写入 | 仅 IPC | 引擎 |
| `remote/disable` | `confirm` | 写入 | 任何连接 | 引擎 |

## `cex`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `cex/status` | `read` | 读取 | 任何连接 | 引擎 |
| `cex/connect` | `admin` | 写入 | 仅 IPC | 引擎 |
| `cex/disconnect` | `confirm` | 写入 | 任何连接 | 引擎 |

## `webPush`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `webPush/status` | `read` | 读取 | 任何连接 | 引擎 |
| `webPush/register` | `confirm` | 写入 | 任何连接 | 引擎 |
| `webPush/unregister` | `confirm` | 写入 | 任何连接 | 引擎 |

## `upload`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `upload/start` | `chat` | 读取 | 任何连接 | 引擎 |

## `push`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `push/subscribe` | `read` | 订阅 | 任何连接 | 引擎 |
| `push/unsubscribe` | `read` | 订阅 | 任何连接 | 引擎 |

## `log`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `log/follow` | `admin` | 订阅 | 任何连接 | 引擎 |
| `log/unfollow` | `admin` | 订阅 | 任何连接 | 引擎 |

## `binanceAgent`

| 操作 | 权限范围 | 类型 | 接受位置 | 回复方 |
| --- | --- | --- | --- | --- |
| `binanceAgent/list` | `read` | 读取 | 任何连接 | 引擎 |
| `binanceAgent/connect` | `admin` | 写入 | 仅 IPC | 引擎 |
| `binanceAgent/timeline` | `read` | 读取 | 任何连接 | 引擎 |
| `binanceAgent/setLimits` | `confirm`; 修改放宽了限额时为 `admin` | 写入 | 任何连接 | 引擎 |
| `binanceAgent/pause` | `confirm` | 写入 | 任何连接 | 引擎 |
| `binanceAgent/resume` | `admin` | 写入 | 任何连接 | 引擎 |
| `binanceAgent/stop` | `confirm` | 写入 | 任何连接 | 引擎 |
| `binanceAgent/record` | `read` | 写入 | 任何连接 | 引擎 |
| `binanceAgent/report` | `agent` | 写入 | 任何连接 | 引擎 |
