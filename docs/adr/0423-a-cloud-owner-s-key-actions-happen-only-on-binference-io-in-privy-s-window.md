# 0423. A Cloud owner's key actions happen only on binference.io, in Privy's window

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

Self-hosted gives the owner key every change that could widen what a wallet may sign: the rescue
address, the ceiling, saved addresses, new wallets, exports, the agent key's moves and the
identity registry's call (spec 5, sections 2, 4 and 6); going live is terminal only, with the
typed disclaimer ([decision 0060](../DECISIONS.md#d0060)). On bInference Cloud the owner of an
agent is a signed-in user, whose Privy account owns the wallets, and holds no owner key. The
official bot, the console's chat and the agent itself run on paths a compromised worker can reach.

## Decision

- Each action below happens only on binference.io, in Privy's own window, under the user's Privy
  sign-in, which signs the change as the wallet's owner. Nothing else asks for it.

  | Self-hosted                                                           | Cloud, on binference.io                                      |
  | --------------------------------------------------------------------- | ------------------------------------------------------------ |
  | `safety/setRescueAddress` and `safety/cancelRescueChange` (owner key) | Set or cancel the rescue address, with the same 24-hour wait |
  | `ceiling/set`: venues, the per-transaction cap, `--day-cap-usd`       | Change the ceiling; the day cap also sizes the user's sums   |
  | `binference address add`, and a removal that rewrites the ceiling     | Save or remove an address                                    |
  | `binference wallet create`, `--launch`, `--bridge`                    | Make a wallet, a launch wallet or a bridge wallet            |
  | `binference wallet export`                                            | Export a wallet's key, sealed to the user's browser          |
  | `binference signer revoke`                                            | Remove bInference's signer service from the wallets          |
  | `identity/allow`                                                      | Let the agent register its identity                          |
  | `binference live`, with the typed disclaimer                          | Go live, typing the disclaimer on binference.io              |

- An owner action asked anywhere else (the official bot, the console's chat, the agent, an MCP
  client) is refused with the step to take on binference.io.
- Without them the engine may still trade inside the ceiling and the limits, make limits stricter,
  freeze, rescue to the rescue address in effect, revoke approvals and switch to paper, each with
  the taps self-hosted asks. It may not write a wallet, a ceiling, the custody record, the address
  book or the rescue fields of `safety`, nor move an agent to live, which its database role and the
  trigger on `agents` refuse (spec 3, section 6.6).

## Consequences

- A compromised worker or a hijacked Telegram account cannot widen a ceiling, add a payee, take a
  key out or go live.
- Every widening change costs the user a visit to binference.io.

## Alternatives

- Owner actions from the official bot behind a second factor: the bot's path runs through the
  ingress and the worker, which this rule keeps out of every widening change.
- A Cloud owner key, as self-hosted's: one more secret for each user to keep, which Privy's sign-in
  already gives.
