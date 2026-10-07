import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AgentDraft,
  type AgentModeChange,
  type AgentRecord,
  type AgentSettings,
  agentSettingsOf,
} from "../agents/agent-record.js";
import type { AgentStore } from "../ports.js";
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

/** Creates an empty in-memory {@link AgentStore} for tests. */
export function createMemoryAgentStore(): AgentStore {
  const agents: Agents = new Map();
  return {
    create: async (draft, call) => memoryCall(call, () => create(agents, draft)),
    get: async (id, call) => memoryCall(call, () => structuredClone(agents.get(id))),
    list: async (call) =>
      memoryCall(call, () =>
        structuredClone(
          [...agents.values()].map((settings) => settings.agent).toSorted(byCreation),
        ),
      ),
    setApprovalMode: async (change, call) =>
      memoryCall(call, () => {
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
      }),
    setLimits: async (change, call) =>
      memoryCall(call, () => {
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
      }),
    setMode: async (change, call) => memoryCall(call, () => setMode(agents, change)),
  };
}
