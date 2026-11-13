---
title: Safety
description: What needs your tap, what auto mode may do, the limits, the ceiling that holds even with stolen keys, and how to freeze and rescue.
---

binference keeps your money behind three layers. The **limits** are your agent's caps, which the
engine checks before every card. The **card** is the terms you confirm with a tap. The **ceiling**
is each wallet's policy at Privy, the custody provider: it holds even if someone steals the engine's
keys, and only your owner key changes it.

## Paper and live

A new agent starts in paper mode: it reads real quotes, runs every check and shows real cards, but
records each fill at the confirmed quote and sends nothing on chain. Paper cards say so.

`binference live` moves an agent to live. It runs only in a terminal on the engine's machine: it
shows the disclaimer and the privacy statement and asks you to type that you understand. It refuses
until the agent's wallet holds funds. The first live card says that the trade uses real money.

`binference paper`, or `/paper` in Telegram, moves the agent back to paper mode from any surface. An
action keeps the mode it was proposed in. Sends, approval revokes, bridges, token launches and the
identity registration are live only.

## What needs your tap

In manual mode, the default, every transaction waits for your tap on its card, except the fills of
an auto order or an alert rule you confirmed once. A trade card lasts 60 seconds, every other card
10 minutes. When you tap a trade card whose quote is older than 10 seconds, binference quotes it
again; if the new least output is worse by more than 0.5%, a new card opens and the old tap does not
count.

These always open a card, in any mode:

- sends, bridges and the rescue
- unstakes
- token launches and the identity registration
- approval revokes
- unfreezing
- auto orders and alert rules, once each, when you make them

## Auto mode

