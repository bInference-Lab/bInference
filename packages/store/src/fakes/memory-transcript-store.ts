import { err, ok, type Result } from "@binference/core";
import type { CommittingAppend, EventAppend, TranscriptEvent } from "../chats/transcript-event.js";
import type { TranscriptStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

type Appended = Result<readonly TranscriptEvent[], "no_session" | "no_turn">;

// Numbers the events after the session's last, once every event names a turn of the session.
function numbered(database: MemoryAgentDatabase, append: EventAppend): Appended {
  const { sessionId } = append;
  if (!database.sessions.has(sessionId)) {
    return err("no_session");
  }
  const isOwn = (turnId: string | undefined): boolean =>
    turnId === undefined || database.turns.get(turnId)?.sessionId === sessionId;
  if (!append.events.every((event) => isOwn(event.turnId))) {
    return err("no_turn");
  }
  const last = database.events.filter((event) => event.sessionId === sessionId).length;
  return ok(
    append.events.map((event, index) => ({
      ...event,
      id: database.eventIds.value() + index + 1,
      sessionId,
      seq: last + index + 1,
    })),
  );
}

// Why a committing append may not be written beyond an append's refusal.
function commitRefusal(database: MemoryAgentDatabase, append: CommittingAppend) {
  const turn = database.turns.get(append.turn);
  if (turn?.sessionId !== append.sessionId) {
    return "no_turn";
  }
  if (append.events.some((event) => event.turnId !== append.turn)) {
    return "no_turn";
  }
  return turn.endedAtMs === undefined ? undefined : "ended";
}

function write(database: MemoryAgentDatabase, events: readonly TranscriptEvent[]): void {
  database.events.push(...structuredClone(events));
  database.eventIds.add(events.length);
}

/** The {@link TranscriptStore} of an in-memory agent database. */
export function createMemoryTranscriptStore(database: MemoryAgentDatabase): TranscriptStore {
  return {
    append: async ({ fence, ...append }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const events = numbered(database, append);
        if (events.ok) {
          write(database, events.value);
        }
        return events;
      }),
    appendCommitting: async ({ fence, ...append }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const events = numbered(database, append);
        if (!events.ok) {
          return events;
        }
        const refusal = commitRefusal(database, append);
        if (refusal !== undefined) {
          return err(refusal);
        }
        write(database, events.value);
        const turn = database.turns.get(append.turn);
        if (turn !== undefined) {
          database.turns.set(turn.id, { ...turn, committed: true });
        }
        return events;
      }),
    events: async ({ sessionId, afterSeq = 0, limit }, options) =>
      inMemory(options, () =>
        database.events
          .filter((event) => event.sessionId === sessionId && event.seq > afterSeq)
          .slice(0, limit)
          .map((event) => structuredClone(event)),
      ),
  };
}
