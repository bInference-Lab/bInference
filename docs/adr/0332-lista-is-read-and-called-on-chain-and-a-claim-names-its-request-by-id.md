# 0332. Lista is read and called on chain, and a claim names its request by id

Status: Accepted

Accepted by the owner on 2026-11-02, with the owner's ruling of the same day that a Lista stake
carries up to 100 BNB in a ceiling rule of its own, as a StakeHub stake does.

## Context

slisBNB stays in v1 ([decision 0296](0296-lending-leaves-v1-a-stake-counts-against-the-caps-and-an-unstake-always-asks.md)),
priced by its stake manager's rate ([decision 0328](0328-slisbnb-is-worth-bnb-s-feed-price-times-its-stake-manager-s-rate-within-bounds.md)),
and [decision 0331](0331-a-liquid-staking-venue-stakes-into-one-pool-and-its-queue-says-when-a-claim-is-ready.md)
fits a liquid staking venue to the `StakingVenue` port. Lista publishes no SDK. Its developer docs
name the stake manager `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` and slisBNB
`0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` on BSC (both in the registry since 2026-10-06), say
to call `deposit()`, approve the stake manager on slisBNB before `requestWithdraw(uint256)`, read
`getUserRequestStatus` rather than assume a deadline, and claim with `claimWithdraw(uint256 idx)`,
an index into `getUserWithdrawalRequests` that changes after each claim.

`ListaStakeManager.sol` in Lista's `synclub-contracts` repo: `deposit`, `requestWithdraw` and the
claims run only while not paused; `deposit` refuses a value that mints no slisBNB;
`requestWithdraw` refuses zero units and an amount under `minBnb`, pulls the units with
`safeTransferFrom`, and records `(uuid, units, startTime)`; a claim pays a request once Lista's bot
has unbonded enough on StakeHub (`uuid < nextConfirmedRequestUUID`), and removes it by moving the
list's last request into its place. `claimWithdrawByUUID(uint256)` claims the caller's request with
that id, and the bot's `claimWithdrawFor(address, uint256)` claims for any user by index. Read on
BSC on 2026-11-02 at block 131,301,081: not paused, `minBnb` 0.001 BNB, `synFee` 1,500,000,000 of
10^10 (15%), one slisBNB for 1.039342452779596239 BNB, StakeHub's `unbondPeriod` 604,800 s; the
stake manager is a proxy whose implementation `0xafe120d0D912495366253c51Fe1f2F6F71f6A085` holds
`deposit`, `requestWithdraw`, `claimWithdraw`, `claimWithdrawByUUID`,
`getUserWithdrawalRequests` and `getUserRequestStatus`.

## Decision

- **On chain, no SDK.** `plugins/lista` reads the stake manager, slisBNB and StakeHub's
  `unbondPeriod` in one Multicall3 call at the latest block, then a wallet's request statuses at that
  block, and encodes its calls from the verified source's ABI. Contracts come from the registry.
- **A claim names its request by id.** The ceiling, the builder and the decoder take
  `claimWithdrawByUUID` in place of the docs' `claimWithdraw`: a request's id never moves, while an
  index moves when the owner or Lista's bot claims another request between the card and the block.
  `claimWithdraw`, `claimWithdrawFor` and `instantWithdraw` are never built and decode as
  `unknown_call`. A paper claim names request 0, which no request holds.
- **The calls.** A stake is `deposit` with its coin. An unstake is an exact approval of its slisBNB
  to the stake manager, then `requestWithdraw` of those units, which spends the approval. A claim
  takes the oldest request Lista's queue released.
- **The pool.** Lista's one pool is its stake manager, named Lista; its commission is `synFee` in
  basis points; it is never jailed; it gives no yearly rate.
