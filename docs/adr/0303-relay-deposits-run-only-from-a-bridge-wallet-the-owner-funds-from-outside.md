# 0303. Relay deposits run only from a bridge wallet the owner funds from outside

Status: Accepted

Proposed with the owner's ruling of 2026-10-31: Relay goes through a small bridge wallet, like the
launch wallet, funded from outside only; Relay deposits are allowed only in a bridge wallet's
ceiling, never in a main wallet's; a stolen key can lose only what is in it. Across stays on main
wallets.

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
lets a bridge venue in only where the ceiling binds the deposit's recipient and destination chain.
Relay is the only route from BNB Smart Chain to Solana and to USDG on Robinhood Chain
([decision 0301](0301-a-bridge-route-moves-a-dollar-to-a-dollar-or-eth-to-eth-as-the-bridge-s-api-lists-it.md)).

Every Relay deposit on BNB Smart Chain names only a depositor and a 32-byte order id: its
depository's `depositErc20(depositor, token, amount, id)` and `depositNative(depositor, id)`
(Relay's EVM Depository reference; the contract's verified ABI), its receiver's `forward(data)`,
or a token transfer with the id appended. The recipient and the destination chain live in Relay's
off-chain order. Relay's API answered a quote for a recipient `0x2222...` on Base, and one for a
Solana recipient, with `depositErc20(user, USDC, amount, id)` and nothing else on 2026-10-31. No
Privy rule can tie the id to a saved address.

[Decision 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md)
already bounds loose launch calls to a separate wallet the owner funds from outside.

## Decision

- **A wallet role.** `bridge` joins `launch` as a role a wallet of an agent may have. A venue marks
  a call `onlyWallet: "bridge"`, and names a spender only a bridge wallet approves in
  `onlyWalletSpenders.bridge`. A bridge wallet's ceiling lists them; no other wallet's does.
- **Relay's calls.** Relay declares `depositErc20(depositor, token, amount, id)` and
  `depositNative(depositor, id)` on its depository, each with `depositor` pinned to the wallet, as
  a bridge wallet's alone, and the depository as a bridge wallet's spender. Every other Relay
  contract is in no ceiling.
- **The signer refuses them elsewhere.** A call marked for a role signs only from a wallet of that
  role: the engine passes the marks in `allowed.walletOnlyCalls`, and rule 2 refuses one from any
  other wallet, as it does a launch wallet's create call.
- **Funding and the rest.** The bridge wallet is funded from outside only, and no other wallet's
  ceiling may pay it, as decision 0217 sets for the launch wallet. Its creation, rescue, checks
  and cards are their own task; until it exists, no agent holds a bridge wallet, so no Relay deposit
  can sign.

## Consequences

- What a machine whose keys are all stolen can take through the bridge wallet: everything in it.
  A Relay deposit pays whoever the off-chain order names. The 24-hour caps bound the coin and the
  capped tokens it sends, as for every wallet. From the main wallets, nothing more: none of their
  ceilings lists a Relay call or the depository.
- Solana and USDG on Robinhood Chain are reached only from the bridge wallet; their routes stay in
  the registry.
- The signer's `walletOnlyCalls` carry a role; the ceiling's registry view takes the wallet's role.

## Alternatives

- **Leave Relay out of v1.** Solana and USDG would leave with it. The owner chose the bridge wallet.
- **Allow Relay from the main wallets.** A stolen key could pay any address from every wallet.
  Lost.
- **Trust Relay's order.** Its API's answer would decide who gets paid; a stolen machine writes its
  own order.
