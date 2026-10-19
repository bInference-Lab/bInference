import type { Id } from "@binference/core";
import type { InboxMessageView } from "@binference/protocol";
import type {
  EngineTurnStart,
  EngineUsage,
  InboxWatch,
  RecordedUsage,
  TurnStartAnswer,
} from "../relay/engine-chat-records.js";
import type { EngineChat } from "../relay/ports.js";
import { nthTestId } from "./memory-agent-stores.js";

/** One thing the fake engine pushed on an agent's chat topic, as the engine names its kind. */
interface ChatPush {
  readonly kind: "chat/turnStarted" | "chat/message" | "chat/status" | "chat/turnEnded";
  readonly agent: Id<"agt">;
  readonly turn: Id<"trn">;
  /** The text of `chat/message`, the key of `chat/status`, the outcome of `chat/turnEnded`. */
  readonly detail?: string;
  /** The values of `chat/status`, when it has any. */
  readonly values?: Readonly<Record<string, number>>;
}

/** A refusal of `turn/start`. */
type Refusal = Extract<TurnStartAnswer, { readonly started: false }>;

/** The agent's running turn as the fake engine holds it. */
interface Running {
  readonly turn: Id<"trn">;
  readonly messages: readonly Id<"msg">[];
  readonly marked: boolean;
}

/** A schedule's wake-up the fake engine stored: its message, session, turn and schedule. */
type AlertWake = Pick<AlertFired, "alert" | "fired" | "outsideContent">;
type AlertFired = Extract<InboxMessageView, { readonly kind: "inbox/alertFired" }>;

interface Woken {
  readonly message: Id<"msg">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
  readonly schedule: Id<"sch">;
}

/**
 * An engine's side of chat held in memory, with the owner's side beside it: its inbox, each
 * agent's open session and running turn, and what it pushed on the chat topics.
 */
export interface MemoryEngineChat extends EngineChat {
  /** `chat/post` from the owner's surface, with images or not: the session and the turn reserved for it. */
  post(
    agent: Id<"agt">,
    text: string,
    images?: readonly string[],
  ): { readonly message: Id<"msg">; readonly session: Id<"ses">; readonly turn: Id<"trn"> };
  /** A schedule's wake-up, due at `due`: the message, its session and the turn reserved for it. */
  due(
    agent: Id<"agt">,
    wake: { readonly prompt: string; readonly due: number; readonly outsideContent: boolean },
  ): Woken;
  /** An alert's wake-up: the message, its session and the turn reserved for it. */
  alerted(agent: Id<"agt">, wake: AlertWake): Omit<Woken, "schedule">;
  /** `chat/stop` from the owner, or a freeze. */
  stop(agent: Id<"agt">, reason?: "owner" | "freeze"): Id<"msg">;
  /** `chat/clear`: answers the session that follows. */
  clear(agent: Id<"agt">): Id<"ses">;
  /** Makes `turn/start` refuse the agent's turns from now on, or start them again. */
  refuse(agent: Id<"agt">, refusal: Refusal | undefined): void;
  /** While the link is down, every call rejects as an engine out of reach does. */
  link(state: "up" | "down"): void;
  running(agent: Id<"agt">): Running | undefined;
  readonly pushes: readonly ChatPush[];
  /** Each `usage/record` the engine took, once per key, in order. */
  readonly usage: readonly EngineUsage[];
  /** Settles with the first push `match` accepts, made already or to come. */
  waitForPush(match: (push: ChatPush) => boolean): Promise<ChatPush>;
  /** The ids of the messages the runtime has not taken. */
  untaken(): readonly Id<"msg">[];
}

interface FakeState {
  readonly agents: ReadonlySet<string>;
  readonly inbox: InboxMessageView[];
  readonly taken: Set<string>;
  readonly sessions: Map<string, Id<"ses">>;
  readonly running: Map<string, Running>;
  readonly refusals: Map<string, Refusal>;
  readonly watchers: Set<InboxWatch>;
  readonly pushes: ChatPush[];
  readonly waiters: Set<(push: ChatPush) => void>;
  readonly ids: () => number;
  readonly down: Set<"link">;
  readonly usage: EngineUsage[];
}

