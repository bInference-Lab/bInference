import { BinferenceError, type Clock, type Id, type IdSource } from "@binference/core";
import { type ChatSurface, chatSurfaceSchema } from "@binference/protocol";
import type { HelperRecord, HelperStore } from "@binference/store";
import type { TurnSetup } from "../chats/chat-context.js";
import { createSerial } from "../chats/chat-context.js";
import { createQueueMerge } from "../chats/queue-merge.js";
import { createEngineLiveFacts } from "../engine-chat/engine-live-facts.js";
import type { ContextSource, EngineChat } from "../engine-chat/ports.js";
import { type ChatTurn, createChatTurn, type TurnReport } from "../loop/chat-turn.js";
import type { TurnRefusal } from "../loop/turn-records.js";
import { turnLimits } from "../loop/turn-run.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import { loadConversation } from "../sessions/conversation.js";
import { createSessionJournal } from "../sessions/session-journal.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { ToolClient } from "../tools/tool-client.js";
import type { BudgetMemory } from "./budget-memory.js";
import { createHelperRunLog, type HelperRunLog } from "./helper-run-log.js";
import { createHelperTurnEngine } from "./helper-turn-engine.js";
import { type HelperFailure, stateOfReport } from "./helper-words.js";

/** What every helper run works with, for every agent of the runtime. */
export interface HelperRunParts {
  readonly stores: AgentStores;
  readonly helpers: HelperStore;
  /** The engine's side of chat, which charges each helper model call to its agent's budget. */
  readonly engine: EngineChat;
  /** The agents' live facts: whether an agent may run a helper, and each call's tail. */
  readonly context: ContextSource;
  /** Where a helper's end goes: `helper/ended`. */
  readonly client: ToolClient;
  /** What a helper's turn runs with, for its place. */
  readonly setup: (place: TurnPlace) => TurnSetup;
  readonly budgets: BudgetMemory;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** The runtime's lifetime: the runs' writes end with it. */
  readonly lifetime: AbortSignal;
}

/** How one run ended: its state, why a failed one failed, its final text and its outside mark. */
export interface RunEnd {
  readonly state: HelperRecord["state"];
  readonly failure?: HelperFailure;
  readonly report?: string;
  readonly outside: boolean;
}

/** One run as it goes: its turn once built, and its log. */
export interface LiveRun {
  readonly log: HelperRunLog;
  /** Halts the run's turn as a stop does. */
  stop(reason: "owner" | "runtime"): void;
}

// An agent the engine would refuse a turn for is refused here too: archived or unknown.
async function admitOf(parts: HelperRunParts, agent: Id<"agt">, signal: AbortSignal) {
  try {
    await parts.context.liveFacts(agent, signal);
    return undefined;
  } catch (error) {
    signal.throwIfAborted();
    const code = error instanceof BinferenceError ? error.code : "";
    const refusals: Readonly<Record<string, TurnRefusal>> = {
      "agent.archived": "archived",
      "agent.not_found": "not_found",
    };
    return refusals[code] ?? "unavailable";
  }
}

// The run's turn: the helper's session and journal, its own engine side, no merging, and the
// agent's facts, under the helper's setup and time limit.
async function turnOf(
  parts: HelperRunParts,
  run: { readonly helper: HelperRecord; readonly place: TurnPlace; readonly log: HelperRunLog },
  message: string,
): Promise<ChatTurn> {
  const { stores, clock, lifetime } = parts;
  const { helper, place, log } = run;
  const setup = parts.setup(place);
  const history = await loadConversation(stores.transcript, helper.id, lifetime);
  const taken = [{ id: parts.ids.next("msg"), text: message, outside: false }];
  const at = { agent: place.agent, turn: place.turn };
  const engine = createHelperTurnEngine({
    stores,
    place,
    taken,
    clock,
    log,
    admit: async (signal) => admitOf(parts, place.agent, signal),
    budgetLeft: () => parts.budgets.leftOf(place.agent),
    recordUsage: async (usage, signal) => {
      const recorded = await parts.engine.recordUsage({ ...at, ...usage }, signal);
      parts.budgets.note(place.agent, recorded.budgetLeftMicros);
      return recorded;
    },
  });
  const merge = { stores, session: helper.id, turn: place.turn, serial: createSerial() };
  return createChatTurn({
    turnId: place.turn,
    parts: {
      models: setup.models,
      tools: setup.tools,
      journal: createSessionJournal(stores, place, clock),
      engine,
      merge: createQueueMerge({ ...merge, mode: () => "after" }),
      facts: createEngineLiveFacts(parts.context, place.agent),
      ...(setup.settings === undefined ? {} : { settings: setup.settings }),
      clock,
    },
    prefix: setup.instructions,
    history: history.messages,
    taken,
    outsideContent: history.outside || setup.hasOutsideTools === true,
    lifetime,
    // The helper's own timer ends the run; the turn's limit is only a backstop.
    limits: { ...(setup.limits ?? turnLimits), turnTimeMs: helper.timeoutMs + 60_000 },
    ...(setup.compaction === undefined
      ? {}
      : { compaction: { setup: setup.compaction, stored: history } }),
  });
}

/**
 * Runs one run of a helper to its end (decision 0403): a turn of the helper's own session with the
 * message it takes, ended by its time limit as a stop does. `onStart` hears the run once it can be
 * stopped. Answers how it ended; a time limit that halted it ends it `timed_out`.
 */
export async function runOnce(
  parts: HelperRunParts,
  helper: HelperRecord,
  run: { readonly message: string; readonly onStart: (live: LiveRun) => void },
): Promise<RunEnd> {
  const turnId = parts.ids.next("trn");
  const place: TurnPlace = {
    agent: helper.agentId,
    session: helper.id,
    turn: turnId,
    helper: helper.model === undefined ? {} : { model: helper.model },
  };
  const log = createHelperRunLog();
  const turn = await turnOf(parts, { helper, place, log }, run.message);
  const timer = new AbortController();
  const timedOut = parts.clock.sleep(helper.timeoutMs, timer.signal).then(
    () => {
      turn.stop("runtime");
      return true;
    },
    () => false,
  );
  run.onStart({ log, stop: (reason) => turn.stop(reason) });
  const report: TurnReport = await turn.run();
  timer.abort();
  const stored = await parts.stores.sessions.turn(turnId, { signal: parts.lifetime });
  const said = log.read().said[0];
  const ended = (await timedOut) ? { state: "timed_out" as const } : stateOfReport(report);
  return {
    ...ended,
    outside: stored?.outsideContent === true,
    ...(said === undefined ? {} : { report: said }),
  };
}

/** The chat surface a helper's parent session began on, which its wake-up names. */
export async function surfaceOf(parts: HelperRunParts, helper: HelperRecord): Promise<ChatSurface> {
  const parent = await parts.stores.sessions.get(helper.parentSessionId, {
    signal: parts.lifetime,
  });
  const surface = chatSurfaceSchema.safeParse(parent?.surface);
  return surface.success ? surface.data : "console";
}
