import { createInstallQuotas, type InstallQuotas } from "../quotas/install-quotas.js";
import { noQuotas } from "../quotas/no-quotas.js";
import type { EngineOptions } from "./create-engine.js";

/**
 * The install's quota checks (decision 0431) over the options' quota source, which holds none
 * when absent, and the stores the rates count: the intents and the model calls.
 */
export function installQuotasOf(
  options: Pick<EngineOptions, "quotas" | "stores" | "clock">,
): InstallQuotas {
  const { stores, clock } = options;
  const source = options.quotas ?? noQuotas;
  return createInstallQuotas({ source, intents: stores.intents, usage: stores.modelUsage, clock });
}
