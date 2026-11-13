---
title: "Notices"
description: "Every notice binference sends the owner, with an example of its words."
---

<!-- Generated from the code by pnpm docs:gen. Never edit this file: change the code, then run pnpm docs:gen. -->

Every notice binference sends the owner in Telegram, the console and the terminal chat, with an example of what the owner reads. The level decides its icon. A notice that can be muted is muted per agent in its notice settings; every other notice always goes, since it tells of a security event, of money, or of the engine or an agent stopping.

## `fill`

Level: info. Can be muted: yes.

```text
🧪 ✅ Take-profit filled: sold 1.65 BNB for $12.40 at $0.0000075
```

## `skipped`

Level: warning. Can be muted: yes.

```text
⚠️ Stop-loss skipped: the wallet holds too little of this token. The order stays active.
```

## `orderExpiring`

Level: info. Can be muted: yes.

```text
Limit order ends Oct 11, 2026, 09:30:00
```

## `orderOverfilled`

Level: critical. Can be muted: no.

```text
🔴 Stop-loss filled more often than it allows: 2 fills of 1. Check the wallet and the order.
```

## `fillUnvalued`

Level: warning. Can be muted: no.

```text
⚠️ Limit order filled on chain, but its trade cannot be valued yet. binference counted the fill on the order and keeps trying to value it.
```

## `fillsFailing`

Level: warning. Can be muted: no.

```text
⚠️ Take-profit stopped: its last 5 fills failed on chain. Check the token, and make a new order if you still want one.
```

## `approvalReset`

Level: warning. Can be muted: no.

```text
⚠️ A trade could not finish its last steps, so binference set the approval it had given for PEPE back to zero.
```

## `copyHeld`

Level: info. Can be muted: no.

```text
12 more copy trades skipped this hour, see the console
```

## `webhookHeld`

Level: info. Can be muted: no.

```text
Alert rule "BNB breakout": 12 more fills or skips this hour, see the console
```

## `webhookSkipped`

Level: warning. Can be muted: no.

```text
⚠️ Alert rule "BNB breakout" skipped an alert: it could not start within a minute of its time, so it is not made up later. The rule stays active.
```

## `webhookRuleCancelled`

Level: warning. Can be muted: no.

```text
⚠️ Alert rule "BNB breakout" ended: you withdrew its fill before it was sent, and nothing was traded. The rule is deleted, so its URL takes no more alerts.
```

## `webhookRuleFailing`

Level: warning. Can be muted: no.

```text
⚠️ Alert rule "BNB breakout" ended: its last 5 fills failed on chain. The rule is deleted, so its URL takes no more alerts. Check the token, and make a new rule if you still want one.
```

## `ordersEnded`

Level: info. Can be muted: yes.

```text
Take-profit sold all your PEPE, so your 2 other exit orders on it ended
```

## `exitEnded`

Level: info. Can be muted: yes.

```text
Trailing stop on PEPE ended: the wallet holds none of it any more
```

## `lowGas`

Level: warning. Can be muted: yes.

```text
⚠️ Main has 0.001 BNB left for network fees. Add BNB.
```

## `daily`

Level: info. Can be muted: yes.

```text
Daily summary for main, the last 24 hours
🔴 Live: $1,200.00, +$50.00 in 24 hours; realized P&L +$12.40
🧪 Paper: $600.00; realized P&L $0.00
Auto orders: 1 filled, 1 skipped, 2 open
Model spend: $1.20, against a daily model budget of $3.00
1 card waits for your answer
1 skip: the wallet holds too little of this token
```

## `frozen`

Level: critical. Can be muted: no.

```text
🔴 main is frozen from Telegram. Unfreeze on the Safety screen of the console or the Mini App, or with `binference unfreeze` in the terminal.
```

## `unfrozen`

Level: info. Can be muted: no.

```text
🟢 main is unfrozen from the console.
```

## `rescue`

Level: critical. Can be muted: no.

```text
🔴 Rescue confirmed: moving everything to 0x9F3c…41aB
```

## `newDevice`

Level: info. Can be muted: no.

```text
A new console device was paired: Laptop
```

## `signInsLocked`

Level: warning. Can be muted: no.

```text
⚠️ Too many failed attempts to sign in with the console device Laptop, so binference refuses them until Oct 11, 2026, 09:30:00. None of them signed in.
```

## `limitChange`

Level: info. Can be muted: no.

```text
Limit changed by the CLI: the per-trade cap changes at Oct 11, 2026, 09:30:00. Not you? Cancel now.
```

