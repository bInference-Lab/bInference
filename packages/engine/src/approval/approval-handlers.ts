import {
  BinferenceError,
  type Clock,
  err,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode, ResultOf, Scope } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import type { ApprovalMode } from "../intents/auto-mode.js";
import { activeAgent } from "../operations/active-agent.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { approvalModeNotice } from "./approval-mode-notice.js";

/** The handlers of an agent's approval mode (protocol spec, section 7.2; decision 0088). */
export interface ApprovalHandlers {
  readonly "approval/get": EngineHandler<"approval/get">;
  readonly "approval/set": EngineHandler<"approval/set">;
}

/** What the approval mode handlers read, write and announce through. */
export interface ApprovalHandlersOptions {
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type ApprovalModeView = ResultOf<"approval/get">;

interface Change {
  readonly agent: AgentRecord;
  readonly before: ApprovalModeRecord;
  readonly after: ApprovalModeRecord;
}

// The server lets in a caller with either scope of `approval/set`; the mode decides which one the
// call needs. Auto is a loosening (decision 0089), manual a braking.
const neededScope: Readonly<Record<ApprovalMode, Scope>> = { auto: "loosen", manual: "confirm" };

// Another write to the mode, such as a switch from another surface, makes a set read it again.
const setAttempts = 3;

function viewOf(record: ApprovalModeRecord): ApprovalModeView {
  return { mode: record.mode, changedAt: record.changedAtMs };
}

// Every change is journaled with who made it and where, pushed on the config topic, and announced
// to the owner as a notice on every surface.
async function announce(
  options: ApprovalHandlersOptions,
  call: EngineCall<"approval/set">,
  change: Change,
): Promise<void> {
  const { agent, before, after } = change;
  const entry = await options.journal.record(
    {
      atMs: after.changedAtMs,
      by: call.caller.credential,
      surface: after.changedBySurface,
      path: `agents.${agent.name}.approvalMode`,
      before: before.mode,
      after: after.mode,
    },
    { signal: call.signal },
  );
  options.publish({ topic: "config", kind: "config/changed", data: jsonValueSchema.parse(entry) });
  options.publish(approvalModeNotice(agent, after));
}

async function setMode(
  options: ApprovalHandlersOptions,
  call: EngineCall<"approval/set">,
  attemptsLeft: number,
): Promise<Result<ApprovalModeView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok || found.value.approvalMode.mode === args.mode) {
    return found.ok ? ok(viewOf(found.value.approvalMode)) : found;
  }
  const { agent, approvalMode: before } = found.value;
  const set = await options.agents.setApprovalMode(
    {
      agentId: agent.id,
      mode: args.mode,
      bySurface: answererOf(call.caller).surface,
      atMs: options.clock.now(),
      expectedVersion: before.version,
    },
    { signal },
  );
  if (set.ok) {
    await announce(options, call, { agent, before, after: set.value });
    return ok(viewOf(set.value));
  }
  if (attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.agent_stale",
      message: `The approval mode of agent ${agent.id} kept changing under the switch.`,
      retryable: true,
      details: { agent: agent.id },
    });
  }
  return setMode(options, call, attemptsLeft - 1);
}

/**
 * Creates the approval mode handlers. `approval/get` answers an agent's mode and when it last
 * changed. `approval/set` to `auto` is a loosening that needs the `loosen` scope; to `manual` it
 * brakes with `confirm`, and takes effect at once: the mode's version rises, so every intent the
 * auto mode authorized under the old version loses its grant before it is signed, and the next
 * intent opens a card. Each switch is journaled, pushed as `config/changed` and announced as the
 * `notice.approvalMode` notice. Setting the mode an agent is in changes nothing.
 */
export function createApprovalHandlers(options: ApprovalHandlersOptions): ApprovalHandlers {
  return {
    async "approval/get"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok(viewOf(found.value.approvalMode)) : found;
    },
    async "approval/set"(call) {
      if (!call.caller.scopes.includes(neededScope[call.args.mode])) {
        return err("auth.scope");
      }
      return setMode(options, call, setAttempts);
    },
  };
}
