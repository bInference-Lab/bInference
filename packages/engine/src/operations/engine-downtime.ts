import type { ChatRelay } from "../chat/chat-relay.js";
import type { DowntimeCheck } from "../downtime/downtime-check.js";
import { createDowntime, type Downtime } from "../downtime/downtime.js";
import type { EngineOptions } from "./create-engine.js";

/**
 * The downtime re-check over the engine's stores and its one publish: each agent's report goes to
 * its inbox through the chat relay (decision 0267).
 */
export function downtimeOf(
  options: EngineOptions,
  parts: { readonly check: DowntimeCheck; readonly relay: Pick<ChatRelay, "reportResume"> },
): Downtime {
  const { stores, clock, publish } = options;
  const { check, relay } = parts;
  return createDowntime({
    orders: stores.orders,
    alive: stores.alive,
    check,
    clock,
    publish,
    tellAgent: async (agent, payload, call) => relay.reportResume(agent, payload, call),
  });
}
