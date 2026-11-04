---
title: Stake BNB
description: Stake the agent's BNB with a validator on StakeHub or in Lista's pool for slisBNB, then unstake and claim it back.
---

Your agent can put its BNB to work in two places on BNB Smart Chain:

- **StakeHub**, BNB Smart Chain's native staking: you stake with a validator, and your stake earns
  that validator's rewards less its commission.
- **Lista**, which mints slisBNB for your BNB: you stake into its one pool, with no validator to
  pick.

Each venue credits only the wallet that signs. binference never hands over your stake's votes. A
stake is three moves: a **stake**, an **unstake** that starts the unbonding time, and a **claim**
that takes the BNB back to the wallet once that time has passed.

## Stake

Ask the agent, for example "what can I stake with?" or "stake 2 BNB with the validator with the
lowest commission". It reads the options, then proposes the stake on a card. The card shows:

- on StakeHub, the validator and its commission, and when it can be read, its yearly rate from its
  last day of rewards
- on Lista, the least slisBNB the stake mints
- how many days an unstake will take before you can claim it

A stake counts against the agent's per-trade cap and its 24-hour cap, like a trade. In
[auto mode](/guides/safety/#auto-mode), a stake within the caps may run without a card.

binference refuses a stake below the venue's minimum, which it reads from the chain, a stake with a
jailed validator, and any move while the venue is paused.

## Unstake

An unstake always shows a card, in any mode, since it locks the BNB for the unbonding time. The card
says when the BNB is ready to claim.

- On StakeHub, name the validator and an amount in BNB, or unstake all of it.
- On Lista, name the slisBNB to unstake. binference first approves exactly that slisBNB, then asks
  Lista to withdraw it. Lista's own queue releases it, which may take longer than the card's
  estimate.

Unstakes and claims count against neither cap.

## Claim

binference checks every minute and sends the [`claimReady`](/reference/notices/#claimready) notice
once you can claim. Ask the agent to claim; in auto mode a claim may run without a card. If a Lista
withdrawal was claimed outside binference, such as on Lista's site, you get the
[`claimedElsewhere`](/reference/notices/#claimedelsewhere) notice and binference counts it once.

## The 100 BNB stake rule

The [ceiling](/guides/safety/#the-ceiling) limits a contract call to 1 BNB. StakeHub's stake and
Lista's stake have a rule of their own that carries up to 100 BNB in one transaction; every other
call keeps the 1 BNB cap.

A wallet whose ceiling was written before this rule still holds a stake to 1 BNB. binference then
refuses a larger stake before its card (`stake_over_ceiling`). To fix it, write the ceiling again
with your owner key, naming every venue the wallet keeps:

```sh
binference ceiling
binference ceiling set --venues <the venues it lists>
```

## Paper mode

A paper stake moves paper BNB into a paper staking position at the venue's quote. A paper unstake
waits the venue's real unbonding time before a paper claim can take it back.

## What you see

`/positions` in Telegram and the console's portfolio show a Staking section: each stake at what it
is worth now, with its rewards, and apart from it what unbonds and what can be claimed. slisBNB is
priced from BNB's price times Lista's rate, and only while that rate agrees with Chainlink's slisBNB
feed within 1%; otherwise it shows no value. Stakes made outside binference are not listed.

## Notices

- [`claimReady`](/reference/notices/#claimready): an unstake can be claimed now.
- [`claimedElsewhere`](/reference/notices/#claimedelsewhere): a Lista withdrawal was claimed outside
  binference.
- [`stakeMintedFewer`](/reference/notices/#stakemintedfewer): a Lista stake minted less slisBNB than
  its card promised, after Lista's rate moved.
- [`stakeApprovalLeft`](/reference/notices/#stakeapprovalleft): a Lista unstake stopped after its
  approval landed; propose it again to finish.

## See also

- [Agent and MCP tools](/reference/agent-and-mcp-tools/): `staking_options`, `stake`, `unstake` and
  `claim`.
- [Safety](/guides/safety/) for the caps and the ceiling.
