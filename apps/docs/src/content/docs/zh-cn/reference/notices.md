---
title: "通知"
description: "binference 发送给所有者的每条通知，并附上其文字示例。"
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

binference 通过 Telegram、控制台和终端对话发送给所有者的每条通知，并附上所有者看到的文字示例。级别决定通知的图标。可静音的通知按 Agent 在其通知设置中静音；其他通知总会发送，因为它们涉及安全事件、资金，或引擎或 Agent 停止。

## `fill`

级别：信息。可静音：是。

```text
🧪 ✅ 止盈已成交：以 $0.0000075 卖出 1.65 BNB，收到 $12.40
```

## `skipped`

级别：警告。可静音：是。

```text
⚠️ 止损已跳过：钱包中这种代币不足。订单仍然有效。
```

## `orderExpiring`

级别：信息。可静音：是。

```text
限价单将于 2026年10月11日 09:30:00 到期
```

## `orderOverfilled`

级别：严重。可静音：否。

```text
🔴 止损的成交次数超过了上限：已成交 2 次，上限 1 次。请检查钱包和订单。
```

## `fillUnvalued`

级别：警告。可静音：否。

```text
⚠️ 限价单已在链上成交，但暂时无法为这笔交易估值。binference 已在订单上计入这次成交，并会继续尝试估值。
```

## `fillsFailing`

级别：警告。可静音：否。

```text
⚠️ 止盈已停止：最近 5 次成交都在链上失败。请检查该代币；如仍需要，请新建订单。
```

## `approvalReset`

级别：警告。可静音：否。

```text
⚠️ 一笔交易未能完成后面的步骤，binference 已把为 PEPE 给出的授权额度重置为零。
```

## `copyHeld`

级别：信息。可静音：否。

```text
本小时另有 12 笔跟单交易被跳过，请在控制台查看
```

## `webhookHeld`

级别：信息。可静音：否。

```text
提醒规则“BNB breakout”：本小时另有 12 次成交或跳过，请在控制台查看
```

## `webhookSkipped`

级别：警告。可静音：否。

```text
⚠️ 提醒规则“BNB breakout”已跳过一次提醒：它未能在应执行时间后一分钟内开始，之后不会补做。规则仍然有效。
```

## `webhookRuleCancelled`

级别：警告。可静音：否。

```text
⚠️ 提醒规则“BNB breakout”已结束：你在发送之前撤回了它的成交，未进行任何交易。该规则已删除，其地址不再接收提醒。
```

## `webhookRuleFailing`

级别：警告。可静音：否。

```text
⚠️ 提醒规则“BNB breakout”已结束：最近 5 次成交都在链上失败。该规则已删除，其地址不再接收提醒。请检查该代币；如仍需要，请新建规则。
```

## `ordersEnded`

级别：信息。可静音：是。

```text
止盈已卖出你持有的全部 PEPE，该持仓的其他 2 个平仓订单已结束
```

## `exitEnded`

级别：信息。可静音：是。

```text
PEPE 的追踪止损已结束：钱包中已没有这种代币
```

## `lowGas`

级别：警告。可静音：是。

```text
⚠️ Main 仅剩 0.001 BNB 可付网络费。请充值 BNB。
```

## `daily`

级别：信息。可静音：是。

```text
main 的每日摘要（过去 24 小时）
🔴 实盘：$1,200.00，24 小时变化 +$50.00；已实现盈亏 +$12.40
🧪 模拟：$600.00；已实现盈亏 $0.00
自动订单：已成交 1 次，跳过 1 次，挂单 2 个
模型花费：$1.20，每日模型预算 $3.00
1 张卡片等你回复
跳过 1 次：钱包中这种代币不足
```

## `frozen`

级别：严重。可静音：否。

```text
🔴 已从 Telegram 冻结 main。请在终端运行 `binference unfreeze` 解除冻结。
```

## `unfrozen`

