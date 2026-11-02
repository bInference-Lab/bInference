# 0329. The portfolio counts a staked, unbonding or bridged dollar once, at the venue's pool

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

[Decision 0296](0296-lending-leaves-v1-a-stake-counts-against-the-caps-and-an-unstake-always-asks.md)
keeps a stake as a position of the venue's receipt token, and
[decision 0327](0327-a-staking-move-is-planned-before-its-card-and-again-at-the-queue-and-booked-from-what-landed.md)
books an unstake's coin into an unbonding row until a claim takes it back.
[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
and [decision 0320](0320-a-bridge-s-delivery-is-followed-on-a-timer-and-its-row-settles-before-its-intent.md)
take a bridge's units out of their position at its final deposit and keep the bridge in transit
until a read settles it. The protocol spec gives `portfolio/get` a staking part and an in-transit
part, and says each counts once. It leaves open:

- What a receipt token is worth now. A validator's credit shares have no feed and no market, so the
  price source has no price for them, and a stake would leave the totals at the moment it is made.
- Whether unbonding coin and a bridge in transit count in the totals, and how often.
- Where the staking part comes from: the venue's read of the wallet, or what binference booked.
- What `portfolio/get` answers when the staking venue does not.

## Decision

- **A receipt token is priced by its pool.** A staking venue reads the pools of the receipt tokens
  it mints, at the latest block (`StakingVenue.pools`): each pool's units and the coin they are
  worth together, as the venue itself prices a share; StakeHub reads a credit contract's
  `totalSupply` and `totalPooledBNB`. A receipt token is worth the coin's price from the price
  source times its pool's coin over its units, one exact ratio rounded down once, as every value
  now is. With no coin price it has none, never a guessed one.
- **Only the portfolio reads prices this way.** `portfolio/get`, `portfolio/pnl`, its P&L cards and
  the daily summary's totals ask the venue for the pools of the tokens a wallet holds positions
  in that the registry does not list, once per read. The policy, the money path and the booking of
  a staking move keep their own prices: no trade sells a receipt token, and each move is booked
  from what landed (decision 0327).
- **Each dollar counts once.** A staked receipt token is a balance, live as the chain reads it and
  paper as the paper position holds it, valued at its pool; the staking part shows the same units
  beside it and adds nothing. An unbonding row no claim took counts at its coin's price now,
  rounded down: claimable once its ready time came, unbonding before. A bridge in transit or late
  counts at the value its units left their position with. The live ones add to `totalUsdMicros`,
  the paper ones to `paperTotalUsdMicros`, never to each other. A bridge is live only, since paper
  mode refuses bridges (`paper_only`), and never pays a wallet of the install
  (`address.own_wallet`), so a delivery never shows on the destination chain as well.
- **The staking part is what binference booked.** One entry per wallet, mode, venue and validator:
  the receipt units held, their coin at the pool, and the wallet's unbonding rows no claim took.
  A stake or an unstake made outside binference is not listed, as a token the registry does not
  list and no position holds is not; a claim of its coin arrives with no value (decision 0327).
- **slisBNB is a token.** It stays a balance and a position priced at its stake manager's rate
  ([decision 0328](0328-slisbnb-is-worth-bnb-s-feed-price-times-its-stake-manager-s-rate-within-bounds.md)),
  shown with no price when that rate is refused. It joins the staking part once a Lista staking
  venue runs.
- **A venue that does not answer fails soft.** The portfolio, the P&L, its cards and the daily
  summary are displays, not money decisions. Pools that cannot be read, or an answer the venue host
  cannot hold (a pool of a token not asked for, of another coin, or with no units), leave the
  venue's receipt tokens with their units and no value, out of the totals, as any token with no
  price; they are not in the staking part, since only the pool names their validator. An unbonding
  of a venue that does not answer, or that the engine no longer runs, shows its coin, valued at
  the coin's price, with no receipt units. Surfaces say "value unknown". The policy and the money
  path are untouched: each still refuses what it cannot price.

## Consequences

- A stake moves its value from the coin balance into the receipt balance at the pool's price, and
  its yield shows as the receipt position's unrealized P&L.
- Each portfolio read of a wallet holding unlisted tokens costs one StakeHub list read and two
  reads per credit contract held, at the latest block.
- The totals read the chain and the stores at one moment. A claim or a refund that landed but that
  reconciliation or the bridge follower has not read yet counts in the wallet and in its row until
  that read, at most one follower pass for a bridge and one reconciliation for a claim.
- A StakeHub outage shows staked receipt units with no value and leaves them out of the totals
  until StakeHub answers again; `/positions` says their value is unknown.

## Alternatives

- **Value the stake from the venue's read of the wallet.** It also shows stakes made outside
  binference, but costs four reads per validator, about 220 calls per wallet and read, and has no
  answer for a paper stake, which the chain does not hold.
- **A price for receipt tokens in the price source.** Every unpriced token in the money path, a
  new meme token on each buy, would ask the staking venue first, and the policy would price a
  token no trade sells.
- **Leave unbonding coin and bridges in transit out of the totals.** The totals would drop by the
  amount at each unstake and bridge, and rise again at the claim or the refund.
- **Fail the whole read when the venue does not answer.** A display would go dark for every
  holding because of one venue, against the rule to fail soft on what only informs.
