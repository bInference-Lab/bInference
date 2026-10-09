import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { RiskReason } from "../intents/intent-reason.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { RiskCheck } from "../ports.js";

/** What a fake risk check knows: the registry, the time, and how it refuses other tokens. */
export interface FakeRiskCheckOptions {
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** The reason it refuses a token the registry does not list: `sources_down` when absent. */
  readonly refusal?: RiskReason;
}

/**
 * Creates a risk check for tests with no risk source to ask: a trade that buys a token the
 * registry lists passes, and any other is refused, as an unknown token fails closed when no
 * source can answer for it.
 */
export function createFakeRiskCheck(options: FakeRiskCheckOptions): RiskCheck {
  const { chains, clock, refusal = "sources_down" } = options;
  return {
    async assess({ quoted }, { signal }) {
      signal.throwIfAborted();
      const checkedAt = clock.now();
      const isListed = assetInfoOf(chains, quoted.trade.assetOut) !== undefined;
      return await Promise.resolve(
        isListed
          ? { view: { verdict: "pass", flags: [], onCurve: false, checkedAt } }
          : { view: { verdict: "block", flags: [], onCurve: false, checkedAt }, refusal },
      );
    },
  };
}
