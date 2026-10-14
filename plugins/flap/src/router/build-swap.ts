import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type BuildRequest,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveTokenOf, encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { zeroAddress } from "viem";
import { portalOf } from "../flap-assets.js";
import type { VenueParts } from "../venue-parts.js";
import { encodeSwap } from "./swap-call.js";

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "flap.no_route", message });
}

/**
 * Builds a quoted trade on a Flap curve: one `swapExactInput` call to the registry's Portal that
 * spends exactly the request's input, pays the wallet that calls it, and reverts below the host's
 * minimum out. It carries no deadline; the venue declares so. A coin input travels as the call's
 * value; a token input first gets an exact approval of the Portal. A wallet on a chain the venue
 * does not trade on, or an asset the Portal cannot name, throws.
 */
export async function buildSwap(
  request: BuildRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<readonly TxDraft[]> {
  signal.throwIfAborted();
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  const inputToken = setup === undefined ? undefined : curveTokenOf(request.amountIn.asset, setup);
  const outputToken = setup === undefined ? undefined : curveTokenOf(request.assetOut, setup);
  if (setup === undefined || inputToken === undefined || outputToken === undefined) {
    throw refuse("Flap does not trade this pair on the wallet's chain here.");
  }
  const portal = portalOf(request.contracts);
  const inputAmount = request.amountIn.base;
  const trade = encodeEvmDraft({
    from: request.wallet,
    to: accountRefSchema.parse(`${setup.chain}:${portal}`),
    value: inputToken === zeroAddress ? inputAmount : 0n,
    data: encodeSwap({
      inputToken,
      outputToken,
      inputAmount,
      minOutputAmount: request.minOut.base,
    }),
  });
  return await Promise.resolve(
    inputToken === zeroAddress
      ? [trade]
      : [
          encodeEvmApproval({
            wallet: request.wallet,
            token: inputToken,
            spender: portal,
            amountBase: inputAmount,
          }),
          trade,
        ],
  );
}
