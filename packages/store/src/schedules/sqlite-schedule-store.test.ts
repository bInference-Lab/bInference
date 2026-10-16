import { idSchema } from "@binference/core";
import { scheduleStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteScheduleStore, scheduleTasks } from "./sqlite-schedule-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

describe("sqlite schedule store", () => {
  it.each(
    scheduleStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const { agentId } = plantAgent(database, 1);
        return {
          schedules: createSqliteScheduleStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          agentId,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps a row for each run, sent or skipped with its reason", async () => {
    const { host, database } = databases.open(engineDatabase);
    const { agentId } = plantAgent(database, 1);
    const schedules = createSqliteScheduleStore(host);
    const id = idSchema("sch").parse("sch_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const record = {
      id,
      agentId,
      when: { at: 10 },
      prompt: "review",
      state: "active",
      nextAtMs: 10,
      createdBy: "telegram",
      outsideContent: true,
      createdAtMs: 1,
      changedAtMs: 1,
    } as const;
    await schedules.create(record, live);
    const wake = {
      id: idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      turnId: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      opens: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      payload: {},
    };
    await schedules.run({ id, dueAtMs: 10, atMs: 12, skip: "frozen", wake }, live);
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(kysely.selectFrom("schedule_runs").selectAll()).rows;
    expect(rows.map((row) => Object.fromEntries(Object.entries(row)))).toStrictEqual([
      {
        schedule_id: id,
        due_at: 10,
        at: 12,
        outcome: "skipped",
        reason: "frozen",
        message_id: null,
      },
    ]);
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...scheduleTasks]));
  });
});
