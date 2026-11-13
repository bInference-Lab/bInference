import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AgentDraft,
  type AgentModeChange,
  type AgentModelsChange,
  type AgentNotificationsChange,
  type AgentRecord,
  type AgentSettings,
  agentSettingsOf,
} from "../agents/agent-record.js";
import type { ApprovalModeChange, ApprovalModeRecord } from "../agents/approval-mode-record.js";
import { withBreakerHold } from "../agents/breaker-hold.js";
import type { LimitsChange, LimitsRecord } from "../agents/limits-record.js";
import type { SendLevelChange, SendLevelRecord } from "../agents/send-level-record.js";
import type { AgentFreeze } from "../intents/freeze-write.js";
import type { AgentStore } from "../ports.js";
import type { QuotaCall } from "../quotas/quotas.js";
import { createMemoryAddressBook } from "./memory-address-book.js";
import { byCreation, memoryCall } from "./memory-call.js";

type Agents = Map<Id<"agt">, AgentSettings>;

// How many agents not archived the store holds that pass the test.
function heldWhere(agents: Agents, test: (agent: AgentRecord) => boolean): number {
  return [...agents.values()].filter(({ agent }) => agent.archivedAtMs === undefined && test(agent))
    .length;
}

// An agent created while the whole install is frozen starts frozen at its creation; with a quota,
// an install that holds that many agents not archived takes none (decision 0431).
function create(
  agents: Agents,
  draft: AgentDraft,
  install: { readonly isFrozen: boolean; readonly quota: number | undefined },
): Result<AgentSettings, "exists" | "name_taken" | "quota"> {
  if (agents.has(draft.id)) {
    return err("exists");
  }
  if ([...agents.values()].some((settings) => settings.agent.name === draft.name)) {
    return err("name_taken");
  }
  if (install.quota !== undefined && heldWhere(agents, () => true) >= install.quota) {
    return err("quota");
  }
  const settings = agentSettingsOf(structuredClone(draft));
  const agent = install.isFrozen ? { ...settings.agent, frozenAtMs: draft.atMs } : settings.agent;
  agents.set(draft.id, { ...settings, agent });
  return ok(structuredClone({ ...settings, agent }));
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

// Writes fields of the agent row under the version the changer read, and raises that version.
function setAgentRow(
  agents: Agents,
  change: AgentModeChange | AgentNotificationsChange | AgentModelsChange,
  fields: Partial<Pick<AgentRecord, "mode" | "notifications" | "models">>,
): Result<AgentRecord, "not_found" | "stale"> {
  const found = current(agents, change, (settings) => settings.agent.version);
  if (!found.ok) {
    return found;
  }
  const agent = {
    ...found.value.agent,
    ...structuredClone(fields),
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, agent });
  return ok(structuredClone(agent));
}

// Sets the mode; with a quota, a paper agent goes live only while fewer other live agents not
// archived are held (decision 0431).
function setMode(
  agents: Agents,
  change: AgentModeChange,
  quota: number | undefined,
): Result<AgentRecord, "not_found" | "stale" | "quota"> {
  const found = current(agents, change, (settings) => settings.agent.version);
  const isGoingLive = found.ok && change.mode === "live" && found.value.agent.mode !== "live";
  const others = (agent: AgentRecord) => agent.mode === "live" && agent.id !== change.agentId;
  if (isGoingLive && quota !== undefined && heldWhere(agents, others) >= quota) {
    return err("quota");
  }
  return setAgentRow(agents, change, { mode: change.mode });
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
  const { pending } = structuredClone(change);
  const limits = {
    ...structuredClone(change.limits),
    agentId: change.agentId,
    ...(pending === undefined ? {} : { pending }),
    changedAtMs: change.atMs,
    version: change.expectedVersion + 1,
  };
  agents.set(change.agentId, { ...found.value, limits });
  return ok(structuredClone(limits));
}

/** A freeze's time, and whether it freezes or lifts a freeze. */
export interface FreezeChange {
  readonly atMs: number;
  readonly isFrozen: boolean;
}

/** An agent store in memory, which the in-memory intent store marks agents frozen through. */
export interface MemoryAgentStore extends AgentStore {
  /**
   * Marks agents frozen at `atMs`, or unfrozen, at once, inside another in-memory store's write.
   * Every agent is checked first: an unknown one is `not_found`, one at another row version
   * `stale`, and then nothing changes. An agent frozen before a freeze keeps its first time; each
   * row's version rises by one.
   */
  freezeNow(
    freezes: readonly AgentFreeze[],
    change: FreezeChange,
  ): Result<readonly AgentRecord[], "not_found" | "stale">;
  /** The agent as stored now, for another in-memory store's write, or `undefined`. */
  agentNow(id: Id<"agt">): AgentRecord | undefined;
  /** Moves each agent's row version on by one, inside another in-memory store's write. */
  touchNow(ids: readonly Id<"agt">[]): void;
}

