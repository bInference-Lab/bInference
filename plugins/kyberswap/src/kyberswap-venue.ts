import { BinferenceError, defineVenue, type Venue } from "@binference/plugin-sdk";
import { createKyberswapApi } from "./api/kyberswap-api.js";
import { chainSetupsOf } from "./chain-setup.js";
import { executorName, routerName } from "./kyberswap-contracts.js";
import type { KyberswapOptions } from "./kyberswap-options.js";
import { buildSwap } from "./router/build-swap.js";
import { decodeSwap } from "./router/decode-swap.js";
import { quoteTrade } from "./routes/quote-trade.js";

// A header value: letters, digits, dots, dashes and underscores.
const clientIdPattern = /^[\w.-]{1,64}$/;

function clientIdOf(options: KyberswapOptions): string {
  if (!clientIdPattern.test(options.clientId)) {
    throw new BinferenceError({
      code: "kyberswap.bad_options",
      message: "KyberSwap's client id is 1 to 64 letters, digits, dots, dashes or underscores.",
    });
  }
  return options.clientId;
}

/**
 * Creates the `kyberswap` venue: keyless quotes from KyberSwap's aggregator API, built through its
 * MetaAggregationRouterV2. On each chain it declares the router and the AggregationExecutorProxy
 * from the registry; the host gives their addresses with every request. Quotes drop routes through
 * hooks off the chain's allowlist; builds carry the host's deadline and minimum output; the
 * decoder reads both back from the router call. Bad options are a fault (`kyberswap.bad_options`).
 */
export function createKyberswapVenue(options: KyberswapOptions): Venue {
  const setups = chainSetupsOf(options.chains);
  const parts = {
    api: createKyberswapApi({ http: options.http, clientId: clientIdOf(options) }),
    setups,
  };
  return defineVenue({
    id: "kyberswap",
    contracts: [...setups.keys()].map((chain) => ({ chain, names: [routerName, executorName] })),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildSwap(request, parts, signal),
    decode: (draft) => decodeSwap(draft, setups),
  });
}
