# 0177. An agent gives its reason for each auto order

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Decision 0176](../DECISIONS.md#d0176) left auto orders without a reason, because the order
request of [spec 1](../specs/protocol.md) section 8.2 had no field for one. Every intent request
carries `reason`, the agent's words on why, and its card shows them as "Agent says"
([spec 4](../specs/cards-and-messages.md) section 1). An auto order's one card authorizes every
fill that follows ([decision 0004](../DECISIONS.md#d0004)), so the owner has more reason to read
why the agent asks for it than for one swap. MCP clients and older engines send order requests
without the field, and `check:protocol-compat` allows additions only.

## Decision

- Spec 1's order request gains `reason?`: one or more characters, the agent's words. Webhook rules,
  which the owner makes, take none.
- The agent runtime's `order_create` requires it: the order's terms (`orderTermsSchema`) hold a
  `reason`, so a call without one fails its check and never reaches the engine. The engine sends
  it on as the request's `reason`.
- An auto order's card shows it as the "Agent says" line (`card.reason`), escaped and cut to 200
  characters like an intent's, in the same place on the card. Another client's order without one
  shows no such line.

## Consequences

- An order the agent proposes reads like a swap it proposes: the terms from data, and one quoted
  line of the agent's words.
- The field is optional on the wire, so an MCP client and an older engine keep working.
- The order card's drawing takes the reason from the stored request when the orders core draws
  its cards.

## Alternatives

- **A required `reason` on every order request.** It breaks every client that sends orders today,
  and the owner making an order in the console has no agent's words to give. Rejected.
- **The reason in the turn's chat text only.** The card is where the owner confirms, and the
  chat text may be far above it. Rejected.
