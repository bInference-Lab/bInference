import { err, type Result } from "@binference/core";
import {
  type AgentModeChange,
  agentModeChangeSchema,
  type AgentRecord,
  agentRecordSchema,
} from "@binference/engine";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { type QuotaWrite, quotaWriteSchema } from "../tasks/quota-write.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { setAgentRow } from "./settings-tasks.js";

// Whether a switch to live of a paper agent at the version the changer read finds the install
// holding as many other live agents not archived as its quota allows (decision 0431); with no
// quota nothing is counted, and a missing row or another version is left to the write's answer.
function isOverLiveAgents(
  database: StoreConnection,
  change: AgentModeChange,
  quota: number | undefined,
): boolean {
  if (quota === undefined || change.mode !== "live") {
    return false;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const agents = kysely.selectFrom("agents");
  const row = takeFirst(agents.select(["mode", "version"]).where("id", "=", change.agentId));
  if (row?.mode !== "paper" || row.version !== change.expectedVersion) {
    return false;
  }
  const others = takeFirst(
    agents
      .select((builder) => builder.fn.countAll<number>().as("count"))
      .where("mode", "=", "live")
      .where("archived_at", "is", null)
      .where("id", "!=", change.agentId),
  );
  return (others?.count ?? 0) >= quota;
}

/**
 * Sets an agent's mode under the agent row's version the changer read, within the live agents'
 * quota its caller hands it: a missing row or another version is answered first, then `quota`.
 */
export const setModeTask: StoreTask<
  QuotaWrite<AgentModeChange>,
  Result<AgentRecord, "not_found" | "stale" | "quota">
> = defineTask({
  name: "agents.set_mode",
  access: "write",
  input: quotaWriteSchema(agentModeChangeSchema),
  output: resultSchema(agentRecordSchema, ["not_found", "stale", "quota"]),
  run: (database, { write: change, quota }) =>
    isOverLiveAgents(database, change, quota)
      ? err("quota")
      : setAgentRow(database, change, { mode: change.mode }),
});