## `limitChangeCancelled`

Level: info. Can be muted: no.

```text
Limit change cancelled for the 24-hour cap; the limit in effect stays
```

## `ceilingChange`

Level: warning. Can be muted: no.

```text
⚠️ The owner key changed the ceiling of main's wallets from the CLI: the most one contract call may carry. Not you? Freeze now.
```

## `dayCapAdded`

Level: info. Can be muted: no.

```text
A 24-hour cap on approvals of ETH now holds main's wallets. Until this change, approvals of ETH had no 24-hour cap.
```

## `signerRevoked`

Level: warning. Can be muted: no.

```text
⚠️ The owner key removed the agent key of signer office-mac from every wallet, from the CLI. The machine that held it signs nothing more. Not you? Freeze now.
```

## `sendLevel`

Level: info. Can be muted: no.

```text
Send level 2 → 1 at Oct 11, 2026, 09:30:00
```

## `sendLevelCancelled`

Level: info. Can be muted: no.

```text
Send level change to 0 cancelled; it stays 2
```

## `rescueStopped`

Level: critical. Can be muted: no.

```text
🔴 A rescue stopped part way: the rescue address changed while it ran. What was not sent stays in the wallets. Check them, then start a rescue again.
```

## `rescueAddress`

Level: warning. Can be muted: no.

```text
⚠️ Rescue address changes to 0x9F3c…41aB at Oct 11, 2026, 09:30:00. Not you? Cancel now.
```

## `rescueAddressCancelled`

Level: info. Can be muted: no.

```text
Rescue address change to 0x9F3c…41aB cancelled
```

## `ceilingOutdated`

Level: warning. Can be muted: no.

```text
⚠️ The wallets' ceilings still let sends pay 0x9F3c…41aB. Run `binference rescue set` with the owner key to update them.
```

## `plainSecret`

Level: warning. Can be muted: no.

```text
⚠️ A secret is written as plain text in config. Run `binference check --fix`.
```

## `budget`

Level: info. Can be muted: no.

```text
main used today's model budget ($3.00). Chat resumes Oct 11, 2026, 09:30:00; orders keep running.
```

## `scheduleSet`

Level: info. Can be muted: no.

```text
New schedule for main, set from Telegram, next run Oct 11, 2026, 09:30:00: Review my portfolio.
```

## `scheduleCancelled`

Level: info. Can be muted: no.

```text
Schedule of main cancelled by the agent: Review my portfolio.
```

## `loop`

Level: info. Can be muted: no.

```text
main repeated the same step and was stopped
```

## `watcherLag`

Level: warning. Can be muted: no.

```text
⚠️ Prices on BNB Smart Chain are read 14 blocks behind the chain, so auto orders may fill late. Add a paid RPC under `chains.rpc` in config.json5, or check this machine's network.
```

## `watcherStopped`

Level: critical. Can be muted: no.

```text
🔴 Price watching on BNB Smart Chain stopped on a fault and starts again by itself; auto orders there fill nothing until it does. Run `binference logs` to see why.
```

## `walletOverflow`

Level: warning. Can be muted: no.

```text
⚠️ Whale's trades in 3 blocks were too many to read; copy orders and alerts missed them.
```

## `watcherUnpriced`

Level: warning. Can be muted: no.

```text
⚠️ Price watching on BNB Smart Chain has no price for 2 watched tokens, 0x9F3c…41aB first, so their auto orders cannot trigger until a price returns. A price comes from a launchpad curve, or a PancakeSwap pool that trades at least $1,000 of WBNB or a stablecoin.
```

## `resumed`

Level: info. Can be muted: no.

```text
Engine was off 2 hours: 3 orders checked, 1 filled, 2 skipped
1 skipped: the price now does not reach its trigger price; the order waits on
1 skipped for other reasons
```

## `update`

Level: info. Can be muted: yes.

```text
binference 2027.1.0 is out. Run `binference update`. What changed: Stop-loss orders fill faster
```

## `updateBare`

Level: info. Can be muted: yes.

```text
binference 2027.1.0 is out. To install it, run binference stop, then npm install --global binference@2027.1.0, then binference start.
```

## `updated`

Level: info. Can be muted: yes.

```text
binference is now 2027.1.0. What changed: Stop-loss orders fill faster
```

## `updatedBare`

Level: info. Can be muted: yes.

```text
binference is now 2027.1.0.
```

## `updateRolledBack`

Level: warning. Can be muted: no.

```text
⚠️ binference 2027.1.0 did not pass after the update, so binference went back to 2026.12.2. Your settings and records are as they were before the update; messages and alerts that came while it was checked are not kept.
```

