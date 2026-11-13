import { type Clock, err, idSchema, ok } from "@binference/core";
import { maxReasoningChars } from "@binference/protocol";
import type { OwnerMessage } from "../loop/model-message.js";
import type { TurnEngine } from "../loop/ports.js";
import type { TurnStartRequest } from "../loop/turn-records.js";
import { type AgentStores, written } from "../sessions/agent-stores.js";
import { ownerEvents } from "../sessions/session-journal.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { EngineTurn, TurnStartAnswer } from "./engine-chat-records.js";
import type { EngineChat } from "./ports.js";
import { progressKeyOf } from "./progress-keys.js";
import { statusKeysOf } from "./status-keys.js";

/** What the engine's side of one turn works with. */
export interface EngineTurnOptions {
  readonly chat: EngineChat;
  readonly stores: AgentStores;
  readonly place: TurnPlace;
  /** The messages the turn takes from the chat queue, oldest first. */
  readonly taken: readonly OwnerMessage[];
  readonly clock: Clock;
  /** Hears the engine's refusal, with the time a spent budget resumes. */
  readonly onRefused?: (refusal: Extract<TurnStartAnswer, { readonly started: false }>) => void;
  /**
   * Hears what is left of the agent's model budget each time the engine answers it, so a helper
   * knows it before its own first call (decision 0403).
   */
  readonly onBudget?: (leftMicros: bigint) => void;
}

const messageId = idSchema("msg");

// Once the engine started the turn (runtime spec, section 11): the turn's row with the messages it
// took, then those messages as the owner's events. A message a turn took before is not taken again.
async function recordStart(
  options: EngineTurnOptions,
  request: TurnStartRequest,
  signal: AbortSignal,
): Promise<void> {
  const { stores, place, clock } = options;
  const { fence } = stores;
  const draft = { id: place.turn, sessionId: place.session, startedAtMs: clock.now() };
  const row = await stores.sessions.startTurn(
    { ...draft, outsideContent: request.outsideContent, fence },
    { signal },
  );
  if (!row.ok && row.error !== "exists") {
    written(row, "start a turn");
  }
  const waiting = await stores.queue.waiting({ sessionId: place.session, limit: 200 }, { signal });
  const open = new Set<string>(waiting.map((message) => message.message));
  const messages = request.messages.filter((id) => open.has(id)).map((id) => messageId.parse(id));
  if (messages.length > 0) {
    written(await stores.queue.take({ messages, turn: place.turn, fence }, { signal }), "take");
  }
  const events = ownerEvents(options.taken, { turn: place.turn, atMs: clock.now() });
  if (events.length > 0) {
    const append = { sessionId: place.session, events, fence };
    written(await stores.transcript.append(append, { signal }), "append");
  }
}

// A tool's progress line of spec 4; a tool that shows none sends nothing.
function progressOf(chat: EngineChat, at: EngineTurn): TurnEngine["progress"] {
  return async (tool, signal) => {
    const line = progressKeyOf(tool);
    if (line !== undefined) {
      const { key: progressKey, values } = line;
      const progress = { ...at, progressKey, ...(values === undefined ? {} : { values }) };
      await chat.turnProgress(progress, signal);
    }
  };
}

/**
 * The engine's side of one turn over the runtime's link to the engine (runtime spec, section 4.3):
 * `turn/start`, then the turn's row in `agent.sqlite`; `turn/mark`; `turn/say` with the final text
 * and, before it, with each draft; `turn/progress` with the line of spec 4 a tool shows;
 * `turn/reasoning` with the reasoning of each model call, as it grows and once it ended;
 * `turn/status` with the line's keys of spec 4; `usage/record` after each model call attempt;
 * `turn/end`. A start the engine refuses answers the refusal, after the paused status line for a
 * spent budget; one it cannot answer, or whose row is not written, rejects.
 */
export function createEngineTurnEngine(options: EngineTurnOptions): TurnEngine {
  const { chat, place } = options;
  const at = { agent: place.agent, turn: place.turn };
  const status: TurnEngine["status"] = async (line, signal) => {
    for (const { key, values } of statusKeysOf(line)) {
      const shown = { ...at, statusKey: key, ...(values === undefined ? {} : { values }) };
      // oxlint-disable-next-line eslint/no-await-in-loop -- the lines go out in their order
      await chat.turnStatus(shown, signal);
    }
  };
  return {
    async start(request, signal) {
      const messages = request.messages.map((id) => messageId.parse(id));
      const start = {
        ...at,
        session: place.session,
        messages,
        outsideContent: request.outsideContent,
      };
      const answer = await chat.startTurn(start, signal);
      if (!answer.started) {
        options.onRefused?.(answer);
        // A spent budget or a turn quota shows the owner when chat goes on; the refusal stands
        // without the line, and the owner's next message tries the start, and the line, again.
        const { refusal, resumesAt } = answer;
        if ((refusal === "budget" || refusal === "quota") && resumesAt !== undefined) {
          await status({ line: refusal, resumesAt }, signal).catch(() => undefined);
        }
        return err(answer.refusal);
      }
      options.onBudget?.(answer.budgetLeftMicros);
      await recordStart(options, request, signal);
      return ok({ budgetLeftMicros: answer.budgetLeftMicros });
    },
    mark: async (signal) => chat.markTurn(at, signal),
    say: async (text, signal) =>
      chat.sayTurn({ ...at, session: place.session, text, final: true }, signal),
    draft: async (text, signal) =>
      chat.sayTurn({ ...at, session: place.session, text, final: false }, signal),
    progress: progressOf(chat, at),
    reasoning: async ({ text, final }, signal) =>
      chat.turnReasoning({ ...at, text: text.slice(0, maxReasoningChars), final }, signal),
    status,
    async recordUsage(usage, signal) {
      const recorded = await chat.recordUsage({ ...at, ...usage }, signal);
      options.onBudget?.(recorded.budgetLeftMicros);
      return recorded;
    },
    end: async (outcome, signal, failedTool) =>
      chat.endTurn({ ...at, outcome, ...(failedTool === undefined ? {} : { failedTool }) }, signal),
  };
}
