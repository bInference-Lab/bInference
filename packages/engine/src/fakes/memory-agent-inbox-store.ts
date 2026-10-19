import { err, type Id, type JsonValue, ok, type Result } from "@binference/core";
import {
  type AgentInboxDraft,
  type AgentInboxMessage,
  isRuntimeProposal,
  maxUntakenMessages,
  settleIdsOf,
  type UntakenQuery,
} from "../chat/agent-inbox-record.js";
import type { AgentInboxStore } from "../chat/ports.js";
import type { IntentEventRecord } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { isTerminalState } from "../intents/intent-state.js";
import type { AgentStore } from "../ports.js";
import type { ScheduleWake } from "../schedules/schedule-record.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** An in-memory agent inbox that the in-memory intent store also writes settle messages to. */
export interface MemoryAgentInboxStore extends AgentInboxStore {
  /**
   * Writes the settle message of an intent the move left in `intent.state`, inside the intent
   * store's own write: only for a terminal state of an intent whose first event names the agent
   * runtime as its proposer, and none while its agent holds 200 untaken messages.
   */
  settleNow(
    intent: IntentRecord,
    firstEvent: IntentEventRecord | undefined,
  ): AgentInboxMessage | undefined;
  /**
   * Stores an owner's message at once, inside another in-memory store's own write, for an agent
   * the caller knows: `busy` while the agent holds 200 untaken messages.
   */
  addNow(draft: AgentInboxDraft): Result<AgentInboxMessage, "busy" | "not_found">;
  /**
   * Stores a schedule's or an alert's wake-up at once, inside the in-memory store's own write:
   * `waiting` while `waitingFor` is still untaken, and `busy` while the agent holds 200 untaken
   * messages.
   */
  wakeNow(wake: MemoryWake): Result<AgentInboxMessage, "waiting" | "busy">;
  /** Replaces the payload of a message still untaken, and answers it; `undefined` otherwise. */
  replaceNow(id: Id<"msg">, payload: JsonValue): AgentInboxMessage | undefined;
}

/** A wake-up as an in-memory store hands it over; a schedule's unless it names its kind. */
interface MemoryWake {
  readonly agentId: Id<"agt">;
  readonly kind?: "inbox/scheduleDue" | "inbox/alertFired";
  readonly wake: ScheduleWake;
  readonly atMs: number;
  readonly waitingFor?: Id<"msg">;
}

/** The agents an in-memory agent inbox knows. */
export interface MemoryAgentInboxOptions {
  readonly agents: Pick<AgentStore, "get">;
}

/** The rows of an in-memory agent inbox: its messages and each agent's open session. */
interface InboxRows {
  readonly all: () => readonly AgentInboxMessage[];
  readonly add: (message: AgentInboxMessage) => void;
  readonly markTaken: (ids: ReadonlySet<string>, atMs: number) => number;
  readonly replace: (id: Id<"msg">, payload: JsonValue) => AgentInboxMessage | undefined;
  readonly sessionOf: (agent: Id<"agt">) => Id<"ses"> | undefined;
  readonly open: (agent: Id<"agt">, session: Id<"ses">) => void;
}

function createRows(): InboxRows {
  const messages: AgentInboxMessage[] = [];
  const sessions = new Map<Id<"agt">, Id<"ses">>();
  return {
    all: () => messages,
    add(message) {
      messages.push(structuredClone(message));
    },
    markTaken(ids, atMs) {
      const marked = messages.flatMap((stored, index) =>
        ids.has(stored.id) && stored.takenAtMs === undefined ? [index] : [],
      );
      for (const index of marked) {
        const stored = messages[index];
        if (stored !== undefined) {
          messages.splice(index, 1, { ...stored, takenAtMs: atMs });
        }
      }
      return marked.length;
    },
    replace(id, payload) {
      const index = messages.findIndex(
        (stored) => stored.id === id && stored.takenAtMs === undefined,
      );
      const stored = messages[index];
      if (stored === undefined) {
        return undefined;
      }
      const replaced = { ...stored, payload: structuredClone(payload) };
      messages.splice(index, 1, replaced);
      return structuredClone(replaced);
    },
    sessionOf: (agent) => sessions.get(agent),
    open(agent, session) {
      sessions.set(agent, session);
    },
  };
}

function isTaken(message: AgentInboxMessage): boolean {
  return message.takenAtMs !== undefined;
}

function untakenOf(rows: InboxRows, agent: Id<"agt">): number {
  return rows.all().filter((stored) => stored.agentId === agent && !isTaken(stored)).length;
}