## `backupFailed`

Level: warning. Can be muted: no.

```text
⚠️ Last night's backup failed: its second copy in backups.copyTo could not be written
```

## `locked`

Level: critical. Can be muted: no.

```text
🔴 binference restarted and is locked. Run `binference unlock`.
```

## `restarted`

Level: info. Can be muted: no.

```text
binference restarted, as you asked, and serves again.
```

## `restartedForConfig`

Level: info. Can be muted: no.

```text
binference restarted to apply your settings and serves again: models.imageMaking, engine.port.
```

## `signerStopped`

Level: critical. Can be muted: no.

```text
🔴 The signer stopped, so binference signs nothing. Fix what `binference logs` shows, then run `binference unlock`.
```

## `signerRefused`

Level: warning. Can be muted: no.

```text
⚠️ The signer refused to sign a step of a trade: its amounts are not the trade's. Nothing was sent for it.
```

## `daySums`

Level: warning. Can be muted: no.

```text
⚠️ Not sent: it would pass your 24-hour cap of 10 BNB on BNB Smart Chain, of which 9.5 BNB is used. Room frees at Oct 11, 2026, 09:30:00. To raise the cap, change it on binference.io.
```

## `privyUnreachable`

Level: critical. Can be muted: no.

```text
🔴 binference could not reach Privy for five minutes after it started, so it stays locked. Check this machine's network, then run `binference unlock`.
```

## `webhookPortTaken`

Level: warning. Can be muted: no.

```text
⚠️ binference cannot take alerts for your alert rules: port 7457 is in use. Set `engine.webhookPort` in config.json5 to a free port, then restart binference.
```

## `webhookRotated`

Level: info. Can be muted: no.

```text
The URL of alert rule "BNB breakout" changed from the CLI; the old one no longer works. Not you? Delete the rule now.
```

## `pluginHostRefused`

Level: warning. Can be muted: no.

```text
⚠️ Plugin fear-index tried to reach `other.example.net`, which it does not declare. binference refused it.
```

## `pluginStopped`

Level: critical. Can be muted: no.

```text
🔴 Plugin fear-index crashed 5 times in 10 minutes, so binference stopped it. Enable it again with `binference plugin enable fear-index`.
```

## `pluginHostsHeld`

Level: info. Can be muted: no.

```text
Plugin fear-index asked for 3 more hosts it does not declare in the last hour. binference refused them all.
```

## `pluginStalled`

Level: warning. Can be muted: no.

```text
⚠️ Plugin fear-index stopped reading what binference sent it, so binference ended it. It starts again on its own.
```

## `pluginChanged`

Level: critical. Can be muted: no.

```text
🔴 Plugin fear-index did not start: its files are no longer the ones you added. Remove it with `binference plugin remove fear-index` and add it again.
```

## `pluginRevoked`

Level: critical. Can be muted: no.

```text
🔴 bInference revoked the listing of plugin fear-index 1.2.0, so binference turned this version off. Remove it, or add a version bInference lists.
```

## `pluginsHeld`

Level: warning. Can be muted: no.

```text
⚠️ binference cannot check bInference's plugin listings right now, so it stopped your plugins until it can. They start again on their own.
```

## `pluginSandboxOff`

Level: critical. Can be muted: no.

```text
🔴 Community plugins cannot run on this machine: a plugin could start a program. Run `binference check` to see the fix.
```

## `configInvalid`

Level: warning. Can be muted: no.

```text
⚠️ binference kept the settings it runs on: config.json5 has a value telegram.mode does not take. Run `binference check` to see the fix.
```

## `configChanged`

Level: info. Can be muted: no.

```text
Settings changed in config.json5: owner.locale. They apply now.
```

## `unknownTx`

Level: warning. Can be muted: no.

```text
⚠️ Main's nonce 42 was used by a transaction binference did not sign
```

## `fillDiffers`

Level: warning. Can be muted: no.

```text
⚠️ A trade settled more than 1% away from its simulation. Check the trade.
```

## `blockShared`

Level: warning. Can be muted: no.

```text
⚠️ Two trades of Main landed in one block, so its positions and P&L may count the coin that block paid it twice. Check the wallet.
```

## `fillUnknown`

Level: warning. Can be muted: no.

```text
⚠️ A trade settled, but no RPC can say what it received any more. Add a tracing RPC to the config and restart binference to finish it.
```

## `notSigned`

Level: warning. Can be muted: no.

