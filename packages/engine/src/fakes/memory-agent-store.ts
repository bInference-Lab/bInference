import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AgentDraft,
  type AgentModeChange,
  type AgentRecord,
  type AgentSettings,
  agentSettingsOf,
} from "../agents/agent-record.js";
import type { ApprovalModeChange, ApprovalModeRecord } from "../agents/approval-mode-record.js";
import type { LimitsChange, LimitsRecord } from "../agents/limits-record.js";
import type { SendLevelChange, SendLevelRecord } from "../agents/send-level-record.js";
import type { AgentStore } from "../ports.js";
import { createMemoryAddressBook } from "./memory-address-book.js";
import { byCreation, memoryCall } from "./memory-call.js";

type Agents = Map<Id<"agt">, AgentSettings>;

function create(agents: Agents, draft: AgentDraft): Result<AgentSettings, "exists" | "name_taken"> {
  if (agents.has(draft.id)) {
    return err("exists");
  }
  if ([...agents.values()].some((settings) => settings.agent.name === draft.name)) {
    return err("name_taken");
  }
  const settings = agentSettingsOf(structuredClone(draft));
  agents.set(draft.id, settings);
  return ok(structuredClone(settings));
}

// The agent's settings when the row the change names is at the version the changer read.
function current(
  agents: Agents,
  change: { readonly agentId: Id<"agt">; readonly expectedVersion: number },
  version: (settings: AgentSettings) => number,
): Result<AgentSettings, "not_found" | "stale"> {
  const settings = agents.get(change.agentId);
  if (settings === undefined) {
    return err("not_found");
  }
  return version(settings) === change.expectedVersion ? ok(settings) : err("stale");
}

function setMode(
  agents: Agents,
  change: AgentModeChange,
): Result<AgentRecord, "not_found" | "stale"> {
  const found = current(agents, change, (settings) => settings.agent.version);
  if (!found.ok) {
    return found;
  }
  const agent = {
    ...found.value.agent,
    mode: change.mode,
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, agent });
  return ok(structuredClone(agent));
}

function setSendLevel(
  agents: Agents,
  change: SendLevelChange,
): Result<SendLevelRecord, "not_found" | "stale"> {
  const found = current(agents, change, (settings) => settings.sendLevel.version);
  if (!found.ok) {
    return found;
  }
  const { agentId, level, pending } = structuredClone(change);
  const sendLevel = {
    agentId,
    level,
    ...(pending === undefined ? {} : { pending }),
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, sendLevel });
  return ok(structuredClone(sendLevel));
}

function setApprovalMode(
  agents: Agents,
  change: ApprovalModeChange,
): Result<ApprovalModeRecord, "not_found" | "stale"> {
  const found = current(agents, change, (settings) => settings.approvalMode.version);
  if (!found.ok) {
    return found;
  }
  const approvalMode = {
    ...found.value.approvalMode,
    mode: change.mode,
    changedBySurface: change.bySurface,
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, approvalMode });
  return ok(structuredClone(approvalMode));
}

function setLimits(
  agents: Agents,
  change: LimitsChange,
): Result<LimitsRecord, "not_found" | "stale"> {
  const found = current(agents, change, (settings) => settings.limits.version);
  if (!found.ok) {
    return found;
  }
  const limits = {
    ...structuredClone(change.limits),
    agentId: change.agentId,
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, limits });
  return ok(structuredClone(limits));
}

/** Creates an empty in-memory {@link AgentStore} for tests. */
export function createMemoryAgentStore(): AgentStore {
  const agents: Agents = new Map();
  const book = createMemoryAddressBook();
  return {
    create: async (draft, call) => memoryCall(call, () => create(agents, draft)),
    get: async (id, call) =>
      memoryCall(call, () => {
        const settings = agents.get(id);
        return settings === undefined
          ? undefined
          : { ...structuredClone(settings), addressBook: book.live(id) };
      }),
    list: async (call) =>
      memoryCall(call, () =>
        structuredClone(
          [...agents.values()].map((settings) => settings.agent).toSorted(byCreation),
        ),
      ),
    setApprovalMode: async (change, call) =>
      memoryCall(call, () => setApprovalMode(agents, change)),
    setLimits: async (change, call) => memoryCall(call, () => setLimits(agents, change)),
    setMode: async (change, call) => memoryCall(call, () => setMode(agents, change)),
    setSendLevel: async (change, call) => memoryCall(call, () => setSendLevel(agents, change)),
    addAddress: async (entry, call) =>
      memoryCall(call, () => (agents.has(entry.agentId) ? book.add(entry) : err("not_found"))),
    removeAddress: async (removal, call) => memoryCall(call, () => book.remove(removal)),
  };
}