级别：信息。可静音：否。

```text
🟢 已从 控制台 对 main 解除冻结。
```

## `rescue`

级别：严重。可静音：否。

```text
🔴 已确认紧急转出：正在将全部资产转到 0x9F3c…41aB
```

## `newDevice`

级别：信息。可静音：否。

```text
已配对新的控制台设备：Laptop
```

## `signInsLocked`

级别：警告。可静音：否。

```text
⚠️ 控制台设备 Laptop 的登录失败次数过多，binference 在 2026年10月11日 09:30:00 前拒绝这些登录。这些尝试都没有登录成功。
```

## `limitChange`

级别：信息。可静音：否。

```text
命令行 修改了限额：单笔上限将于 2026年10月11日 09:30:00 更改。不是你操作？请立即取消。
```

## `limitChangeCancelled`

级别：信息。可静音：否。

```text
已取消对24 小时上限的修改，当前限额保持不变
```

## `ceilingChange`

级别：警告。可静音：否。

```text
⚠️ 已从 命令行 用所有者密钥修改 main 钱包的上限：一次合约调用最多可携带的金额。不是你操作？请立即冻结。
```

## `dayCapAdded`

级别：信息。可静音：否。

```text
main 的钱包对 ETH 的授权现在有 24 小时上限。在此之前，ETH 的授权没有 24 小时上限。
```

## `signerRevoked`

级别：警告。可静音：否。

```text
⚠️ 已从 命令行 用所有者密钥从所有钱包移除签名方 office-mac 的 Agent 密钥。持有它的机器无法再签名。不是你操作？请立即冻结。
```

## `sendLevel`

级别：信息。可静音：否。

```text
转账级别 2 → 1，将于 2026年10月11日 09:30:00 生效
```

## `sendLevelCancelled`

级别：信息。可静音：否。

```text
已取消将转账级别改为 0，仍为 2
```

## `rescueStopped`

级别：严重。可静音：否。

```text
🔴 紧急转出中途停止：执行期间紧急转出地址已更改。未转出的资产仍在钱包中。请检查钱包，然后重新发起紧急转出。
```

## `rescueAddress`

级别：警告。可静音：否。

```text
⚠️ 紧急转出地址将于 2026年10月11日 09:30:00 改为 0x9F3c…41aB。不是你操作？请立即取消。
```

## `rescueAddressCancelled`

级别：信息。可静音：否。

```text
已取消将紧急转出地址改为 0x9F3c…41aB
```

## `ceilingOutdated`

级别：警告。可静音：否。

```text
⚠️ 各钱包的上限仍允许向 0x9F3c…41aB 转账。请用所有者密钥运行 `binference rescue set` 更新。
```

## `plainSecret`

级别：警告。可静音：否。

```text
⚠️ 配置文件中有明文密钥。请运行 `binference check --fix`。
```

## `budget`

级别：信息。可静音：否。

```text
main 已用完今日模型预算（$3.00）。对话将于 2026年10月11日 09:30:00 恢复；自动订单继续运行。
```

## `scheduleSet`

级别：信息。可静音：否。

```text
main 有新的定时任务，来自 Telegram，下次运行时间 2026年10月11日 09:30:00：Review my portfolio.
```

## `scheduleCancelled`

级别：信息。可静音：否。

```text
main 的定时任务已由 Agent 自己取消：Review my portfolio.
```

## `loop`

级别：信息。可静音：否。

```text
main 重复执行同一步骤，已停止
```

## `watcherLag`

级别：警告。可静音：否。

```text
⚠️ BNB Smart Chain 的价格读取落后链上 14 个区块，自动订单可能延迟成交。请在 config.json5 的 `chains.rpc` 中添加付费 RPC，或检查本机网络。
```

## `watcherStopped`

级别：严重。可静音：否。

```text
🔴 BNB Smart Chain 的价格监控因故障停止，会自动重新启动；在此之前，该链上的自动订单不会成交。请运行 `binference logs` 查看原因。
```

