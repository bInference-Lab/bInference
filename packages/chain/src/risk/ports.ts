import type { Result } from "@binference/core";
import type { AssetRef } from "../caip/asset-ref.js";
import type { TokenRiskReport } from "./risk-report.js";

/**
 * A data service that reports on a token's risk before the agent buys it (ARCHITECTURE.md section
 * 7, step 4), such as GoPlus or honeypot.is. It reads; it never moves funds. Adapters: the
 * `goplus` and `honeypot` plugins.
 */
export interface TokenRiskSource {
  /** The source's id, which the engine stores with each finding, such as `goplus`. */
  readonly id: string;
  /**
   * What the source reports about the token. A token or chain the source has no answer for is
   * `not_covered`. A service that is down, refuses the request or answers outside its documented
   * shape rejects with a `BinferenceError`, and with the signal's reason once the signal aborts.
   */
  check(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<TokenRiskReport, "not_covered">>;
}
