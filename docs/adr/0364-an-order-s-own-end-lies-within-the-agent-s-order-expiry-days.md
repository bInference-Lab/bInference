# 0364. An order's own end lies within the agent's order expiry days

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

Every agent has the limit `orderExpiryDays`, copied from `defaults.orders.expiryDays` (spec 2), 30
days by default. Like every limit it is lower-is-stricter: the owner lowers it at once and a looser
value waits 24 hours ([decision 0111](0111-a-looser-limit-waits-24-hours-a-stricter-one-applies-at-once.md)).
An order that names no `expiresAt` ends that many days after it is made. An order that named its
own `expiresAt` was held only to a future time, so the agent or an MCP client could ask for an
order that runs a year, past a limit the owner set lower, and the card was the only place the owner
could see it.

## Decision

- `order/create` refuses, before anything is stored and before any card, a request whose
  `expiresAt` is later than the agent's `orderExpiryDays` from now, for every order kind: limit,
  take-profit, stop-loss, trailing, DCA and copy. An end exactly at the limit passes.
- The refusal is its own protocol error, `order.expiry_limit`, an additive code of protocol v1.
  Every error names the next step, so its words, in English and Chinese, name the agent's
  `orderExpiryDays` and both ways out: an earlier end, or leaving the end out, or a higher limit
  with `binference limit set orders.expiryDays=DAYS`.
- The agent's `order_create` tool answers the model with the same English words, so the agent can
  tell the owner what to change.
- The check runs after the request's other rules, so a malformed request gets its own refusal
  first.
- A webhook rule keeps spec 1's 30 days; `orderExpiryDays` does not bind it.

## Consequences

- An order never outlasts the expiry limit the owner set when it was made.
- Every surface reads the same code and shows its words; MCP clients read the code.
- A looser limit that waits its 24 hours is not in effect yet, so an end past the limit now is
  refused until it applies.

## Alternatives

- **Clamp the end to the limit.** The card would show an end the request did not ask for.
- **`protocol.bad_args` with an English message.** The owner's surfaces show the words a code
  chooses, so the owner would read only that the request holds something wrong, with no next step.
- **Bind webhook rules too.** Their lifetime is spec 1's own 30 days, set apart from auto orders.
