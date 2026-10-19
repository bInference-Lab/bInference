# 0241. A failed launch may keep its exact approval, and the engine alone holds the launch wallet rule

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

The second review of the token launch named two facts that
[decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
leaves unsaid:

- A launch whose first buy spends a token signs an exact approval of that spend to a registry
  contract of the launchpad, then the create call. When the approval lands and the create call
  fails, the approval stays. [Decision 0211](0211-a-live-fill-holds-its-line-while-watched-and-leaves-no-approval-behind.md)
  resets such an approval for an auto order's fill.
- A launch runs only from the agent's launch wallet, but its create call goes to a registry
  contract of the launchpad, which every wallet's ceiling allows. Neither the signer nor Privy's
  policy would refuse a launch from a main wallet: the engine's check is the only one, as
  [decision 0218](0218-a-launch-wallet-is-paid-from-outside-and-signs-only-with-its-launch-read.md)
  says of curve trades.

## Decision

- **The approval stays.** A failed launch does not reset its approval. It is exact on the first
  buy's spend, to a registry contract the launchpad declares, in a launch wallet the owner funds
  from outside with what a launch needs. The next launch's exact approval on the launchpad
  replaces it, and a `revokeApproval` clears it.
- **The rule is the engine's.** The launch wallet rule stays in the engine: before any card, a
  launch from any other wallet ends `needs_launch_wallet`. No ceiling refuses a launchpad's create
  call by wallet.

## Consequences

- After a failed launch with a token first buy, the launch wallet may hold an exact allowance to
  the launchpad until the owner's next launch there or a revoke.
- A fault in the engine's launch wallet check would let a main wallet sign a launch; the review of
  every change to that check stays on the money-path checklist.

## Alternatives

- **Reset the approval as a fill does.** It needs a second signed step after a failure, from a
  wallet that may hold too little gas, for an allowance bounded by the launch wallet's own funds.
  Rejected for now.
- **Refuse launch calls in the main wallets' ceilings.** The launchpad's registry contracts also
  serve the curve trades the main wallets make on launches with no contracts of their own
  (decision 0218), and a ceiling reads the contract, not the function's purpose. Rejected.
