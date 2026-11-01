# 0324. StakeHub is read and called on chain, and every move credits only the caller

Status: Accepted

Accepted by the owner on 2026-11-01.

## Context

Staking stays in v1 ([decision 0296](0296-lending-leaves-v1-a-stake-counts-against-the-caps-and-an-unstake-always-asks.md)):
native BNB staking through StakeHub, the system contract at
`0x0000000000000000000000000000000000002002` on BNB Smart Chain. The ceiling already allows its
`delegate`, `undelegate` and `claim` and no sibling, since none of the three takes an input that
names who is credited: StakeHub credits `msg.sender`, and its credit shares refuse transfer and
approval. Protocol v1 has `staking/options`, a `stake` request and `StakingPositionView`
(spec 1); spec 6 has the reasons `validator_jailed`, `below_min_stake` and `nothing_to_claim`, a
paper path, and an unstake's ready time read again at reconciliation with the venue's own request
(spec 3's `stake_unbondings.request_ref`). Nothing reads StakeHub or builds its calls yet, and no
port fits: a swap venue quotes a pair, a bridge pays another chain.

BNB Chain publishes no SDK for StakeHub. Its staking developer guide reads the contracts
(`getValidators`, `getValidatorDescription`, `getValidatorCommission`, `getValidatorBasicInfo`,
the credit contract's `getPooledBNB`, `pendingUnbondRequest` and `unbondRequest`) and calls
`delegate(operatorAddress, delegateVotePower)`, `undelegate(operatorAddress, shares)` and
`claim(operatorAddress, requestNumber)`, `requestNumber` 0 meaning every ready request. It
computes a yield from a day's `getValidatorRewardRecord` over its
`getValidatorTotalPooledBNBRecord`, compounded, and labels that code an example. Read on BSC on
2026-11-01 at block 131,098,446: 56 validators, 3 jailed, a 7-day unbonding time, a 1 BNB least
stake, a reward day of 86,400 s, and 5,000 gas for the claim's payment to the delegator.

`StakeHub.sol` checks, in this order: paused (`whenNotPaused`), a black-listed caller
(`notInBlackList`), an operator it does not list (`ValidatorNotExisted`); then for `delegate` a
value under the least (`DelegationAmountTooSmall`) before a jailed validator taken from anyone but
its operator (`OnlySelfDelegation`); for `undelegate` zero shares (`ZeroShares`) and more shares
than held (`InsufficientBalance`); for `claim` no request (`NoUnbondRequest`), none ready
(`NoClaimableUnbondRequest`), and a payment the caller cannot take with 5,000 gas
(`TransferFailed`). `StakeCredit` keys each unstake by its delegator and a sequence number that
counts up from 0, sets its unlock time from the block it lands in, and claims from the front of
the queue.

## Decision

- **A staking venue port.** `StakingVenue` in `@binference/chain/staking`, with its contract
  suite and fake, and `defineStaking` in the plugin SDK: `options` lists the validators, the
  unbonding time and the least stake; `holdings` reads a wallet's positions; `plan` plans a stake,
  an unstake or a claim at the latest block, or answers why StakeHub would refuse it; `build` makes
  the planned call; `decode` reads one back; `landed` reads back what a landed move did. A staking
  venue declares contracts on its own chain only, and no bridge deposit.
- **On chain, no SDK.** `plugins/stakehub` reads StakeHub and the credit contracts through the
  chain's RPC failover, every call of one read at one block through Multicall3, the pinned reads
  marked as reads at the head, at most four batches at once, and encodes the three calls itself
  from `StakeHub.sol`'s ABI. Contract addresses come from the chain registry.
- **Refusals before the card, in StakeHub's order,** named as spec 6 names them:
  `staking_paused`, `wallet_blocked`, `validator_unknown`; then `below_min_stake` before
  `validator_jailed` for a stake; `nothing_staked` or `exceeds_staked` for an unstake;
  `nothing_to_claim`, then `claim_unpayable` for a claim from a wallet that holds code, which
  StakeHub's 5,000 gas payment may not reach. A jailed validator blocks only a new stake; an
  unstake or a claim from one passes. A failed read of a validator StakeHub lists is
  `stakehub.read_failed`, never `validator_unknown`.
- **Only the caller is credited.** The decoder reads only `delegate`, `undelegate` and `claim`, to
  StakeHub on its chain, in the exact bytes the ABI writes, with coin only on a stake, and gives the
  draft's sender as the account credited. `redelegate`, `claimBatch`, `syncGovToken`, a call to
  any other contract and bytes after the arguments are `unknown_call`.
- **No votes handed over.** Every `delegate` passes `delegateVotePower` false, and the decoder
  refuses true. The ceiling and the signer do not bind it: a venue's declaration can pin an input
  to the wallet or bind a bridge deposit's inputs to the plan, but carries no fixed value for an
  input, and the boolean moves no funds. The decoder and the host's compare of the decoded call
  with the plan hold it.
- **What a plan carries.** The validator's name, commission and jail state at the plan's block; a
  stake's minted shares and an unstake's burned shares with the validator's pool (its shares and
  their coin) they are priced by; an unstake's earliest ready time, the plan block's time plus
  the unbonding time, since StakeHub counts from the landing block; a claim's parts by reference.
- **Paper.** A plan given the engine's paper position reads only StakeHub's state, never the
  wallet's: shares and parts come from the position, the price from the pool.
- **An unstake in BNB, or of the whole stake.** An amount burns the fewest shares worth at least
  it, rounded up, never more than the wallet holds, and every share when the amount is the
  stake's whole worth at the plan's block; `whole` burns every share at the plan's block, so no
  dust remains when the stake grew since it was read. An amount above the worth is
  `exceeds_staked`.
- **A claim of what is ready.** It names the count of ready requests at the front of the queue,
  at most 1,000, never 0. `holdings` reads at most 1,000 waiting requests per validator and marks a
  holding with more as cut.
- **Read-back.** `landed` reads the transaction's own `Delegated`, `Undelegated` or `Claimed` event
  of the wallet and validator, and the credit contract at the landing block: a stake's minted
  shares, an unstake's request, its reference (the credit contract and its sequence number) and
  the unlock time StakeHub set, and the references of the requests a claim took.
- **A yearly rate, not a compounded yield.** `aprBps` is the newest recorded day's rewards over
  the pool before them, times 365, rounded down; today's record when StakeHub has written it,
  else yesterday's, and absent when neither exists.

## Consequences

- The engine's `stake` kind (next task) calls `plan` before the card, stores the plan as the
  intent's quote (`stakePlanSchema`), compares `decode` with the plan as the venue host does for a
  trade, maps each refusal to its reason, plans again as the wallet queue takes the move, and
  stores what `landed` reads at reconciliation.
- The card shows an unstake's ready time as the earliest one; the stored unbonding takes the time
  `landed` read, and a claim before it answers `nothing_to_claim`.
- A stake above the wallet's cap per call needs its own ceiling rule:
  [decision 0325](0325-a-stake-carries-up-to-100-bnb-in-a-ceiling-rule-of-its-own.md) gives
  `delegate` 100 BNB; a least stake raised above it refuses every stake.
- StakeHub pays a claim with 5,000 gas. A wallet with code, such as an exported key delegated with
  EIP-7702 later, gets `claim_unpayable`; Privy's server wallets hold no code.
- A thief who holds every key can still delegate the wallet's BNB to a validator he runs, within
  the caps, or hand its votes to one: the stake stays the wallet's, and he earns commission on its
  rewards.
- A validator's moniker is outside content, and the plugin passes it on as StakeHub holds it.

## Alternatives

- **Pass `delegateVotePower` through.** The owner never asked to vote, and a tap would hand
  governance weight to whoever runs the validator.
- **A fixed-value input in the venue declaration, for the signer and Privy.** It changes the shape
  every ceiling and the signer share for a boolean that moves no funds.
- **`claim` with `requestNumber` 0.** It takes every ready request too, but the call would not say
  how many, so the host could not compare it with the plan.
- **The guide's compounded yield.** The protocol names `aprBps`; compounding one day's rate
  365 times overstates what a stake that is not restaked each day earns.
- **Fold staking into the swap venue port.** A stake has no pair, no route and no least output,
  and needs reads a swap venue never makes.
- **Leave the paper path and the read-back to the engine.** The engine would price StakeHub's
  shares and decode its events itself, which names a venue in core.
