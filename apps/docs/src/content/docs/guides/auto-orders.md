---
title: Auto orders and alerts
description: Limit, take-profit, stop-loss, trailing, DCA and copy orders that you confirm once, and alerts that tell you without trading.
---

An auto order is a trade you confirm once, on its card, that then fills by itself whenever its
condition holds, inside the bounds on that card. An alert only tells you, and sends no transaction.

:::caution[Auto orders fill on paper only]
Live fills of auto orders are off. binference refuses an auto order while the agent is live, with
the error `order.live_fills_off`. Place auto orders while the agent is in paper mode, where they
fill on paper at real prices. An order keeps the mode it was made in, so a paper order still fills
on paper after the agent goes live.
:::

## The kinds

| Kind          | What it does                                                                              |
| ------------- | ----------------------------------------------------------------------------------------- |
| Limit         | Buys or sells once the price reaches the trigger price                                    |
| Take-profit   | Sells once the price rises to the trigger price                                           |
| Stop-loss     | Sells once the price falls to the trigger price                                           |
| Trailing stop | Sells once the price falls a set distance below its highest point since the order started |
| DCA           | Buys a set amount on a schedule                                                           |
| Copy trade    | Buys and sells when a wallet you follow does                                              |

## Make an order

Ask your agent in chat, for example "set a stop-loss on my CAKE at $1.80" or "buy $20 of BNB every
Monday at 9". The agent proposes the order, and its card shows every bound: the token, buy or sell,
the size, the wallet, the trigger, the worst price, the most slippage and when the order ends.
Confirm the card once; each fill then runs inside those bounds without a card. An MCP client can
propose an order the same way, and its card waits for you too.

binference refuses an order before its card when:

- it asks more slippage than the agent's limit (`order.slippage_limit`)
- the price watcher cannot price its token (`order.unpriced_token`): a token needs a launchpad
  curve, or a PancakeSwap pool that trades at least $1,000 of WBNB or a stablecoin
- the agent is live (`order.live_fills_off`)

`/orders` in Telegram lists the active orders with their triggers and fills. To cancel one, ask the
agent; a cancel needs no card.

## How a fill runs

The price watcher reads the price of every token with an active order at each new block. When a
trigger is met, binference sizes the fill and checks it against the order's bounds and the agent's
24-hour cap, then fills it. A fill has 30 seconds; one that runs past them is skipped.

- **Worst price.** A limit order and a take-profit fill at their trigger price or better by default.
  A stop-loss and a trailing stop have no worst price, so they sell at the market price, within the
  order's slippage.
- **Once or more.** A price order fills once unless its card names more fills. After a fill it waits
  until its condition stops holding before it can fill again.
- **Exit orders end together.** When one exit order (a take-profit, stop-loss, trailing stop or
  limit sale) sells a whole position, the position's other exit orders end, and you get the
  [`ordersEnded`](/reference/notices/#ordersended) notice.
- **Expiry.** An order ends after the agent's order expiry, 30 days by default
  (`defaults.orders.expiryDays`), unless its card names another end. Change it with
  `binference limit set orders.expiryDays=7`. You get the
  [`orderExpiring`](/reference/notices/#orderexpiring) notice a day before.
- **Failures.** After 5 fills in a row fail, the order is cancelled with the
  [`fillsFailing`](/reference/notices/#fillsfailing) notice.

Each fill sends the [`fill`](/reference/notices/#fill) notice, and each skip the
[`skipped`](/reference/notices/#skipped) notice with its reason. Both can be muted per agent with
`defaults.notifications.muted`.

## DCA

A DCA order only buys. Its schedule names the minute, hour, day of the month, month and day of the
week, in your time zone unless it names another, and may stop after a number of buys. A buy that
cannot start within 60 seconds of its time is skipped as missed and never made up later.

## Copy trade

A copy order follows a leader wallet and copies its buys and sales of tokens.

- **Buys.** Each copied buy spends the least of the order's own size, the agent's
  `defaults.copy.perBuyUsd` ($20 by default) and what the leader spent. Buys under $5 are skipped,
  and an order makes at most 10 buys an hour.
- **Daily cap.** Copies of one leader spend at most `defaults.copy.perLeaderDayUsd` a day ($200 by
  default), and the order's own daily cap if it names one.
- **Sales.** When the leader sells a share of its holding, the order sells the same share of what it
  bought. A sale that fails for a passing reason is tried again each minute for an hour.
- **Late trades.** binference reads a leader's trades once they are 12 blocks deep. A buy more than
  60 seconds late is never made. A sale is still made late, at the price then, and the notice says
  it was late.
- The leader cannot be one of your own wallets, and an agent follows at most 50 wallets.

Each skip of a copy order is a notice: at most 5 an hour per order, then one
[`copyHeld`](/reference/notices/#copyheld) line counts the rest.

## Freeze and downtime

A freeze pauses every active order; unfreezing makes it active again, or expired if its time passed.
A card that still waited is cancelled.

When the engine starts again after it was stopped, after the machine slept, or after the clock moved
more than a minute, binference checks every order once on a fresh price before any order fills. A
fill never runs on a price read before the stop. When it checked an order, you get one
[`resumed`](/reference/notices/#resumed) notice with what filled and what was skipped.

## Alerts

An alert tells you when something happens, and never trades or opens a card. Ask the agent to set
one; it is set at once, and you can ask the agent to remove it.

- **Price alert.** A token reaches a price. It fires once.
- **Wallet alert.** A wallet you follow trades. It fires on each trade.
- **Launch alert.** A new token on Flap, Genius.fun or Brew passes your filters, such as its tax,
  its curve progress, its liquidity, its insider wallets or its creator's other launches. It fires
  on each match.

An alert can also wake the agent: it then starts an answer of the agent, marked as outside content,
at most 10 times an hour per agent. Each alert sends at most 5 notices an hour, then one
[`alertHeld`](/reference/notices/#alertheld) line counts the rest. An agent keeps at most 50 active
alerts. Wallet and launch alerts end after 30 days by default.

## See also

- [Alert rules](/guides/remote-and-webhooks/), which fill from a webhook such as TradingView's.
- [Safety](/guides/safety/) for the caps every fill counts against.
- [Notices](/reference/notices/) for every fill, skip and alert notice.
