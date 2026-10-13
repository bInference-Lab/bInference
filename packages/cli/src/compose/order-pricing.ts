import type { CliHost } from "../program/cli-host.js";
import type { Closers } from "./closers.js";
import type { ComposeEngineOptions } from "./compose-engine.js";
import type { PriceTriggerLink } from "./price-triggers.js";

/**
 * What prices a price order's token: the price watchers, or a test host's orders, which alone
 * turn live fills on (decision 0210).
 */
export function pricingOf(
  host: CliHost,
  canPrice: ComposeEngineOptions["canPrice"],
): Pick<ComposeEngineOptions, "canPrice"> & { readonly liveOrderFills?: true } {
  const { testOrders } = host;
  return testOrders === undefined
    ? { canPrice }
    : {
        canPrice: async (token) => Promise.resolve(testOrders.canPrice(token)),
        liveOrderFills: true,
      };
}

/**
 * Hands a test host's prices to the price triggers from here on, as the price watchers' prices
 * would go, and stops them with the shutdown; nothing without test orders.
 */
export function startTestOrders(
  opening: { readonly host: CliHost; readonly closers: Closers },
  triggers: PriceTriggerLink,
): void {
  const { testOrders } = opening.host;
  if (testOrders === undefined) {
    return;
  }
  const stop = testOrders.start(async (price, call) =>
    triggers.see === undefined ? [] : triggers.see(price, call),
  );
  opening.closers.add("test_orders", async () => {
    stop();
    return Promise.resolve();
  });
}
