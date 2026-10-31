# 0297. A bridge pays a saved address on one of five chains, and only a read there says it arrived

Status: Accepted

Accepted by the owner on 2026-10-30, with the rescue address allowed only where it is a plain
wallet on both chains, and the address book showing how many saved addresses on other chains
the ceiling can still hold.

## Context

[Decision 0067](../DECISIONS.md#d0067) makes a bridge a cross-chain send to an address-book entry
or the rescue address, under the send level. [Decision 0091](../DECISIONS.md#d0091) lets the
ceiling pay only the rescue address and saved addresses, and
[decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) binds each argument of a
call that names who gets paid. Spec 6 still ended a bridge "when the bridge reports delivery, or
after 2 hours with the delivery marked unknown": it took the bridge's word, and it stopped looking.

On 2026-10-29 the owner settled three things:

- Bridges deliver to Ethereum, Base, Arbitrum, Solana and Robinhood Chain. Robinhood Chain is an
  Ethereum L2 that pays gas in ETH; Across delivers USDC there as USDG, another token.
- A route whose recipient the Privy ceiling cannot bind stays out of v1; the ceiling is never
  widened to let one in.
- Solana is the first chain binference reads that is not EVM (decision 0298).

A deposit names its recipient and its destination chain as arguments of one call on BNB Smart
Chain. A relayer then pays the recipient on the destination chain, or, past the deposit's
deadline, the bridge pays the deposit back to the depositor on BNB Smart Chain.

## Decision

- **Where.** In v1 a bridge leaves BNB Smart Chain and delivers to Ethereum, Base, Arbitrum,
  Robinhood Chain or Solana. The chain registry lists, per destination chain, each route a bridge
  venue serves from BNB Smart Chain: the token that leaves and the token that arrives, read from
  the venue's official API. No other route is offered.
- **Which venues.** Across, then Relay, then LI.FI on a route neither serves; each only on routes
  whose deposit the ceiling binds: the recipient (20 bytes, or 32 for Solana), the destination
  chain id, the depositor (the wallet itself, which gets any refund) and an empty message, each a
  top-level argument the ceiling reads. A route it cannot bind is named in its venue's evidence
  and never added.
- **To whom.** An address-book entry on the destination chain. The ceiling binds each entry's
  destination chain id and recipient bytes together, so an entry saved for Base is never paid on
  Ethereum. The send level applies as it does to a send. The deposit's decoded recipient bytes
  must equal the entry's, through its chain family's address codec.
- **The rescue address** may receive a bridge on an EVM destination chain only while it holds no
  code on BNB Smart Chain and none on the destination: the same key then holds it on both. On
  Solana it never can.
- **One deposit per intent.** A bridge's plan is an exact approval when the token needs one, then
  one deposit. A deposit whose nonce a transaction used is never signed again; recovery follows
  spec 6, section 7.
- **Delivery is read, never inferred.** The venue's status says which transaction on the
  destination chain filled the deposit. The destination chain family's reader reads that
  transaction at its final commitment and finds the payment to the recipient in the delivered
  token, at least the quote's minimum. Only that read marks the bridge `delivered`. A status that
  says filled while the read finds nothing leaves it in transit. A refund is read the same way on
  BNB Smart Chain: the venue's payment back to the wallet.
- **Late, never given up.** Two hours after the deposit is final, a bridge not delivered is
  `late`, and the owner gets one notice with the venue's status page. The engine keeps reading
  until a delivery or a refund settles it; no timer ends it unread.
- **Caps and modes.** A bridge counts its USD value against the per-trade and 24-hour caps as a
  send does. It never runs in auto mode ([decision 0088](../DECISIONS.md#d0088)), and paper mode
  refuses it with `paper_only`.
- **Positions.** When the deposit is final, the units sent leave their position at average cost,
  with no gain or loss, as a send's do. They count in the agent's live total as in transit, once,
  until the delivery read, when they leave the agent, or a refund, which arrives back at its value.

## Consequences

- Spec 6's bridge row changes: `finalized` waits for the delivery read, and a bridge reaches
  `reconciled` only on a delivery or a refund. A bridge whose venue never pays stays in transit,
  late, in the daily summary until the owner acts outside binference.
- Each destination chain needs keyless public RPCs with failover in the registry, and Solana a
  reader of its own.
- The ceiling grows one rule per saved address on another chain. Privy's rule count per policy
  bounds how many such entries an owner can save; the ceiling task measures it, and the address
  book shows how many are saved and the most the ceiling can hold.
- An owner whose rescue address is a contract wallet must save its address on each destination
  chain to bridge there.
- A delivered token that differs from the token sent shows on the card, and the minimum is in the
  delivered token.

## Alternatives

- **Trust the venue's status.** One HTTP answer would decide that the owner's funds arrived.
- **End a bridge after 2 hours as unknown.** The funds would still be somewhere; the owner would
  lose the read that tells where.
- **Bind the recipient and the chain apart.** A stolen key could pay a Base entry's address on
  Ethereum, where that address may belong to no one the owner knows, such as an exchange's deposit
  address.
- **Allow the rescue address on every chain.** A contract wallet's address on BNB Smart Chain may
  hold nothing, or someone else's contract, on another chain.
- **A small bridge wallet of its own**, as the launch wallet. It would let in routes the ceiling
  cannot bind; the owner chose to leave those out of v1 instead.
