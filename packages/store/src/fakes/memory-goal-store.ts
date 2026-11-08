import { err, ok } from "@binference/core";
import {
  goalClearSchema,
  goalDraftSchema,
  type GoalRecord,
  goalWriteSchema,
  progressNotePutSchema,
} from "../chats/goal-record.js";
import type { GoalStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

function setOf(database: MemoryAgentDatabase): GoalStore["set"] {
  const { goals, sessions } = database;
  return async (draft, options) =>
    inMemory(options, () => {
      const { fence, ...goal } = goalDraftSchema.parse(draft);
      if (!holdsFence(database, fence)) {
        return err("fenced");
      }
      if (!sessions.has(goal.sessionId)) {
        return err("no_session");
      }
      if (goals.has(goal.sessionId)) {
        return err("exists");
      }
      const record: GoalRecord = {
        ...goal,
        status: "active",
        spentMicros: 0n,
        goalTurns: 0,
        strikes: 0,
        updatedAtMs: goal.startedAtMs,
        version: 0,
      };
      goals.set(goal.sessionId, record);
      return ok(structuredClone(record));
    });
}

function writeOf(database: MemoryAgentDatabase): GoalStore["write"] {
  const { goals } = database;
  return async (change, options) =>
    inMemory(options, () => {
      const { fence, sessionId, version, next } = goalWriteSchema.parse(change);
      if (!holdsFence(database, fence)) {
        return err("fenced");
      }
      const stored = goals.get(sessionId);
      if (stored === undefined) {
        return err("not_found");
      }
      if (stored.version !== version) {
        return err("stale");
      }
      const { pauseReason: _reason, note: _note, ...kept } = stored;
      const written: GoalRecord = {
        ...kept,
        ...next,
        updatedAtMs: Math.max(next.updatedAtMs, stored.startedAtMs),
        version: stored.version + 1,
      };
      goals.set(sessionId, written);
      return ok(structuredClone(written));
    });
}

function putNoteOf(database: MemoryAgentDatabase): GoalStore["putNote"] {
  const { progressNotes, sessions } = database;
  return async (put, options) =>
    inMemory(options, () => {
      const { fence, ...note } = progressNotePutSchema.parse(put);
      if (!holdsFence(database, fence)) {
        return err("fenced");
      }
      if (!sessions.has(note.sessionId)) {
        return err("no_session");
      }
      if (note.markdown === "" && note.plan.length === 0) {
        progressNotes.delete(note.sessionId);
        return ok(undefined);
      }
      progressNotes.set(note.sessionId, note);
      return ok(structuredClone(note));
    });
}

/** The {@link GoalStore} of an in-memory agent database. */
export function createMemoryGoalStore(database: MemoryAgentDatabase): GoalStore {
  const { goals, progressNotes } = database;
  return {
    get: async (session, options) => inMemory(options, () => structuredClone(goals.get(session))),
    active: async (options) =>
      inMemory(options, () =>
        [...goals.values()]
          .filter((goal) => goal.status === "active")
          .toSorted(
            (left, right) =>
              left.startedAtMs - right.startedAtMs || (left.sessionId < right.sessionId ? -1 : 1),
          )
          .slice(0, 100)
          .map((goal) => structuredClone(goal)),
      ),
    set: setOf(database),
    write: writeOf(database),
    clear: async (clear, options) =>
      inMemory(options, () => {
        const { fence, sessionId } = goalClearSchema.parse(clear);
        return holdsFence(database, fence) ? ok(goals.delete(sessionId)) : err("fenced");
      }),
    note: async (session, options) =>
      inMemory(options, () => structuredClone(progressNotes.get(session))),
    putNote: putNoteOf(database),
  };
}