## `walletOverflow`

级别：警告。可静音：否。

```text
⚠️ Whale 在 3 个区块中的交易过多，无法读取；跟单和提醒错过了这些交易。
```

## `watcherUnpriced`

级别：警告。可静音：否。

```text
⚠️ BNB Smart Chain 的价格监控无法获取 2 个监控中代币的价格（首个为 0x9F3c…41aB），在价格恢复之前，这些代币的自动订单无法触发。价格来自发射台联合曲线，或可交易至少 $1,000 WBNB 或稳定币的 PancakeSwap 交易池。
```

## `resumed`

级别：信息。可静音：否。

```text
引擎停止了 2 小时：已检查 3 个订单，成交 1 个，跳过 2 个
跳过 1 个：当前价格未达到其触发价格；订单继续等待
因其他原因跳过 1 个
```

## `update`

级别：信息。可静音：是。

```text
binference 2027.1.0 已发布。请运行 `binference update`。更新内容：Stop-loss orders fill faster
```

## `updateBare`

级别：信息。可静音：是。

```text
binference 2027.1.0 已发布。要安装它，请运行 binference stop 停止 binference，然后运行 npm install --global binference@2027.1.0，再运行 binference start。
```

## `updated`

级别：信息。可静音：是。

```text
binference 已更新到 2027.1.0。更新内容：Stop-loss orders fill faster
```

## `updatedBare`

级别：信息。可静音：是。

```text
binference 已更新到 2027.1.0。
```

## `updateRolledBack`

级别：警告。可静音：否。

```text
⚠️ binference 2027.1.0 更新后未通过，binference 已回退到 2026.12.2。你的设置和记录与更新前一致；检查期间收到的消息和提醒不会保留。
```

## `backupFailed`

级别：警告。可静音：否。

```text
⚠️ 昨晚的备份失败：无法在 backups.copyTo 中写入第二份副本
```

## `locked`

级别：严重。可静音：否。

```text
🔴 binference 已重启并处于锁定状态。请运行 `binference unlock`。
```

## `restarted`

级别：信息。可静音：否。

```text
binference 已按你的要求重启，现已恢复服务。
```

## `restartedForConfig`

级别：信息。可静音：否。

```text
binference 已重启以应用你的设置，现已恢复服务：models.imageMaking, engine.port。
```

## `signerStopped`

级别：严重。可静音：否。

```text
🔴 签名进程已停止，binference 不会签名。请先处理 `binference logs` 显示的问题，再运行 `binference unlock`。
```

## `signerRefused`

级别：警告。可静音：否。

```text
⚠️ 签名进程拒绝为一笔交易的一个步骤签名：金额与这笔交易不符。该步骤未发送任何内容。
```

## `daySums`

级别：警告。可静音：否。

```text
⚠️ 未发送：这会超出你在 BNB Smart Chain 上的 24 小时上限 10 BNB，其中已用 9.5 BNB。2026年10月11日 09:30:00 起会释放额度。要提高上限，请在 binference.io 上修改。
```

## `privyUnreachable`

级别：严重。可静音：否。

```text
🔴 binference 启动后五分钟内都无法连接 Privy，因此仍处于锁定状态。请检查本机网络，然后运行 `binference unlock`。
```

## `webhookPortTaken`

级别：警告。可静音：否。

```text
⚠️ binference 无法为提醒规则接收提醒：端口 7457 已被占用。请在 config.json5 中把 `engine.webhookPort` 设为空闲端口，然后重启 binference。
```

## `webhookRotated`

级别：信息。可静音：否。

```text
命令行 更改了提醒规则“BNB breakout”的地址，旧地址已失效。不是你操作？请立即删除该规则。
```

## `pluginHostRefused`

级别：警告。可静音：否。

```text
⚠️ 插件 fear-index 试图访问它没有声明的 `other.example.net`，binference 已拒绝。
```

