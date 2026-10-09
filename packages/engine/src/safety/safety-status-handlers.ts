import { type Clock, ok } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { InstallFacts } from "../install/install-record.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { AgentStore, InstallStore, IntentStore } from "../ports.js";
import { openIntentOf } from "./open-intent.js";

/** The handler of `safety/status` (protocol spec, section 7.1). */
export interface SafetyStatusHandlers {
  readonly "safety/status": EngineHandler<"safety/status">;
}

/** What the safety status reads. */
export interface SafetyStatusOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  readonly intents: IntentStore;
  readonly clock: Clock;
}

type SafetyStatus = ResultOf<"safety/status">;

// Every frozen agent not archived, with its time, in the order the store lists them.
function frozenAgents(agents: readonly AgentRecord[]): NonNullable<SafetyStatus["agents"]> {
  return agents.flatMap(({ id, frozenAtMs, archivedAtMs }) =>
    frozenAtMs === undefined || archivedAtMs !== undefined
      ? []
      : [{ agent: id, frozenAt: frozenAtMs }],
  );
}

function statusOf(
  facts: InstallFacts,
  read: {
    readonly agents: readonly AgentRecord[];
    readonly rescue: IntentRecord | undefined;
    readonly nowMs: number;
  },
): SafetyStatus {
  const agents = frozenAgents(read.agents);
  const { rescueAddress, pendingRescue } = rescueAt(facts, read.nowMs);
  const { frozenAtMs } = facts;
  return {
    frozen: frozenAtMs !== undefined || agents.length > 0,
    ...(frozenAtMs === undefined ? {} : { frozenAt: frozenAtMs }),
    agents,
    ...(read.rescue === undefined
      ? {}
      : { rescue: { intent: read.rescue.id, state: read.rescue.state } }),
    ...(rescueAddress === undefined ? {} : { rescueAddress }),
    ...(pendingRescue === undefined
      ? {}
      : { pendingRescueAddress: pendingRescue.address, pendingRescueAt: pendingRescue.atMs }),
  };
}

/**
 * Creates the `safety/status` handler (decision 0128), which any surface may call with `read`: it
 * answers whether anything is frozen, when the whole install was, every frozen agent not archived
 * with its time, the rescue that has not ended with its state, and the rescue address in effect
 * with a new one that waits and when it takes effect.
 */
export function createSafetyStatusHandlers(options: SafetyStatusOptions): SafetyStatusHandlers {
  return {
    async "safety/status"({ signal }) {
      const [agents, facts, rescue] = await Promise.all([
        options.agents.list({ signal }),
        options.install.read({ signal }),
        openIntentOf(options.intents, { kind: "rescue" }, { signal }),
      ]);
      return ok(statusOf(facts, { agents, rescue, nowMs: options.clock.now() }));
    },
  };
}
