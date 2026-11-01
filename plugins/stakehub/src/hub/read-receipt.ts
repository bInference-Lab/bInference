import { type AssetRef, assetRefSchema, err, ok, type Result } from "@binference/plugin-sdk";
import { type Address, zeroAddress } from "viem";
import { creditRead } from "./hub-calls.js";
import { readEach, required } from "./hub-read.js";
import type { OptionsRead } from "./read-options.js";

/**
 * The validator's credit shares as an asset of the chain, the receipt token every stake with it
 * mints, read at the read's block; `validator_unknown` when StakeHub lists no credit contract for
 * it.
 */
export async function readReceipt(
  at: OptionsRead,
  validator: Address,
): Promise<Result<AssetRef, "validator_unknown">> {
  const [credit] = await readEach(at, [creditRead(at.hub, validator)]);
  const contract = required(credit, "getValidatorCreditContract");
  return contract === zeroAddress
    ? err("validator_unknown")
    : ok(assetRefSchema.parse(`${at.chain}/erc20:${contract}`));
}
