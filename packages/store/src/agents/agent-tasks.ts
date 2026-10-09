import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type AgentDraft,
  agentDraftSchema,
  type AgentRecord,
  agentRecordSchema,
  type AgentSettings,
  agentSettingsOf,
  agentSettingsSchema,
} from "@binference/engine";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readSettings, toAgentRecord } from "./agent-rows.js";
import { limitsColumns } from "./limits-rows.js";

function takenBy(database: DatabaseSync, draft: AgentDraft): "exists" | "name_taken" | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("agents")
      .select("id")
      .where((agent) => agent.or([agent("id", "=", draft.id), agent("name", "=", draft.name)])),
  );
  if (row === undefined) {
    return undefined;
  }
  return row.id === draft.id ? "exists" : "name_taken";
}

// Whether the whole install is frozen, so a new agent starts frozen.
function isInstallFrozen(database: DatabaseSync): boolean {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const safety = takeFirst(kysely.selectFrom("safety").select("frozen_at").where("id", "=", 1));
  return (safety?.frozen_at ?? null) !== null;
}

function insertAgent(database: DatabaseSync, draft: AgentDraft, frozenAt: number | null): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const atMs = draft.atMs;
  execute(
    kysely.insertInto("agents").values({
      id: draft.id,
      name: draft.name,
      mode: draft.mode,
      locale: draft.locale,
      models: jsonText(draft.models),
      notifications: jsonText(draft.notifications),
      frozen_at: frozenAt,
      archived_at: null,
      created_at: atMs,
      changed_at: atMs,
      version: 0,
    }),
  );
  execute(
    kysely.insertInto("limits").values({
      ...limitsColumns(draft.limits),
      agent_id: draft.id,
      changed_at: atMs,
      version: 0,
    }),
  );
  execute(
    kysely.insertInto("approval_modes").values({
      agent_id: draft.id,
      mode: draft.approvalMode,
      changed_by_surface: draft.bySurface,
      changed_at: atMs,
      version: 0,
    }),
  );
  execute(
    kysely.insertInto("send_levels").values({
      agent_id: draft.id,
      level: draft.sendLevel,
      pending_level: null,
      pending_at: null,
      changed_at: atMs,
      version: 0,
    }),
  );
}

/** Writes a new agent with its limits, approval mode and send level. */
export const createAgentTask: StoreTask<
  AgentDraft,
  Result<AgentSettings, "exists" | "name_taken">
> = defineTask({
  name: "agents.create",
  access: "write",
  input: agentDraftSchema,
  output: resultSchema(agentSettingsSchema, ["exists", "name_taken"]),
  run(database, draft) {
    const taken = takenBy(database, draft);
    if (taken !== undefined) {
      return err(taken);
    }
    const frozenAt = isInstallFrozen(database) ? draft.atMs : null;
    insertAgent(database, draft, frozenAt);
    const settings = agentSettingsOf(draft);
    const agent = frozenAt === null ? settings.agent : { ...settings.agent, frozenAtMs: frozenAt };
    return ok({ ...settings, agent });
  },
});

/** Reads one agent with its settings. */
export const getAgentTask: StoreTask<Id<"agt">, AgentSettings | undefined> = defineTask({
  name: "agents.get",
  access: "read",
  input: idSchema("agt"),
  output: agentSettingsSchema.optional(),
  run: (database, id) => readSettings(database, id),
});

/** Lists every agent, oldest first. */
export const listAgentsTask: StoreTask<null, readonly AgentRecord[]> = defineTask({
  name: "agents.list",
  access: "read",
  input: z.null(),
  output: z.array(agentRecordSchema),
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const agents = kysely.selectFrom("agents").selectAll().orderBy("created_at").orderBy("id");
    return execute(agents).rows.map(toAgentRecord);
  },
});
