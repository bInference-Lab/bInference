import { assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ExecutionWrite } from "@binference/engine";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgentOn } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqlitePositionStore } from "./sqlite-position-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = () => ({ signal: AbortSignal.timeout(30_000) });
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");

function buying(
  held: { readonly intentId: Id<"int">; readonly walletId: Id<"wal"> },
  quantityBase: bigint,
  readVersion?: number,
): ExecutionWrite {
  const { intentId, walletId } = held;
  const position = {
    walletId,
    asset: token,
    isPaper: false,
    quantityBase,
    costUsdMicros: 1_000n,
    realizedUsdMicros: 0n,
    changedAtMs: 1_000,
  };
  return {
    execution: {
      intentId,
      walletId,
      isPaper: false,
      atMs: 1_000,
      sold: { asset: coin, base: 10n },
      feeBase: 0n,
      bought: { asset: token, base: 10n },
      gas: { asset: coin, base: 1n },
      valueUsdMicros: 1_000n,
      feeUsdMicros: 0n,
      gasUsdMicros: 1n,
    },
    positions: [readVersion === undefined ? { position } : { position, readVersion }],
    realizedUsdMicros: 0n,
  };
}

describe("an execution's position writes", () => {
  it("roll back whole when a version's update moves no row", async () => {
    const { host, database } = databases.open(engineDatabase);
    const agent = await plantAgentOn(host, 1);
    const held = { intentId: await createIntent(host, agent, 1), walletId: agent.walletId };
    const store = createSqlitePositionStore(host);
    expect((await store.record(buying(held, 10n), live())).ok).toBe(true);
    // A trigger that skips the row stands in for a row the write no longer holds.
    database.exec(
      "CREATE TRIGGER skip_moves BEFORE UPDATE ON positions BEGIN SELECT RAISE(IGNORE); END",
    );

    await expect(store.record(buying(held, 20n, 0), live())).rejects.toMatchObject({
      code: "store.constraint",
    });
    const page = { after: 0, limit: 10, isPaper: false };
    expect(await store.executions(page, live())).toHaveLength(1);
  });
});
