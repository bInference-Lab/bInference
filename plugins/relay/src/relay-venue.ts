import {
  BinferenceError,
  type ChainRef,
  defineVenue,
  err,
  type Venue,
} from "@binference/plugin-sdk";
import { relayDeclaration } from "./relay-bridge.js";

/**
 * Creates the `relay` venue on the source chains given (decision 0307): Relay's declaration, so the
 * venue host, the limits and the bridge wallet's ceiling know its deposits as a bridge wallet's
 * alone. It trades nothing: selling one token for another through Relay is a trade, never a bridge
 * (decision 0301), so its quote is `no_route`, its build throws `relay.no_trade` and its decoder
 * answers every draft `unknown_call`. Bridges go through `createRelayBridge`.
 */
export function createRelayVenue(chains: readonly ChainRef[]): Venue {
  return defineVenue({
    ...relayDeclaration(chains),
    quote: async (_request, { signal }) => {
      signal.throwIfAborted();
      return Promise.resolve(err("no_route"));
    },
    build: async () =>
      Promise.reject(
        new BinferenceError({
          code: "relay.no_trade",
          message: "Relay trades nothing in binference; it only bridges from a bridge wallet.",
        }),
      ),
    decode: () => err("unknown_call"),
  });
}
