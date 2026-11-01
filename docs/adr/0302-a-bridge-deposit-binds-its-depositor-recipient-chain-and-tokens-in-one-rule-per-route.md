# 0302. A bridge deposit binds its depositor, recipient, chain and tokens in one rule per route

Status: Amended by 0313

Proposed with the owner's ruling of 2026-10-31 (each destination chain's rules list up to 100
saved addresses, chain and recipient bound together; the lead then asked for each route's tokens
bound as a pair, so a destination has one rule per route) and the lead's (Across's 20-byte `depositV3`
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
- **One rule per route of each destination.** For each declared deposit and each EVM destination
  chain the owner saved an address for and the venue's routes reach, the ceiling holds one rule
  per route, `Bridge <function>, chain <id> to <destination>, <n>`: the function on its contract,
  no native coin, each wallet input `{{wallet.address}}`, the recipient `in` the addresses saved
  for that chain, the destination chain id in decimal, and the route's token that leaves `eq` with its token that
  arrives `eq`. The chain id and the recipient sit in one rule, so an address saved for Base is
  never paid on Ethereum; the tokens sit in pairs, so ETH never leaves for USDC on arrival. No saved
  address, no route or a destination with no 20-byte address gives no rule.
- **Every ceiling write derives the recipients.** Who a destination's rules pay is worked out on
  every write from the addresses the write already carries: the addresses named for that
  destination that are still the rescue address or a saved address. A change of the calls keeps
  the addresses the rules pay now; a change of the recipients narrows every destination's rules to
  them and takes out a destination left with none, in the same owner-signed change, a change
  signed ahead included. Removing a saved address, or replacing the rescue address, so stops every
  bridge paying it at once. The address book per chain feeds the addresses named per destination
  through this same input; until it exists, the rescue address goes to a destination only where
  that input names it, after the check decision 0297 asks for.
- **Across uses `depositV3`.** The plugin re-encodes the API's `deposit` values as `depositV3`, the
  form whose every bound input Privy reads. `deposit`, `depositNow`, `unsafeDeposit`, the
  periphery's swaps and `speedUpDeposit` are in no ceiling.
- **The empty message is the signer's.** Privy cannot bind it, so the signer refuses a deposit
  whose declared empty inputs are not empty.
- **The room.** A destination's rules list at most 100 addresses, and a ceiling's rules take at
  most 480,000 bytes, a margin under what Privy took. A ceiling past it is refused as `too_large`.
  A change builds and measures every wallet's new ceiling before it writes any, so a launch
  wallet's larger ceiling never fails after the main wallets changed; the owner reads
  `wallet.ceiling_too_large`, or `wallet.ceiling_bad_bridge` for a deposit no ceiling holds, each
  with its next step.
- **The read-back.** A ceiling reads back as built only when each bridge rule pins a wallet input
  and names its recipient, chain and token pair in that order, and the rules of one destination
  count from 1 with the same recipients.

## Consequences

- Decision 0297's consequence "one rule per saved address" becomes one rule per route of each
  destination chain and deposit function. Across's routes from BSC make at most ten rules; adding
  or removing a saved address rewrites that destination's rules with the owner key, in the same
  change as the send rules.
- What a stolen machine can still do through a bridge rule, within decision 0149's promise: deposit
  with an `outputAmount` near nothing, fill it as a relayer to the saved recipient, and keep the
  input. The 24-hour approval caps bound it for capped tokens, as a swap at a bad price.
- The signer, not Privy, refuses a non-empty message; a thief who holds every key can send one.
  Across calls a message's handler only when the recipient holds code: a fill to a plain saved
  wallet pays it and ignores the message, and a saved contract without the handler makes the fill
  revert, so the deposit refunds the depositor, the wallet itself.
- A route whose deposit names its recipient only inside a struct, or only in an off-chain order,
  gives no rule here; decision 0303 says where Relay goes.

## Alternatives

- **One rule per saved address.** It binds the same pair, at 100 times the rules and bytes for a
  full chain. Lost to the owner's ruling.
- **One rule per destination, tokens as lists.** It lets a token leave on one route and arrive as
  another route's token. Lost to the lead's ruling.
- **Across's `deposit` with 32-byte values.** Privy takes no `{{wallet.address}}` there, so the
  depositor would be a literal written per wallet after it exists. `depositV3` binds it in every
  wallet's ceiling as built.
- **Bind the amounts.** Privy compares a field with a constant, never with another field, so no
  rule can tie `outputAmount` to `inputAmount`. The signer checks both against the plan.
- **A condition set of saved addresses.** It would hold more than 100, but a set holds one list, so
  the chain and the recipient would come apart unless each chain had its own set, each another
  owner-key change outside the policy.
