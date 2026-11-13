import { BinferenceError, type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf, Scope } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
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
  /** Whether a community plugin is on, so auto mode asks for every proposal (decision 0350). */
  readonly communityPluginsOn?: (() => boolean) | undefined;
  /** Whether a listed MCP server is on for an agent, so auto mode asks (decision 0428). */
  readonly listedMcpOn?: ((agent: Id<"agt">) => boolean) | undefined;
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

// In auto mode, the view says while a community plugin (decision 0350) or a listed MCP server
// (decision 0428) keeps every proposal asking; `autoAsks` keeps its one value for older clients.
function viewOf(
  options: ApprovalHandlersOptions,
  agent: Id<"agt">,
  record: ApprovalModeRecord,
): ApprovalModeView {
  const view = { mode: record.mode, changedAt: record.changedAtMs };
  const isAuto = record.mode === "auto";
  return {
    ...view,
    ...(isAuto && options.communityPluginsOn?.() === true ? { autoAsks: "plugin" as const } : {}),
    ...(isAuto && options.listedMcpOn?.(agent) === true ? { listedMcpOn: true as const } : {}),
  };
}

// Every change is journaled with who made it and where, pushed on the config topic, and announced
// to the owner as a notice on every surface.
async function announce(
  options: ApprovalHandlersOptions,
  call: EngineCall<"approval/set">,
  change: Change,
): Promise<void> {
  const { agent, before, after } = change;
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: after.changedAtMs,
      path: `agents.${agent.name}.approvalMode`,
      before: before.mode,
      after: after.mode,
      notices: [approvalModeNotice(agent, after)],
    },
    { signal: call.signal },
  );
}

async function setMode(
  options: ApprovalHandlersOptions,
  call: EngineCall<"approval/set">,
  attemptsLeft: number,
): Promise<Result<ApprovalModeView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok || found.value.approvalMode.mode === args.mode) {
    return found.ok ? ok(viewOf(options, args.agent, found.value.approvalMode)) : found;
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
    return ok(viewOf(options, agent.id, set.value));
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
 * changed; both answers carry `autoAsks: plugin` in auto mode while a community plugin is on
 * (decision 0350), and `listedMcpOn: true` while a listed MCP server is on for the agent
 * (decision 0428). `approval/set` to `auto` is a loosening that needs the `loosen` scope; to `manual` it
 * brakes with `confirm`, and takes effect at once: the mode's version rises, so every intent the
 * auto mode authorized under the old version loses its grant before it is signed, and the next
 * intent opens a card. Each switch is journaled, pushed as `config/changed` and announced as the
 * `notice.approvalMode` notice. Setting the mode an agent is in changes nothing.
 */
export function createApprovalHandlers(options: ApprovalHandlersOptions): ApprovalHandlers {
  return {
    async "approval/get"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      if (!found.ok) {
        return found;
      }
      return ok(viewOf(options, args.agent, found.value.approvalMode));
    },
    async "approval/set"(call) {
      if (!call.caller.scopes.includes(neededScope[call.args.mode])) {
        return err("auth.scope");
      }
      return setMode(options, call, setAttempts);
    },
  };
}
