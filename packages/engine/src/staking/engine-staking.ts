import { accountRefParts } from "@binference/chain";
import type { EngineOptions } from "../operations/create-engine.js";
import { createPositions } from "../positions/create-positions.js";
import { createStakingHost } from "../venues/staking-host.js";
import { tellClaimsReady } from "./tell-claims-ready.js";
import type { UnbondingRecord } from "./unbonding-record.js";
import { type LiquidReads, watchLiquidParts } from "./watch-liquid-parts.js";

/** The engine's work on unstaked coin, which the composition root runs on a timer. */
export interface StakeWork {
  /**
   * Tells the owner once of each unstake's coin a claim can take now, as `notice.claimReady`
   * (decision 0327), and closes a liquid venue's live part its venue no longer lists, claimed
   * outside binference, as `notice.claimedElsewhere` (decision 0331). Answers how many parts it
   * told of or closed. A timer of the composition root calls it every minute, locked or not: it
   * reads, books what was claimed outside, and tells.
   */
  readonly tellClaimsReady: (options: { readonly signal: AbortSignal }) => Promise<number>;
}

/**
 * The engine's teller of unstaked coin ready to claim, over its stores, with the watch of each
 * liquid venue's queue (decision 0331), which keeps when it read each holding last.
 */
export function stakeWorkOf(
  options: Pick<
    EngineOptions,
    "stores" | "publish" | "clock" | "custody" | "chains" | "stakingVenues" | "positions" | "prices"
  >,
): StakeWork {
  const { stores, publish, clock, custody, chains } = options;
  const staking = createStakingHost({ venues: options.stakingVenues ?? [], chains, clock });
  const isWatched = (row: UnbondingRecord) => {
    const chain = row.validator === undefined ? undefined : accountRefParts(row.validator).chain;
    const venue = chain === undefined ? undefined : staking.venueOn(row.venue, chain);
    return !row.isPaper && venue?.pool !== undefined;
  };
  const parts = {
    unbondings: stores.unbondings,
    install: stores.install,
    publish,
    clock,
    isWatched,
  };
  const positions = createPositions({ store: options.positions, prices: options.prices });
  const watch = { ...parts, intents: stores.intents, positions, staking, custody };
  const reads: LiquidReads = new Map();
  return {
    tellClaimsReady: async (call) => {
      const told = await tellClaimsReady(parts, call);
      const watched = await watchLiquidParts(watch, reads, call);
      return told + watched.told + watched.closed;
    },
  };
}
