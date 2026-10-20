import { BinferenceError, type LaunchBuild, type LaunchBuildRequest } from "@binference/plugin-sdk";
import { curveAssetOf } from "@binference/plugin-sdk/evm";
import type { LaunchParts } from "./launch-parts.js";
import { checkFirstBuy, launchStepsOf, placeOf } from "./launch-steps.js";
import { findTaxTokenSalt } from "./vanity-salt.js";

/**
 * Builds a Flap launch from the launch wallet: an exact approval of the Portal for a token first
 * buy, then one `newTokenV6` call that names the uploaded metadata's CID and every setting, with a
 * fresh salt found off line so the token's address ends in 7777. The build names that token, at the
 * address the Portal gives it before the call runs. The call takes no minimum for the first buy, as
 * the venue declares (decision 0270), and the Portal takes no launch fee, so a quoted fee other than
 * none throws, as does a launch on a chain or pair Flap does not launch against.
 */
export async function buildLaunch(
  request: LaunchBuildRequest,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<LaunchBuild> {
  signal.throwIfAborted();
  checkFirstBuy(request);
  const placed = placeOf(request, parts);
  const meta = request.metadataUri;
  if (placed === undefined || request.fee.base !== 0n || meta === undefined) {
    throw new BinferenceError({
      code: "flap.no_route",
      message:
        "Flap launches here only on its chains and pairs, with no launch fee, once uploaded.",
    });
  }
  const found = await findTaxTokenSalt(placed.maker, { random: parts.random, signal });
  const written = { meta, salt: found.salt };
  const { token, steps } = launchStepsOf(request, placed, written);
  return { token: curveAssetOf(token, placed.chain.setup), steps };
}
