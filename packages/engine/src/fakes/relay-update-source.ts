import { BinferenceError } from "@binference/core";
import type { BotUpdate } from "../ingress/bot-update.js";
import type { BotUpdateSource } from "../ports.js";
import { createWaiters } from "./waiters.js";

/**
 * An update source for tests, shaped like a webhook relay: an ingress service receives each update
 * the bot's platform posts and holds it, once per id, until the engine acknowledges it.
 */
export interface RelayUpdateSource extends BotUpdateSource {
  /**
   * Receives one posted update. A repeat of an id it holds or has acknowledged changes nothing.
   * With 1,000 updates held it throws `engine.relay_full`, as the relay refuses the post and the
   * platform posts it again later.
   */
  deliver(update: BotUpdate): void;
}

const defaultLimit = 100;
const maxHeld = 1_000;

/** Creates a {@link RelayUpdateSource} that holds no update yet. */
export function createRelayUpdateSource(): RelayUpdateSource {
  const held = new Map<number, BotUpdate>();
  const waiters = createWaiters();
  let acknowledged = -1;
  const pending = (limit: number): readonly BotUpdate[] =>
    [...held.values()].toSorted((a, b) => a.updateId - b.updateId).slice(0, limit);
  const next: BotUpdateSource["next"] = async (options) => {
    options.signal.throwIfAborted();
    const updates = pending(options.limit ?? defaultLimit);
    if (updates.length > 0) {
      return updates;
    }
    await waiters.wait(options.signal);
    return next(options);
  };
  return {
    next,
    async acknowledge(updateId, options) {
      options.signal.throwIfAborted();
      acknowledged = Math.max(acknowledged, updateId);
      for (const id of [...held.keys()].filter((key) => key <= updateId)) {
        held.delete(id);
      }
      await Promise.resolve();
    },
    deliver(update) {
      if (update.updateId <= acknowledged || held.has(update.updateId)) {
        return;
      }
      if (held.size >= maxHeld) {
        throw new BinferenceError({
          code: "engine.relay_full",
          message: `A relay holds at most ${String(maxHeld)} updates that are not acknowledged.`,
          retryable: true,
        });
      }
      held.set(update.updateId, update);
      waiters.wake();
    },
  };
}
