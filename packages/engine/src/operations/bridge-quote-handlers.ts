import { type BridgeQuoteOptions, quoteBridge } from "../bridges/quote-bridge.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler of `bridge/quote` (protocol spec, section 7.3). */
export interface BridgeQuoteHandlers {
  readonly "bridge/quote": EngineHandler<"bridge/quote">;
}

/**
 * Creates the `bridge/quote` handler: every route the agent's wallet may take for the bridge,
 * quoted and held to a proposal's checks, the best least output first, storing nothing (see
 * {@link quoteBridge}).
 */
export function createBridgeQuoteHandlers(options: BridgeQuoteOptions): BridgeQuoteHandlers {
  return {
    "bridge/quote": async ({ args, signal }) => quoteBridge(options, args, { signal }),
  };
}
