import { defineVenue, type Venue, type VenueDeclaration } from "@binference/plugin-sdk";
import { checkedKeys, createOkxApi } from "./api/okx-api.js";
import { chainSetupsOf } from "./chain-setup.js";
import { approverName, routerName } from "./okx-contracts.js";
import type { OkxChain, OkxOptions } from "./okx-options.js";
import { buildSwap } from "./router/build-swap.js";
import { dagSwapByOrderIdJson, dagSwapToJson } from "./router/dag-call.js";
import { decodeSwap } from "./router/decode-swap.js";
import { quoteTrade } from "./routes/quote-trade.js";

/**
 * What the `okx` venue declares on the chains it is given: its id, and OKX's DEX router and
 * TokenApprove by their registry names. Its trades call the router's two DAG swaps, `dagSwapTo`
 * only with the wallet as its receiver, and approve only TokenApprove. It needs no key, so the composition root can list the
 * venue's contracts, such as for a wallet's ceiling, before it reads one. Bad chains are a fault
 * (`okx.bad_options`).
 */
export function okxDeclaration(chains: readonly OkxChain[]): VenueDeclaration {
  const setups = chainSetupsOf(chains);
  return {
    id: "okx",
    contracts: [...setups.keys()].map((chain) => ({
      chain,
      names: [routerName, approverName],
      calls: [
        { contract: routerName, abi: dagSwapByOrderIdJson, walletInputs: [] },
        { contract: routerName, abi: dagSwapToJson, walletInputs: ["receiver"] },
      ],
      spenders: [approverName],
    })),
  };
}

/**
 * Creates the `okx` venue: quotes from OKX's DEX aggregator API, signed with the owner's key, and
 * trades through OKX's DEX router. On each chain it declares the router and OKX's TokenApprove
 * from the registry; the host gives their addresses with every request. Quotes drop routes
 * through protocols whose pools run hooks; builds carry the host's minimum output and deadline;
 * the decoder reads both back from the router call. Bad options, an empty key part among them, are
 * a fault (`okx.bad_options`). Each request signs with the key as it stands when the request
 * starts; with no key, making the venue or a request is refused with `okx.no_key`.
 */
export function createOkxVenue(options: OkxOptions): Venue {
  const setups = chainSetupsOf(options.chains);
  const { http, clock } = options;
  // The venue is made only on the owner's key; a key that goes later stops the next request.
  checkedKeys(options.keys);
  const parts = { api: createOkxApi({ http, clock, keys: options.keys }), setups };
  return defineVenue({
    ...okxDeclaration(options.chains),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildSwap(request, parts, signal),
    decode: (draft) => decodeSwap(draft, setups),
  });
}
