import {
  type AccountRef,
  type AssetRef,
  accountRefSchema,
  assetRefSchema,
  type BridgeDestination,
  type DecodedDeposit,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { readDepositV3 } from "./deposit-call.js";

const msPerSecond = 1_000;

function accountOn(chain: string, address: Address): AccountRef {
  return accountRefSchema.parse(`${chain}:${address}`);
}

function tokenOn(chain: string, address: Address): AssetRef {
  return assetRefSchema.parse(`${chain}/erc20:${address}`);
}

/**
 * Reads what an Across deposit does from the draft's bytes alone, as a bound deposit (decision
 * 0317): the contract it calls, its depositor, its recipient on the destination chain, the exact
 * input, the delivered token with the least a fill pays, and its fill deadline. Only `depositV3` in the exact form the bridge builds, from the depositor itself,
 * with no native value, an empty message and a destination the bridge serves, decodes; any other
 * call is `unknown_call`.
 */
export function decodeDeposit(
  draft: TxDraft,
  destinations: readonly BridgeDestination[],
): Result<DecodedDeposit, "unknown_call"> {
  const call = decodeEvmDraft(draft);
  const terms = call.ok && call.value.value === 0n ? readDepositV3(call.value.data) : undefined;
  const isOwn = call.ok && terms?.depositor === call.value.from && terms.message === "0x";
  const id = terms?.destinationChainId.toString();
  const destination = destinations.find((item) => item.id === id);
  if (!isOwn || terms === undefined || destination === undefined) {
    return err("unknown_call");
  }
  return ok({
    kind: "bound",
    contract: accountOn(draft.chain, call.value.to),
    depositor: draft.from,
    recipient: accountOn(destination.chain, terms.recipient),
    amountIn: { asset: tokenOn(draft.chain, terms.inputToken), base: terms.inputAmount },
    minOut: { asset: tokenOn(destination.chain, terms.outputToken), base: terms.outputAmount },
    fillDeadlineMs: terms.fillDeadline * msPerSecond,
  });
}
