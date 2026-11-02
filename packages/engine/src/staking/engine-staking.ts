import type { EngineOptions } from "../operations/create-engine.js";
import { createStakingHost } from "../venues/staking-host.js";
import { isReleased } from "./released-parts.js";
import { tellClaimsReady } from "./tell-claims-ready.js";
import type { UnbondingRecord } from "./unbonding-record.js";

/** The engine's work on unstaked coin, which the composition root runs on a timer. */
export interface StakeWork {
  /**
   * Tells the owner once of each unstake's coin a claim can take now, as `notice.claimReady`
   * (decision 0327), and answers how many it told of. A timer of the composition root calls it
   * every minute, locked or not: it only reads and tells.
   */
  readonly tellClaimsReady: (options: { readonly signal: AbortSignal }) => Promise<number>;
}

/**
 * The engine's teller of unstaked coin ready to claim, over its stores, which asks a liquid
 * venue whether its queue released a live part (decision 0331).
 */
export function stakeWorkOf(
  options: Pick<
    EngineOptions,
    "stores" | "publish" | "clock" | "custody" | "chains" | "stakingVenues"
  >,
): StakeWork {
  const { stores, publish, clock, custody, chains } = options;
  const staking = createStakingHost({ venues: options.stakingVenues ?? [], chains, clock });
  const release = { staking, custody, clock };
  const parts = {
    unbondings: stores.unbondings,
    install: stores.install,
    publish,
    clock,
    isReleased: async (row: UnbondingRecord, call: { readonly signal: AbortSignal }) =>
      isReleased(release, row, call),
  };
  return { tellClaimsReady: async (call) => tellClaimsReady(parts, call) };
}
