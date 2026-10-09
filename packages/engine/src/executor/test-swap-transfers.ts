import {
  type AccountRef,
  type AssetRef,
  type AssetTransfer,
  accountRefParts,
  assetRefSchema,
  printAccountRef,
} from "@binference/chain";
import type { FakeSent } from "@binference/chain/testing";
import { testCoin } from "../intents/test-intents.js";

/** A fake swap call read back: its router, what went in, and the asset that came out. */
interface FakeSwap {
  readonly router: AccountRef;
  readonly amountIn: { readonly asset: AssetRef; readonly base: bigint };
  readonly outAsset: AssetRef;
}

function swapOf(sent: FakeSent): FakeSwap | undefined {
  const [to = "", , data = ""] = sent.draftPayload.split("|");
  const [kind, , inBase = "0", inAsset = "", , outAsset = ""] = data.split(",");
  const router = printAccountRef({ chain: accountRefParts(sent.account).chain, address: to });
  if (kind !== "swap" || !router.ok) {
    return undefined;
  }
  const amountIn = { asset: assetRefSchema.parse(inAsset), base: BigInt(inBase) };
  return { router: router.value, amountIn, outAsset: assetRefSchema.parse(outAsset) };
}

// The fake chain's coin, which an inner call pays without a log, as a chain's native coin.
function isCoin(asset: AssetRef): boolean {
  return asset === testCoin;
}

/**
 * What a fake swap call moved once a block holds it, as an EVM chain's logs and value show it:
 * the input from the wallet to the router, and `out` of a token from the router back to the
 * wallet. The coin an inner call pays the wallet leaves no log: `swapCoinReceived` says it.
 */
export function swapTransfers(
  sent: FakeSent,
  out: (amountInBase: bigint) => bigint,
): readonly AssetTransfer[] {
  const swap = swapOf(sent);
  if (swap === undefined) {
    return [];
  }
  const { router, amountIn, outAsset } = swap;
  const paid = { from: sent.account, to: router, amount: amountIn };
  const amountOut = { asset: outAsset, base: out(amountIn.base) };
  return isCoin(outAsset) ? [paid] : [paid, { from: router, to: sent.account, amount: amountOut }];
}

/** The coin a fake swap call's inner call paid the wallet: `out` of the input on a sale for it. */
export function swapCoinReceived(sent: FakeSent, out: (amountInBase: bigint) => bigint): bigint {
  const swap = swapOf(sent);
  return swap !== undefined && isCoin(swap.outAsset) ? out(swap.amountIn.base) : 0n;
}
