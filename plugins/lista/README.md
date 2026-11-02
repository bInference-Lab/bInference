# @binference/lista

## Purpose

The `lista` staking venue: stakes BNB for slisBNB through Lista's stake manager on BNB Smart Chain,
requests a withdrawal of slisBNB and claims the BNB back once Lista's queue releases it.

- **Pool.** Lista's one pool, its stake manager, with the share of rewards Lista keeps, StakeHub's
  unbonding time as the least a withdrawal waits, and the least BNB a deposit mints slisBNB for.
- **Holdings.** A wallet's slisBNB, what it is worth in BNB, its withdrawal requests with when each
  is ready or that Lista's queue still holds it, and what a claim takes now.
- **Plan.** A stake, an unstake or a claim at the latest block, live or against a paper position,
  or Lista's refusal by name: another pool, paused, a stake that mints nothing, nothing staked, more
  than held, a withdrawal under Lista's least, nothing to claim. A stake promises the slisBNB it
  mints less 10 basis points.
- **Build.** `deposit` with the stake's BNB; an exact approval of the unstake's slisBNB to the
  stake manager, then `requestWithdraw`; `claimWithdrawByUUID` of the oldest released request.
  The stake manager credits the caller in each.
- **Read-back.** What a landed move did, from its events and the stake manager at its block: the
  slisBNB a stake minted, an unstake's request with its id and earliest time, the request a claim
  took and what it paid.
- **Decode.** Only those three calls in those exact bytes; anything else is `unknown_call`.
- **Faults.** No node answering is the RPC failover's `chain.rpc_down`; a revert or an answer
  outside its shape is `lista.read_failed`. A request of another chain or asset is
  `lista.bad_request`, a plan that does not fit its action `lista.bad_plan`, and missing or foreign
  contracts at creation `lista.bad_options`.

## API

| Export             | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `createListaVenue` | The Lista staking venue on one chain, over the registry's contracts. |
| `listaDeclaration` | What the venue declares on chains, without reading any.              |
| `listaContractsOn` | The stake manager's calls and spender on one chain.                  |
| `listaId`          | The venue's id, `lista`.                                             |
| `stakeManagerName` | The stake manager's registry name.                                   |

`@binference/lista/testing` exports `createListaWorld`, a model of Lista's stake manager and
slisBNB behind a model RPC, and `listaForeignDrafts`.

## Example

```ts
import { createListaVenue } from "@binference/lista";

const venue = createListaVenue({ chain, coin, receipt, rpc, contracts, stakeHub, multicall });
const plan = await venue.plan(
  { action: "stake", wallet, validator: venue.pool, amount },
  { signal },
);
```
