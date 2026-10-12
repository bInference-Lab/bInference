import type { Id } from "@binference/core";
import type { LiveFactsReader } from "../loop/ports.js";
import type { ContextSource } from "./ports.js";

/**
 * The {@link LiveFactsReader} of one agent over the engine's `facts/get`: a read the engine does
 * not answer is `undefined`, so the turn goes on without the facts (decision 0201); an aborted
 * signal rejects with its reason.
 */
export function createRelayLiveFacts(source: ContextSource, agent: Id<"agt">): LiveFactsReader {
  return {
    async read(signal) {
      try {
        return await source.liveFacts(agent, signal);
      } catch {
        signal.throwIfAborted();
        return undefined;
      }
    },
  };
}
