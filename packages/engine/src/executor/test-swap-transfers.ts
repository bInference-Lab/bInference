import {
  type AccountRef,
  type AssetTransfer,
  accountRefParts,
  assetRefSchema,
  printAccountRef,
} from "@binference/chain";
import type { FakeSent } from "@binference/chain/testing";

/**
 * What a fake swap call moved once a block holds it: the input from the wallet to the router, and
 * `out` of the output from the router back to the wallet. Any other call moved nothing.
 */
export function swapTransfers(
  sent: FakeSent,
  out: (amountInBase: bigint) => bigint,
): readonly AssetTransfer[] {
  const [to = "", , data = ""] = sent.draftPayload.split("|");
  const [kind, , inBase = "0", inAsset = "", , outAsset = ""] = data.split(",");
  if (kind !== "swap") {
    return [];
  }
  const printed = printAccountRef({ chain: accountRefParts(sent.account).chain, address: to });
  if (!printed.ok) {
    return [];
  }
  const router: AccountRef = printed.value;
  const amountIn = { asset: assetRefSchema.parse(inAsset), base: BigInt(inBase) };
  const amountOut = { asset: assetRefSchema.parse(outAsset), base: out(amountIn.base) };
  return [
    { from: sent.account, to: router, amount: amountIn },
    { from: router, to: sent.account, amount: amountOut },
  ];
}