```text
⚠️ A trade was cancelled before its first transaction was signed. Nothing was sent.
```

## `confirmationLapsed`

Level: warning. Can be muted: no.

```text
⚠️ A trade was not sent: its confirmation ran out before it could go out. Nothing was signed.
```

## `feeAboveCap`

Level: warning. Can be muted: no.

```text
⚠️ A trade waited because the network fee was above your cap, and its confirmation ran out. Confirm it again on its new card, or cancel it.
```

## `launchUnsent`

Level: warning. Can be muted: no.

```text
⚠️ A trade on a launch's curve was not sent: the launchpad no longer holds the token on that curve, as after its graduation. Nothing was signed.
```

## `nameMoved`

Level: warning. Can be muted: no.

```text
⚠️ A send to alice.bnb was not signed: the name now points to 0x2bA6…3c71, not 0x71C7…976F as on its card. Nothing was sent. Check the name, then propose the send again.
```

## `claimReady`

Level: info. Can be muted: yes.

```text
2 BNB you unstaked from 0x71C7…976F can be claimed now
```

## `claimedElsewhere`

Level: info. Can be muted: no.

```text
2 BNB you unstaked from 0x1adB…7fE6 was claimed outside binference and is back in your wallet
```

## `stakeMintedFewer`

Level: warning. Can be muted: no.

```text
⚠️ Your stake of 2 BNB with Pool landed after its rate moved: it minted 1.8 BNB, less than the 1.81 BNB its card promised. binference booked the 1.8 BNB it minted.
```

## `stakeApprovalLeft`

Level: warning. Can be muted: no.

```text
⚠️ Your unstake from Pool stopped after its approval landed: Pool may still take 1.8 BNB from this wallet, but only for an unstake the wallet itself asks for. Propose the unstake again if you still want it; it sets the approval anew.
```

## `skillProposed`

Level: info. Can be muted: no.

```text
main proposes the skill "dip-buyer". Its scan found problems, so it cannot be applied as it stands. Review it with /skills, in the console, or with `binference skill show skp_0190f1c2-3a4b-7c5d-8e6f-000000000001`.
```

## `skillApplied`

Level: info. Can be muted: no.

```text
Skill "dip-buyer" of main was applied from telegram. It loads from the agent's next turn.
```

## `skillRejected`

Level: info. Can be muted: no.

```text
The proposal for skill "dip-buyer" of main was rejected from cli.
```

## `skillHeld`

Level: warning. Can be muted: no.

```text
⚠️ Skill "dip-buyer" in the workspace of main is new or changed, so it does not load until you accept it. Check its files, then accept it with /skills, in the console, or with `binference skill accept dip-buyer`.
```

## `skillAccepted`

Level: info. Can be muted: no.

```text
Skill "dip-buyer" of main was accepted from console as its files are now. It loads from the agent's next turn.
```

## `bridgeLate`

Level: warning. Can be muted: no.

```text
⚠️ Your bridge of 20 BNB to Base has not arrived after 2 hours. binference keeps checking. fake-cross's status: https://bridge.test/transfer/0xd1
```

## `bridgeArrived`

Level: info. Can be muted: no.

```text
✅ Your late bridge to Base arrived: 0x71C7…976F received 19.96 BNB
```

## `bridgeRefunded`

Level: warning. Can be muted: no.

```text
⚠️ fake-cross did not deliver your bridge to Base and paid 20 BNB back to Main
```

## `bridgeLapsed`

Level: warning. Can be muted: no.

```text
⚠️ Your bridge to Base was not sent before its confirmation ran out: its quote expired, so propose it again. Nothing was signed.
```

## `bridgeKeyNeeded`

Level: warning. Can be muted: no.

```text
⚠️ fake-cross no longer says where your bridges stand without an API key it accepts. Until you set one, binference cannot tell when they arrive, and tells you of each one still out after 2 hours. Set venues.keys.fake-cross in config.json5 to a key from fake-cross's dashboard, then restart binference.
```

## `rescueBridged`

Level: info. Can be muted: no.

```text
Once your new rescue address 0x9F3c…41aB takes effect at Oct 11, 2026, 09:30:00, bridges from main's wallets may pay it on Base, Arbitrum: it holds no code there or on its own chain, so it is most likely a plain wallet with the same key there.
```

## `rescueNotBridged`

Level: info. Can be muted: no.

```text
Bridges from main's wallets do not pay your rescue address 0x9F3c…41aB on Base: it holds code there or on its own chain, so the same address there may not be yours. To bridge there, save an address you control on Base in the address book with your owner key.
```