/** Each agent's model budget in the fake engine: $1 a day. */
const dailyBudgetMicros = 1_000_000n;

const pageSize = 50;

function pushChat(state: FakeState, push: ChatPush): void {
  state.pushes.push(push);
  for (const waiter of state.waiters) {
    waiter(push);
  }
}

function waitForPush(state: FakeState, match: (push: ChatPush) => boolean): Promise<ChatPush> {
  const made = state.pushes.find(match);
  if (made !== undefined) {
    return Promise.resolve(made);
  }
  return new Promise((resolve) => {
    const waiter = (push: ChatPush): void => {
      if (match(push)) {
        state.waiters.delete(waiter);
        resolve(push);
      }
    };
    state.waiters.add(waiter);
  });
}

// Answers 1 past the last number at each call.
function counterFrom(start: number): () => number {
  let last = start;
  return () => {
    last += 1;
    return last;
  };
}

function nextId<P extends string>(state: FakeState, prefix: P): Id<P> {
  return nthTestId(prefix, state.ids());
}

function store(state: FakeState, view: InboxMessageView): void {
  state.inbox.push(view);
  for (const watch of state.watchers) {
    watch.onMessage(view);
  }
}

function sessionOf(state: FakeState, agent: Id<"agt">): Id<"ses"> {
  const open = state.sessions.get(agent) ?? nextId(state, "ses");
  state.sessions.set(agent, open);
  return open;
}

function base(state: FakeState, agent: Id<"agt">) {
  return { message: nextId(state, "msg"), agent, session: sessionOf(state, agent), at: 1_000 };
}

function reach(state: FakeState, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (state.down.has("link")) {
    throw new Error("The engine cannot be reached.");
  }
}

function startTurn(state: FakeState, start: EngineTurnStart): TurnStartAnswer {
  const refused = state.refusals.get(start.agent);
  if (!state.agents.has(start.agent) || refused !== undefined) {
    return refused ?? { started: false, refusal: "not_found" };
  }
  const { agent, turn, messages, outsideContent } = start;
  state.running.set(agent, { turn, messages, marked: outsideContent });
  pushChat(state, { kind: "chat/turnStarted", agent, turn });
  return { started: true, budgetLeftMicros: budgetLeft(state, agent) };
}

function budgetLeft(state: FakeState, agent: Id<"agt">): bigint {
  const spent = state.usage
    .filter((record) => record.agent === agent)
    .reduce((sum, record) => sum + record.usdMicros, 0n);
  return dailyBudgetMicros - spent;
}

// A record sent again under its key is counted once, as the engine keeps a write's key.
function recordUsage(state: FakeState, usage: EngineUsage): RecordedUsage {
  if (!state.agents.has(usage.agent)) {
    throw new Error("The agent is unknown.");
  }
  if (!state.usage.some((record) => record.key === usage.key)) {
    state.usage.push(usage);
  }
  return { budgetLeftMicros: budgetLeft(state, usage.agent) };
}

function engineSide(state: FakeState): EngineChat {
  return {
    watchInbox(watch) {
      state.watchers.add(watch);
      void watch.refetch(new AbortController().signal).catch(() => undefined);
      return () => state.watchers.delete(watch);
    },
    async listInbox(cursor, signal) {
      reach(state, signal);
      const from = cursor === undefined ? 0 : Number(cursor);
      const open = state.inbox.filter((view) => !state.taken.has(view.message));
      const items = open.slice(from, from + pageSize);
      const more = from + pageSize < open.length;
      return Promise.resolve({ items, ...(more ? { next: String(from + pageSize) } : {}) });
    },
    async takeInbox(messages, signal) {
      reach(state, signal);
      messages.forEach((message) => state.taken.add(message));
      return Promise.resolve();
    },
    async startTurn(start, signal) {
      reach(state, signal);
      return Promise.resolve(startTurn(state, start));
    },
    ...turnCalls(state),
  };
}

