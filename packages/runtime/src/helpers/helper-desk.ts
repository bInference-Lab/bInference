import { err, type Id, ok, type Result } from "@binference/core";
import type { HelperRecord } from "@binference/store";
import type { ModelMessage } from "../loop/model-message.js";
import { isConfiguredModel } from "../providers/model-ref.js";
import { written } from "../sessions/agent-stores.js";
import { loadConversation } from "../sessions/conversation.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { HelperRunView } from "./helper-run-log.js";
import { type HelperRunParts, surfaceOf } from "./helper-run.js";
import { createHelperRuns, type HelperRuns } from "./helper-runs.js";
import { stoppedByRestartText } from "./helper-words.js";

// The most helpers of one agent that run at once (decision 0403).
const maxRunningHelpers = 4;

/** A run's time limit in minutes: 10 unless the agent asks for 1 to 30. */
export const helperMinutes: {
  readonly fallback: number;
  readonly least: number;
  readonly most: number;
} = { fallback: 10, least: 1, most: 30 };

/** What the agent asks for when it starts a helper. */
export interface HelperStartRequest {
  readonly agent: Id<"agt">;
  /** The agent's turn that starts it: the session it is started from. */
  readonly from: Pick<TurnPlace, "session">;
  /** The whole brief: the helper starts with nothing else. */
  readonly task: string;
  readonly label: string;
  readonly model?: string;
  readonly timeoutMinutes?: number;
}

/** One of the agent's helpers, named by the agent. */
interface HelperOfAgent {
  readonly agent: Id<"agt">;
  readonly helper: Id<"ses">;
}

/** A follow-up the agent sends one of its helpers. */
interface HelperSendRequest extends HelperOfAgent {
  readonly message: string;
  readonly timeoutMinutes?: number;
}

/**
 * Why the desk did not do what the agent asked: 4 helpers already run, the model's provider is not
 * configured, the budget is spent, no such helper of the agent, it does not run, 4 follow-ups
 * already wait for it, or the runtime is stopping.
 */
export type HelperRefusal =
  | "too_many"
  | "unknown_model"
  | "budget"
  | "not_found"
  | "not_running"
  | "busy"
  | "closing";

/** A helper as `helper_read` shows it: its record, its run so far and its conversation. */
export interface HelperReading {
  readonly helper: HelperRecord;
  /** The log of its current or last run in this runtime. */
  readonly run?: HelperRunView;
  readonly messages: readonly ModelMessage[];
}

/** A follow-up the desk took: the helper, and whether it waits for the helper's run to end. */
interface HelperSent {
  readonly helper: HelperRecord;
  readonly queued: boolean;
}

/** The agent's helpers, as its tools reach them (decision 0403). */
export interface HelperDesk {
  start(
    request: HelperStartRequest,
    signal: AbortSignal,
  ): Promise<Result<HelperRecord, HelperRefusal>>;
  /** The agent's helpers, the newest run's start first. */
  list(agent: Id<"agt">, signal: AbortSignal): Promise<readonly HelperRecord[]>;
  read(place: HelperOfAgent, signal: AbortSignal): Promise<HelperReading | undefined>;
  /**
   * A follow-up: a run of a helper that ended starts at once; one for a running helper waits for
   * its run to end, and `queued` says so.
   */
  send(request: HelperSendRequest, signal: AbortSignal): Promise<Result<HelperSent, HelperRefusal>>;
  /** Stops a running helper and answers it as it ended. */
  stop(place: HelperOfAgent, signal: AbortSignal): Promise<Result<HelperRecord, HelperRefusal>>;
}

/** The desk as the runtime drives it: the agent's tools' side, and its stops and repair. */
export interface HelperRunner extends HelperDesk {
  /** The owner stopped or cleared the agent's chat, or froze it: its helpers stop, unannounced. */
  stopAgent(agent: Id<"agt">): void;
  /** The runtime stops: every run halts and is waited for; the next start ends each `stopped`. */
  stopAll(): Promise<void>;
  /**
   * At a start: each helper a stop or a crash left running ends `stopped`, and its agent hears it
   * in one message.
   */
  repair(signal: AbortSignal): Promise<void>;
  /** Settles once no helper runs, including runs that begin while it waits. */
  rested(): Promise<void>;
}

