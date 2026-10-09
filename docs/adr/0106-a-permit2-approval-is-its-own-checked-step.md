# 0106. A Permit2 approval is its own checked step

Status: Accepted

## Context

Some venues pull an input token through Permit2, such as PancakeSwap's Universal Router.
[Rule 8](../ARCHITECTURE.md#rule-8) allows Permit2 only with an amount and an expiry, towards
allowlisted spenders. The wallet's ceiling refuses typed data and the signer signs transactions
only, so no Permit2 signature can be given. The venue host takes at most one token approval, then
one trade call, and the simulation reads token allowances only.

## Decision

A Permit2 approval is a transaction step of its own: `approve(token, spender, amount, expiration)`
on the registry's Permit2, for a spender in the registry, with the exact input and an expiration no
later than the trade's deadline. A plan that needs it is an exact approval of Permit2, the Permit2
approval, then the trade call. The simulation reads Permit2's allowance, and the signer checks the
step with a hard rule.

It is built with the first venue that needs it. OKX does not: its TokenApprove takes a plain token
approval, and its decoder refuses the router's Permit2 mode.

## Consequences

- The venue host's step order, the chain family's reading of a draft, the simulation check and the
  signer's hard rules each learn the step.
- A sale through such a venue sends one more transaction.
- The ceiling already lists a venue's Permit2 as a contract and a spender.

## Alternatives

- **A Permit2 signature.** It needs typed data through the ceiling and the signer. Rejected.
- **No venue that needs Permit2.** It closes off routes through the Universal Routers. Rejected.
