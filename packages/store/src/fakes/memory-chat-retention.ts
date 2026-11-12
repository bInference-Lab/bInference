import { err, ok } from "@binference/core";
import type { ChatRetention } from "../ports.js";
import {
  holdsFence,
  inMemory,
  type MemoryAgentDatabase,
  removeFrom,
} from "./memory-agent-database.js";

/** The {@link ChatRetention} of an in-memory agent database. */
export function createMemoryChatRetention(database: MemoryAgentDatabase): ChatRetention {
  return {
    prune: async ({ fence, beforeMs }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const kept = database.events.filter((event) => event.atMs >= beforeMs);
        const events = database.events.length - kept.length;
        database.events.splice(0, database.events.length, ...kept);
        const holdsEvents = new Set(kept.map((event) => event.turnId));
        const turns = removeFrom(
          database.turns,
          (turn) =>
            turn.endedAtMs !== undefined && turn.endedAtMs < beforeMs && !holdsEvents.has(turn.id),
        );
        const messages = removeFrom(
          database.queue,
          (message) =>
            message.receivedAtMs < beforeMs &&
            (message.turnId !== undefined || message.droppedAtMs !== undefined),
        );
        return ok({ events, turns, messages });
      }),
  };
}
