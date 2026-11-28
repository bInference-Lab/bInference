---
title: Get started
description: Set binference up on your Mac, pair your Telegram bot, make a paper trade by chat, confirm its card, set your limits, go live, and freeze or rescue when you need to.
---

This page takes you from the install to your first trade. binference supports macOS for now.

## What you need

- A Mac, with Terminal.
- A Privy account, at [dashboard.privy.io](https://dashboard.privy.io). binference keeps your
  agent's wallets in a Privy app of your own.
- A Telegram account, to make a bot of your own with @BotFather.
- An API key from a model provider: the bInference Router, OpenAI, Anthropic, OpenRouter, or any
  other provider of the OpenAI or Anthropic API.
- A wallet only you control on BNB Chain, such as a hardware wallet, for your rescue address.

## Install

Open Terminal and run:

```sh
curl -fsSL https://agent.binference.io/install.sh | sh -s -- --beta
```

The [install guide](/guides/install/) says what the script puts where. At its end it runs
`binference init`.

## Set up with binference init

`binference init` asks its questions in this order, and checks each answer before it stores or
makes anything:

1. **Language**, English or Simplified Chinese.
2. **The disclaimer and the privacy statement.** Type `I understand` to accept them.
3. **Usage counts**, yes or no.
4. **Your model:** the provider, the model's ID and its API key. binference checks the key with one
   small call before it keeps it.
5. **Your Privy app:** its app ID and app secret, from Configuration, App settings, Basics in
   Privy's dashboard.
6. **Your owner key.** binference shows it once as a `bnok1` code and keeps only its public half.
   Write it down and keep it offline, then type its last 6 characters back. It raises a wallet's
   ceiling, saves addresses the agent may pay, exports a wallet and attaches a new machine.
7. **Your rescue address** on BNB Chain, starting with `0x`.
8. **Your bot token.** In Telegram, start a chat with @BotFather, type `/newbot`, and paste the
   token it gives you.
9. **Your limits:** the per-trade cap and the 24-hour cap in US dollars, $100 and $500 unless you
   type others.

Then init makes your agent wallet on Privy, with its ceiling, and this Mac's agent key, which signs
inside that ceiling. At your Mac's desktop, the key goes into the keychain; init says where it kept
it. It writes your settings to `~/.binference/config.json5`, and asks whether to start binference
now as the background service, which then starts each time you log in. If you say no, start it
later with `binference start`.

## Pair your Telegram bot

At its end, init prints a link to your bot and the time it runs out. Once binference runs, open the
link in Telegram. Whoever opens it first becomes the owner, and the bot then answers that Telegram
account only, in its private chat.

If the link ran out, or to pair another account, run `binference telegram pair`. It prints a new
link, valid 10 minutes.

## Your first trade, on paper

Your agent starts in paper mode. It reads real quotes, runs every check and shows real cards, but
records each fill at the confirmed quote and sends nothing on chain. Its paper portfolio starts
with 1 BNB and 500 USDT. Write to your bot as you would to a person, for example:

```text
Buy 10 USDT with BNB.
```

The agent proposes the trade on a card. Confirm it, then send `/positions` to see your paper
holdings.

## The card and Confirm

A card shows the terms of one action: what leaves the wallet, the least that arrives, the fees and
any warning. Paper cards say so. Press Confirm to go ahead, or Cancel. A trade card lasts 60
seconds, other cards 10 minutes, and a card nobody answers sends nothing.

In manual mode, the default, every transaction waits for your tap on its card. The
[safety guide](/guides/safety/) says which actions need a card in any mode.

You can answer a card on any surface: Telegram, the console, the terminal chat that
`binference chat` opens, or `binference confirm <id>` and `binference deny <id>` in a shell. The
first answer counts. Run `binference console` for a link that opens the console in your browser.

## Your limits

The engine checks the limits before every card. See them with:

```sh
binference limit
```

Change them with `binference limit set`, each limit as `key=value`:

```sh
binference limit set limits.perTradeUsd=50
```

A stricter limit applies at once. A looser one waits 24 hours, and you get a notice, so a change
you did not make can be stopped with `binference limit cancel`. In Telegram, `/limits` shows the
limits, and its buttons can only make them stricter.

## Go live

When you want to trade with real money:

1. Run `binference wallet address` for the address of your agent wallet, and fund it with BNB on
   BNB Chain. The agent keeps 0.002 BNB of it aside for network fees.
2. Run `binference live` in Terminal on this Mac. It shows the disclaimer and the privacy statement
   unless you accepted them at init, and asks you to type `I understand`. It refuses until the
   wallet holds funds.

The first live card says that the trade uses real money. To switch back, run `binference paper`,
or send `/paper` in Telegram.

## Freeze and rescue

- **Freeze** stops at once: send `/freeze` in Telegram, or run `binference freeze`. Every open card
  and every action not yet signed is cancelled, and auto orders pause. To unfreeze, run
  `binference unfreeze` and confirm the card it opens.
- **Rescue** moves what every agent wallet holds to your rescue address, but the 0.002 BNB it
  keeps for network fees: send `/rescue` in Telegram, or run `binference rescue`, then confirm its
  card. It works while frozen and in paper mode too, where it moves the real funds.

## Next

- [Chat with your agent](/guides/chat/): the Telegram commands, the console and the terminal chat.
- [Safety](/guides/safety/): auto mode, the ceiling and your two keys.
- [Auto orders and alerts](/guides/auto-orders/): limit, take-profit, stop-loss and more.