## `pluginStopped`

级别：严重。可静音：否。

```text
🔴 插件 fear-index 在 10 分钟内崩溃了 5 次，binference 已将其停止。运行 `binference plugin enable fear-index` 可重新启用。
```

## `pluginHostsHeld`

级别：信息。可静音：否。

```text
插件 fear-index 在过去一小时内又请求了 3 个它没有声明的主机，binference 已全部拒绝。
```

## `pluginStalled`

级别：警告。可静音：否。

```text
⚠️ 插件 fear-index 不再读取 binference 发给它的内容，binference 已将其结束。它会自行重新启动。
```

## `pluginChanged`

级别：严重。可静音：否。

```text
🔴 插件 fear-index 未启动：它的文件已不是你添加时的那些。请用 `binference plugin remove fear-index` 移除后重新添加。
```

## `pluginRevoked`

级别：严重。可静音：否。

```text
🔴 bInference 已撤销插件 fear-index 1.2.0 的上架条目，binference 已关闭这个版本。请移除它，或添加 bInference 已上架的版本。
```

## `pluginsHeld`

级别：警告。可静音：否。

```text
⚠️ binference 当前无法核对 bInference 的插件上架条目，已先停止你的插件。恢复核对后，它们会自动重新启动。
```

## `pluginSandboxOff`

级别：严重。可静音：否。

```text
🔴 社区插件无法在这台电脑上运行：插件可以启动程序。运行 `binference check` 查看修复方法。
```

## `configInvalid`

级别：警告。可静音：否。

```text
⚠️ binference 保留了当前运行的设置：config.json5 中 telegram.mode 的值不可用。请运行 `binference check` 查看修复方法。
```

## `configChanged`

级别：信息。可静音：否。

```text
config.json5 中的设置已更改：owner.locale。它们已立即生效。
```

## `unknownTx`

级别：警告。可静音：否。

```text
⚠️ Main 的随机数 42 被一笔非 binference 签名的交易占用
```

## `fillDiffers`

级别：警告。可静音：否。

```text
⚠️ 一笔交易的成交结果与模拟结果相差超过 1%，请核对该笔交易。
```

## `blockShared`

级别：警告。可静音：否。

```text
⚠️ Main 的两笔交易在同一个区块上链，持仓和盈亏可能把该区块转入的币重复计算。请检查钱包。
```

## `fillUnknown`

级别：警告。可静音：否。

```text
⚠️ 一笔交易已上链，但已没有 RPC 能说明它收到了多少。请在配置中添加追踪 RPC 并重启 binference，以完成这笔交易的记录。
```

## `notSigned`

级别：警告。可静音：否。

```text
⚠️ 一笔交易在第一笔链上交易签名前已取消，未发送任何内容。
```

## `confirmationLapsed`

级别：警告。可静音：否。

```text
⚠️ 一笔交易未发送：它的确认在发出之前已过期。未签名任何内容。
```

## `feeAboveCap`

级别：警告。可静音：否。

```text
⚠️ 网络费高于你设定的上限，一笔交易一直在等待，它的确认已过期。请在新卡片上再次确认，或取消它。
```

## `launchUnsent`

级别：警告。可静音：否。

```text
⚠️ 一笔在发射项目联合曲线上的交易未发送：发射台已不在该联合曲线上持有此代币，例如代币已毕业。未签名任何内容。
```

## `nameMoved`

级别：警告。可静音：否。

```text
⚠️ 向 alice.bnb 的转账未签名：该域名现在指向 0x2bA6…3c71，而不是卡片上的 0x71C7…976F。未发送任何内容。请检查域名，然后重新发起转账。
```

## `claimReady`

级别：信息。可静音：是。

```text
你从 0x71C7…976F 解除质押的 2 BNB 现在可以领取
```

## `claimedElsewhere`

级别：信息。可静音：否。

