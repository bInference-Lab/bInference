import { err, ok } from "@binference/core";
import type { ChatDeletion } from "../ports.js";
import {
  holdsFence,
  inMemory,
  type MemoryAgentDatabase,
  removeFrom,
} from "./memory-agent-database.js";

/** The {@link ChatDeletion} of an in-memory agent database. */
export function createMemoryChatDeletion(database: MemoryAgentDatabase): ChatDeletion {
  return {
    delete: async ({ fence, agents }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const chosen = new Set<string>(agents);
        const owned = new Set(
          [...database.sessions.values()]
            .filter((session) => chosen.has(session.agentId))
            .map((session) => session.id),
        );
        const kept = database.events.filter((event) => !owned.has(event.sessionId));
        const events = database.events.length - kept.length;
        database.events.splice(0, database.events.length, ...kept);
        const ofAgent = (row: { readonly agentId: string }): boolean => chosen.has(row.agentId);
        return ok({
          events,
          messages: removeFrom(database.queue, ofAgent),
          turns: removeFrom(database.turns, (turn) => owned.has(turn.sessionId)),
          helpers: removeFrom(database.helpers, ofAgent),
          goals: removeFrom(database.goals, ofAgent),
          progressNotes: removeFrom(database.progressNotes, ofAgent),
          sessions: removeFrom(database.sessions, ofAgent),
        });
      }),
  };
}
