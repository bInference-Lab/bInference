---
title: Launch a token
description: Launch a token on Flap, Genius.fun or Brew from a launch wallet, with a draft the agent writes and only you start.
---

binference can launch a token on three launchpads on BNB Smart Chain: Flap, Genius.fun and Brew.
Only you start a launch. The agent may draft one from your chat in Telegram, and nothing is
published until you press Start launch and confirm its card. binference takes no commission on any
launch.

A launch publishes its name, words and picture for good, so it runs only live: in paper mode a
launch is refused. Auto mode never launches.

## The launch wallet

Every launch runs from the agent's launch wallet: a small wallet of its own whose ceiling alone
allows the launchpads' create calls. Make it with your owner key:

```sh
binference wallet create --launch --label launch
```

Fund it from a wallet of your own. No other wallet of the agent can pay it, and it cannot be your
rescue address or a saved address, so a stolen engine key can lose only what it holds. A rescue
empties it like any other agent wallet. An agent has one launch wallet.

The launch wallet also runs the agent's live trades on a launch's own curve, such as a Genius.fun
token's.

The launchpad must be one of the agent's venues. Flap is by default; add Genius.fun or Brew with
`binference limit set limits.venues=<the venues it has>,geniusfun`, which applies after 24 hours.
`binference limit` shows the venues the agent has.

## Draft a launch in Telegram

1. In the bot's chat, tell the agent what to launch: the launchpad, the name and symbol, the
   description and links, what it pairs with, and the first buy. For Flap or Brew, send the picture
   with that message.
2. The agent drafts the launch. The bot shows every line of the draft with the picture, and two
   buttons: **Start launch** and **Drop**. A draft lasts 10 minutes, and a newer draft replaces it.
3. Press **Start launch**. binference proposes the launch from your press, not the agent's.
4. The launch card follows, with every setting, the fees and the first buy. Confirm it, within 10
   minutes.

The console shows a draft but cannot start it: start it in Telegram. Neither the agent nor an MCP
client can propose a launch itself (`intent.owner_only`), and only one launch of an agent runs at a
time.

## The launchpads

### Flap

- binference uploads the picture and words to Flap, then waits up to 5 minutes for Flap to pin them
  before the card opens. If Flap does not pin them in time, the launch stops with the
  [`launchStopped`](/reference/notices/#launchstopped) notice, and the picture and words may already
  be public.
- binference launches tax tokens only: a tax on every buy, every sell or both, each 1% to 10%, for a
  number of days, paid to an address you name, with an optional share burned.
- It pairs with BNB, USDT or USD1. Flap charges no launch fee.
- The first buy runs inside the create call with no minimum on chain. The simulation holds it to its
  minimum before the card, and the card warns you of it.

### Genius.fun

- Genius.fun has no API for pictures: give a link to a picture you host, `ipfs://` or `https://`.
  binference never opens it.
- Name the creator fee recipient, the address that claims the creator's part of every trade's fee.
  It cannot be one of your agent wallets, since binference cannot claim those fees.
- It pairs with BNB, USDT or USDC. The launch fee is read from Genius.fun's contracts when quoted.
- The first buy keeps a minimum on chain.

### Brew

- The picture goes into the create call itself, so it must be small: the picture and words share
  2,048 bytes.
- The token starts in a pool with a 1% fee, its whole supply of 1,000,000,000 in one range, locked
  in Brew's locker. Its starting market cap is 8 BNB, 5,000 USDT or USDC, or else about $5,000 at
  binference's price of the pair, unless you name another.
- Name the pool fee recipient, or turn holder rewards on: the creator's part of the pool fees then
  buys the token and burns it, for good.
- It pairs with BNB, USDT, USDC, FDUSD, BTCB, ETH, Cake, slisBNB or USD1. The launch fee is read
  from Brew's contracts when quoted.
- Every Brew card warns that Brew's site says it is not available to U.S. citizens.

## When a launch stops

- [`launchStopped`](/reference/notices/#launchstopped): the launch ended before its card, such as
  when the pin did not come.
- [`launchNotSigned`](/reference/notices/#launchnotsigned): binference stopped after you confirmed
  but before it signed. No token was made.
- [`launchStepUnsent`](/reference/notices/#launchstepunsent): its approval landed, but the create
  call was never signed. The notice names what the launchpad may still spend.

binference never signs a launch again after a stop. Propose it again if you still want it.

## See also

- [Commands](/reference/commands/) for `wallet create --launch`.
- [Auto orders and alerts](/guides/auto-orders/) for launch alerts.
- [Safety](/guides/safety/) for the ceiling.