`binference approval auto` lets the agent's own trades run without a tap;
`binference approval manual` switches it back. Each change is announced with the
[`approvalMode`](/reference/notices/#approvalmode) notice.

Auto mode runs an action without a card only when every one of these holds:

- it is a buy, a sell or a swap, or a stake or claim with the agent's own wallet
- it fits the per-trade cap and the 24-hour cap
- the network fee is at most the network fee cap
- it sells no token on the deny list
- it buys no token that is not verified, and none with a risk warning such as a tax
- every approval it sets goes to a spender the registry lists
- the agent proposed it, not an MCP client
- the chat that led to it read no outside content, and no community plugin is enabled
- the engine is unlocked

Anything else opens a card, and the card says why auto mode asked.

## The limits

Each agent copies its limits from `defaults` in `config.json5` when it is made:

| Limit                              | Config key                                  | Default                    |
| ---------------------------------- | ------------------------------------------- | -------------------------- |
| Most one trade may move            | `defaults.limits.perTradeUsd`               | $100                       |
| Most trades and sends move in 24 h | `defaults.limits.rollingDayUsd`             | $500                       |
| Slippage on registry tokens        | `defaults.limits.slippageBps.registry`      | 1%                         |
| Slippage on other tokens           | `defaults.limits.slippageBps.other`         | 5%                         |
| Largest price impact               | `defaults.limits.priceImpactBps`            | 3%                         |
| Largest token tax                  | `defaults.limits.taxBps`                    | 10%                        |
| Least pool liquidity               | `defaults.limits.liquidityFloorUsd`         | $10,000                    |
| BNB kept for network fees          | `defaults.limits.gasReserve.eip155:56`      | 0.002 BNB                  |
| Venues the agent may use           | `defaults.limits.venues`                    | every installed core venue |
| Tokens allowed, tokens refused     | `defaults.limits.allowTokens`, `denyTokens` | none                       |

The 24-hour cap is rolling: it counts what trades, sends, bridges and stakes moved in the last 24
hours, from the moment each was confirmed. Unstakes and claims count against neither cap.

`binference limit` shows the limits in effect. `binference limit set` changes them, each as
`key=value` with the key `defaults` uses, such as:

```sh
binference limit set limits.perTradeUsd=50 limits.rollingDayUsd=300
```

A stricter limit applies at once. A looser one waits 24 hours, and you get the
[`limitChange`](/reference/notices/#limitchange) notice, so a change you did not make can be
stopped: `binference limit cancel` drops the looser limits that wait. In Telegram, `/limits` shows
the limits, and its buttons can only make them stricter.

The Limits screen of the console and the Mini App shows each agent's limits and changes one at a
time: pick the limit and type its new value in the unit it shows, such as `50` dollars or `0.5`
percent. A stricter one applies at once; a looser one shows when its 24 hours end, and Cancel the
looser limits drops what waits. A refused change says why. The gas reserve changes in the terminal
only.

## Token checks

A token the registry does not list is checked before a buy: binference asks GoPlus, then runs a test
buy, transfer and sale on the chain's current state. A honeypot, a token that cannot be sold, a
hidden owner, a blacklist, a tax over your limit or liquidity under your floor is refused, in any
mode. A sale skips this check; its simulation decides.

## The network fee cap

`chains.maxFeePerGasGwei` caps the fee per gas, 1 gwei on BNB Smart Chain by default. While the
network asks more, a transaction waits and is retried each block. Nothing is ever signed above the
cap.

## The ceiling

The ceiling is each wallet's policy at Privy. Privy refuses to sign anything outside it, so it holds
even when the engine or its machine is taken over. It allows:

- **Sends** only to your rescue address and to the addresses you saved with your owner key.
- **Contract calls** only to the venues the ceiling names, and only the functions each venue
  declares, with approvals only to their declared spenders.
- **Native coin per call:** at most 1 BNB per contract call (`defaults.ceiling.perTxBnb`).
  StakeHub's stake and Lista's stake may carry up to 100 BNB.
- **24-hour caps** shared by every wallet of the install: the BNB all transactions send, and the
  approvals of WBNB, USDT, USDC and ETH. `binference init` sizes each at twice
  `defaults.limits.rollingDayUsd`, valued at a floor price: $100 a BNB or WBNB, $1 a stablecoin,
  $1,000 an ETH. At the default $500 that is 10 BNB, 10 WBNB, 1,000 USDT, 1,000 USDC and 1 ETH a
  day.

Someone with stolen engine keys can still trade at a bad price within these caps, but cannot send
your funds anywhere you did not save.

`binference ceiling` shows a wallet's ceiling as Privy holds it. `binference ceiling set` changes it
with your owner key:

- `--venues <ids>` sets every venue a contract call may use, separated by commas, on every wallet of
  the agent. Run `binference ceiling` first and name every venue you keep: binference refuses to
  drop a venue the agent's limits still name.
- `--per-tx 0.5` sets the most native coin one contract call may carry.
- `--day-cap-usd 2000` sizes every 24-hour cap, on every wallet of every agent. It goes alone.

Each change is announced with the [`ceilingChange`](/reference/notices/#ceilingchange) notice.

## Your two keys

- **The owner key** owns the wallets and their ceilings. `binference init` shows it once as a
  `bnok1` code: keep it offline. You type it at a hidden prompt for `rescue set`, `address add`,
  `ceiling set`, `wallet create`, `wallet export`, `signer revoke`, `agent identity`, attaching
  another machine and restoring a backup. It never goes into the keychain.
- **The agent key** lives on the engine's machine and can ask Privy for signatures inside the
  ceiling only. The signer process holds it and checks its own rules before every signature: the
  chain, the contract and function, the exact amounts and approvals, the fee cap, and a live
  confirmation or grant for the exact terms.

## Freeze

A freeze stops at once. It cancels every open card and every action not yet signed, ends the agent's
running answer and pauses its auto orders. Transactions already sent finish.

- `binference freeze` freezes every agent and the install, so an agent made later starts frozen.
  `binference freeze --agent <id>` freezes one agent.
- `/freeze` in Telegram freezes everything.
- The Safety screen of the console or the Mini App freezes every agent, or one, after asking once
  more.

While frozen, an agent proposes nothing, except an approval revoke, which still needs its card.

To unfreeze, run `binference unfreeze` (with `--agent <id>` for one agent), or press Unfreeze on
the Safety screen of the console or the Mini App. It opens a card; confirming it from any surface
unfreezes. Auto mode never confirms it. `binference safety status` and the Safety screen show what
is frozen, the rescue under way and the rescue address.

## Rescue

A rescue moves everything out of every agent wallet to your rescue address: each registry token,
each token a wallet holds a position in, then the BNB above the gas reserve. It sells nothing. It
works while frozen and in paper mode too, where it moves the real funds.

Open it with `binference rescue`, `/rescue` in Telegram or Open the rescue card on the Safety
screen of the console or the Mini App, then confirm its card. A transfer whose
simulation fails is left out, and each step is retried up to 3 times. The
[`rescue`](/reference/notices/#rescue) notice tells you it started.

The rescue address is set at `binference init`. To change it, run `binference rescue set <address>`
with your owner key: the new address takes effect after 24 hours, and the old one works until then.
You get the [`rescueAddress`](/reference/notices/#rescueaddress) notice; if you did not ask for it,
run `binference rescue cancel`.

## Send levels

A send pays only your rescue address or a saved address, at every level. The send level of an agent
narrows it further: 0 and 1 allow any saved address, 2 allows an address only 24 hours after it was
saved, and 3 allows no sends. New agents start at `defaults.sendLevel`, 0 by default. The
[sends and bridges guide](/guides/sends-and-bridges/) covers the address book.

## Check your install

`binference check` reads the config, who can open its files, the unlock mode, the engine, the
wallets' ceilings, remote access and the plugin sandbox, and names a fix for each finding.
`binference check --fix` makes files and folders others can open yours alone.

## See also

- [Commands](/reference/commands/) for `limit`, `approval`, `ceiling`, `freeze`, `rescue` and
  `safety`.
- [Notices](/reference/notices/) for every notice about a freeze, a limit, the ceiling or the rescue
  address.
