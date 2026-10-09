import {
  BinferenceError,
  type Clock,
  err,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { SendLevelRecord, SendLevelState } from "../agents/send-level-record.js";
import { journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { moveSendLevel, sendLevelAt } from "../policy/send-level-change.js";
import type { AgentStore, ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { sendLevelNotices } from "./send-level-notice.js";

/** The handlers of an agent's send level (protocol spec, section 7.6; decision 0016). */
export interface SendLevelHandlers {
  readonly "sendLevel/get": EngineHandler<"sendLevel/get">;
  readonly "sendLevel/set": EngineHandler<"sendLevel/set">;
  readonly "sendLevel/cancelPending": EngineHandler<"sendLevel/cancelPending">;
}

/** What the send level handlers read, write and announce through. */
export interface SendLevelHandlersOptions {
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type SendLevelView = ResultOf<"sendLevel/get">;
type LevelCall = EngineCall<"sendLevel/set"> | EngineCall<"sendLevel/cancelPending">;

/** A written move: the call that asked for it, and the agent and state it was decided against. */
interface Planned {
  readonly call: LevelCall;
  readonly settings: AgentSettings;
  /** The state in effect when the move was decided. */
  readonly before: SendLevelState;
}

// Another write to the level, such as a change from another surface, makes a move read it again.
const moveAttempts = 3;

function viewOf({ level, pending }: SendLevelState): SendLevelView {
  return {
    level,
    ...(pending === undefined
      ? {}
      : { pending: { level: pending.level, effectiveAt: pending.atMs } }),
  };
}

function isSame(a: SendLevelState, b: SendLevelState): boolean {
  return (
    a.level === b.level &&
    a.pending?.level === b.pending?.level &&
    a.pending?.atMs === b.pending?.atMs
  );
}

// Every change is journaled with who made it and where, pushed on the config topic, and announced
// to the owner as a notice on every surface.
async function announce(
  options: SendLevelHandlersOptions,
  planned: Planned,
  after: SendLevelRecord,
): Promise<void> {
  const { call, settings, before } = planned;
  await journalConfigChange(
    options,
    {
      caller: call.caller,
      atMs: after.changedAtMs,
      path: `agents.${settings.agent.name}.sendLevel`,
      before: jsonValueSchema.parse(viewOf(before)),
      after: jsonValueSchema.parse(viewOf(after)),
      notices: sendLevelNotices(before, after),
    },
    { signal: call.signal },
  );
}

type Decide = (state: SendLevelState, nowMs: number) => Result<SendLevelState, ProtocolErrorCode>;

// A cancel keeps the level in effect and drops the looser level that waits.
const dropPending: Decide = (state, nowMs) => ok({ level: sendLevelAt(state, nowMs).level });

interface Moving {
  readonly call: LevelCall;
  readonly decide: Decide;
  readonly attemptsLeft: number;
}

async function move(
  options: SendLevelHandlersOptions,
  { call, decide, attemptsLeft }: Moving,
): Promise<Result<SendLevelState, ProtocolErrorCode>> {
  const found = await activeAgent(options.agents, call.args.agent, { signal: call.signal });
  if (!found.ok) {
    return found;
  }
  const nowMs = options.clock.now();
  const { sendLevel } = found.value;
  const before = sendLevelAt(sendLevel, nowMs);
  const next = decide(sendLevel, nowMs);
  if (!next.ok || isSame(next.value, before)) {
    return next.ok ? ok(before) : next;
  }
  const change = { ...next.value, agentId: sendLevel.agentId, atMs: nowMs };
  const set = await options.agents.setSendLevel(
    { ...change, expectedVersion: sendLevel.version },
    { signal: call.signal },
  );
  if (set.ok) {
    await announce(options, { call, settings: found.value, before }, set.value);
    return ok(next.value);
  }
  if (attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.agent_stale",
      message: `The send level of agent ${sendLevel.agentId} kept changing under the move.`,
      retryable: true,
      details: { agent: sendLevel.agentId },
    });
  }
  return move(options, { call, decide, attemptsLeft: attemptsLeft - 1 });
}

/**
 * Creates the send level handlers. `sendLevel/get` answers the level in effect and a looser one
 * that waits. `sendLevel/set` to a stricter level, or to the level in effect, applies at once with
 * the `confirm` scope and drops any looser level that waits; a looser level needs the `loosen`
 * scope and waits 24 hours (decision 0089), so a hijacked surface cannot quietly open a locked
 * wallet. `sendLevel/cancelPending` drops the looser level that waits. Each change is journaled,
 * pushed as `config/changed`, and announced: a moved level as the `notice.sendLevel` notice, a
 * looser level that is gone before its time as the `notice.sendLevelCancelled` notice.
 */
export function createSendLevelHandlers(options: SendLevelHandlersOptions): SendLevelHandlers {
  return {
    async "sendLevel/get"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok(viewOf(sendLevelAt(found.value.sendLevel, options.clock.now()))) : found;
    },
    async "sendLevel/set"(call) {
      const decide: Decide = (state, nowMs) => {
        const { next, loosens } = moveSendLevel(state, call.args.level, nowMs);
        return call.caller.scopes.includes(loosens ? "loosen" : "confirm")
          ? ok(next)
          : err("auth.scope");
      };
      const moved = await move(options, { call, decide, attemptsLeft: moveAttempts });
      return moved.ok ? ok(viewOf(moved.value)) : moved;
    },
    async "sendLevel/cancelPending"(call) {
      const moved = await move(options, { call, decide: dropPending, attemptsLeft: moveAttempts });
      return moved.ok ? ok({ level: moved.value.level }) : moved;
    },
  };
}
