import { accountRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { alertFireRowsPerAgent } from "@binference/engine/orders";
import { alertStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteAlertStore } from "./sqlite-alert-store.js";

const databases = createTestDatabases();
const live = { signal: new AbortController().signal };
afterAll(() => {
  databases.closeAll();
});

describe("sqlite alert store", () => {
  it.each(
    alertStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const first = plantAgent(database, 1).agentId;
        const second = plantAgent(database, 2).agentId;
        const { kysely, execute } = createSyncKysely<EngineTables>(database);
        const archive = async (agent: string) => {
          execute(kysely.updateTable("agents").set({ archived_at: 1 }).where("id", "=", agent));
          return Promise.resolve();
        };
        return {
          alerts: createSqliteAlertStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          agentIds: [first, second] as const,
          archive,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});

describe("sqlite alert fires", () => {
  it("keeps an agent's newest 1,000 fire records", async () => {
    const { host, database } = databases.open(engineDatabase);
    const { agentId } = plantAgent(database, 1);
    const alerts = createSqliteAlertStore(host);
    const id = idSchema("alr").parse("alr_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const account = accountRefSchema.parse("eip155:56:0x0000000000000000000000000000000000000001");
    const alert = {
      id,
      agentId,
      condition: { kind: "wallet", account } as const,
      state: "active",
      wake: false,
      fires: 0,
      outsideContent: false,
      createdBy: "telegram",
      createdAtMs: 1,
      changedAtMs: 1,
    } as const;
    await alerts.create(alert, live);
    const fires = Array.from({ length: alertFireRowsPerAgent + 1 }, (_, n) => n);
    await fires.reduce(async (before, n) => {
      await before;
      await alerts.fire({ id, expectedFires: n, atMs: 10 + n }, live);
    }, Promise.resolve());

    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const kept = takeFirst(
      kysely
        .selectFrom("alert_fires")
        .select((builder) => [
          builder.fn.countAll<number>().as("count"),
          builder.fn.min("at").as("oldest"),
        ]),
    );
    expect({ ...kept }).toStrictEqual({ count: alertFireRowsPerAgent, oldest: 11 });
  });
});
