import type { EngineOptions } from "../operations/create-engine.js";
import { tellClaimsReady } from "./tell-claims-ready.js";

/** The engine's work on unstaked coin, which the composition root runs on a timer. */
export interface StakeWork {
  /**
   * Tells the owner once of each unstake's coin a claim can take now, as `notice.claimReady`
   * (decision 0327), and answers how many it told of. A timer of the composition root calls it
   * every minute, locked or not: it only reads and tells.
   */
  readonly tellClaimsReady: (options: { readonly signal: AbortSignal }) => Promise<number>;
}

/** The engine's teller of unstaked coin ready to claim, over its stores. */
export function stakeWorkOf(
  options: Pick<EngineOptions, "stores" | "publish" | "clock">,
): StakeWork {
  const { stores, publish, clock } = options;
  const parts = { unbondings: stores.unbondings, install: stores.install, publish, clock };
  return { tellClaimsReady: async (call) => tellClaimsReady(parts, call) };
}
