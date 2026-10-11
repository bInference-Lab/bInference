import type { DatabaseSync } from "node:sqlite";
import { testAgent, testAgentDraft, testLimits, testNowMs } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { createIntent } from "../testing/create-intent.js";
import { createTestDatabases, type TestDatabase } from "../testing/test-databases.worker.js";
import { createRestoreGuards } from "./restore-guards.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});
const options = { signal: new AbortController().signal };
const hourMs = 3_600_000;
const hash = (digit: string): string => digit.repeat(64);

function kyselyOf(database: DatabaseSync) {
  return createSyncKysely<EngineTables>(database);
}

// One install's engine.sqlite with the test agent, a token and a device, as `init` leaves it.
async function installWith(changes: Parameters<typeof testAgentDraft>[0]): Promise<TestDatabase> {
  const opened = databases.open(engineDatabase);
  await createSqliteAgentStore(opened.host).create(testAgentDraft(changes), options);
  const { kysely, execute } = kyselyOf(opened.database);
  execute(
    kysely
      .insertInto("safety")
      .values({ id: 1, version: 0 })
      .onConflict((c) => c.doNothing()),
  );
  execute(
    kysely.insertInto("tokens").values({
      id: "tok_cli",
      label: "laptop",
      kind: "cli",
      scopes: '["read"]',
      secret_hash: hash("a"),
      created_at: 1,
      last_used_at: null,
      revoked_at: null,
      expires_at: null,
    }),
  );
  execute(
    kysely.insertInto("devices").values({
      id: "dev_phone",
      label: "phone",
      alg: "p256",
      public_key: "key",
      created_at: 1,
      last_seen_at: null,
      revoked_at: null,
    }),
  );
  return opened;
}

// An intent of the test agent confirmed an hour ago at `usd` micro-dollars, live.
async function spend(opened: TestDatabase, n: number, usd: bigint): Promise<void> {
  const walletId = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001";
  const { kysely, execute } = kyselyOf(opened.database);
  execute(
    kysely
      .insertInto("wallets")
      .values({
        id: walletId,
        agent_id: testAgent,
        family: "evm",
        custody: "privy",
        custody_wallet_id: "custody",
        policy_id: "policy",
        signer_id: "signer",
        address: `0x${"1".padStart(40, "0")}`,
        label: "main",
        created_at: 1,
        archived_at: null,
      })
      .onConflict((c) => c.doNothing()),
  );
  const id = await createIntent(opened.host, { agentId: testAgent, walletId } as never, n);
  execute(
    kysely.updateTable("intents").set({ value_usd_micros: usd.toString() }).where("id", "=", id),
  );
  execute(
    kysely
      .updateTable("intent_events")
      .set({ at: testNowMs - hourMs })
      .where("intent_id", "=", id),
  );
}

describe("the guards a restore carries into the restored database", () => {
  it("keeps revokes, the owner, freezes, stricter limits and the day's spend", async () => {
    // The backup: auto mode and looser limits, and nothing revoked or frozen.
    const restored = await installWith({
      approvalMode: "auto",
      limits: { ...testLimits, perTradeUsdMicros: 9_000_000_000n },
    });
    // The state it replaces: the owner since revoked the token and the device, paired a new
    // Telegram owner, froze, tightened the per-trade cap and spent 3 USD in the last day.
    const current = await installWith({
      limits: { ...testLimits, perTradeUsdMicros: 1_000_000n },
    });
    const now = kyselyOf(current.database);
    now.execute(now.kysely.updateTable("tokens").set({ revoked_at: testNowMs - 2 * hourMs }));
    now.execute(now.kysely.updateTable("devices").set({ revoked_at: testNowMs - 2 * hourMs }));
    now.execute(now.kysely.updateTable("safety").set({ frozen_at: testNowMs - hourMs }));
    now.execute(
      now.kysely.insertInto("telegram_owner").values({ id: 1, user_id: 42, paired_at: testNowMs }),
    );
    await spend(current, 1, 3_000_000n);
    const read = await createRestoreGuards(current.host).read(testNowMs, options);

    const after = await createRestoreGuards(restored.host).carry(read, testNowMs, options);

    expect(after.access.tokens).toStrictEqual(read.access.tokens);
    expect(after.access.devices[0]?.["revoked_at"]).toBe(testNowMs - 2 * hourMs);
    expect(after.telegramOwner).toStrictEqual({ userId: 42, pairedAtMs: testNowMs });
    expect(after.safety.frozenAtMs).toBe(testNowMs - hourMs);
    const agent = after.agents[0];
    expect(agent?.approvalMode).toBe("manual");
    expect(agent?.limits.values.perTradeUsdMicros).toBe(1_000_000n);
    expect(after.outflows.map((outflow) => outflow.valueUsdMicros)).toStrictEqual([3_000_000n]);
    const counted = await createSqliteIntentStore(restored.host).confirmedSince(
      { agentId: testAgent, isPaper: false, fromMs: testNowMs - 24 * hourMs },
      options,
    );
    expect(counted.map((intent) => intent.valueUsdMicros)).toStrictEqual([3_000_000n]);
  });

  it("counts a carried intent once, in the place of the restored copy's own", async () => {
    const restored = await installWith({});
    await spend(restored, 2, 1_000_000n);
    const current = await installWith({});
    await spend(current, 2, 2_000_000n);
    const read = await createRestoreGuards(current.host).read(testNowMs, options);

    await createRestoreGuards(restored.host).carry(read, testNowMs, options);

    const counted = await createSqliteIntentStore(restored.host).confirmedSince(
      { agentId: testAgent, isPaper: false, fromMs: testNowMs - 24 * hourMs },
      options,
    );
    expect(counted.map((intent) => intent.valueUsdMicros)).toStrictEqual([2_000_000n]);
  });
});
