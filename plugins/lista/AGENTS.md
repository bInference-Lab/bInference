# @binference/lista

slisBNB through Lista: stakes BNB for slisBNB, requests a withdrawal and claims it back once
Lista's queue releases it, every move crediting only the wallet.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin (decisions [0331](../../docs/adr/0331-a-liquid-staking-venue-stakes-into-one-pool-and-its-queue-says-when-a-claim-is-ready.md)
and [0332](../../docs/adr/0332-lista-is-read-and-called-on-chain-and-a-claim-names-its-request-by-id.md)):

- It imports `@binference/plugin-sdk`, viem and zod. The package graph enforces it.
- It implements the `StakingVenue` port through `defineStaking` as a liquid venue: its one `pool`
  is Lista's stake manager, named Lista. It passes `stakingVenueContract` in its unit test. It
  never signs or sends.
- The stake manager, slisBNB, StakeHub and Multicall3 come only from the chain registry. Lista
  ships no SDK; every function, event and refusal it relies on comes from Lista's developer docs
  and `synclub-contracts`' `ListaStakeManager.sol` and `IStakeManager.sol`.
- It declares `deposit`, `requestWithdraw` and `claimWithdrawByUUID` on the stake manager, and the
  stake manager as its one spender: the registry's `bscVenueCalls.lista` holds the same calls, and
  the composition root's test checks the two agree. `claimWithdraw` by index, `claimWithdrawFor`
  and `instantWithdraw` are never built.
- Every move credits the caller. The decoder reads only those three, to the stake manager on its
  chain, in the exact bytes the builder writes, with coin only on a stake; anything else is
  `unknown_call`. An unstake's approval of exactly its slisBNB units comes first, and only the
  chain family reads it. `decode-move.property.test.ts` holds both.
- `src/manager/` is the one folder that reads the chain's views; `src/landed/` reads a landed
  move's receipt and transaction, and an unstake's request at its landing block, or at the latest
  block by its landing block's header time once a node no longer keeps that block's state. A read
  takes one Multicall3 call at the latest block, then a wallet's request statuses at that block. A
  revert of a view Lista always answers, or an answer outside its shape, is `lista.read_failed`.
- The pool math lives in `src/plan/pool-math.ts`, rounding as the stake manager does. A stake's
  least units sit 10 basis points under what it mints at the plan's block.
- A part is ready only once `getUserRequestStatus` says it is claimable; until then it is
  `queued`, no sooner than its request's time plus StakeHub's unbonding time.
- Unit tests read a model of Lista in `src/testing/`, never the network.
