---
title: Send and bridge
description: Save the addresses the agent may pay, send to them on BNB Smart Chain, revoke approvals, and bridge to Ethereum, Base, Arbitrum, Robinhood Chain and Solana.
---

The agent can pay only addresses you saved with your owner key, and your rescue address. That rule
lives in each wallet's [ceiling](/guides/safety/#the-ceiling) at Privy, so it holds even if the
engine's keys are stolen. Sends, approval revokes and bridges are live only, always show a card, and
never run in auto mode.

## The address book

Save an address with your owner key:

```sh
binference address add 0x9F3c...41aB --label "cold wallet"
```

binference writes it into the address book and into every wallet's ceiling. An address is saved for
one chain: BNB Smart Chain by default, or the chain `--chain` names for a bridge to deliver to:

| Chain           | `--chain`      |
| --------------- | -------------- |
| Ethereum        | `ethereum`     |
| Base            | `base-mainnet` |
| Arbitrum        | `arbitrum`     |
| Robinhood Chain | `robinhood`    |
| Solana          | `solana`       |

A saved address is paid only on its own chain. binference refuses a token contract, a venue
contract, the agent's bridge or launch wallet, and on Solana a program or token account. Each chain
holds at most 100 saved addresses.

`binference address list` shows each entry and when a send may pay it.
`binference address remove <adr_...>` removes one at once; binference sends nothing to it from then
on.

## Sends

Ask the agent, for example "send 50 USDT to cold wallet". It proposes the send on a card that names
the entry and its address. A send may pay:

- your rescue address
- a saved address on the wallet's chain
- a `.bnb` name that points to a saved address, as the [names guide](/guides/names-and-identity/)
  explains

After the agent read outside content, it cannot send to an address outside the address book. A send
counts against the per-trade cap and the 24-hour cap.

The [send level](/guides/safety/#send-levels) can narrow sends further: at level 2 an entry is paid
only 24 hours after it was saved, and level 3 allows no sends.

## Revoke an approval

Ask the agent to revoke a token approval. It proposes setting the allowance back to zero, for a
spender the registry lists. A revoke counts against neither cap, and works while the agent is
frozen, still with its card.

## Bridges

A bridge moves a token from BNB Smart Chain to another chain. binference bridges with two venues:

| Destination     | Across                     | Relay                  |
| --------------- | -------------------------- | ---------------------- |
| Ethereum        | USDC, USDT, ETH            | USDC, USDT             |
| Base            | USDC, USDT, ETH            | USDC, USDT             |
| Arbitrum        | USDC, USDT (as USDT0), ETH | USDC, USDT (as USDT0)  |
| Robinhood Chain | ETH                        | USDC and USDT, as USDG |
| Solana          |                            | USDC, USDT             |

ETH arrives in a plain wallet as ETH. BNB is not bridged.

- **Across** bridges from the agent's main wallets. Its deposit names the recipient and the
  destination, and the ceiling holds each to your saved addresses.
- **Relay** bridges only from the agent's **bridge wallet**. Relay's deposit names no recipient, so
  no ceiling can check where it pays. A small wallet you fund keeps that risk to what it holds.

### Turn bridges on

Neither venue is on for a new agent. With your owner key, add it to the ceiling, then to the agent's
venues. Run `binference ceiling` to see the venues the wallets keep, and name them all again with
the new one:

```sh
binference ceiling set --venues <the venues it lists>,across
binference limit set limits.venues=<the venues it lists>,across
```

Adding a venue loosens the limits, so it applies after 24 hours.

For Relay, first make the bridge wallet with your owner key, and fund it from outside:

```sh
binference wallet create --bridge --label bridge
```

Its ceiling allows only Relay deposits and sends to your rescue address and saved addresses. No
other wallet of the agent can pay it, so fund it from a wallet of your own. Then add `relay` to the
agent's venues with `binference limit set`.

### Bridge

Save the address that should receive on the destination chain, then ask the agent, for example
"bridge 20 USDC to my Base wallet". binference quotes every route at once and picks the one with the
best least output. The card names the recipient, the destination chain, the least that arrives,
about how long it takes, the fees and the venue, and the bridge wallet when the bridge leaves from
it. When a route delivers another token, such as USDG on Robinhood Chain, the card shows the swap
rate; above 0.5% the route is refused.

A bridge counts against the per-trade cap and the 24-hour cap. With no recipient named, binference
quotes for your rescue address on that chain, when it may pay it there.

### Your rescue address on other chains

A bridge pays your rescue address on an EVM chain only where it holds no code, on BNB Smart Chain or
on the destination: then it is most likely a plain wallet with the same key. It is never paid on
Solana. binference adds it to a chain's bridge rule once you saved an address on that chain. You get
the [`rescueBridged`](/reference/notices/#rescuebridged) or
[`rescueNotBridged`](/reference/notices/#rescuenotbridged) notice; when it is not paid, save an
address you control on that chain.

### After the deposit

binference reads the destination chain every 30 seconds until the funds arrive, and the receipt
names what arrived. A bridge never times out:

- After 2 hours without delivery it is late, and you get the
  [`bridgeLate`](/reference/notices/#bridgelate) notice once, with the venue's status page.
  binference keeps reading.
- [`bridgeArrived`](/reference/notices/#bridgearrived) tells you when a late bridge arrives.
- [`bridgeRefunded`](/reference/notices/#bridgerefunded) tells you the venue paid it back to the
  wallet.

`/positions` shows a bridge in transit at the value it left with, until it arrives.

### Relay's API key

binference uses Relay without a key. Relay retires the keyless read of a deposit's status on
2026-11-24; after that, set `venues.keys.relay` to a key from Relay's dashboard, or binference
cannot tell when a Relay bridge arrives and sends the
[`bridgeKeyNeeded`](/reference/notices/#bridgekeyneeded) notice.

## What binference does not do on other chains

binference holds no key on another chain and signs nothing there. It reads the destination chains
only to see that a bridge arrived. To move funds on from there, use your own wallet.

## See also

- [Commands](/reference/commands/) for `address`, `wallet create` and `ceiling set`.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/): `addresses`, `send`, `approval_revoke`,
  `bridge_quote` and `bridge`.