function turnCalls(
  state: FakeState,
): Pick<EngineChat, "markTurn" | "sayTurn" | "turnStatus" | "recordUsage" | "endTurn"> {
  return {
    async recordUsage(usage, signal) {
      reach(state, signal);
      return Promise.resolve(recordUsage(state, usage));
    },
    async markTurn({ agent, turn }, signal) {
      reach(state, signal);
      const running = state.running.get(agent);
      if (running?.turn !== turn) {
        throw new Error("The turn is not running.");
      }
      state.running.set(agent, { ...running, marked: true });
      return Promise.resolve();
    },
    async sayTurn({ agent, turn, text }, signal) {
      reach(state, signal);
      pushChat(state, { kind: "chat/message", agent, turn, detail: text });
      return Promise.resolve();
    },
    async turnStatus({ agent, turn, statusKey, values }, signal) {
      reach(state, signal);
      const shown = values === undefined ? {} : { values };
      pushChat(state, { kind: "chat/status", agent, turn, detail: statusKey, ...shown });
      return Promise.resolve();
    },
    async endTurn({ agent, turn, outcome }, signal) {
      reach(state, signal);
      if (state.running.get(agent)?.turn === turn) {
        state.running.delete(agent);
      }
      pushChat(state, { kind: "chat/turnEnded", agent, turn, detail: outcome });
      return Promise.resolve();
    },
  };
}

function ownerSide(
  state: FakeState,
): Pick<MemoryEngineChat, "post" | "due" | "alerted" | "stop" | "clear"> {
  return {
    post(agent, text, images) {
      const view = {
        ...base(state, agent),
        kind: "inbox/message" as const,
        turn: nextId(state, "trn"),
      };
      store(state, { ...view, text, surface: "cli", ...(images === undefined ? {} : { images }) });
      return { message: view.message, session: view.session, turn: view.turn };
    },
    due(agent, wake) {
      const view = {
        ...base(state, agent),
        kind: "inbox/scheduleDue" as const,
        turn: nextId(state, "trn"),
        schedule: nextId(state, "sch"),
        ...wake,
      };
      store(state, view);
      const { message, session, turn, schedule } = view;
      return { message, session, turn, schedule };
    },
    alerted(agent, wake) {
      const view = {
        ...base(state, agent),
        kind: "inbox/alertFired" as const,
        turn: nextId(state, "trn"),
        ...wake,
      };
      store(state, view);
      const { message, session, turn } = view;
      return { message, session, turn };
    },
    stop(agent, reason = "owner") {
      const view = { ...base(state, agent), kind: "inbox/stop" as const, reason };
      store(state, view);
      return view.message;
    },
    clear(agent) {
      const next = nextId(state, "ses");
      store(state, { ...base(state, agent), kind: "inbox/clear", next });
      state.sessions.set(agent, next);
      return next;
    },
  };
}

/** Creates a fake engine whose agents are those named, each active, with no message yet. */
export function createMemoryEngineChat(agents: readonly Id<"agt">[]): MemoryEngineChat {
  const state: FakeState = {
    agents: new Set(agents),
    inbox: [],
    taken: new Set(),
    sessions: new Map(),
    running: new Map(),
    refusals: new Map(),
    watchers: new Set(),
    pushes: [],
    waiters: new Set(),
    ids: counterFrom(1_000),
    down: new Set(),
    usage: [],
  };
  return {
    ...engineSide(state),
    ...ownerSide(state),
    refuse(agent, refusal) {
      if (refusal === undefined) {
        state.refusals.delete(agent);
      } else {
        state.refusals.set(agent, refusal);
      }
    },
    link(linkState) {
      if (linkState === "down") {
        state.down.add("link");
      } else {
        state.down.delete("link");
      }
    },
    running: (agent) => state.running.get(agent),
    pushes: state.pushes,
    usage: state.usage,
    waitForPush: async (match) => waitForPush(state, match),
    untaken: () =>
      state.inbox.filter((view) => !state.taken.has(view.message)).map((view) => view.message),
  };
}
