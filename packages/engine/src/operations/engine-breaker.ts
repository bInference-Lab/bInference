import type { ChatRelay } from "../chat/chat-relay.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { oneLookAtATime } from "../safety/breaker-looks.js";
import type { BreakerFollow } from "../safety/follow-breaker.js";
import type { EngineOptions } from "./create-engine.js";

/** The engine's work that follows the breaker (decision 0439). */
export interface BreakerWork {
  /**
   * Reads the breaker and writes its pull, its lift or its version alone, once per version past
   * the one the install applied (decisions 0439 and 0440); a source that does not answer in time
   * writes nothing and answers `unread`. One look runs at a time: a call made while one runs
   * waits for it, then reads again. The startup calls it before the keys, the recovery and the
   * repairs, and a timer of the composition root every second, locked or not: it signs nothing.
   */
  readonly followBreaker: (options: { readonly signal: AbortSignal }) => Promise<BreakerFollow>;
}

/** The breaker's work over the engine's stores, its chat relay stopping turns at a pull. */
export function breakerWorkOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly relay: Pick<ChatRelay, "stopHeld"> },
): BreakerWork {
  const { stores, clock, ids, publish } = options;
  const look = oneLookAtATime({
    stored: parts.stored,
    agents: stores.agents,
    intents: stores.intents,
    install: stores.install,
    orders: stores.orders,
    clock,
    ids,
    publish,
    source: options.breaker,
    stopTurns: async (signal: AbortSignal) => parts.relay.stopHeld(signal),
  });
  return { followBreaker: async ({ signal }) => look(signal) };
}
