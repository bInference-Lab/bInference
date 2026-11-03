import { BinferenceError, type Random } from "@binference/core";
import type { OrderParts } from "../orders/create-order.js";
import {
  createWebhookRuleHandlers,
  type WebhookRuleHandlers,
} from "../webhooks/webhook-rule-handlers.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";
import type { EngineOptions } from "./create-engine.js";

// The loopback listener's address at its default port, for an engine its composition root gave no
// webhook address.
const loopbackWebhookBase = "http://127.0.0.1:7457";

// An engine with no secure generator makes no rule secret: it fails closed, before any write.
const noSecrets: Random = {
  bytes: () => {
    throw new BinferenceError({
      code: "engine.no_secret_source",
      message: "This engine was started without a secure generator for webhook rule secrets.",
    });
  },
};

// What the webhook rule use cases read and write through, from the engine's options.
function webhookRulePartsOf(options: EngineOptions, orders: OrderParts): WebhookRuleParts {
  const { stores, secretRandom } = options;
  const { stored, agents, wallets, custody, install, chains, intents } = orders;
  const { readTokenFacts, clock, ids, publish, isLocked, expireCard } = orders;
  return {
    rules: stores.webhookRules,
    stored,
    agents,
    wallets,
    custody,
    install,
    chains,
    intents,
    readTokenFacts,
    clock,
    ids,
    secretRandom: secretRandom ?? noSecrets,
    publish,
    isLocked,
    expireCard,
    webhookBase: options.webhookBase ?? (() => loopbackWebhookBase),
    ...(orders.launches === undefined ? {} : { launches: orders.launches }),
  };
}

/**
 * The webhook rule use cases (decisions 0299 and 0337) on the auto orders' parts, and their
 * handlers: the same stores, intents, wallets and card timer, with the rules' own store, the
 * secure generator for their secrets and the base of their URLs.
 */
export function webhookRulesOf(
  options: EngineOptions,
  orders: OrderParts,
): { readonly parts: WebhookRuleParts; readonly handlers: WebhookRuleHandlers } {
  const parts = webhookRulePartsOf(options, orders);
  return { parts, handlers: createWebhookRuleHandlers(parts) };
}