```text
你从 0x1adB…7fE6 解除质押的 2 BNB 已在 binference 之外被领取，已回到你的钱包
```

## `stakeMintedFewer`

级别：警告。可静音：否。

```text
⚠️ 你在 Pool 质押的 2 BNB 已上链，但兑换率在上链前变动：只铸造了 1.8 BNB，少于卡片承诺的至少 1.81 BNB。binference 已按实际铸造的 1.8 BNB 记账。
```

## `stakeApprovalLeft`

级别：警告。可静音：否。

```text
⚠️ 你在 Pool 的解除质押在授权上链后停止：Pool 仍可从此钱包动用 1.8 BNB，但只能用于此钱包自己发起的解除质押。如仍需要，请重新发起解除质押，它会重新设置该授权。
```

## `skillProposed`

级别：信息。可静音：否。

```text
main 提议了技能“dip-buyer”。扫描发现了问题，目前无法应用。可在 /skills、控制台或用 `binference skill show skp_0190f1c2-3a4b-7c5d-8e6f-000000000001` 查看。
```

## `skillApplied`

级别：信息。可静音：否。

```text
main 的技能“dip-buyer”已从 telegram 应用，从 Agent 的下一轮起加载。
```

## `skillRejected`

级别：信息。可静音：否。

```text
main 的技能“dip-buyer”的提案已从 cli 拒绝。
```

## `skillHeld`

级别：警告。可静音：否。

```text
⚠️ main 工作区中的技能“dip-buyer”为新增或已更改，在你接受之前不会加载。请检查其文件，然后通过 /skills、控制台或 `binference skill accept dip-buyer` 接受。
```

## `skillAccepted`

级别：信息。可静音：否。

```text
main 的技能“dip-buyer”已从 console 按其当前文件接受，从 Agent 的下一轮起加载。
```

## `bridgeLate`

级别：警告。可静音：否。

```text
⚠️ 你跨链到 Base 的 20 BNB 2 小时后仍未到账。binference 会继续检查。fake-cross 的状态页：https://bridge.test/transfer/0xd1
```

## `bridgeArrived`

级别：信息。可静音：否。

```text
✅ 你延迟的跨链已在 Base 到账：0x71C7…976F 收到 19.96 BNB
```

## `bridgeRefunded`

级别：警告。可静音：否。

```text
⚠️ fake-cross 未完成你到 Base 的跨链，已将 20 BNB 退回 Main
```

## `bridgeLapsed`

级别：警告。可静音：否。

```text
⚠️ 你到 Base 的跨链在确认过期前未发送：它的报价已过期，请重新发起。未签名任何内容。
```

## `bridgeKeyNeeded`

级别：警告。可静音：否。

```text
⚠️ 平台 fake-cross 现在只在收到有效的 API 密钥时才告知跨链进度。设置之前，binference 无法得知你的跨链何时到账，2 小时后仍未到账的每笔跨链都会通知你。请在 config.json5 中把 venues.keys.fake-cross 设为 fake-cross 控制面板中的密钥，然后重启 binference。
```

## `rescueBridged`

级别：信息。可静音：否。

```text
你的新紧急转出地址 0x9F3c…41aB 于 2026年10月11日 09:30:00 生效后，main 的钱包可以跨链到它在 Base, Arbitrum 上的地址：它在那里和在本链上都没有合约代码，因此很可能是同一把密钥持有的普通钱包。
```

## `rescueNotBridged`

级别：信息。可静音：否。

```text
main 的钱包不会跨链到你在 Base 上的紧急转出地址 0x9F3c…41aB：它在那里或在本链上有合约代码，因此那里的同一地址可能不属于你。要跨链到那里，请用你的所有者密钥在地址簿中保存一个你在 Base 上控制的地址。
```

## `shellAllowed`

级别：信息。可静音：否。

```text
现已允许 2 条命令（来自 Telegram），目录 /srv/project：git log -1; head -n 3
```

