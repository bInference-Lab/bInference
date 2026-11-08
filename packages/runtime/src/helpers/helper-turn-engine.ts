import { type Clock, err, type Id, ok } from "@binference/core";
import type { RecordedUsage } from "../engine-chat/engine-chat-records.js";
import { progressKeyOf } from "../engine-chat/progress-keys.js";
import { statusKeysOf } from "../engine-chat/status-keys.js";
import type { OwnerMessage } from "../loop/model-message.js";
import type { TurnEngine } from "../loop/ports.js";
import type { TurnRefusal, TurnStartRequest, UsageRecord } from "../loop/turn-records.js";
import { type AgentStores, written } from "../sessions/agent-stores.js";
import { ownerEvents } from "../sessions/session-journal.js";
import { type HelperRunLog, withLine } from "./helper-run-log.js";

/** Where a helper's turn runs: the agent, the helper's own session and the turn's id. */
interface HelperTurnPlace {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
}

/** What the side of one helper turn that stands in for the engine works with. */
export interface HelperTurnOptions {
  readonly stores: AgentStores;
  readonly place: HelperTurnPlace;
  /** The message the run takes: its task, or a follow-up. */
  readonly taken: readonly OwnerMessage[];
  readonly clock: Clock;
  readonly log: HelperRunLog;
  /**
   * Whether the agent may run its helper now: nothing, or why not, as the engine would refuse its
   * own turn. Rejects with an aborted signal's reason.
   */
  readonly admit: (signal: AbortSignal) => Promise<TurnRefusal | undefined>;
  /** What is left of the agent's budget, as the engine last answered; `undefined` before that. */
  readonly budgetLeft: () => bigint | undefined;
  /** `usage/record` under the helper's turn, charged to the agent's budget. */
  readonly recordUsage: (usage: UsageRecord, signal: AbortSignal) => Promise<RecordedUsage>;
}

// The helper's turn row and its message, as the agent's own turn writes them once it started.
async function recordStart(
  options: HelperTurnOptions,
  request: Pick<TurnStartRequest, "outsideContent">,
  signal: AbortSignal,
) {
  const { stores, place, clock } = options;
  const { fence } = stores;
  const draft = { id: place.turn, sessionId: place.session, startedAtMs: clock.now() };
  written(
    await stores.sessions.startTurn(
      { ...draft, outsideContent: request.outsideContent, fence },
      { signal },
    ),
    "start a helper's turn",
  );
  const events = ownerEvents(options.taken, { turn: place.turn, atMs: clock.now() });
  const append = { sessionId: place.session, events, fence };
  written(await stores.transcript.append(append, { signal }), "append");
}

/**
 * The side of a helper's turn that stands in for the engine (decision 0403). The engine keeps one
 * running turn per agent, the agent's own, so a helper's turn never starts there: it starts here
 * once the agent may run it, refused as the engine would refuse the agent's turn, and for a budget
 * the engine last answered as spent. Its text, drafts, progress and status lines go to the run's
 * log, never to the owner's chat; its mark is the helper's own; each model call's usage is recorded
 * with the engine against the agent's budget.
 */
export function createHelperTurnEngine(options: HelperTurnOptions): TurnEngine {
  const { log } = options;
  return {
    async start(request, signal) {
      const left = options.budgetLeft();
      const refusal = left !== undefined && left <= 0n ? "budget" : await options.admit(signal);
      if (refusal !== undefined) {
        return err(refusal);
      }
      await recordStart(options, request, signal);
      const started = { messages: request.messages, outside: request.outsideContent };
      log.write((view) => ({ ...view, started, running: true }));
      return ok(left === undefined ? {} : { budgetLeftMicros: left });
    },
    mark: async () => {
      log.write((view) => ({ ...view, marked: true }));
      return Promise.resolve();
    },
    say: async (text) => {
      log.write((view) => ({ ...view, said: [text] }));
      return Promise.resolve();
    },
    draft: async (text) => {
      log.write((view) => ({ ...view, drafts: withLine(view.drafts, text) }));
      return Promise.resolve();
    },
    progress: async (tool) => {
      const line = progressKeyOf(tool);
      if (line !== undefined) {
        log.write((view) => ({ ...view, progressKeys: withLine(view.progressKeys, line.key) }));
      }
      return Promise.resolve();
    },
    reasoning: async () => Promise.resolve(),
    status: async (line) => {
      const keys = statusKeysOf(line).map(({ key }) => key);
      log.write((view) => ({ ...view, statusKeys: keys.reduce(withLine, view.statusKeys) }));
      return Promise.resolve();
    },
    recordUsage: async (usage, signal) => options.recordUsage(usage, signal),
    end: async (outcome) => {
      log.write((view) => ({ ...view, running: false, ended: outcome }));
      return Promise.resolve();
    },
  };
}
