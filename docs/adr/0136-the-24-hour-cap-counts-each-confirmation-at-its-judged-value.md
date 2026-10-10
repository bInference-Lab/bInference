# 0136. The 24-hour cap counts each confirmation at its judged value

Status: Accepted

## Context

[Decision 0046](../DECISIONS.md#d0046) caps what an agent moves in a rolling 24 hours, and
ARCHITECTURE.md section 23 sums "every outgoing trade and send in the last 24 hours". Until now the
engine summed the executions it had recorded: a trade counted once it settled, or filled on paper.
A live trade confirmed and not yet settled did not count, so an agent could confirm several trades
in the seconds before the first one landed and pass its cap with all of them. Two taps, or a tap
and the auto mode, that landed together each read the day as it was before either, and both passed.

The policy already values each intent when it runs, rounding each outflow up to a whole
micro-dollar, but that value was not stored with the intent.

## Decision

- Each intent stores the USD value the policy judged its outflows at, in micro-dollars, with the
  quote it was judged with (`intents.value_usd_micros`, migration 0016). An intent the policy never
  values, such as a rescue or an unfreeze, has none.
- The rolling 24-hour cap counts every intent of the agent confirmed in the last 24 hours in the
  intent's mode (paper or live), by the owner's tap or the auto mode, from the moment it was
  confirmed and at its stored value, settled or not. An intent that ended without moving anything
  (`cancelled`, `expired`, `failed_onchain`) and the intent under check do not count. A
  confirmation exactly 24 hours old still counts.
- The cap is checked at three points: the policy at the proposal; the confirmation itself, by a
  tap or the auto test; and the policy again when the wallet queue takes a live intent, with the
  intent's own confirmation left out.
- One agent's confirmations run one at a time: each reads the agent's confirmed outflows as every
  earlier one left them, then stores its own. A tap that would pass the cap is refused with
  `limit.daily_cap` and changes nothing: the card stays open until it expires or the owner cancels
  it. An auto test that finds the cap full opens the card instead.
- The count of settled executions goes away.

## Consequences

- No 24-hour window holds confirmations of one agent in one mode that together pass its cap; a
  property test holds it over taps that land together and clock steps around the window's edge.
- A trade counts at what the policy judged it worth, not at what settled. A trade that fills below
  its quote still counts in full until its confirmation is 24 hours old.
- Intents stored before migration 0016 have no value and do not count. No released install had a
  rolling cap that counted anything but settled trades, and those are at most 24 hours from leaving
  the window.
- The count reads one indexed query of the intent events (`intent_events (to_state, at)`).
- A tap now has one more way to fail. Telegram answers it with the error's message, and the
  protocol adds the code `limit.daily_cap` inside v1.

## Alternatives

- **Keep counting settled trades.** Leaves the window between confirmation and settlement open.
  Rejected.
- **Count at the proposal.** Proposals that the owner never confirms would fill the cap. Rejected.
- **Value each confirmation again at its tap.** A second price read at every tap, and a value that
  differs from the one the owner saw checked. Rejected: the stored value is the one the policy
  passed.
