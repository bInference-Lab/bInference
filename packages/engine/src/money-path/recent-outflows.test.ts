import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import type { ExecutionDraft } from "../positions/execution-record.js";
import { recentOutflowsOf } from "./recent-outflows.js";

const other = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const stranger = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000003");
const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const dayMs = 86_400_000;
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function execution(fields: Partial<ExecutionDraft>): ExecutionDraft {
  return {
    intentId,
    walletId: testWallet,
    isPaper: false,
    atMs: testNowMs,
    sold: { asset: testCoin, base: 10n },
    feeBase: 0n,
    bought: { asset: testToken, base: 20n },
    gas: { asset: testCoin, base: 1n },
    valueUsdMicros: 5_000_000n,
    feeUsdMicros: 0n,
    gasUsdMicros: 7n,
    ...fields,
  };
}

async function stored(executions: readonly ExecutionDraft[]) {
  const positions = createMemoryPositionStore();
  await Promise.all(
    executions.map(async (draft) => positions.record({ execution: draft, positions: [] }, live())),
  );
  return positions;
}

describe("the recent outflows", () => {
  it("counts each trade of the agent's wallets in the mode over the last 24 hours, fee in", async () => {
    const positions = await stored([
      execution({ atMs: testNowMs - dayMs, valueUsdMicros: 1n }),
      execution({ atMs: testNowMs - dayMs - 1, valueUsdMicros: 2n }),
      execution({ walletId: other, valueUsdMicros: 3n, feeUsdMicros: 4n }),
      execution({ walletId: stranger, valueUsdMicros: 5n }),
      execution({ isPaper: true, valueUsdMicros: 6n }),
    ]);
    const query = { wallets: [testWallet, other], isPaper: false, nowMs: testNowMs };
    await expect(recentOutflowsOf(positions, query, live())).resolves.toStrictEqual([
      { atMs: testNowMs - dayMs, valueUsdMicros: 1n },
      { atMs: testNowMs, valueUsdMicros: 7n },
    ]);
    const paper = { ...query, isPaper: true };
    await expect(recentOutflowsOf(positions, paper, live())).resolves.toStrictEqual([
      { atMs: testNowMs, valueUsdMicros: 6n },
    ]);
  });

  it("reads past a page of executions", async () => {
    const many = Array.from({ length: 1_001 }, () => execution({ valueUsdMicros: 1n }));
    const positions = await stored(many);
    const query = { wallets: [testWallet], isPaper: false, nowMs: testNowMs };
    const outflows = await recentOutflowsOf(positions, query, live());
    expect(outflows).toHaveLength(1_001);
  });

  it("reads nothing for an agent without a wallet, and refuses an aborted signal", async () => {
    const positions = await stored([execution({})]);
    const none = { wallets: [], isPaper: false, nowMs: testNowMs };
    await expect(recentOutflowsOf(positions, none, live())).resolves.toStrictEqual([]);
    const reason = new Error("stopped");
    const query = { ...none, wallets: [testWallet] };
    await expect(
      recentOutflowsOf(positions, query, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
