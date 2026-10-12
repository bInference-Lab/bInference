import { defineLaunchpad, type LaunchpadVenue } from "@binference/plugin-sdk";
import { chainSetupsOf } from "./chain-setup.js";
import { readCurve } from "./curve/read-curve.js";
import { portalName } from "./flap-assets.js";
import type { FlapOptions } from "./flap-options.js";
import { swapFunctionJson } from "./portal/portal-calls.js";
import { quoteTrade } from "./quote/quote-trade.js";
import { buildSwap } from "./router/build-swap.js";
import { decodeSwap } from "./router/decode-swap.js";

/**
 * Creates the `flap` launchpad: buys and sells of the tokens on Flap's bonding curves, quoted and
 * read through Flap's Portal by `eth_call` on each chain's RPC failover. On each chain it declares
 * the registry's Portal: its trades call the Portal's `swapExactInput` alone, which pays the
 * calling wallet and takes no deadline, so the chain declares `noDeadline`, and an approval names
 * only the Portal. Its curve read says which tokens Flap holds, and its quotes name the tax the
 * Portal takes on the curve. Bad options are a fault (`flap.bad_options`).
 */
export function createFlapVenue(options: FlapOptions): LaunchpadVenue {
  const parts = { setups: chainSetupsOf(options.chains) };
  return defineLaunchpad({
    id: "flap",
    contracts: [...parts.setups.keys()].map((chain) => ({
      chain,
      names: [portalName],
      calls: [{ contract: portalName, abi: swapFunctionJson, walletInputs: [] }],
      spenders: [portalName],
      noDeadline: true,
    })),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildSwap(request, parts, signal),
    decode: (draft) => decodeSwap(draft, parts),
    curve: async (request, { signal }) => readCurve(request, parts, signal),
  });
}
