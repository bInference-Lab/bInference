# @binference/stakehub

## Purpose

The `stakehub` staking venue: stakes BNB with a validator through BNB Smart Chain's StakeHub
system contract, unstakes it and claims it back after the unbonding time.

- **Validators.** Every validator StakeHub lists, with its moniker, commission, whether it is
  jailed and until when, and a yearly rate from its last recorded day of rewards: that day's
  rewards over the pool before them, times 365.
- **Holdings.** A wallet's credit shares with each validator, what they are worth in BNB, its
  waiting unstakes with when each is ready, and what a claim takes now.
- **Plan.** A stake, an unstake or a claim at the latest block, live or against a paper position,
  or StakeHub's refusal by name: paused, a refused wallet, an unknown validator, a stake under the
  least or to a jailed validator, nothing staked, more than the stake is worth, nothing to claim,
  or a claim to a wallet with code that StakeHub's payment cannot reach. A plan carries the
  validator's commission and jail state, the shares a stake mints or an unstake burns with the
  pool they are priced by, and a claim's parts by reference.
- **Build.** One call to StakeHub from the wallet: `delegate` with the stake and no votes handed
  over, `undelegate` of the fewest shares worth at least the amount, every share for the whole
  stake, or `claim` of the ready unstakes. StakeHub credits the caller in each.
- **Read-back.** What a landed move did, from its own event and the credit contract at its block:
  the shares a stake minted, an unstake's request with its reference and unlock time, the parts a
  claim took.
- **Decode.** Only those three calls in those exact bytes; anything else is `unknown_call`.
- **Faults.** No node answering is the RPC failover's `chain.rpc_down`; a revert or an answer
  outside its shape is `stakehub.read_failed`. A request of another chain or asset is
  `stakehub.bad_request`, a plan that does not fit its action `stakehub.bad_plan`, and missing
  or foreign contracts at creation `stakehub.bad_options`.

## API

| Export                | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `createStakeHubVenue` | The StakeHub staking venue over a chain's RPC failover             |
| `stakeHubDeclaration` | The venue's id and contracts on its chains, without a chain read   |
| `stakeHubId`          | The venue's id, `stakehub`                                         |
| `StakeHubOptions`     | The chain, its coin, its RPC failover and the registry's contracts |

## Example

The composition root builds the venue for the chain whose registry lists StakeHub:

```ts
import { createStakeHubVenue } from "@binference/stakehub";

const staking = createStakeHubVenue({ chain, coin, rpc, contracts, multicall });
const plan = await staking.plan(
  { action: "stake", wallet, validator, amount: { asset: coin, base: 10n ** 18n } },
  { signal },
);
```
