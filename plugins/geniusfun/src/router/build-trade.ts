import {
  accountRefParts,
  BinferenceError,
  type BuildRequest,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveSideOf, encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { zeroAddress } from "viem";
import { tradeCallData } from "../contracts/genius-calls.js";
import { addressOf, curveAccountOf, factoriesOf } from "../geniusfun-contracts.js";
import { findLaunch } from "../launch/find-launch.js";
import type { VenueParts } from "../venue-parts.js";

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "geniusfun.no_route", message });
}

/**
 * Builds a quoted trade on a Genius.fun curve: one `buy` or `sell` call to the curve of the
 * token's launch, which the host gave (decision 0212), spending exactly the request's input,
 * paying the request's wallet, and reverting below the host's minimum out. It carries no
 * deadline; the venue declares so. The coin travels as a buy's value; a token input, a sale's
 * tokens or a buy's quote token, first gets an exact approval of the curve. The token's launch is
 * read again from the stacks' factories, and a curve that is not the token's own, or a trade the
 * curve does not take, throws.
 */
export async function buildTrade(
  request: BuildRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<readonly TxDraft[]> {
  signal.throwIfAborted();
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  const side = setup === undefined ? undefined : curveSideOf(request, setup);
  if (setup === undefined || side === undefined) {
    throw refuse("Genius.fun does not trade this pair on the wallet's chain.");
  }
  const curveAccount = curveAccountOf(request.contracts);
  const curve = addressOf(curveAccount);
  const read = { rpc: setup.rpc, signal };
  const finding = await findLaunch(read, factoriesOf(request.contracts), side.token);
  const launch = finding.kind === "launched" ? finding.launch : undefined;
  if (launch === undefined || launch.curve !== curve || launch.pairToken !== side.quote) {
    throw refuse("the token's own curve does not trade this pair.");
  }
  parts.launches.set(curve, { token: side.token, pairToken: side.quote });
  const amountIn = request.amountIn.base;
  const call = {
    side: side.side,
    amountIn,
    minOut: request.minOut.base,
    recipient: addressOf(request.wallet),
  };
  const isCoinIn = side.inputToken === zeroAddress;
  const trade = encodeEvmDraft({
    from: request.wallet,
    to: curveAccount,
    value: isCoinIn ? amountIn : 0n,
    data: tradeCallData(call),
  });
  if (isCoinIn) {
    return [trade];
  }
  const approval = encodeEvmApproval({
    wallet: request.wallet,
    token: side.inputToken,
    spender: curve,
    amountBase: amountIn,
  });
  return [approval, trade];
}
