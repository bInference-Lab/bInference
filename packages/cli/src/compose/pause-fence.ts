import type { ChainRef } from "@binference/chain";
import type { WatchedPrice } from "@binference/chain-evm";
import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { ChainWatch } from "./chain-watch.js";

/** Reads a chain's newest block number now, through the chain's RPCs, within its own timeout. */
export type ReadHead = (chain: ChainRef, signal: AbortSignal) => Promise<bigint>;

/** What the fence reads with and runs on. */
export interface PauseFenceParts {
  readonly watches: ReadonlyMap<ChainRef, ChainWatch>;
  readonly readHead: ReadHead;
  readonly clock: Clock;
  /**
   * Whether the engine finds a pause now: the downtime timer's check, which the composition root
   * sets once the timer runs. A price that finds one is dropped.
   */
  readonly pauses: { check?: () => boolean };
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

/**
 * The price hand-off's fence of what a pause of the engine left behind (decision 0268): prices
 * whose read was asked before the pause, and blocks the chain made before it.
 */
export interface PauseFence {
  /** Whether a price may go on to the triggers. */
  passes(watch: ChainWatch, price: WatchedPrice): boolean;
  /**
   * After a pause: drops every price of each chain until a head read after the pause answers,
   * then every price of a block below that head.
   */
  afterPause(): void;
}

// A read answered this long after it was asked spanned a pause: a sleep of the machine stops the
// read's own timeout, never the wall clock.
const maxReadAgeMs = 60_000;
// A head read that failed is asked again after this long.
const headRetryMs = 2_000;

// The chain's fence now: waiting for its head, or the head prices must reach.
type ChainFence = { readonly kind: "waiting" } | { readonly kind: "head"; readonly head: bigint };

/** Creates the {@link PauseFence}; a chain holds no fence until the first pause. */
export function createPauseFence(parts: PauseFenceParts): PauseFence {
  const fences = new Map<ChainRef, ChainFence>();
  const rounds = { last: 0 };
  // Asks the chain's head until one answers, unless a later pause began meanwhile.
  const headAfter = async (chain: ChainRef, round: number): Promise<void> => {
    while (
      !parts.signal.aborted &&
      fences.get(chain)?.kind === "waiting" &&
      rounds.last === round
    ) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one head read at a time, until one answers
        const head = await parts.readHead(chain, parts.signal);
        if (rounds.last === round) {
          fences.set(chain, { kind: "head", head });
        }
        return;
      } catch (error) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        parts.logger.warn("watcher.head_failed", { chain, errorCode });
        // oxlint-disable-next-line eslint/no-await-in-loop -- the next try waits its turn
        await parts.clock.sleep(headRetryMs, parts.signal).catch(() => undefined);
      }
    }
  };
  return {
    passes(watch, price) {
      if (parts.pauses.check?.() === true) {
        return false;
      }
      const ageMs = parts.clock.now() - price.askedAtMs;
      if (ageMs < 0 || ageMs > maxReadAgeMs) {
        return false;
      }
      const fence = fences.get(watch.chain.ref);
      return fence === undefined || (fence.kind === "head" && price.block >= fence.head);
    },
    afterPause() {
      rounds.last += 1;
      const round = rounds.last;
      for (const chain of parts.watches.keys()) {
        fences.set(chain, { kind: "waiting" });
        void headAfter(chain, round);
      }
    },
  };
}