/** What the desk works with: the runs' parts and the providers the settings configure. */
export interface HelperDeskOptions extends HelperRunParts {
  /** The names of `models.providers` now. */
  readonly providers: () => readonly string[];
}

/** The desk's parts and its runs. */
interface Desk {
  readonly options: HelperDeskOptions;
  readonly runs: HelperRuns;
}

function msOf(minutes: number | undefined): number {
  return (minutes ?? helperMinutes.fallback) * 60_000;
}

function knownModel(options: HelperDeskOptions, model: string | undefined): boolean {
  return model === undefined || isConfiguredModel(model, options.providers());
}

// Why a start or a follow-up of the agent may not run now, or nothing.
function refusalOf(
  { options, runs }: Desk,
  ask: { readonly agent: Id<"agt">; readonly model?: string | undefined },
): HelperRefusal | undefined {
  const left = options.budgets.leftOf(ask.agent);
  if (runs.closing()) {
    return "closing";
  }
  if (left !== undefined && left <= 0n) {
    return "budget";
  }
  if (!knownModel(options, ask.model)) {
    return "unknown_model";
  }
  return runs.count(ask.agent) >= maxRunningHelpers ? "too_many" : undefined;
}

async function ownHelper(
  options: HelperDeskOptions,
  place: HelperOfAgent,
  signal: AbortSignal,
): Promise<HelperRecord | undefined> {
  const helper = await options.helpers.get(place.helper, { signal });
  return helper?.agentId === place.agent ? helper : undefined;
}

async function startHelper(
  desk: Desk,
  request: HelperStartRequest,
  signal: AbortSignal,
): Promise<Result<HelperRecord, HelperRefusal>> {
  const { options, runs } = desk;
  const refusal = refusalOf(desk, request);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const draft = {
    id: options.ids.next("ses"),
    agentId: request.agent,
    parentSessionId: request.from.session,
    label: request.label,
    ...(request.model === undefined ? {} : { model: request.model }),
    startedAtMs: options.clock.now(),
    timeoutMs: msOf(request.timeoutMinutes),
    fence: options.stores.fence,
  };
  const helper = written(await options.helpers.start(draft, { signal }), "start a helper");
  runs.begin(helper, `Your task from the agent, titled "${helper.label}":\n\n${request.task}`);
  return ok(helper);
}

/** A follow-up's words as the helper reads them, and its run's time limit. */
interface FollowUp {
  readonly message: string;
  readonly timeoutMs: number;
}

// A new run of a helper that ended, with the follow-up.
async function rerun(
  desk: Desk,
  ask: { readonly helper: HelperRecord; readonly next: FollowUp },
  signal: AbortSignal,
): Promise<Result<HelperSent, HelperRefusal>> {
  const { options, runs } = desk;
  const { helper, next } = ask;
  const refusal = refusalOf(desk, { agent: helper.agentId, model: helper.model });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const atMs = options.clock.now();
  const move = { helper: helper.id, from: helper.state, to: "running" as const, atMs };
  const fenced = { ...move, timeoutMs: next.timeoutMs, fence: options.stores.fence } as const;
  const moved = await options.helpers.move(fenced, { signal });
  if (!moved.ok) {
    return err(moved.error === "not_found" ? "not_found" : "not_running");
  }
  runs.begin(moved.value, next.message);
  return ok({ helper: moved.value, queued: false });
}

