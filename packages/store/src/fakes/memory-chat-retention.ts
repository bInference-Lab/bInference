import { err, ok } from "@binference/core";
import type { ChatRetention } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

// Removes, from a map, the entries `isGone` names, and answers how many.
function removeFrom<V>(rows: Map<string, V>, isGone: (row: V) => boolean): number {
  const gone = [...rows].filter(([, row]) => isGone(row));
  gone.forEach(([key]) => rows.delete(key));
  return gone.length;
}

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
