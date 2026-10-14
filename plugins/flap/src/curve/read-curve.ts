import type { CurveHolding, CurveRequest } from "@binference/plugin-sdk";
import { curveAssetOf, curveTokenOn } from "@binference/plugin-sdk/evm";
import { portalOf } from "../flap-assets.js";
import { readTokenState } from "../portal/read-portal.js";
import { tokenStatus } from "../portal/token-state.js";
import type { VenueParts } from "../venue-parts.js";

const offCurve: CurveHolding = { onCurve: false };

/**
 * Whether Flap holds a token on its curve now, read from the Portal at the latest block. A token
 * Flap never launched, or one that graduated to a pool, is off its curve, and so is any asset that
 * is no ERC-20 token of a chain the venue trades on. A token in any other state is Flap's: it names
 * the asset its curve trades against, and the quote refuses it unless it is tradable on the curve,
 * so it never goes to the pools. A Portal that cannot be read throws.
 */
export async function readCurve(
  request: CurveRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<CurveHolding> {
  signal.throwIfAborted();
  const held = curveTokenOn(request.token, parts.setups);
  if (held === undefined) {
    return offCurve;
  }
  const { setup, token } = held;
  const read = { rpc: setup.rpc, portal: portalOf(request.contracts), signal };
  const state = await readTokenState(read, token);
  if (state === undefined || state.status === tokenStatus.invalid) {
    return offCurve;
  }
  return state.status === tokenStatus.dex
    ? offCurve
    : { onCurve: true, quoteAsset: curveAssetOf(state.quoteToken, setup) };
}
