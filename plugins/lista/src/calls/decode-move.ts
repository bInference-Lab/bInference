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
import { type ManagerCall, readManagerCall } from "./manager-calls.js";

/** Lista's stake manager on its chain, by its checksum address. */
export interface ManagerAt {
  readonly chain: ChainRef;
  readonly address: Address;
}

type Move = Omit<DecodedStake, "contract" | "validator" | "credits">;

// The move of a call in the form the venue builds: `deposit` with coin, a request of some units
// and a claim of one request, with no coin. Any other is undefined.
function moveOf(call: ManagerCall, value: bigint): Move | undefined {
  if (call.name === "deposit") {
    return value > 0n ? { action: "stake", value } : undefined;
  }
  if (value !== 0n) {
    return undefined;
  }
  if (call.name === "requestWithdraw") {
    return call.units > 0n ? { action: "unstake", value, shares: call.units } : undefined;
  }
  return { action: "claim", value, parts: 1, refs: [call.uuid.toString()] };
}

/**
 * Reads a stake manager call from the draft's bytes alone. Only a call to the stake manager
 * itself, on its chain, of `deposit`, `requestWithdraw` or `claimWithdrawByUUID` in the exact form
 * the venue builds decodes; the stake manager credits the caller in each, so the decoded move
 * credits the draft's sender, and names the stake manager as the pool it moves in. `claimWithdraw`
 * by index, the bot's `claimWithdrawFor`, `instantWithdraw`, a call to any other contract, coin
 * sent with a request or a claim, an empty request and bytes past the arguments are
 * `unknown_call`. A token approval is the chain family's to read, not the venue's.
 */
export function decodeMove(
  draft: TxDraft,
  manager: ManagerAt,
): Result<DecodedStake, "unknown_call"> {
  const evm = decodeEvmDraft(draft);
  if (!evm.ok || draft.chain !== manager.chain || evm.value.to !== manager.address) {
    return err("unknown_call");
  }
  const call = readManagerCall(evm.value.data);
  const move = call === undefined ? undefined : moveOf(call, evm.value.value);
  if (move === undefined) {
    return err("unknown_call");
  }
  const pool = accountRefSchema.parse(`${draft.chain}:${manager.address}`);
  return ok({ ...move, contract: pool, validator: pool, credits: draft.from });
}
