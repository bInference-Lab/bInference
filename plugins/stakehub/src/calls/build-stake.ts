import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type StakePlan,
  type TxDraft,
} from "@binference/plugin-sdk";
import { encodeEvmDraft, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { maxClaimParts, type StakeHubAt } from "./decode-stake.js";
import { claimData, delegateData, undelegateData } from "./stake-calls.js";

function refused(problem: string): BinferenceError {
  return new BinferenceError({
    code: "stakehub.bad_plan",
    message: `StakeHub cannot build this plan: ${problem}`,
  });
}

function addressOf(plan: StakePlan, hub: StakeHubAt): Address {
  const parts = accountRefParts(plan.validator);
  const address = parseEvmAddress(parts.address);
  const isOwnChain = [parts.chain, accountRefParts(plan.wallet).chain].every(
    (chain) => chain === hub.chain,
  );
  if (!address.ok || !isOwnChain) {
    throw refused("its wallet or validator is not an EVM account of StakeHub's chain.");
  }
  return address.value;
}

function dataOf(plan: StakePlan, validator: Address): `0x${string}` {
  if (plan.action === "stake") {
    return delegateData(validator);
  }
  if (plan.action === "unstake" && plan.shares !== undefined && plan.shares.base > 0n) {
    return undelegateData(validator, plan.shares.base);
  }
  const parts = BigInt(plan.parts?.length ?? 0);
  if (plan.action === "claim" && parts > 0n && parts <= maxClaimParts) {
    return claimData(validator, parts);
  }
  throw refused("an unstake names no shares, or a claim no parts.");
}

/**
 * The plan's one call to StakeHub, from the plan's wallet: `delegate` with the stake's coin and no
 * votes handed over, `undelegate` of the plan's shares, or `claim` of its ready parts. StakeHub
 * credits the caller in each, so the call credits the plan's wallet alone. A plan of another
 * chain, or one whose parts do not fit its action, is `stakehub.bad_plan`.
 */
export function buildStake(plan: StakePlan, hub: StakeHubAt): readonly TxDraft[] {
  const validator = addressOf(plan, hub);
  const isCoinOnlyOnStake = plan.action === "stake" ? plan.value.base > 0n : plan.value.base === 0n;
  if (!isCoinOnlyOnStake) {
    throw refused("only a stake sends coin, and it sends some.");
  }
  const to = accountRefSchema.parse(`${hub.chain}:${hub.address}`);
  const data = dataOf(plan, validator);
  return [encodeEvmDraft({ from: plan.wallet, to, value: plan.value.base, data })];
}
