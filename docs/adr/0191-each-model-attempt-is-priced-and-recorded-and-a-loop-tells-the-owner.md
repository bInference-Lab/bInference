# 0191. Each model attempt is priced and recorded, and a loop tells the owner

Status: Amended by 0198

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 8.3 has the runtime send `usage/record` after each model
call, priced by the provider's own cost, else `models.prices`, else a built-in table, else $0, and
section 9 ends a turn that repeats one call three times with `notice.loop`. It leaves open:

- **Attempts.** Section 8.2 records each attempt's usage, but a failed attempt reports no usage
  event, and two records of one call need keys of their own.
- **Cache writes.** `models.prices` has input, output and cached input, while Anthropic and OpenAI
  charge a prompt prefix written to their cache more than plain input, and some models charge more
  for a long prompt.
- **The table.** Which models it holds, and from where.
- **The notice.** The runtime has no operation that sends a notice, and `turn/end` carries the
  outcome `loop` for the call caps as well as for the loop guard.
- **The engine's answer.** The engine stores no model usage and keeps no daily spend yet.

## Decision

- **Every attempt is a record.** The runtime records each attempt of a model call, answered or
  failed, before it acts on it or tries again, with the model that was called and the key
  `<turn>.usage.<n>`, `n` counting the turn's attempts from 1. A failed attempt carries what its
  provider reported before it failed, such as a refused answer's tokens, else nothing: $0. A record
  the engine does not take ends the turn `failed`; nothing more runs.
- **The price.** The provider's own cost first (the gateway's `usage.cost`); else `models.prices`;
  else the built-in table; else $0. A cache read costs the cached price, a cache write 1.25 times
  the input price (the 5-minute write both providers list), and the rest of the input the input
  price. A model with a long-prompt price charges it when the whole input, cache included, passes
  its threshold. The cost is rounded up to the micro-dollar, so the budget never counts less than
  the provider charges.
- **The built-in table** holds Anthropic's and OpenAI's list prices, read from their pricing pages
  on 2026-10-12, keyed by the provider kind and the model's id; a dated snapshot takes its alias's
  price unless the table lists it. The `binference` kind reports its own cost and needs none.
- **`binference check`** warns under `models.priced`, naming each configured model (roles and
  fallbacks) whose provider reports no cost and that no price covers.
- **The loop guard** counts the calls that ran: a refused or not-run call has no result of a tool
  to repeat. When it trips and the tool call limit is reached in the same batch, the turn ends with
  the loop guard's line.
- **`notice.loop`** is sent by the engine, through the notice outbox, when the runtime sends the
  loop guard's status line (`turn.loop`), so the call caps send no notice.
- **A spent budget mid-turn** ends the turn `budget` with no further attempt. Until the engine
  keeps each agent's daily spend, `usage/record` answers the agent's daily model budget, and the
  turn shows no status line for it, since only the engine knows when the budget resumes.

## Consequences

- Spec 8 sections 8.3 and 9 and spec 2's `models.prices` say so; the runtime's `ChainModel` carries
  its price, and its `TurnEngine` port gains `recordUsage`.
- The table goes stale as prices change: `models.prices` replaces any row, and the table is
  updated with its date when a provider changes its list.
- The engine's model budget can charge each stored record by its key once.

## Alternatives

- **Record only the attempt that answered.** A refused or retried attempt that was billed would
  never count against the budget. Rejected.
- **Price a cache write as plain input.** The budget would count less than the provider charges
  on every turn that writes the cache. Rejected.
- **A notice operation for the runtime.** A second way for a client with `agent` to reach the
  owner, which the status line already carries. Rejected.
- **Notice every `loop` outcome.** The call caps are limits, not a repeat, and their status line
  says so. Rejected.
