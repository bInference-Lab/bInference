import { BinferenceError, err, ok } from "@binference/core";
import type { AssetRef } from "../caip/asset-ref.js";
import type { TokenRiskSource } from "../risk/ports.js";
import type { TokenRiskReport } from "../risk/risk-report.js";

/** A fake risk source's answers, and whether its service is down. */
export interface FakeRiskSourceOptions {
  readonly id: string;
  /** The report for each token it covers; any other token is `not_covered`. */
  readonly reports: ReadonlyMap<AssetRef, TokenRiskReport>;
  /** Every check rejects with `<id>.unavailable`, as a service that is down. */
  readonly isDown?: boolean;
}

/** A fake risk source that counts the checks it answered. */
export interface FakeRiskSource extends TokenRiskSource {
  /** How many checks reached the source, the refused ones too. */
  checks(): number;
}

/**
 * Creates a risk source for tests: it answers each token from its table, and every check of a
 * source that is down rejects as a service that does not answer.
 */
export function createFakeRiskSource(options: FakeRiskSourceOptions): FakeRiskSource {
  let count = 0;
  return {
    id: options.id,
    async check(asset, { signal }) {
      signal.throwIfAborted();
      count += 1;
      if (options.isDown === true) {
        throw new BinferenceError({
          code: `${options.id}.unavailable`,
          message: `The fake risk source ${options.id} is down.`,
          retryable: true,
        });
      }
      const report = options.reports.get(asset);
      return await Promise.resolve(report === undefined ? err("not_covered") : ok(report));
    },
    checks: () => count,
  };
}
