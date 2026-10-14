import type { ChainRef } from "@binference/plugin-sdk";
import type { CurveChainSetup } from "@binference/plugin-sdk/evm";

/** What the venue's curve read, quote, build and decoder share: the chains it trades on. */
export interface VenueParts {
  readonly setups: ReadonlyMap<ChainRef, CurveChainSetup>;
}
