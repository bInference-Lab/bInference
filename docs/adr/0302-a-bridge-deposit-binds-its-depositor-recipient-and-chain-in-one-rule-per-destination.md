# 0302. A bridge deposit binds its depositor, recipient and chain in one rule per destination

Status: Proposed

Proposed with the owner's ruling of 2026-10-31 (one rule per destination chain listing up to 100
saved addresses, chain and recipient bound together) and the lead's (Across's 20-byte `depositV3`
re-encoded from its API's answer).

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
lets a bridge pay only an address saved for its destination chain, and lets a venue in only where
the ceiling binds the deposit's recipient, destination chain, depositor and message. It expected
one Privy rule per saved address. [Decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md)
reads calldata by a function's top-level inputs only.

Across's SpokePool on BNB Smart Chain takes a deposit two ways: `deposit` with 32-byte values and
`depositV3` with 20-byte addresses, the same call underneath. Its API builds `deposit`. On Privy's
test app on 2026-10-31:

- A `uint256` input compares in decimal or hex; an `address` input takes `{{wallet.address}}`; a
  `bytes32` input compares regardless of case but takes no `{{wallet.address}}`.
- No condition takes an empty `bytes` value ("Condition value must be a hex string").
- One policy took 492,666 bytes of rules and refused 506,607 with a 403, whatever the count of
  rules: it took 400 small ones. Privy's `in` takes at most 100 values.

Across relayers are permissionless: a fill pays the recipient the deposit's `outputAmount` of its
`outputToken`, and the relayer is repaid the input.

## Decision

- **A venue declares a deposit's bound inputs.** A `VenueCall` may carry `bridge`: the recipient
  (a 20-byte address input), the destination chain (a `uint256` input), the token that leaves and
  the token that arrives (address inputs), and the `bytes` inputs that must be empty. The depositor
  is a wallet input, as a swap's receiver is. Such a call never becomes a plain call rule.
- **One rule per destination.** For each declared deposit and each EVM destination chain the
  owner saved an address for and the venue's routes reach, the ceiling holds
  `Bridge <function>, chain <id> to <destination>`: the function on its contract, no native coin,
  each wallet input `{{wallet.address}}`, the recipient `in` the addresses saved for that chain
  (and the rescue address where it is a plain wallet on both chains), the destination chain id in
  decimal, and the token in and out among the routes' tokens. The chain id and the recipient sit in
  one rule, so an address saved for Base is never paid on Ethereum. No saved address, no route or
  a destination with no 20-byte address gives no rule.
- **Across uses `depositV3`.** The plugin re-encodes the API's `deposit` values as `depositV3`, the
  form whose every bound input Privy reads. `deposit`, `depositNow`, `unsafeDeposit`, the
  periphery's swaps and `speedUpDeposit` are in no ceiling.
- **The empty message is the signer's.** Privy cannot bind it, so the signer refuses a deposit
  whose declared empty inputs are not empty.
- **The room.** A destination's rules list at most 100 addresses, and a ceiling's rules take at
  most 480,000 bytes, a margin under what Privy took. A ceiling past it is refused as `too_large`,
  and `bridgeRoom` gives how many more addresses a destination's rules can list.
- **The read-back.** A ceiling reads back as built only when each bridge rule pins a wallet input
  and names its recipient, chain and tokens in that order.

## Consequences

- Decision 0297's consequence "one rule per saved address" becomes one rule per destination chain
  and deposit function. Five destinations with Across make at most five rules; adding a saved
  address rewrites one rule with the owner key, as a send recipient does.
- What a stolen machine can still do through a bridge rule, within decision 0149's promise: deposit
  with an `outputAmount` near nothing, fill it as a relayer to the saved recipient, and keep the
  input. The 24-hour approval caps bound it for capped tokens, as a swap at a bad price.
- The signer, not Privy, refuses a non-empty message; a thief who holds every key can send one. A
  fill to a wallet with a message reverts, and the deposit refunds the depositor, the wallet itself.
- A route whose deposit names its recipient only inside a struct, or only in an off-chain order,
  gives no rule here; decision 0303 says where Relay goes.
- The address book shows the room per destination from `bridgeRoom`.

## Alternatives

- **One rule per saved address.** It binds the same pair, at 100 times the rules and bytes for a
  full chain. Lost to the owner's ruling.
- **Across's `deposit` with 32-byte values.** Privy takes no `{{wallet.address}}` there, so the
  depositor would be a literal written per wallet after it exists. `depositV3` binds it in every
  wallet's ceiling as built.
- **Bind the amounts.** Privy compares a field with a constant, never with another field, so no
  rule can tie `outputAmount` to `inputAmount`. The signer checks both against the plan.
- **A condition set of saved addresses.** It would hold more than 100, but a set holds one list, so
  the chain and the recipient would come apart unless each chain had its own set, each another
  owner-key change outside the policy.
