import type { AssetRef, ChainRegistry } from "@binference/chain";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { assetInfoOf } from "./asset-infos.js";

/**
 * The risk step with no risk source to ask: a trade whose every asset the chain registry lists
 * passes as verified, and any other asset is blocked as `sources_down`, since an unknown token
 * fails closed when no source can answer for it (ARCHITECTURE.md section 7).
 */
export function registryRisk(
  chains: ChainRegistry,
  assets: readonly AssetRef[],
): IntentTrigger<"risk_passed" | "risk_refused"> {
  return assets.every((asset) => assetInfoOf(chains, asset) !== undefined)
    ? { type: "risk_passed" }
    : { type: "risk_refused", reason: "sources_down" };
}
