---
title: "Engine operations"
description: "Every operation of the engine protocol: the scope a call needs, what it does, where it is accepted and who answers it."
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

Every operation of the engine protocol, version 1, by domain. A client calls an operation by its name; the engine refuses a call whose connection lacks the operation's scope. A read changes nothing, a write changes what the engine stores, and a subscription starts or stops pushes for its connection.

## `engine`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `engine/status` | `read` | read | any connection | engine |
| `engine/describe` | `read` | read | any connection | engine |
| `engine/stop` | `admin` | write | IPC only | engine |
| `engine/restart` | `admin` | write | any connection | engine |
| `engine/unlock` | `admin` | write | IPC only | engine |

## `safety`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `safety/status` | `read` | read | any connection | engine |
| `safety/freeze` | `confirm` | write | any connection | engine |
| `safety/unfreeze` | `loosen` | write | any connection | engine |
| `safety/rescue` | `confirm` | write | any connection | engine |
| `safety/setRescueAddress` | `admin` | write | any connection | engine |
| `safety/cancelRescueChange` | `confirm` | write | any connection | engine |

## `notice`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `notice/list` | `read` | read | any connection | engine |
| `notice/getSettings` | `read` | read | any connection | engine |
| `notice/setSettings` | `admin` | write | any connection | engine |

## `telegram`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `telegram/pair` | `admin` | read | IPC only | engine |

## `agent`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `agent/list` | `read` | read | any connection | engine |
| `agent/get` | `read` | read | any connection | engine |
| `agent/create` | `admin` | write | any connection | engine |
| `agent/rename` | `admin` | write | any connection | engine |
| `agent/archive` | `admin` | write | any connection | engine |
| `agent/goLive` | `admin` | write | IPC only | engine |
| `agent/goPaper` | `confirm` | write | any connection | engine |
| `agent/readFile` | `read` | read | any connection | engine |
| `agent/writeFile` | `admin` | write | any connection | engine |
| `agent/editFile` | `agent` | write | any connection | engine |
| `agent/endFirstChat` | `agent` | write | any connection | engine |

## `facts`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `facts/get` | `read` | read | any connection | engine |

## `identity`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `identity/get` | `read` | read | any connection | engine |
| `identity/allow` | `admin` | write | IPC only | engine |
| `identity/register` | `propose` | write | any connection | engine |

## `wallet`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `wallet/list` | `read` | read | any connection | engine |
| `wallet/create` | `admin` | write | IPC only | engine |
| `wallet/rename` | `admin` | write | any connection | engine |
| `wallet/exportKey` | `admin` | write | IPC only | engine |
| `wallet/exportSealed` | `admin` | read | IPC only | engine |
| `wallet/activity` | `read` | read | any connection | engine |

## `ceiling`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `ceiling/get` | `read` | read | any connection | engine |
| `ceiling/set` | `admin` | write | IPC only | engine |

## `signer`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `signer/revoke` | `admin` | write | IPC only | engine |

## `address`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `address/list` | `read` | read | any connection | engine |
| `address/add` | `admin` | write | IPC only | engine |
| `address/remove` | `confirm` | write | any connection | engine |

## `portfolio`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `portfolio/get` | `read` | read | any connection | engine |
| `portfolio/pnl` | `read` | read | any connection | engine |
| `portfolio/resetPaper` | `confirm` | write | any connection | engine |

## `asset`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `asset/get` | `read` | read | any connection | engine |
| `asset/search` | `read` | read | any connection | engine |

## `name`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `name/resolve` | `read` | read | any connection | engine |

## `quote`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `quote/get` | `read` | read | any connection | engine |

## `risk`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `risk/check` | `read` | read | any connection | engine |

## `market`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `market/scan` | `read` | read | any connection | engine |
| `market/chart` | `read` | read | any connection | engine |

## `launch`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `launch/list` | `read` | read | any connection | engine |
| `launch/draft` | `agent` | write | any connection | engine |
| `launch/openDraft` | `read` | read | any connection | engine |
| `launch/draftPicture` | `chat` | read | any connection | engine |

## `launchpad`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `launchpad/list` | `read` | read | any connection | engine |

## `staking`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `staking/options` | `read` | read | any connection | engine |

## `bridge`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `bridge/quote` | `read` | read | any connection | engine |

