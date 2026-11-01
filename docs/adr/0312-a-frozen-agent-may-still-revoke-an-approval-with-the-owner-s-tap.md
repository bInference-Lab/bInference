# 0312. A frozen agent may still revoke an approval, with the owner's tap

Status: Accepted

Accepted by the owner on 2026-11-01 ("Allow revokes").

Amends [decision 0099](../DECISIONS.md#d0099).

## Context

A freeze refuses every new intent of a frozen agent with the policy reason `frozen`, and cancels
every unsigned one but a rescue ([decisions 0093](../DECISIONS.md#d0093) and
[0099](0099-a-freeze-leaves-a-pending-rescue.md)). An approval revoke
([decision 0309](0309-an-approval-revoke-sets-a-verified-spender-s-allowance-to-zero.md)) sets one
allowance to zero and moves nothing. It is what an owner reaches for after a suspected theft, which
is also when the owner freezes. Under the freeze it was refused like a trade.

The freeze lives in the engine alone: neither the signer nor the custodian's ceiling knows of it,
and the ceiling's approval rule already allows `approve(spender, 0)` to a spender it names.

## Decision

- The policy's `frozen` rule passes an approval revoke of a frozen agent, or of any agent while the
  whole install is frozen. Every other rule still applies: the spender, paper mode, the simulation.
- A revoke still opens its card and waits for the owner's tap; auto mode never authorizes one
  (`kind`). The wallet queue's second policy check passes it the same way.
- Everything else a freeze does stays: it refuses every other new intent, a send included, cancels
  every unsigned intent but a rescue, a revoke waiting at the time of the freeze included, pauses
  auto orders and stops running turns.

## Consequences

- A frozen owner can clear an approval from the CLI, the console or the Mini App, then unfreeze or
  rescue.
- Nothing in the signer, the custodian's ceiling or the rescue changes.
- The agent's turns are stopped while frozen, so the agent itself proposes none then; the owner,
  or an MCP client, may propose one, and only the owner's tap confirms it.

## Alternatives

- **Refuse it, as every intent.** An owner who froze after a theft must unfreeze to revoke, which
  lets every other intent through again. Lost (owner).
- **Let a waiting revoke outlast the freeze, as a rescue does.** A revoke proposed before a freeze
  may come from the turn the owner meant to stop; a new one after the freeze is the owner's own.
  Lost.
