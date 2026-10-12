# 0201. A turn reads the live facts in one call and sends them after the history

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

Spec 8 section 7.1 lays a model call's context out as three parts: the stable prefix
(instructions, workspace files, skills index, tools), the history, and the volatile tail, one
context message after the history with the time, the mode, the freeze, the approval mode, the
wallets and their dollar balances, the open orders, today's spend against the limits, the model
budget left and the send level. The runtime reads the tail from the engine at `turn/start` and
after a batch that wrote. A changing tail must never sit in a system block: a provider caches a
prompt up to its marks, and a system block before the history would end every cache there. The
specs leave open how the runtime reads the facts, how the parts are written, and what happens when
a read fails.

## Decision

- **One read: `facts/get`** (`read`), the engine's answer for one agent: mode, freeze, approval
  mode, send level, the balances of the agent's mode with their dollar values and total, its
  active and paused orders (at most 50), its outflows of the last 24 hours, and the per-trade and
  24-hour caps in effect. One call gives one consistent picture, and the runtime needs no other
  operation for it.
- **When.** The runtime reads the facts before a turn's first model call, and again before the
  next model call after a batch that ran a propose or control tool. The model budget left comes
  from `turn/start` and each `usage/record` answer, which the turn already reads.
- **A failed read never stops the turn.** Balances the engine cannot read now are left out of the
  answer; a `facts/get` that fails gives a tail that says the facts could not be read, and the
  turn goes on.
- **The prefix is data, rendered the same way every call:** the instructions, fixed per release
  and naming the owner's language, then each workspace file in spec 8's order inside a delimiter
  that names it, each cut at 12,000 characters and all at 40,000, with a line saying what was cut.
  A missing file is left out. Each transport sends it as its one system part, marked for caching
  where the provider takes marks, with the tool declarations, the last one marked.
- **The tail is the last user message,** after the history and its cache mark, as plain text that
  says it comes from binference, not the owner. It carries no mark and is never stored, so the
  prefix and the history keep their bytes from call to call.

## Consequences

- Spec 1 gains `facts/get` and `LiveFactsView`; the glossary gains "live facts".
- Two turns with no workspace change send a byte-identical prefix; only the tail differs.
- A turn makes one more engine read before its first model call and after each writing batch.
- The skills index joins the prefix after the workspace files when skills land.

## Alternatives

- **One read per fact** (`agent/get`, `approval/get`, `sendLevel/get`, `portfolio/get`,
  `order/list`): five calls that can disagree with each other, and no read of today's spend.
- **The facts in the system prompt.** Every call would miss the cache from the first byte.
- **The facts as a stored transcript event.** The history would change under the cache, and old
  facts would read as current.
