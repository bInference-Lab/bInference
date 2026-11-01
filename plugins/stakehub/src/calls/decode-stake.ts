import {
  accountRefSchema,
  type ChainRef,
  type DecodedStake,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { readStakeCall, type StakeCall } from "./stake-calls.js";

/** StakeHub on its chain, by its checksum address. */
export interface StakeHubAt {
  readonly chain: ChainRef;
  readonly address: Address;
}

/** A claim takes at most this many unbonding parts in one call. */
export const maxClaimParts = 1_000n;

type Move = Omit<DecodedStake, "contract" | "validator" | "credits">;

// The move of a call in the form the venue builds: `delegate` with coin and no votes handed over,
// `undelegate` of some shares and `claim` of some parts, with no coin. Any other is undefined.
function moveOf(call: StakeCall, value: bigint): Move | undefined {
  if (call.name === "delegate") {
    return !call.votes && value > 0n ? { action: "stake", value } : undefined;
  }
  if (value !== 0n || call.count === 0n) {
    return undefined;
  }
  if (call.name === "undelegate") {
    return { action: "unstake", value, shares: call.count };
  }
  return call.count <= maxClaimParts
    ? { action: "claim", value, parts: Number(call.count) }
    : undefined;
}

/**
 * Reads a StakeHub call from the draft's bytes alone. Only a call to StakeHub itself, on its chain,
 * of `delegate`, `undelegate` or `claim` in the exact form the venue builds decodes; StakeHub
 * credits the caller in each, so the decoded move credits the draft's sender. A sibling such as
 * `redelegate`, `claimBatch` or `syncGovToken`, which names another account, a call to any other
 * contract, a `delegate` that hands the validator the wallet's votes, coin sent with an unstake or
 * a claim, and bytes past the arguments are `unknown_call`.
 */
export function decodeStake(draft: TxDraft, hub: StakeHubAt): Result<DecodedStake, "unknown_call"> {
  const evm = decodeEvmDraft(draft);
  if (!evm.ok || draft.chain !== hub.chain || evm.value.to !== hub.address) {
    return err("unknown_call");
  }
  const call = readStakeCall(evm.value.data);
  const move = call === undefined ? undefined : moveOf(call, evm.value.value);
  if (call === undefined || move === undefined) {
    return err("unknown_call");
  }
  return ok({
    ...move,
    contract: accountRefSchema.parse(`${draft.chain}:${hub.address}`),
    validator: accountRefSchema.parse(`${draft.chain}:${call.validator}`),
    credits: draft.from,
  });
}
