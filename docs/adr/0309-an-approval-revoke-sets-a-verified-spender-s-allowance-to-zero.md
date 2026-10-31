# 0309. An approval revoke sets a verified spender's allowance to zero

Status: Accepted

Accepted by the owner on 2026-11-01 ("known contracts only").

## Context

Spec 1 names the `revokeApproval` request, `{ token, spender }`, and spec 6 names its card's life
(10 minutes) and its paper refusal (`paper_only`). Spec 4 names its action line. The specs leave
open which spenders it may name, how it is checked and what it counts:

- A main wallet's ceiling lets it approve only the spenders the venues the install runs declare,
  at any amount within the 24-hour caps; a launch wallet's lets it approve any spender. The
  signer's hard rules refuse an approval whose spender the step's allowed set does not list.
- Every spender those venues declare is a contract the chain registry lists. A launch wallet's
  approvals to a launch's own contracts are exact and spent by the trade, and a fill that cannot
  finish resets its approval itself ([decision 0211](0211-a-live-fill-holds-its-line-while-watched-and-leaves-no-approval-behind.md)).
- A revoke moves no funds, so no cap can value it.

## Decision

- **A verified spender this wallet may approve.** The spender must be a contract the chain registry
  lists on the wallet's chain, and the wallet's ceiling, as last read back from custody, must name
  it. Any other ends `failed_check` with `spender_unlisted` before the card: no approval binference
  makes can name it, and the ceiling would refuse the signature after the tap. A spender only a
  wallet of another role approves, such as Relay's depository from a main wallet, is one such.
- **An ERC-20 allowance only.** The request's spender names the token's own allowance. A venue's
  allowances inside Permit2 cannot be revoked through it: no ceiling allows a call to Permit2's
  `approve`, and each one already expires at its trade's deadline (the 2026-10-09 ruling).
- **One step, checked by simulation.** The plan is the token's `approve(spender, 0)` from the
  wallet, from its family's approval draft. The simulation must succeed, move nothing out of the
  wallet and set no allowance but that one, at zero; anything else ends `failed_check` with
  `effects_differ` or `simulation_reverted`. An allowance already at zero still passes: the step
  costs only its network fee.
- **No value, always a tap.** It counts nothing against the per-trade or the 24-hour cap, is never
  authorized by auto mode (`kind`), and is refused in paper mode (`paper_only`). Its card lasts 10
  minutes.
- **The signer allows that spender alone, at zero.** The queue's allowed set holds the request's
  spender, no contract and no recipient, and the signing request's approval amount is zero, built
  from the revoke's quote. The ceiling's approval rule already allows it, so the ceiling does not
  change.
- **Its network fee leaves the coin's position** as a departure
  ([decision 0127](0127-a-send-out-of-a-wallet-leaves-its-positions-at-average-cost.md)), with nothing
  sent.

## Consequences

- An agent can clear an approval a venue's router still holds, as after a trade that left part of
  an exact approval unspent.
- A leftover approval to a venue the ceiling no longer names cannot be revoked here: the owner
  rescues the wallet's funds if that allowance is a worry.
- A launch wallet cannot revoke an approval to a launch's own contract through this request, and a
  main wallet cannot revoke one to Relay's depository, which only a bridge wallet approves.

## Alternatives

- **Any spender.** The signer and the ceiling refuse an unlisted spender after the owner's tap.
  Lost.
- **Read the allowance first and refuse a zero one.** It adds a reason no spec names, and saves
  only a network fee. Lost.
- **A ceiling rule for `approve(any, 0)`.** It widens every main wallet's ceiling for an approval
  no binference wallet can hold. Lost.
