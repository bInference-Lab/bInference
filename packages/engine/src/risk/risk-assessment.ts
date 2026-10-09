import type { Bps } from "@binference/core";
import type { RiskView } from "@binference/protocol";
import type { RiskReason } from "../intents/intent-reason.js";
import type { TradeQuote } from "../venues/venue-host.js";

/** The agent's limits the risk step holds a token to. */
export interface RiskLimits {
  /** The highest tax a leg of the round trip may take. */
  readonly maxTaxBps: Bps;
  /** The least liquidity, in micro-dollars, a source must know of. */
  readonly liquidityFloorUsdMicros: bigint;
}

/** A trade the venue quoted, and the limits its agent holds the token it buys to. */
export interface RiskSubject {
  readonly quoted: TradeQuote;
  readonly limits: RiskLimits;
}

/** The risk step's answer: the view the intent stores, and the reason it refuses, if it does. */
export interface RiskAssessment {
  readonly view: RiskView;
  readonly refusal?: RiskReason;
}