// The agent as a freeze leaves it, or an unfreeze, without its freeze time.
function frozenOf(agent: AgentRecord, { atMs, isFrozen }: FreezeChange): AgentRecord {
  const { frozenAtMs: was, ...rest } = agent;
  const frozenAtMs = isFrozen ? (was ?? atMs) : undefined;
  return {
    ...rest,
    ...(frozenAtMs === undefined ? {} : { frozenAtMs }),
    changedAtMs: atMs,
    version: agent.version + 1,
  };
}

function freezeNow(
  agents: Agents,
  freezes: readonly AgentFreeze[],
  change: FreezeChange,
): Result<readonly AgentRecord[], "not_found" | "stale"> {
  const found: AgentSettings[] = [];
  for (const freeze of freezes) {
    const checked = current(
      agents,
      { agentId: freeze.agentId, expectedVersion: freeze.expectedVersion },
      (settings) => settings.agent.version,
    );
    if (!checked.ok) {
      return checked;
    }
    found.push(checked.value);
  }
  const frozen: AgentRecord[] = [];
  for (const settings of found) {
    const agent = frozenOf(settings.agent, change);
    agents.set(agent.id, { ...settings, agent });
    frozen.push(agent);
  }
  return ok(structuredClone(frozen));
}

/**
 * Where an in-memory agent store reads the install's freeze and the breaker's hold of it (decision
 * 0440); without them, never frozen.
 */
export interface MemoryAgentStoreOptions {
  readonly install?: {
    readonly frozenAt: () => number | undefined;
    readonly breakerMark?: { readonly at: () => number | undefined };
  };
}

// The reads and the freeze of the store: it keeps each owner's freeze as it is, and every record
// it gives folds the breaker's hold of the install in (decision 0440).
function heldReads(
  agents: Agents,
  options: MemoryAgentStoreOptions & { readonly book: ReturnType<typeof createMemoryAddressBook> },
) {
  const held = (agent: AgentRecord) => withBreakerHold(agent, options.install?.breakerMark?.at());
  const isFrozen = () => options.install?.frozenAt() !== undefined;
  return {
    held,
    freezeNow: (freezes: readonly AgentFreeze[], change: FreezeChange) => {
      const frozen = freezeNow(agents, structuredClone(freezes), change);
      return frozen.ok ? ok(frozen.value.map(held)) : frozen;
    },
    agentNow: (id: Id<"agt">) => {
      const agent = agents.get(id)?.agent;
      return agent === undefined ? undefined : structuredClone(held(agent));
    },
    touchNow: (ids: readonly Id<"agt">[]) => {
      for (const id of new Set(ids)) {
        const settings = agents.get(id);
        if (settings !== undefined) {
          const version = settings.agent.version + 1;
          agents.set(id, { ...settings, agent: { ...settings.agent, version } });
        }
      }
    },
    create: async (draft: AgentDraft, call: QuotaCall) =>
      memoryCall(call, () => {
        const made = create(agents, draft, { isFrozen: isFrozen(), quota: call.quota });
        return made.ok ? ok({ ...made.value, agent: held(made.value.agent) }) : made;
      }),
    get: async (id: Id<"agt">, call: QuotaCall) =>
      memoryCall(call, () => {
        const settings = agents.get(id);
        return settings === undefined
          ? undefined
          : {
              ...structuredClone(settings),
              agent: held(structuredClone(settings.agent)),
              addressBook: options.book.live(id),
            };
      }),
    list: async (call: QuotaCall) =>
      memoryCall(call, () =>
        structuredClone(
          [...agents.values()].map((settings) => held(settings.agent)).toSorted(byCreation),
        ),
      ),
  };
}

/** Creates an empty in-memory {@link MemoryAgentStore} for tests. */
export function createMemoryAgentStore(options: MemoryAgentStoreOptions = {}): MemoryAgentStore {
  const agents: Agents = new Map();
  const book = createMemoryAddressBook();
  const { held, ...reads } = heldReads(agents, { ...options, book });
  const heldRow = <E extends string>(written: Result<AgentRecord, E>): Result<AgentRecord, E> =>
    written.ok ? ok(held(written.value)) : written;
  return {
    ...reads,
    setApprovalMode: async (change, call) =>
      memoryCall(call, () => setApprovalMode(agents, change)),
    setLimits: async (change, call) => memoryCall(call, () => setLimits(agents, change)),
    setMode: async (change, call) =>
      memoryCall(call, () => heldRow(setMode(agents, change, call.quota))),
    setNotifications: async (change, call) =>
      memoryCall(call, () =>
        heldRow(setAgentRow(agents, change, { notifications: change.notifications })),
      ),
    setModels: async (change, call) =>
      memoryCall(call, () => heldRow(setAgentRow(agents, change, { models: change.models }))),
    setSendLevel: async (change, call) => memoryCall(call, () => setSendLevel(agents, change)),
    addAddress: async (entry, call) =>
      memoryCall(call, () => (agents.has(entry.agentId) ? book.add(entry) : err("not_found"))),
    removeAddress: async (removal, call) => memoryCall(call, () => book.remove(removal)),
  };
}
