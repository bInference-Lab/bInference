# 0218. A launch wallet is paid from outside and signs only with its launch read

Status: Accepted

Accepted by the owner on 2026-10-16.

Amends [decision 0217](../DECISIONS.md#d0217).

## Context

A review of the launch wallet ([decision 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md))
found its walls true in amount but open on several paths:

- `address/add` and `safety/setRescueAddress` took a launch wallet's address, after which every
  other wallet of the agent could pay it, though the decision says no ceiling lists it.
- A live curve trade from another wallet, named by the request or picked after a curve read
  failed, reached the card or the auto grant and failed only at the signer, as an alarm.
- A launchpad read that failed, or a launch that graduated, as the wallet queue took the intent
  reached the signer with no launch contract, also as an alarm. The contracts were read once, not
  before a later step or a speed-up.
- A rebuild kept the oldest launch wallet the owner key owns and left any other on Privy, unseen,
  with the lost machine's agent key still its signer. A rebuild that found only launch wallets
  made one the default wallet.
- A launch wallet could be made when no launchpad the install runs declares a launch call, and a
  launchpad added later passed `limit/set` though the wallet's ceiling lacked its calls.
- Some sentences of decision 0217 say more than holds.

The owner ruled on 2026-10-15 that the launch wallet is funded from outside only, and that a
signer refusal stays a real alarm.

## Decision

- **No ceiling lists a launch wallet.** `address/add` and `safety/setRescueAddress` refuse the
  address of any live launch wallet of the install as `address.launch_wallet`, and a rebuild
  refuses one as the rescue address. A saved address that names one, as a book restored from a
  backup may hold, is left out of every ceiling a later change writes, and out of a new wallet's.
  A ceiling change keeps each ceiling's recipients. A rescue still empties the launch wallet to the
  rescue address.
- **A curve trade runs only from the launch wallet.** A live buy or sale placed on a launchpad's
  curve whose launch has contracts of its own ends `failed_check` with the check reason
  `needs_launch_wallet` unless it runs from the agent's live launch wallet: a request that names
  another wallet, or an agent with none. When the curve read that picks the wallet fails, the
  intent ends `failed_check` with `launch_unread`. Both come after the policy and before any quote,
  card or auto grant.
- **The queue signs only with the launch read in hand.** As the wallet queue takes a launch
  wallet's curve trade, it reads the launch's contracts from the launchpad. A read that fails ends
  the intent `failed_check` with `launch_unread`, and a launch that no longer names the curve, as
  after a graduation, with `launch_moved`, both from `confirmed`, with nothing signed and
  `notice.launchUnsent` to the owner. Before each later step and each speed-up it reads them
  again: a later step that cannot have them is never signed and ends the intent as decision 0109
  says; a speed-up waits for the next block while the read fails, and becomes a cancel once the
  launch moved.
- **A rebuild adopts every launch wallet.** It adopts every wallet the owner key owns whose rules
  are the ones binference builds, launch wallets too, moves every one's signer to the new agent
  key, and lists each with its role before the owner types the count. With more than one launch
  wallet, the newest by Privy's time is the agent's launch wallet, the first the store lists; the
  others are extra launch wallets: nothing routes to them, `wallet list` marks them, and
  `binference check` warns with their addresses so the owner rescues what they hold. A rebuild
  that finds no agent wallet is refused, so the default wallet is never a launch wallet. The store
  no longer holds one live launch wallet per agent itself; `wallet/create` takes one call at a
  time, so a second `--launch` is refused before custody makes a wallet.
- **A launch wallet needs launch calls.** `wallet/create` with `launch` is `wallet.no_launch_calls`
  when no launchpad the install runs declares a call on its launch contracts. `limit/set` adding a
  launchpad, and `agent/goLive` with one among the venues, answer `limit.over_ceiling` while the
  launch wallet's stored ceiling lacks one of that launchpad's launch calls; only the owner key
  changes the ceiling.
- **What decision 0217 says more than holds, said again:**
  - Beyond decision 0149, no rule lets the agent's other wallets pay the launch wallet. A swap
    through a venue whose receiver no rule can pin, as decision 0149 allows, can still pay it,
    within that decision's caps.
  - Curve sales and sales through the pools pay the launch wallet, and the coin and registry
    tokens it receives stay there: the default wallet sells those. Its holdings are the owner's
    funding and these proceeds, until a rescue takes them back.
  - An allowance a stolen key grants from the launch wallet outlives the key and a rescue: any
    later deposit of that token can be taken. After a theft, the owner funds that launch wallet no
    more. No command archives it yet, so the agent keeps it as its launch wallet.
  - A launch wallet's approval may name the step's launch contract or any registry contract of
    the route's venues.
  - The signer's check of the launch wallet's calls rests on the wallet's role and the launch
    contracts, which both come from the engine process: against a compromised engine process the
    signer adds no wall for the launch wallet, as for any wallet's allowed contracts.

## Consequences

- No path lets the main wallets fund the launch wallet with a send; the owner funds it from
  outside, such as from the rescue address's wallet.
- A refusal by the signer of a launch wallet's step again means something was wrong, never a
  routine mistake or a flaky read.
- Migration 0039 drops the store's index of one live launch wallet per agent.
- The protocol gains `address.launch_wallet`, `wallet.no_launch_calls`, the check reasons
  `needs_launch_wallet`, `launch_unread` and `launch_moved`, `WalletView.extra` and
  `CeilingView.launchCalls`; the state machine gains `launch_read_failed`, from `confirmed` to
  `failed_check`; spec 4 gains `notice.launchUnsent`.

## Alternatives

- **Let the owner choose which launch wallet a rebuild adopts.** One more question in a recovery
  the owner runs under stress, for a case only a crash or a race makes. Rejected.
- **Keep an intent whose launch read failed `confirmed`, to try again a block later.** The owner
  ruled that it ends with its own reason. Rejected.
- **Let the signer refuse a curve trade from another wallet, as before.** A routine mistake would
  read as an alarm. Rejected.
