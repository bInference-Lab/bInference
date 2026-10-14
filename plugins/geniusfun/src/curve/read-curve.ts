import { accountRefSchema, type CurveHolding, type CurveRequest } from "@binference/plugin-sdk";
import { curveAssetOf } from "@binference/plugin-sdk/evm";
import { curveName } from "../geniusfun-contracts.js";
import { standingOf } from "../launch/token-standing.js";
import type { VenueParts } from "../venue-parts.js";

/**
 * Whether Genius.fun holds a token on a curve now, read from every live stack's factory at the
 * latest block. A token on its launch's curve, not graduated and still selling tokens, names the
 * asset its curve trades against and its curve as the launch's contract (decision 0212), so its
 * trades go there alone. A token whose launch is graduating (its curve ready to graduate, or
 * swept, and its pool not made yet), or one a stack the registry does not list says it launched,
 * is held too, against what its launch names, with no contract: its trades go nowhere, never to
 * the pools (decision 0179). A token never launched, or whose launch has its pool or was rescued,
 * is off its curve, so the pools take over; so is an asset that is no ERC-20 token of a chain the
 * venue trades on. A contract that cannot be read throws.
 */
export async function readCurve(
  request: CurveRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<CurveHolding> {
  const standing = await standingOf(request, parts, signal);
  if (standing.kind === "off_curve") {
    return { onCurve: false };
  }
  if (standing.kind === "held") {
    return { onCurve: true, quoteAsset: curveAssetOf(standing.pairToken, standing.setup) };
  }
  const { setup, launch } = standing;
  const curve = accountRefSchema.parse(`${setup.chain}:${launch.curve}`);
  const quoteAsset = curveAssetOf(launch.pairToken, setup);
  return { onCurve: true, quoteAsset, launch: { [curveName]: curve } };
}
