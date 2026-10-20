# 0274. Each launch wakes the agent, and a held wake-up count waits for a notice that goes out

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Spec 1](../specs/protocol.md) section 8.4 and
[decision 0245](0245-an-alert-fires-once-per-match-tells-the-owner-and-wakes-the-agent-marked.md)
set two rules for alert wake-ups:

- While a wake-up from one alert waits in the agent inbox, untaken, a newer fire of the same alert
  replaces its data instead of adding a message.
- Past 10 wake-ups an hour, a fire stores no wake-up, and the count goes into `wakeSkipped` of the
  next fire that wakes the agent, which its notice tells (`alert.wakeSkipped`).

Two facts make these rules lose information:

- A newer price stands for an older one, but each launch is a token of its own. When launches L1
  and L5 pass a launch alert two seconds apart, before the agent takes L1, its turn reads only L5.
- Each alert sends at most five notices an hour (decision 0245). When the fire that wakes the
  agent is past its alert's five, its notice is held, and the count it carried reaches the owner
  in no notice: only the `alert/fired` push holds it.

## Decision

- **Each launch wakes the agent.** A fire of a launch alert never replaces a waiting wake-up: it
  stores its own, within the 10 wake-ups an hour per agent and the inbox's 200 untaken messages.
  The chat queue merges waiting messages into the next turn, so one turn reads L1 and L5. Price
  and wallet alerts keep the replace rule.
- **The held count waits for a notice that goes out.** `wakeSkipped` counts the wake-ups the
  hourly limit held back since the agent's last fire that woke it and whose notice went out. A fire
  that wakes the agent while its notice is held carries no count, and the count grows until such a
  notice tells it.
- **Storage.** Engine migration 0048 adds `told` to `alert_fires`: set on each wake-up the hourly
  limit held back once a notice tells it, in the write of the fire that tells it. A held wake-up
  before its agent's last wake-up counts as told, as the rule before had it.

## Consequences

- A burst of launches that pass a filter uses up the hourly wake-ups sooner than before, since
  each one counts.
- `alert/fired` carries `wakeSkipped` only on a fire whose notice tells it, so a client that adds
  up the counts counts each held wake-up once.
- Spec 1 section 8.4 and spec 3 section 2.6 say so. This amends decision 0245.

## Alternatives

- **One wake-up that lists every launch fired while it waited.** The message's data would grow
  with each fire and need its own cap. Rejected for separate messages the chat queue already
  merges.
- **Tell the held wake-ups in the line that ends the notice hour** (`notice.alertHeld`). The line
  is per alert, while the hourly limit is per agent, so a count could be told twice. Rejected.
- **Keep the replace rule for launches.** The agent would never read the launches it replaced,
  though the owner chose to wake it for each. Rejected by the owner.
