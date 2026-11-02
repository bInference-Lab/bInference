# @binference/stakehub

Native BNB staking through StakeHub: lists validators, reads a wallet's stake and unbonding coin
and the pools that price each validator's credit shares, and builds the delegate, undelegate and claim calls that credit only the wallet.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin ([decision 0324](../../docs/adr/0324-stakehub-is-read-and-called-on-chain-and-every-move-credits-only-the-caller.md)):

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- It implements the `StakingVenue` port through `defineStaking` and passes
  `stakingVenueContract` in its unit test and on the fork. It never signs or sends.
- StakeHub and Multicall3 come only from the chain registry, by their names. BNB Chain ships no
  SDK for StakeHub; its staking developer guide reads and calls the contracts, and so does this
  plugin. Every function and error it relies on comes from `bsc-genesis-contract`'s `StakeHub.sol`,
  `StakeCredit.sol` and `extension/Protectable.sol`.
- It declares `delegate`, `undelegate` and `claim` on StakeHub and nothing else, no spender, with
  `delegate` carrying up to 100 BNB in a ceiling rule of its own (decision 0325): the registry's
  `bscVenueCalls.stakehub` holds the same calls, and the composition root's test checks the two
  agree. `redelegate`, `claimBatch` and `syncGovToken` are never built.
- Every move credits the caller: StakeHub takes no beneficiary in these three functions. The
  decoder reads only those three, to StakeHub on its chain, in the exact bytes the builder writes,
  `delegate` never handing over votes, with coin only on a stake; anything else is
  `unknown_call`. `decode-stake.property.test.ts` holds it.
- `src/hub/` is the one folder that knows StakeHub's views and calls the chain, with
  `src/landed/` for a landed move's receipt. One read takes the latest block, then every call at
  that block through Multicall3, marked as a read at the head, at most four batches at once, with
  the caller's signal. It caches nothing. A revert of a call StakeHub always answers, or an answer
  outside its shape, is `stakehub.read_failed`.
- A plan names StakeHub's refusals before any card, in the order StakeHub checks them and with
  spec 6's names: `staking_paused`, `wallet_blocked`, `validator_unknown` (a zero credit contract
  alone), then `below_min_stake` before `validator_jailed` for a stake, `nothing_staked` or
  `exceeds_staked` for an unstake, `nothing_to_claim` then `claim_unpayable` for a claim. A paper
  plan reads only StakeHub's state, never the wallet's.
- The share math lives in `src/plan/credit-shares.ts`, priced as StakeCredit prices shares, and
  `credit-shares.property.test.ts` holds it: the fewest shares worth at least an amount, never
  more than held, every share for the whole stake.
- Unit tests read a StakeHub world in `src/testing/`, never the network. The fork tests in
  `src/fork/` stake, unstake and claim on the pinned BSC fork, and jail a validator the way
  StakeHub's slash indicator does.
