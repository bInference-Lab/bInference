import type { AssetRef } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { ReadDecimals } from "./token-decimals.js";

/** The decimals of the watched tokens, each read once while it is watched. */
export interface DecimalsBook {
  readonly known: ReadonlyMap<AssetRef, number>;
  /**
   * Reads the decimals of the tokens it lacks, and forgets those of any other token. A token whose
   * decimals could not be read is asked again 10 minutes later, not every round. Rejects when no
   * endpoint answers, and with the signal's reason once it aborts.
   */
  read(tokens: readonly AssetRef[], signal: AbortSignal): Promise<void>;
}

const retryMs = 600_000;

/** Creates an empty {@link DecimalsBook} over a decimals reader. */
export function decimalsBookOf(readDecimals: ReadDecimals, clock: Clock): DecimalsBook {
  const known = new Map<AssetRef, number>();
  const missedAtMs = new Map<AssetRef, number>();
  return {
    known,
    async read(tokens, signal) {
      const wanted = new Set(tokens);
      for (const book of [known, missedAtMs]) {
        [...book.keys()]
          .filter((token) => !wanted.has(token))
          .forEach((token) => book.delete(token));
      }
      const nowMs = clock.now();
      const unknown = tokens.filter(
        (token) => !known.has(token) && nowMs - (missedAtMs.get(token) ?? -retryMs) >= retryMs,
      );
      if (unknown.length === 0) {
        return;
      }
      const read = await readDecimals(unknown, signal);
      for (const token of unknown) {
        const value = read.get(token);
        if (value === undefined) {
          missedAtMs.set(token, nowMs);
        } else {
          known.set(token, value);
          missedAtMs.delete(token);
        }
      }
    },
  };
}
