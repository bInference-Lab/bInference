---
name: dca-plan
description: Plans dollar-cost averaging. Turns the owner's wish to buy a token regularly into one DCA auto order that buys a fixed amount on a schedule, sized inside the owner's limits and balance, which the owner confirms once on a card. Use when the owner asks to buy a token every day, week or month, to average into a position, or to change or stop such a plan.
license: MIT
metadata:
  binference-audience: agent
---

# DCA plan

A DCA order buys one token with a fixed amount, once each period, on a schedule. The owner
confirms the whole plan once on its card; each buy then runs without a card, inside the order's
bounds and the owner's limits. A good plan fits those limits and the balance from its first buy
to its last.

## 1. Gather the terms

You need five things. Take each from the owner's words or `STRATEGY.md`, and ask for what is
missing in one question. Never pick an amount for the owner.

1. The token, by its asset id from `token_search`. Check a token binference's list does not hold
   with `token_risk`: a `block` verdict means no plan.
2. What each buy spends: a stablecoin such as USDT, or the chain's coin.
3. The amount of each buy: `{ base }` in the spent asset's base units, or `{ usdMicros }`.
4. How often, as a schedule on the owner's wall clock.
5. How many buys (`count`), or until when (`expiresAt`). Without either, it buys each period until
   the order expires, 30 days after it starts.

## 2. Fit the limits

Read the live facts before you propose:

- Each buy must be at most the per-trade limit.
- The buys that fall in any 24 hours, with what the agent already spends, must stay within the
  rolling 24-hour limit. Two buys a day of $60 need $120 of room.
- When the plan passes a limit, propose nothing. Tell the owner which limit, and the largest
  plan that fits, such as "$100 a day fits your $100 per-trade limit". Let the owner choose.
  Never shrink or split the plan on your own: a buy over a limit is skipped at every period.
- Only the owner changes a limit, with `binference limit set` or in the console.

## 3. Fit the balance

- Work out what the whole plan spends: the amount times the number of buys.
- When the wallet holds less, say so. A period the wallet cannot pay is skipped, not bought later.
- A plan that spends the chain's coin leaves its reserve for network fees.

## 4. Write the schedule

The schedule is five cron fields: minute, hour, day of month, month, weekday. It runs on the
owner's time zone unless `timezone` names an IANA zone.

| The owner says           | cron          |
| ------------------------ | ------------- |
| every day at 9:00        | `0 9 * * *`   |
| every Monday at 9:00     | `0 9 * * 1`   |
| on the 1st of each month | `0 9 1 * *`   |
| every 4 hours            | `0 */4 * * *` |

When the owner names no time of day, pick one and say it. A plan longer than 30 days needs an
`expiresAt` after its last buy.

## 5. Propose

Call `order_create` with an order of kind `dca`: the token, `side` `buy`, the `size` of each buy,
`spend`, and a `trigger` with the `cron`, the `timezone` when the owner named one, and the
`count`. Give a reason of one or two sentences. One proposal per turn.

Then tell the owner, in their words: the card waits for them; it shows the schedule and the first
two buys; after the tap each buy runs alone, inside the limits; whether it is paper or live.

## 6. Tell the owner how it behaves

- A DCA order only buys. To sell later, the owner sets an exit order on its own.
- A period missed while binference was off or the agent was frozen is skipped, never bought late.
  A buy that cannot run at its minute is skipped too. The owner gets a notice for each skip.
- Each buy runs the risk check and the limits again: a buy that fails them is skipped.
- A live order may be refused while live fills are off: say what the refusal says, and that the
  same plan runs on paper.

## 7. Change or stop a plan

- `orders` lists the agent's orders with their state.
- To stop a plan, call `order_cancel` with its id when the owner asks. It stops the buys to come.
- A plan cannot be edited: cancel it, then propose the new one.