function store(rows: InboxRows, message: AgentInboxMessage): AgentInboxMessage {
  rows.add(message);
  return structuredClone(message);
}

function settle(
  rows: InboxRows,
  intent: IntentRecord,
  firstEvent: IntentEventRecord | undefined,
): AgentInboxMessage | undefined {
  if (
    !isTerminalState(intent.state) ||
    firstEvent === undefined ||
    !isRuntimeProposal(firstEvent.cause) ||
    untakenOf(rows, intent.agentId) >= maxUntakenMessages
  ) {
    return undefined;
  }
  const ids = settleIdsOf(intent.id);
  const sessionId = rows.sessionOf(intent.agentId) ?? ids.session;
  rows.open(intent.agentId, sessionId);
  return store(rows, {
    id: ids.message,
    agentId: intent.agentId,
    sessionId,
    kind: "inbox/intentSettled",
    turnId: ids.turn,
    payload: { intent: intent.id },
    createdAtMs: intent.changedAtMs,
  });
}

function add(
  rows: InboxRows,
  draft: AgentInboxDraft,
): Result<AgentInboxMessage, "busy" | "not_found"> {
  if (rows.all().some((stored) => stored.id === draft.id)) {
    throw constraintFault(`the message id ${draft.id} is in use`);
  }
  if (draft.kind === "inbox/message" && untakenOf(rows, draft.agentId) >= maxUntakenMessages) {
    return err("busy");
  }
  const sessionId = rows.sessionOf(draft.agentId) ?? draft.opens;
  rows.open(draft.agentId, draft.next ?? sessionId);
  const { id, agentId, kind, turnId, payload, atMs } = draft;
  return ok(
    store(rows, {
      id,
      agentId,
      sessionId,
      kind,
      ...(turnId === undefined ? {} : { turnId }),
      payload,
      createdAtMs: atMs,
    }),
  );
}

function wake(rows: InboxRows, waking: MemoryWake): Result<AgentInboxMessage, "waiting" | "busy"> {
  const { agentId, wake: draft, atMs, waitingFor, kind = "inbox/scheduleDue" } = waking;
  if (rows.all().some((stored) => stored.id === waitingFor && !isTaken(stored))) {
    return err("waiting");
  }
  if (untakenOf(rows, agentId) >= maxUntakenMessages) {
    return err("busy");
  }
  const sessionId = rows.sessionOf(agentId) ?? draft.opens;
  rows.open(agentId, sessionId);
  const { id, turnId, payload } = draft;
  const message = { id, agentId, sessionId, kind, turnId, payload } as const;
  return ok(store(rows, { ...message, createdAtMs: atMs }));
}

function isAfter(message: AgentInboxMessage, after: UntakenQuery["after"]): boolean {
  return (
    after === undefined ||
    message.createdAtMs > after.createdAtMs ||
    (message.createdAtMs === after.createdAtMs && message.id > after.id)
  );
}

function untaken(rows: InboxRows, query: UntakenQuery): readonly AgentInboxMessage[] {
  const { agentId, after, limit } = query;
  return structuredClone(
    rows
      .all()
      .filter(
        (stored) =>
          !isTaken(stored) &&
          (agentId === undefined || stored.agentId === agentId) &&
          isAfter(stored, after),
      )
      .toSorted(byCreation)
      .slice(0, limit),
  );
}

/** Creates an empty in-memory {@link MemoryAgentInboxStore} for tests. */
export function createMemoryAgentInboxStore(
  options: MemoryAgentInboxOptions,
): MemoryAgentInboxStore {
  const rows = createRows();
  return {
    settleNow: (intent, firstEvent) => settle(rows, intent, firstEvent),
    addNow: (draft) => add(rows, structuredClone(draft)),
    wakeNow: (waking) => wake(rows, structuredClone(waking)),
    replaceNow: (id, payload) => rows.replace(id, payload),
    async add(draft, call) {
      call.signal.throwIfAborted();
      const agent = await options.agents.get(draft.agentId, call);
      return agent === undefined ? err("not_found") : add(rows, structuredClone(draft));
    },
    get: async (id, call) =>
      memoryCall(call, () => structuredClone(rows.all().find((stored) => stored.id === id))),
    openSession: async (agent, call) => memoryCall(call, () => rows.sessionOf(agent)),
    untaken: async (query, call) => memoryCall(call, () => untaken(rows, query)),
    take: async (taken, call) =>
      memoryCall(call, () => rows.markTaken(new Set(taken.ids), taken.atMs)),
  };
}
