import {
  accountRefSchema,
  type DecodedEffect,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveAssetOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { zeroAddress } from "viem";
import { type CurveTradeCall, tradeCallOf } from "../contracts/genius-calls.js";
import type { LaunchFacts, VenueParts } from "../venue-parts.js";

// The coin a curve call must send: a buy's whole input on a curve that trades against the coin,
// else none.
function valueOf(trade: CurveTradeCall, launch: LaunchFacts): bigint {
  return trade.side === "buy" && launch.pairToken === zeroAddress ? trade.amountIn : 0n;
}

/**
 * Reads what a Genius.fun curve call does from the draft's bytes: the recipient, the exact input
 * and the minimum out are the call's own, and the assets are those of the launch whose curve the
 * call goes to, as the venue read them on that launch's stack factory when it quoted or built. A
 * buy sends the coin as its value only for a curve that trades against the coin, and exactly its
 * input; a sale sends none. The call carries no deadline. A draft on a chain the venue does not
 * trade on, to a curve it never read, or a call that is no plain `buy` or `sell`, is
 * `unknown_call`.
 */
export function decodeTrade(
  draft: TxDraft,
  parts: VenueParts,
): Result<DecodedEffect, "unknown_call"> {
  const setup = parts.setups.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const launch = call.ok ? parts.launches.get(call.value.to) : undefined;
  const trade = call.ok ? tradeCallOf(call.value.data) : undefined;
  if (setup === undefined || !call.ok || launch === undefined || trade === undefined) {
    return err("unknown_call");
  }
  if (call.value.value !== valueOf(trade, launch)) {
    return err("unknown_call");
  }
  const [input, output] =
    trade.side === "buy" ? [launch.pairToken, launch.token] : [launch.token, launch.pairToken];
  return ok({
    recipient: accountRefSchema.parse(`${setup.chain}:${trade.recipient}`),
    amountIn: { asset: curveAssetOf(input, setup), base: trade.amountIn },
    minOut: { asset: curveAssetOf(output, setup), base: trade.minOut },
  });
}