// A follow-up starts a run of a helper that ended; one that runs here keeps it for after its run,
// and one whose run ended since it was read is read again.
async function sendHelper(
  desk: Desk,
  request: HelperSendRequest,
  signal: AbortSignal,
): Promise<Result<HelperSent, HelperRefusal>> {
  const { options, runs } = desk;
  const read = await ownHelper(options, request, signal);
  const message = `A follow-up from the agent:\n\n${request.message}`;
  const next = { message, timeoutMs: msOf(request.timeoutMinutes) };
  const kept = read?.state === "running" ? runs.follow(read.id, next) : "not_here";
  if (read !== undefined && kept !== "not_here") {
    return kept === "queued" ? ok({ helper: read, queued: true }) : err("busy");
  }
  const helper = read?.state === "running" ? await ownHelper(options, request, signal) : read;
  if (helper === undefined) {
    return err("not_found");
  }
  return helper.state === "running" ? err("not_running") : rerun(desk, { helper, next }, signal);
}

async function stopHelper(
  { options, runs }: Desk,
  place: HelperOfAgent,
  signal: AbortSignal,
): Promise<Result<HelperRecord, HelperRefusal>> {
  const helper = await ownHelper(options, place, signal);
  if (helper === undefined) {
    return err("not_found");
  }
  if (!(await runs.stop(helper.id))) {
    return err("not_running");
  }
  const ended = await options.helpers.get(helper.id, { signal });
  return ended === undefined ? err("not_found") : ok(ended);
}

// One agent hears which of its helpers the restart stopped, best effort.
async function tellStopped(
  options: HelperDeskOptions,
  stopped: readonly HelperRecord[],
  signal: AbortSignal,
): Promise<void> {
  const [first] = stopped;
  if (first === undefined) {
    return;
  }
  const ended = {
    agent: first.agentId,
    helper: first.id,
    surface: await surfaceOf(options, first),
    text: stoppedByRestartText(stopped),
    outsideContent: false,
  };
  await options.client.call("helper/ended", ended, { signal }).catch(() => undefined);
}

// The helpers a stop or a crash left running end `stopped`; each agent hears its own once.
async function repairLeft(options: HelperDeskOptions, signal: AbortSignal): Promise<void> {
  const left = await options.helpers.list({ state: "running", limit: 1_000 }, { signal });
  const atMs = options.clock.now();
  const moves = left.map(
    (helper) =>
      ({
        helper: helper.id,
        from: "running",
        to: "stopped",
        atMs,
        fence: options.stores.fence,
      }) as const,
  );
  const stopped = await Promise.all(
    moves.map(async (move) => written(await options.helpers.move(move, { signal }), "stop")),
  );
  const agents = [...new Set(stopped.map((helper) => helper.agentId))];
  await Promise.all(
    agents.map(async (agent) =>
      tellStopped(
        options,
        stopped.filter((helper) => helper.agentId === agent),
        signal,
      ),
    ),
  );
}

/**
 * Creates the agent's helpers' desk for one runtime start (decision 0403): at most 4 of an
 * agent's helpers run at once, each run in its own line of work beside the owner's chat, with 10
 * minutes or the 1 to 30 the agent asks; a start or follow-up is refused once the engine last
 * answered the agent's budget as spent, and for a model whose provider `models.providers` lacks.
 */
export function createHelperDesk(options: HelperDeskOptions): HelperRunner {
  const desk = { options, runs: createHelperRuns(options) };
  return {
    start: async (request, signal) => startHelper(desk, request, signal),
    list: async (agent, signal) => options.helpers.list({ agentId: agent, limit: 50 }, { signal }),
    async read(place, signal) {
      const helper = await ownHelper(options, place, signal);
      if (helper === undefined) {
        return undefined;
      }
      const history = await loadConversation(options.stores.transcript, helper.id, signal);
      const run = desk.runs.view(helper.id);
      return { helper, messages: history.messages, ...(run === undefined ? {} : { run }) };
    },
    send: async (request, signal) => sendHelper(desk, request, signal),
    stop: async (place, signal) => stopHelper(desk, place, signal),
    stopAgent: (agent) => desk.runs.stopAgent(agent),
    stopAll: async () => desk.runs.stopAll(),
    repair: async (signal) => repairLeft(options, signal),
    rested: async () => desk.runs.rested(),
  };
}