## `shellDisallowed`

级别：信息。可静音：否。

```text
一条允许的命令已被移除（来自命令行）：git status（目录 /srv/project）
```

## `identityMismatch`

级别：警告。可静音：否。

```text
⚠️ main 的身份登记已上链，但注册表读回的账户和注册文件与卡片不符，因此 binference 未保存该身份。依赖它之前请先核对注册表。
```

## `identityDuplicate`

级别：警告。可静音：否。

```text
⚠️ main 的第二次身份登记已上链，但 binference 每个 Agent 只保存一个身份，因此没有保存这一次。该钱包现在持有两个身份，请核对注册表。
```

## `launchStopped`

级别：警告。可静音：否。

```text
⚠️ MCAT 在 pad 的发射已停止：发射台未在 5 分钟内固定其图片和文字。未签名任何内容，但其图片和文字可能已在发射台公开。如仍需要，请重新发起发射。
```

## `launchNotSigned`

级别：警告。可静音：否。

```text
⚠️ MCAT 在 pad 的发射在你确认后停止：binference 在签名发射之前停止了，停止后也不会再签名。没有创建代币，也没有发送任何交易。其图片和文字可能已在发射台公开。如仍需要，请重新发起发射。
```

## `launchStepUnsent`

级别：警告。可静音：否。

```text
⚠️ MCAT 在 pad 的发射中途停止：其授权已上链，但 binference 在签名创建调用之前停止了，停止后也不会再签名。没有创建代币。在新的发射重新设置该授权之前，发射台仍可从发射钱包动用 6 BNB。其图片和文字可能已在发射台公开。如仍需要，请重新发起发射。
```

## `stepUnsent`

级别：警告。可静音：否。

```text
⚠️ 一笔交易中途停止：前面的步骤已上链，但后面的步骤从未签名。请检查钱包。
```

## `stepDropped`

级别：警告。可静音：否。

```text
⚠️ 一笔交易长时间未上链，没有完成。没有任何资产变动，钱包已可再次使用。
```

## `stepDroppedPartWay`

级别：警告。可静音：否。

```text
⚠️ 一笔交易中途停止：前面的步骤已上链，但后面的步骤长时间未上链，没有完成。钱包已可再次使用。请检查钱包。
```

## `droppedLanded`

级别：严重。可静音：否。

```text
🔴 一笔 binference 报告为长时间未上链的交易最终还是上链了。binference 已把它计入你的限额和持仓。请检查钱包。
```

## `walletHeld`

级别：警告。可静音：否。

```text
⚠️ Main 的一笔链上交易卡住了，该钱包之后的交易都在其后等待。binference 会继续发送它，直到区块收录它或所有中继都丢弃它。
```

## `binanceRefused`

级别：警告。可静音：否。

```text
⚠️ main 尝试了超出限额的交易：buy $500 of CAKE。已拒绝。
```

## `binancePaused`

级别：信息。可静音：否。

```text
已从 Mini App 暂停 main
```

## `approvalMode`

级别：信息。可静音：否。

```text
main 已切换为自动模式，来自 命令行
```

## `alertPrice`

级别：信息。可静音：是。

```text
PEPE 价格达到或高于 $0.00001：现价 $0.000011
main 正在查看。
另有 3 个匹配未唤醒 main：每小时最多唤醒 10 次。
```

## `alertWallet`

级别：信息。可静音：是。

```text
Whale 卖出 2M PEPE（占其持仓的 40%），收到 $22.10
```

## `alertLaunch`

级别：信息。可静音：是。

```text
有新发射的代币通过了你的筛选条件：PEPE 0x6982…1933 · Pad · 3 分钟前 · 曲线进度 42% · 交易税 1% · 2 个内部钱包 · 创建者 30 天内其他发射：0
```

## `alertHeld`

级别：信息。可静音：是。

```text
本小时另有 12 次匹配，请在控制台查看
```
