import { err, ok } from "@binference/core";
import {
  helperDraftSchema,
  helperMoveSchema,
  helperQuerySchema,
  type HelperMove,
  type HelperRecord,
} from "../chats/helper-record.js";
import type { HelperStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

// What a move makes of a helper: a new run, or an end that keeps the outside mark once set.
function moved(stored: HelperRecord, move: HelperMove): HelperRecord {
  if (move.to === "running") {
    const { endedAtMs: _ended, ...running } = stored;
    return {
      ...running,
      state: "running",
      startedAtMs: move.atMs,
      timeoutMs: move.timeoutMs ?? stored.timeoutMs,
      runs: stored.runs + 1,
    };
  }
  return {
    ...stored,
    state: move.to,
    endedAtMs: move.atMs,
    outside: stored.outside || move.outside === true,
  };
}

function newestFirst(left: HelperRecord, right: HelperRecord): number {
  return right.startedAtMs - left.startedAtMs || (left.id < right.id ? 1 : -1);
}

function startOf(database: MemoryAgentDatabase): HelperStore["start"] {
  const { helpers, sessions } = database;
  return async (draft, options) =>
    inMemory(options, () => {
      const { fence, ...helper } = helperDraftSchema.parse(draft);
      if (!holdsFence(database, fence)) {
        return err("fenced");
      }
      if (!sessions.has(helper.parentSessionId)) {
        return err("no_session");
      }
      if (sessions.has(helper.id)) {
        return err("exists");
      }
      sessions.set(helper.id, {
        id: helper.id,
        agentId: helper.agentId,
        surface: "helper",
        conversation: `helper:${helper.parentSessionId}`,
        startedAtMs: helper.startedAtMs,
        version: 0,
      });
      const record: HelperRecord = { ...helper, state: "running", runs: 1, outside: false };
      helpers.set(helper.id, record);
      return ok(structuredClone(record));
    });
}

function moveOf(database: MemoryAgentDatabase): HelperStore["move"] {
  const { helpers } = database;
  return async (change, options) =>
    inMemory(options, () => {
      const { fence, ...move } = helperMoveSchema.parse(change);
      if (!holdsFence(database, fence)) {
        return err("fenced");
      }
      const stored = helpers.get(move.helper);
      if (stored === undefined) {
        return err("not_found");
      }
      if (stored.state !== move.from) {
        return err("stale");
      }
      const next = moved(stored, move);
      helpers.set(move.helper, next);
      return ok(structuredClone(next));
    });
}

/** The {@link HelperStore} of an in-memory agent database. */
export function createMemoryHelperStore(database: MemoryAgentDatabase): HelperStore {
  const { helpers } = database;
  return {
    start: startOf(database),
    get: async (id, options) => inMemory(options, () => structuredClone(helpers.get(id))),
    list: async (query, options) =>
      inMemory(options, () => {
        const { agentId, state, limit } = helperQuerySchema.parse(query);
        return [...helpers.values()]
          .filter((helper) => agentId === undefined || helper.agentId === agentId)
          .filter((helper) => state === undefined || helper.state === state)
          .toSorted(newestFirst)
          .slice(0, limit)
          .map((helper) => structuredClone(helper));
      }),
    move: moveOf(database),
  };
}
