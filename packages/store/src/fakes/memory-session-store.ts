import { err, ok, type Result } from "@binference/core";
import type { Fenced, FenceRefusal } from "../chats/fenced.js";
import type { TurnRecord, TurnRef } from "../chats/turn-record.js";
import type { SessionStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

type TurnChange = Result<TurnRecord, FenceRefusal | "not_found" | "ended">;

// Changes a turn that has not ended, under the current fence.
function changeTurn(
  database: MemoryAgentDatabase,
  ref: Fenced<TurnRef>,
  change: (turn: TurnRecord) => TurnRecord,
): TurnChange {
  if (!holdsFence(database, ref.fence)) {
    return err("fenced");
  }
  const turn = database.turns.get(ref.turn);
  if (turn === undefined) {
    return err("not_found");
  }
  if (turn.endedAtMs !== undefined) {
    return err("ended");
  }
  const changed = change(turn);
  database.turns.set(turn.id, changed);
  return ok(structuredClone(changed));
}

function sessionMethods(
  database: MemoryAgentDatabase,
): Pick<SessionStore, "open" | "get" | "close"> {
  const { sessions } = database;
  return {
    open: async ({ fence, ...draft }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (sessions.has(draft.id)) {
          return err("exists");
        }
        sessions.set(draft.id, { ...draft, version: 0 });
        return ok({ ...draft, version: 0 });
      }),
    get: async (id, options) => inMemory(options, () => structuredClone(sessions.get(id))),
    close: async ({ fence, session, atMs, version }, options) =>
      inMemory(options, () => {
        const stored = sessions.get(session);
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (stored === undefined) {
          return err("not_found");
        }
        if (stored.clearedAtMs !== undefined) {
          return err("closed");
        }
        if (stored.version !== version) {
          return err("stale");
        }
        const closed = { ...stored, clearedAtMs: atMs, version: version + 1 };
        sessions.set(session, closed);
        return ok(structuredClone(closed));
      }),
  };
}

/** The {@link SessionStore} of an in-memory agent database. */
export function createMemorySessionStore(database: MemoryAgentDatabase): SessionStore {
  const { turns } = database;
  return {
    ...sessionMethods(database),
    startTurn: async ({ fence, ...draft }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (!database.sessions.has(draft.sessionId)) {
          return err("no_session");
        }
        if (turns.has(draft.id)) {
          return err("exists");
        }
        const turn: TurnRecord = { ...draft, committed: false, heldBack: 0 };
        turns.set(draft.id, turn);
        return ok(structuredClone(turn));
      }),
    commitTurn: async (ref, options) =>
      inMemory(options, () => changeTurn(database, ref, (turn) => ({ ...turn, committed: true }))),
    markOutside: async (ref, options) =>
      inMemory(options, () =>
        changeTurn(database, ref, (turn) => ({ ...turn, outsideContent: true })),
      ),
    endTurn: async ({ atMs, outcome, heldBack, ...ref }, options) =>
      inMemory(options, () =>
        changeTurn(database, ref, (turn) => ({ ...turn, endedAtMs: atMs, outcome, heldBack })),
      ),
    turn: async (id, options) => inMemory(options, () => structuredClone(turns.get(id))),
    unfinishedTurns: async (options) =>
      inMemory(options, () =>
        [...turns.values()]
          .filter((turn) => turn.endedAtMs === undefined)
          .toSorted(
            (left, right) => left.startedAtMs - right.startedAtMs || (left.id < right.id ? -1 : 1),
          )
          .map((turn) => structuredClone(turn)),
      ),
  };
}