## `intent`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `intent/propose` | `propose` | write | any connection | engine |
| `intent/get` | `read` | read | any connection | engine |
| `intent/card` | `read` | read | any connection | engine |
| `intent/list` | `read` | read | any connection | engine |
| `intent/confirm` | `confirm` | write | any connection | engine |
| `intent/deny` | `confirm` | write | any connection | engine |
| `intent/cancel` | `confirm`; `propose` when the caller cancels its own proposal | write | any connection | engine |

## `order`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `order/create` | `propose` | write | any connection | engine |
| `order/get` | `read` | read | any connection | engine |
| `order/list` | `read` | read | any connection | engine |
| `order/cancel` | `propose` | write | any connection | engine |

## `alert`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `alert/create` | `propose` | write | any connection | engine |
| `alert/list` | `read` | read | any connection | engine |
| `alert/delete` | `propose` | write | any connection | engine |

## `webhookRule`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `webhookRule/create` | `admin` | write | any connection | engine |
| `webhookRule/list` | `read` | read | any connection | engine |
| `webhookRule/events` | `read` | read | any connection | engine |
| `webhookRule/delete` | `confirm` | write | any connection | engine |
| `webhookRule/rotateUrl` | `admin` | write | any connection | engine |

## `schedule`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `schedule/create` | `propose` | write | any connection | engine |
| `schedule/list` | `read` | read | any connection | engine |
| `schedule/cancel` | `propose` | write | any connection | engine |

## `limit`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `limit/get` | `read` | read | any connection | engine |
| `limit/set` | `confirm`; `loosen` when a change loosens a limit | write | any connection | engine |
| `limit/cancelPending` | `confirm` | write | any connection | engine |

## `sendLevel`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `sendLevel/get` | `read` | read | any connection | engine |
| `sendLevel/set` | `confirm`; `loosen` when a change loosens a limit | write | any connection | engine |
| `sendLevel/cancelPending` | `confirm` | write | any connection | engine |

## `approval`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `approval/get` | `read` | read | any connection | engine |
| `approval/set` | `confirm`; `loosen` when it switches auto mode on | write | any connection | engine |

## `chat`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `chat/post` | `chat` | write | any connection | engine |
| `chat/messages` | `read` | read | any connection | agent runtime |
| `chat/stop` | `chat` | write | any connection | engine |
| `chat/clear` | `chat` | write | any connection | engine |
| `chat/openCredentialRequest` | `read` | read | any connection | engine |
| `chat/answer` | `chat` | write | any connection | engine |
| `chat/openQuestion` | `read` | read | any connection | engine |

## `turn`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `turn/start` | `agent` | write | any connection | engine |
| `turn/mark` | `agent` | write | any connection | engine |
| `turn/say` | `agent` | write | any connection | engine |
| `turn/status` | `agent` | read | any connection | engine |
| `turn/progress` | `agent` | read | any connection | engine |
| `turn/end` | `agent` | write | any connection | engine |
| `turn/reasoning` | `agent` | read | any connection | engine |
| `turn/chart` | `agent` | read | any connection | engine |
| `turn/credential` | `agent` | read | any connection | engine |
| `turn/deposit` | `agent` | read | any connection | engine |
| `turn/ask` | `agent` | write | any connection | engine |

## `usage`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `usage/record` | `agent` | write | any connection | engine |
| `usage/get` | `read` | read | any connection | engine |

## `inbox`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `inbox/list` | `agent` | read | any connection | engine |
| `inbox/take` | `agent` | write | any connection | engine |
| `inbox/readImage` | `agent` | read | any connection | engine |

## `image`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `image/view` | `agent` | read | any connection | engine |
| `image/store` | `agent` | read | any connection | engine |
| `image/made` | `agent` | read | any connection | engine |
| `image/show` | `agent` | read | any connection | engine |
| `image/read` | `read` | read | any connection | engine |

## `config`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `config/view` | `read` | read | any connection | engine |
| `config/propose` | `propose` | write | any connection | engine |
| `config/read` | `admin` | read | any connection | engine |
| `config/change` | `admin` | write | any connection | engine |
| `config/history` | `read` | read | any connection | engine |

## `shell`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `shell/run` | `agent` | read | any connection | engine |
| `shell/job` | `agent` | read | any connection | engine |

## `browser`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `browser/run` | `agent` | read | any connection | engine |

## `pdf`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `pdf/read` | `agent` | read | any connection | engine |
| `pdf/pageImage` | `agent` | read | any connection | engine |

