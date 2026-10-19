# 0234. A token launch waits in quoted for its pin and signs from the launch wallet

Status: Amended by 0236

Accepted by the owner on 2026-10-16.

## Context

[Spec 6](../specs/intent-states.md#section-5) section 5 says a token launch uploads and pins its
words and picture through its launchpad's own API first, waits in `quoted` until the launchpad
reports the pin, then runs its create call and its first buy as steps of one intent. A gateway read
of the picture before the pin can break it for good. In paper mode the policy refuses a launch with
`paper_only` before any upload, pin, quote or signature, and a launch never passes the auto test.
[Decisions 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md) and
[0218](0218-a-launch-wallet-is-paid-from-outside-and-signs-only-with-its-launch-read.md) keep the
agent's main wallets to known contracts and give launches a wallet of their own. Several cases are
left open:

- What moves a launch out of `quoted`, and what proves that nothing else does.
- What the policy judges before the upload: the launch fee is known only to the launchpad.
- How long the engine waits for a pin, who asks, and what the owner hears when none comes.
  `intent/propose` answers within the agent runtime's 30 s call timeout, and a pin can take longer.
- How the engine reads the picture: the protocol takes it as an upload id (`upload/start`, `POST
/upload/:ticket`).
- What the simulation and the wallet queue check for a launch, which makes a token that does not
  exist yet, and how its first buy enters the positions.

## Decision

- **The order.** A launch is checked when it is proposed: its launchpad is one the engine hosts
  that launches tokens, and its launchpad's settings pass their declaration (decision 0235); else
  `protocol.bad_args`, and nothing is stored. A paper launch then ends `rejected_policy` with
  `paper_only` (or `frozen`), and nothing is read, uploaded or quoted. A live launch is quoted by its
  launchpad from its contracts alone: the launch fee in the chain's coin and what the first buy
  gets. The policy then judges the first buy and the fee as what leaves the wallet, with the rules
  and limits every trade has; a quote that failed leaves the policy to judge the first buy alone,
  so its refusal comes first, and else the launch ends `failed_check` with the launchpad's reason.
- **The launch wallet alone.** A live launch runs from the agent's live launch wallet. A request
  that names another wallet, or an agent with none, ends `failed_check` with `needs_launch_wallet`
  after the policy and before any upload. A paper launch is stored on the default wallet.
- **The picture.** After the policy, the engine reads the upload once through its image port and
  takes it only as a PNG, JPEG or WebP, told by its first bytes, of at most 5 MiB; anything else
  ends `failed_check` with `image_unreadable`, nothing uploaded. Its bytes go to the launchpad and
  nowhere else; the quote keeps their SHA-256, type and size.
- **The upload and the build.** The launchpad uploads the words and the picture and asks for the
  pin without waiting for it, then builds the steps against the metadata address it got back. The
  venue host checks the steps (decision 0235), and the launch moves to `quoted` with a launch quote
  that holds every resolved setting, the picture's digest, the metadata address, the pin's handle
  and the end of the pin wait.
- **The pin wait.** A launch in `quoted` waits for its launchpad's pin report. The engine asks the
  launchpad at once, then every 3 seconds from a timer of the composition root, until 5 minutes
  after the upload. A report of the pin moves it to `assessed` (`pin_reported`); a report that the
  pin failed ends it `failed_check` with `pin_failed`, and the end of the wait with `pin_timeout`
  (`pin_failed` trigger); both tell the owner with `notice.launchStopped`. A status read that throws
  or times out counts as no report yet. The wait lives in the stored quote, so it goes on after a
  restart. `intent/propose` answers a launch once it waits for its pin; its card reaches the owner
  as any card does, with `card/opened`.
- **Nothing else leaves `quoted`.** `risk_passed` refuses a launch (`pin_missing`), and
  `pin_reported` and `pin_failed` refuse any other kind. A launch has no token to weigh yet, so no
  risk step runs; the pair it trades against is judged by the policy's token lists. A property test
  holds that no launch reaches `assessed`, its card, `confirmed` or `executing` before its pin
  report.
- **The simulation.** After the pin the steps run unsent on the latest state of the chain, with
  the launch wallet's own balances: no step reverts, the wallet spends exactly the fee and the
  first buy, receives at least the first buy's minimum of the token the build named, no other
  balance changes, and it sets no allowance the plan does not grant. Else `simulation_reverted` or
  `effects_differ`.
- **Never auto.** The card opens after the simulation; the auto test refuses the kind (`kind`), in
  either mode, and the card lasts 10 minutes as spec 6 says.
- **The queue.** As the wallet queue takes a confirmed launch, the policy runs again on its request
  and its confirmed quote, and the signer may call and approve only the launchpad's registry
  contracts on the chain. No launch contract is read or allowed: a create call reaches the
  launchpad's own registry contracts.
- **The first buy's position.** Once final, the launch reconciles as a trade: the first buy's spend
  in its pair is sold and the new token bought, as any buy opens a position. The launch fee is the
  trade's fee when the first buy spends the chain's coin, and counts with the network fee
  otherwise, since a position keeps a fee in the asset it sold. A launch with no first buy records
  its fee and opens no position.

## Consequences

- A launch never reaches its card, a signature or `executing` before its launchpad reports the pin,
  and a pin that never comes ends it with a reason and a notice within about 5 minutes.
- The picture and the words are public on the launchpad's storage once the upload is made, before
  the owner's tap. The card says so (decision 0235).
- A launch costs no upload until the policy and the launch wallet allow it, and paper mode reads
  nothing.
- The state machine gains `pin_reported` (`quoted` to `assessed`) and `pin_failed` (`quoted` to
  `failed_check`); the check reasons gain `image_unreadable`, `pin_failed` and `pin_timeout`; spec
  4 gains `notice.launchStopped`; the engine gains `checkPins`, which the composition root calls
  every 3 seconds; the protocol's `intent/propose` answers a launch in `quoted`.
- The engine reads uploads through a port of its own. Until the upload store of `upload/start`
  lands, the composition root gives none, and a live launch ends `image_unreadable`.
- The venue tasks give each launchpad a launcher whose steps call only its registry contracts, and
  name the token its create call makes.

## Alternatives

- **Hold `intent/propose` until the pin.** A pin can outlast the runtime's 30 s call timeout, and
  the runtime then counts the proposal as unknown. Rejected.
- **Upload before the policy.** A refused launch would still publish its picture. Rejected.
- **Open the card before the pin.** The owner could confirm a launch whose picture can still
  break. Rejected by spec 6.
- **Run the risk step on the pair.** The pair is the coin or a token the launchpad names, and the
  policy's token lists already judge it; the token itself does not exist. Rejected.
- **Wait for the pin in the background of each proposal.** It needs a task per launch that a stop
  or a crash loses; the timer reads the stored launches and survives both. Rejected.
