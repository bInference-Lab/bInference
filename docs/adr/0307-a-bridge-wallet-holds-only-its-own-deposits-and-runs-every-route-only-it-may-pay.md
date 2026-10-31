# 0307. A bridge wallet holds only its own deposits and runs every route only it may pay

Status: Accepted

Proposed with the owner's ruling of 2026-10-31: Relay routes leave only from a small bridge wallet
the owner funds from outside, made with `binference wallet create`, whose ceiling allows Relay's
deposits and nothing a main wallet needs; no other wallet's ceiling may pay it; a rescue takes
everything back; `binference check` reports it; cards say which wallet pays.

## Context

[Decision 0303](0303-relay-deposits-run-only-from-a-bridge-wallet-the-owner-funds-from-outside.md)
added the `bridge` wallet role: a venue marks a call `onlyWallet: "bridge"` and a spender in
`onlyWalletSpenders.bridge`, a bridge wallet's ceiling lists them, no other ceiling does, and the
signer refuses such a call from any other wallet. It left the wallet's creation, rescue, checks and
cards to their own task. The launch wallet already has each of them
([decisions 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md) and
[0218](0218-a-launch-wallet-is-paid-from-outside-and-signs-only-with-its-launch-read.md)), and its
ceiling holds every main wallet rule as well, since its curve trades sell through the pools.

A Relay deposit names only an order id: whatever the bridge wallet's ceiling allows, a stolen key
can pay anyone with what the wallet holds. Protocol version 1 shows `WalletView.role` as `launch`
only, and a result field may not take a new value inside a version.

## Decision

- **Its ceiling.** A bridge wallet's ceiling holds the calls and spenders every bridge venue the
  install runs marks as a bridge wallet's, whichever venues the agent uses, the sends to the rescue
  and saved addresses, the cancel and the 24-hour caps. It holds no main wallet's call, spender or
  bridge deposit with a bound recipient. A ceiling change keeps it so, and one that would leave it
  no deposit is `wallet.no_bridge_calls`. A venue that marks a call as a bridge wallet's marks
  every call on that chain so.
- **Making it.** `binference wallet create --bridge` (`wallet/create` with `bridge: true`) makes it
  with the owner key. An agent holds one live bridge wallet: a second is `wallet.bridge_exists`.
  An install whose venues mark no bridge wallet's call is `wallet.no_bridge_calls`. `WalletView`
  shows it with `bridge: true`; `role` stays the launch wallet's.
- **Paid from outside only.** Saving its address, or making it the rescue address, is
  `address.bridge_wallet`, and no ceiling lists it as a recipient, as for a launch wallet. A
  contract the registry lists for a venue, such as Relay's depository, is
  `address.venue_contract` there.
- **Which wallet a route runs from.** A route whose venue marks its deposit a bridge wallet's runs
  from the agent's live bridge wallet, else `intent.bridge_wallet_missing`. A trade or an auto
  order that names the bridge wallet is `intent.bridge_wallet_only`, and one that names an extra
  launch or bridge wallet `intent.extra_wallet`. Each is refused before anything is stored, and its
  words lead with the next step: make the bridge wallet with `binference wallet create --bridge`,
  fund it from outside, or propose from another wallet. No fallback lands on a wallet with a role.
- **Its venues.** A venue whose every call is a bridge wallet's needs a live bridge wallet before
  a live agent uses it (`limit.needs_bridge_wallet`), and only that wallet's ceiling is checked for
  it (`limit.bridge_ceiling`). A bridge wallet's ceiling is never checked for a main wallet's venue.
- **A rebuild.** A wallet whose ceiling names a contract only a bridge wallet calls or approves,
  among the calls the registry lists, is a bridge wallet. The rebuild adopts every one, the newest
  the agent's bridge wallet; `wallet list` marks the others `extra`. A restore that leaves one
  behind names it, with the step to rescue what it holds first.
- **Checks and cards.** `binference check` warns of an extra bridge wallet (`wallets.extra_bridge`)
  and of a bridge wallet whose ceiling lacks a call its venues mark (`wallets.bridge_calls`). A card
  for an intent of the bridge wallet shows `card.bridgeWallet` after its action line.

## Consequences

- What a machine whose keys are stolen can take through the bridge wallet stays what decision
  0303 says: what it holds, within the 24-hour caps for the coin and the capped tokens.
- The bridge wallet cannot swap: a token it holds that no route deposits leaves only by a rescue.
- Until a venue marks a bridge wallet's call, no agent can make one; Relay's plugin is that venue.
- A rebuild finds a bridge wallet whether or not the install still runs Relay, since the registry
  lists Relay's calls.

## Alternatives

- **Every main wallet rule as well, as a launch wallet.** It lets a bridge wallet swap before it
  deposits, but adds a main wallet's calls to a wallet that pays anyone. The owner's ruling keeps
  it to the deposits.
- **`role: "bridge"` in `WalletView`.** A client of protocol version 1 parses `role` as `launch`
  only, so it would refuse the view. A new optional field keeps those clients working.
- **Mark the role in the ceiling's rule names.** A rebuild would read the role without the venues,
  but every rule name the read-back and the change of calls compare would move with it.