## `shellAllowed`

Level: info. Can be muted: no.

```text
2 commands are now allowed from Telegram, in /srv/project: git log -1; head -n 3
```

## `shellDisallowed`

Level: info. Can be muted: no.

```text
A command is no longer allowed, removed from the CLI: git status in /srv/project
```

## `breakerPulled`

Level: critical. Can be muted: no.

```text
🔴 bInference pulled its breaker, so every agent it runs is frozen: the cards that waited were cancelled and auto orders paused. Your funds stay in your wallets, and a rescue to your rescue address still works. You will be told when it lifts.
```

## `breakerLifted`

Level: info. Can be muted: no.

```text
🟢 bInference lifted its breaker: your agents can trade again, but your own freeze still holds main, second. Unfreeze them when you want them to trade.
```

## `breakerApprovalLeft`

Level: warning. Can be muted: no.

```text
⚠️ A trade stopped part way while bInference's breaker held it, and the approval its first step gave still stands: 0x10ED…024E may still spend up to 1.8 BNB from 0x9F3c…41aB. If you no longer want that, revoke the approval.
```

## `identityMismatch`

Level: warning. Can be muted: no.

```text
⚠️ The identity registration of main landed, but the registry does not read back the account and registration file its card showed, so binference stored no identity. Check the registry before you rely on it.
```

## `identityDuplicate`

Level: warning. Can be muted: no.

```text
⚠️ A second identity registration of main landed, but binference keeps one identity per agent, so it stored none for this one. The wallet holds two identities now; check the registry.
```

## `launchStopped`

Level: warning. Can be muted: no.

```text
⚠️ The launch of MCAT on pad stopped: the launchpad did not pin its picture and words within 5 minutes. Nothing was signed, but its picture and words may be public on the launchpad. Propose the launch again if you still want it.
```

## `launchNotSigned`

Level: warning. Can be muted: no.

```text
⚠️ The launch of MCAT on pad stopped after you confirmed it: binference stopped before it signed the launch, and it never signs after a stop. No token was made and nothing was sent. Its picture and words may already be public on the launchpad. Propose the launch again if you still want it.
```

## `launchStepUnsent`

Level: warning. Can be muted: no.

```text
⚠️ The launch of MCAT on pad stopped part way: its approval landed, but binference stopped before it signed the create call, and it never signs after a stop. No token was made. The launchpad may still spend 6 BNB from the launch wallet, until a new launch sets that approval again. Its picture and words may already be public on the launchpad. Propose the launch again if you still want it.
```

## `stepUnsent`

Level: warning. Can be muted: no.

```text
⚠️ A trade stopped part way: an earlier step landed on chain, but a later one was never signed. Check the wallet.
```

## `stepDropped`

Level: warning. Can be muted: no.

```text
⚠️ A trade was stuck and did not go through. Nothing moved, and the wallet is free again.
```

## `stepDroppedPartWay`

Level: warning. Can be muted: no.

```text
⚠️ A trade stopped part way: an earlier step landed on chain, but a later one was stuck and did not go through. The wallet is free again. Check the wallet.
```

## `droppedLanded`

Level: critical. Can be muted: no.

```text
🔴 A trade binference reported as stuck went through after all. binference has now counted it toward your limits and positions. Check the wallet.
```

## `walletHeld`

Level: warning. Can be muted: no.

```text
⚠️ A transaction of Main is stuck, so the wallet's later trades wait behind it. binference keeps sending it until a block holds it or every relay drops it.
```

## `binanceRefused`

Level: warning. Can be muted: no.

```text
⚠️ main tried a trade over its limit: buy $500 of CAKE. Refused.
```

## `binancePaused`

Level: info. Can be muted: no.

```text
main paused from the Mini App
```

## `approvalMode`

Level: info. Can be muted: no.

```text
main is now in auto mode, from the CLI
```

## `alertPrice`

Level: info. Can be muted: yes.

```text
PEPE is at or above $0.00001: now $0.000011
main is looking into it.
3 more matches did not wake main: at most 10 wake-ups an hour.
```

## `alertWallet`

Level: info. Can be muted: yes.

```text
Whale sold 2M PEPE, 40% of its holding, for $22.10
```

## `alertLaunch`

Level: info. Can be muted: yes.

```text
New launch passed your filters: PEPE 0x6982…1933 · Pad · 3 min ago · curve 42% · tax 1% · 2 insider wallets · creator's other launches in 30 days: 0
```

## `alertHeld`

Level: info. Can be muted: yes.

```text
12 more matches this hour, see the console
```
