import { isModelPriced } from "@binference/runtime";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CheckFinding } from "./check-finding.js";

// Every model the config names for a role or as a fallback, each once, in the config's order.
function configuredModels(config: BinferenceConfig): readonly string[] {
  const { main, fast, vision, fallbacks } = config.models;
  const named = [main, fast, vision, ...fallbacks.main, ...fallbacks.fast];
  return [...new Set(named.filter((model) => model !== undefined))];
}

/**
 * The finding `models.priced` of `binference check` (runtime spec, section 8.3): a warning that
 * names each configured model whose spend binference cannot know, since its provider reports no
 * cost and neither `models.prices` nor the built-in table prices it. Such a model's calls count $0
 * against the daily model budget.
 */
export function modelPriceFinding(config: BinferenceConfig): CheckFinding {
  const book = { providers: config.models.providers, prices: config.models.prices };
  const unpriced = configuredModels(config).filter((model) => !isModelPriced(model, book));
  if (unpriced.length === 0) {
    return { check: "models.priced", level: "ok" };
  }
  return {
    check: "models.priced",
    level: "warn",
    message: { key: "check.modelsUnpriced", values: { count: unpriced.length } },
    more: unpriced.map((model) => ({ key: "check.modelUnpriced", values: { model } })),
    details: { models: [...unpriced] },
  };
}