## `file`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `file/read` | `agent` | read | any connection | engine |
| `file/write` | `agent` | read | any connection | engine |
| `file/edit` | `agent` | read | any connection | engine |
| `file/patch` | `agent` | read | any connection | engine |
| `file/send` | `agent` | read | any connection | engine |
| `file/fetch` | `read` | read | any connection | engine |

## `credential`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `credential/answer` | `chat` | read | any connection | engine |
| `credential/skip` | `chat` | read | any connection | engine |
| `credential/list` | `read` | read | any connection | engine |
| `credential/delete` | `propose` | read | any connection | engine |
| `credential/set` | `admin` | read | any connection | engine |

## `notes`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `notes/search` | `read` | read | any connection | agent runtime |
| `notes/list` | `read` | read | any connection | agent runtime |
| `notes/write` | `agent`; `admin` when the owner writes the note | write | any connection | agent runtime |
| `notes/delete` | `admin` | write | any connection | agent runtime |
| `notes/get` | `read` | read | any connection | agent runtime |
| `notes/forget` | `agent` | write | any connection | agent runtime |

## `model`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `model/list` | `read` | read | any connection | engine |
| `model/set` | `confirm` | write | any connection | engine |

## `plugin`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `plugin/list` | `read` | read | any connection | engine |
| `plugin/add` | `admin` | write | IPC only | engine |
| `plugin/enable` | `admin` | write | any connection | engine |
| `plugin/disable` | `confirm` | write | any connection | engine |
| `plugin/remove` | `admin` | write | any connection | engine |
| `plugin/call` | `agent` | read | any connection | engine |

## `skill`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `skill/list` | `read` | read | any connection | engine |
| `skill/read` | `read` | read | any connection | engine |
| `skill/add` | `admin` | write | IPC only | engine |
| `skill/remove` | `admin` | write | any connection | engine |

## `ledger`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `ledger/list` | `read` | read | any connection | engine |
| `ledger/export` | `read` | write | any connection | engine |

## `backup`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `backup/list` | `read` | read | any connection | engine |
| `backup/create` | `admin` | write | any connection | engine |
| `backup/restore` | `admin` | write | IPC only | engine |

## `update`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `update/check` | `read` | read | any connection | engine |
| `update/apply` | `admin` | write | IPC only | engine |

## `check`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `check/run` | `read`; `admin` when it repairs what it finds | write | any connection | engine |

## `report`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `report/create` | `admin` | write | any connection | engine |

## `device`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `device/pair` | `admin` | read | IPC only | engine |
| `device/list` | `admin` | read | any connection | engine |
| `device/revoke` | `confirm` | write | any connection | engine |

## `token`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `token/list` | `admin` | read | any connection | engine |
| `token/create` | `admin` | write | IPC only | engine |
| `token/revoke` | `confirm` | write | any connection | engine |
| `token/register` | `admin` | write | IPC only | engine |

## `remote`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `remote/status` | `read` | read | any connection | engine |
| `remote/enable` | `admin` | write | IPC only | engine |
| `remote/disable` | `confirm` | write | any connection | engine |

## `cex`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `cex/status` | `read` | read | any connection | engine |
| `cex/connect` | `admin` | write | IPC only | engine |
| `cex/disconnect` | `confirm` | write | any connection | engine |

## `webPush`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `webPush/status` | `read` | read | any connection | engine |
| `webPush/register` | `confirm` | write | any connection | engine |
| `webPush/unregister` | `confirm` | write | any connection | engine |

## `upload`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `upload/start` | `chat` | read | any connection | engine |

## `push`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `push/subscribe` | `read` | subscription | any connection | engine |
| `push/unsubscribe` | `read` | subscription | any connection | engine |

## `log`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `log/follow` | `admin` | subscription | any connection | engine |
| `log/unfollow` | `admin` | subscription | any connection | engine |

## `binanceAgent`

| Operation | Scope | Kind | Accepted | Answered by |
| --- | --- | --- | --- | --- |
| `binanceAgent/list` | `read` | read | any connection | engine |
| `binanceAgent/connect` | `admin` | write | IPC only | engine |
| `binanceAgent/timeline` | `read` | read | any connection | engine |
| `binanceAgent/setLimits` | `confirm`; `admin` when a change loosens a limit | write | any connection | engine |
| `binanceAgent/pause` | `confirm` | write | any connection | engine |
| `binanceAgent/resume` | `admin` | write | any connection | engine |
| `binanceAgent/stop` | `confirm` | write | any connection | engine |
| `binanceAgent/record` | `read` | write | any connection | engine |
| `binanceAgent/report` | `agent` | write | any connection | engine |
