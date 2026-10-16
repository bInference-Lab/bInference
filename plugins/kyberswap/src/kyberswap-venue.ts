import { defineVenue, type Venue } from "@binference/plugin-sdk";
import { checkedClientId, createKyberswapApi } from "./api/kyberswap-api.js";
import { chainSetupsOf } from "./chain-setup.js";
import { executorName, routerName } from "./kyberswap-contracts.js";
import type { KyberswapOptions } from "./kyberswap-options.js";
import { buildSwap } from "./router/build-swap.js";
import { decodeSwap } from "./router/decode-swap.js";
import { swapFunctionJson } from "./router/swap-call.js";
import { quoteTrade } from "./routes/quote-trade.js";

/**
 * Creates the `kyberswap` venue: keyless quotes from KyberSwap's aggregator API, built through its
 * MetaAggregationRouterV2. On each chain it declares the router and the AggregationExecutorProxy
 * from the registry; the host gives their addresses with every request. Its trades call the
 * router's `swap` alone, and approve only the router. Quotes drop routes through
 * hooks off the chain's allowlist; builds carry the host's deadline and minimum output; the
 * decoder reads both back from the router call. Bad options are a fault (`kyberswap.bad_options`),
 * as is a client id that turns bad later, at the call that reads it.
 */
export function createKyberswapVenue(options: KyberswapOptions): Venue {
  const setups = chainSetupsOf(options.chains);
  checkedClientId(options.clientId);
  const parts = {
    api: createKyberswapApi({ http: options.http, clientId: options.clientId }),
    setups,
  };
  return defineVenue({
    id: "kyberswap",
    contracts: [...setups.keys()].map((chain) => ({
      chain,
      names: [routerName, executorName],
      calls: [{ contract: routerName, abi: swapFunctionJson, walletInputs: [] }],
      spenders: [routerName],
    })),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildSwap(request, parts, signal),
    decode: (draft) => decodeSwap(draft, setups),
  });
}