- **Refusals before the card,** with spec 6's names: `validator_unknown` for any other pool,
  `staking_paused`; a stake that mints no slisBNB is `below_min_stake` with the least coin that
  mints a unit; an unstake is `nothing_staked`, `exceeds_staked`, then `below_min_stake` with
  `minBnb`; a claim with nothing released is `nothing_to_claim` with its next part's time.
- **Amounts.** A stake mints and an unstake pays as the stake manager rounds them, down, from its
  pooled BNB and slisBNB's supply at the plan's block. A stake promises 10 basis points under what
  it mints there: the rate rises about 0.7 basis points a day, and a staking card lives 10
  minutes, so the rate moves well under a tenth of a basis point while a card is open.
- **The queue.** An unstake's earliest time is its block's time plus StakeHub's unbonding time,
  which Lista's queue waits at least; a request is ready only once `getUserRequestStatus` says it
  is claimable.
- **Read-back.** A stake from its `Deposit` event and slisBNB's mint to the wallet; an unstake from
  its `RequestWithdraw` event and the wallet's one request of those units started in that block,
  with what its status pays; a claim from its own call's id and its `ClaimWithdrawal` payment. An
  unstake's request and its status are read first at the landing block. A node that no longer keeps
  that block's state (public BSC nodes keep about a minute) fails that read, so they are read again
  at the latest block: the landing block's time comes from its header, which every node keeps, and
  a request's id, units and start time never change.
- **A request claimed outside binference.** Lista's bot claims released requests for their owners
  with `claimWithdrawFor`, and the owner may claim one on Lista's site. A watch reads each wallet's
  holding with Lista once for all its live open unstakes whose earliest time came, one holding at a
  time, and not again within five minutes. A row whose request Lista no longer lists, and that no
  claim of binference names while it is confirmed, executing or finalized, closes as claimed
  outside binference: the row stops counting as unbonding or claimable and the claim-ready check
  stops reading it, its coin is booked once into the wallet at what the venue's read-back of the
  unstake said it pays and at the value the unstake recorded, and `notice.claimedElsewhere` tells
  the owner once.
- **Its own cap.** `deposit` carries up to 100 BNB in a ceiling rule of its own, as StakeHub's
  `delegate` does ([decision 0325](0325-a-stake-carries-up-to-100-bnb-in-a-ceiling-rule-of-its-own.md),
  which this amends); `requestWithdraw` and `claimWithdrawByUUID` send no coin and keep the cap per
  call. A wallet whose stored ceiling was written before this rule holds a stake to its cap per
  call: a larger one ends `stake_over_ceiling` before its card, whose words name
  `binference ceiling set`, which writes the rule.

## Consequences

- An owner can still claim a request from Lista's site by index; the next claim here reads the
  list again.
- Two unstakes of the same slisBNB units from one wallet in one block read back as neither, and stay
  unbooked with a log line; the wallet queue sends one move of a wallet at a time.
- An unstake reconciled only after its landing block's state is gone and after its request was
  claimed reads back nothing: it stays `finalized` with a log line, and its row is never made. The
  owner recovers it by setting an RPC that keeps old state (an archive node) and restarting, which
  reconciles it from the landing block.
- A stop between a closed row and its booked coin leaves the coin unbooked: the row is closed, so
  no later pass books it, and the owner reads the coin in the wallet with no position.
- A stake above 100 BNB, or above the agent's own caps, is refused before its card as any stake is.
- The live Privy suite signs `claimWithdrawByUUID` in place of `claimWithdraw`.

## Alternatives

- **`claimWithdraw` by index.** The index a plan read can name another request, or none, by the
  time the call lands.
- **Lista's conversions as calls.** `convertBnbToSnBnb` and `convertSnBnbToBnb` answer the same
  rounded numbers as the pool's totals at one block, at the cost of a call per amount, and an
  unstake of the whole holding needs the balance first.
- **A fixed wait of 7 days, or Lista's site's figure.** The queue's real release time depends on
  Lista's bot; only `getUserRequestStatus` knows.
