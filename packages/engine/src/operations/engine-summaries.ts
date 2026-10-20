import type { PaperParts } from "../paper/paper-parts.js";
import { createDailySummaries, type DailySummaries } from "../summaries/daily-summaries.js";
import type { EngineOptions } from "./create-engine.js";

/**
 * The engine's daily summaries, over its stores, its holdings as `portfolio/get` reads them, and
 * the wallets the executor's stuck steps hold, where an executor tells them.
 */
export function dailySummariesOf(options: EngineOptions, paper: PaperParts): DailySummaries {
  const { stores } = options;
  return createDailySummaries({
    agents: stores.agents,
    summaries: stores.dailySummaries,
    install: stores.install,
    intents: stores.intents,
    orders: stores.orders,
    questions: stores.questions,
    usage: stores.modelUsage,
    store: options.positions,
    positions: paper.positions,
    wallets: options.wallets,
    prices: options.prices,
    chains: options.chains,
    heldWallets: options.heldWallets ?? (() => []),
    ownerTimeZone: options.ownerTimeZone,
    clock: options.clock,
    publish: options.publish,
  });
}
