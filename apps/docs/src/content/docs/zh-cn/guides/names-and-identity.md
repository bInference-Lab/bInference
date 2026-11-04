---
title: .bnb 域名和 Agent 身份
description: 向 .bnb 域名转账，并在 ERC-8004 身份注册表中登记 Agent 的链上身份。
---

## 向 .bnb 域名转账

转账可以用 BNB Smart Chain 上的 SPACE ID 域名（例如 `alice.bnb`）代替地址。这个域名必须指向你已保存在[地址簿](/zh-cn/guides/sends-and-bridges/#地址簿)中的地址，或你的紧急转出地址。地址簿只保存地址，从不保存域名。

binference 会解析域名两次：

1. **打开卡片时。** 卡片显示域名、它当前指向的地址，以及解析的时间。如果该地址的反向记录指向另一个域名，卡片会提醒你。
2. **签名之前。** 如果此时域名已指向别处，不会签名，你会收到 [`nameMoved`](/zh-cn/reference/notices/#namemoved) 通知。请检查域名，然后再次提议转账。

以下域名会被 binference 拒绝：

- 没有指向任何地址或已过期；过期后的宽限期也算作过期
- 指向合约

域名可以指向智能账户钱包：这种地址唯一的代码是指向钱包程序的 EIP-7702 委托。卡片会注明这一点。向域名转账与所有转账一样，总会显示卡片。

MCP 客户端可以用 `binference_resolve_name` 工具解析域名。

## Agent 身份

你可以在 BNB Smart Chain 上的 ERC-8004 身份注册表中为 Agent 登记一个条目，让别人可以找到它，并知道哪个钱包在为它交易。这是可选的，每个 Agent 一个，并且只有你可以发起。

```sh
binference agent identity --description "Trades BNB memes for its owner"
```

这个命令会：

1. 如果 Agent 已有身份，显示它。
2. 否则要求你输入所有者密钥，并把注册表的唯一调用加入主钱包的上限。
3. 打开登记 Agent 的卡片。请确认它；自动模式从不确认它。

Agent 必须处于实盘。描述为 1 到 280 个字符，会永久保留在链上。

### 公开的内容

注册文件以 data URI 的形式保存在链上的注册表中，包含：

- Agent 的名称和你的描述
- 登记它的主钱包
- binference 的版本

它从不列出发射钱包或跨链钱包。

### binference 会检查什么

- Agent 和 MCP 客户端不能发起登记（`intent.owner_only`）。
- 钱包已持有身份的 Agent 会被拒绝（`intent.identity_exists`），在一次登记进行中再次登记也会被拒绝（`intent.identity_pending`）。
- binference 在签名前检查注册表的版本，并在登记上链后读回结果。如果上链的内容与卡片显示的不一致，它不保存身份，并发送 [`identityMismatch`](/zh-cn/reference/notices/#identitymismatch) 通知。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`agent identity` 和 `address add`。
- [转账和跨链](/zh-cn/guides/sends-and-bridges/)：地址簿。
