# 0180. A curve call with no deadline is bound by its minimum out

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 6](../specs/intent-states.md) section 3 lets the venue host pass a trade call only when its
deadline is at most 60 seconds after the quote. The deadline makes a call that waits too long fail
on chain, so it cannot run at a price far from the one the card showed.

A launchpad's curve call may have no deadline. Flap's Portal trades on its curve through
`swapExactInput(inputToken, outputToken, inputAmount, minOutputAmount, permitData)` and pays the
caller ("Trade Tokens", docs.flap.sh, read on 2026-10-12; the Portal's verified source, v5.24.0).
Flap documents no other trade call for a curve token. Under spec 6 as written, no curve token on
Flap could be traded, and the token would never go to the pools either
([decision 0179](0179-a-buy-or-sell-goes-nowhere-while-its-place-is-in-doubt.md)).

A call without a deadline is still bound: it reverts below its minimum out, which the policy
sets from the quote less the agent's slippage. The executor sends through private relays, and
the stuck-step rules ([decision 0115](0115-a-stuck-step-every-relay-refuses-is-dropped-and-ends.md),
[decision 0116](0116-a-stuck-step-s-cancel-signs-a-minute-past-its-confirmation.md)) hand over a
step that does not land.

## Decision

- **A venue declares it.** A venue's declaration may say, per chain, that its trade calls carry no
  deadline (`noDeadline`). Its decoder then reads a trade call with no deadline field.
- **The host accepts it only from such a venue.** A decoded trade call without a deadline passes
  the host's checks only when its venue declared `noDeadline` on the trade's chain. From any other
  venue it is refused as `late_deadline`. A call that carries a deadline is checked against the 60
  seconds as before, whatever the declaration.
- **Every other check still holds:** the declared contract, the recipient, the exact input, the
  minimum out, the exact approval and the simulation.

## Consequences

- Flap's curve trades pass the money path. A curve call that waits in a relay can still land later,
  at no less than its minimum out.
- `DecodedEffect.deadlineMs` becomes optional, and `VenueContracts` gains `noDeadline`. Every
  existing venue declares a deadline, so nothing changes for them.
- Spec 6 section 3 and ARCHITECTURE section 7 name the exception.

## Alternatives

- **Keep the 60 seconds for every venue.** No Flap curve token could be traded, and decision 0179
  keeps such a token out of the pools. Rejected.
- **Wrap the call in a contract that checks the time.** The Portal pays the caller, so a wrapper
  would receive the tokens and need a second transfer, and a contract of ours on the money path.
  Rejected.
- **Let any decoder leave the deadline out.** A router call decoded without its deadline would then
  pass. Rejected: the venue must say so in its declaration, where review sees it.
