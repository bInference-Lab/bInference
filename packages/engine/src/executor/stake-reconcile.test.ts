import type { Amount } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testWallet } from "../intents/test-intents.js";
import {
  halfCoin,
  stakedFake,
  stakeRequest,
  testStakingFake,
  testStakingVenue,
  testUnbondingSeconds,
  testValidator,
} from "../staking/test-stakes.js";
import { benchChain, driveUntil, stateOf, type ExecutorBench, tapped } from "./test-executor.js";
import { landing, stakeBench, stakeEnds, stakeReceiptOf } from "./test-stake-bench.js";

const live = { signal: new AbortController().signal };
const mine = { isPaper: false, walletId: testWallet, after: 0, limit: 10 };
const open = { walletId: testWallet, isPaper: false, venue: testStakingVenue };
const dayMs = 86_400_000;
const done = String.fromCodePoint(0x2705);

async function executionsOf(bench: ExecutorBench) {
  const executions = await bench.test.positions.executions(mine, live);
  return executions.map(({ sold, bought, valueUsdMicros }) => ({ sold, bought, valueUsdMicros }));
}

async function soldOf(bench: ExecutorBench) {
  const executions = await bench.test.positions.executions(mine, live);
  return executions.map((execution: { readonly sold: Amount }) => execution.sold);
}

// The bytes of the speed-up the stuck rules signed for the intent's step.
async function speedUpOf(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const [, speedUp] = await bench.test.stores.transactions.ofIntent(intent, live);
  if (speedUp === undefined) {
    throw new Error("Expected a speed-up.");
  }
  return speedUp.raw;
}

async function arrivalsOf(bench: ExecutorBench) {
  const arrivals = await bench.test.positions.arrivals(mine, live);
  return arrivals.map(({ received, valueUsdMicros }) => ({ received, valueUsdMicros }));
}

// The keys of the notices the engine and its executor sent, oldest first.
function noticeKeysOf(bench: ExecutorBench): readonly string[] {
  return [...bench.test.pushes, ...bench.pushes]
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => /"key":"([^"]+)"/.exec(JSON.stringify(data))?.[1] ?? "");
}

describe("a landed staking move, booked from its venue's read-back (decision 0327)", () => {
  it("books a stake once as the coin it spent for the receipt units it minted", async () => {
    const fake = testStakingFake();
    const bench = await stakeBench(landing(fake));
    const intent = await tapped(bench, stakeRequest("stake"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("reconciled");
    const [execution, ...more] = await executionsOf(bench);
    expect(more).toStrictEqual([]);
    expect(execution?.sold).toStrictEqual(halfCoin);
    expect(execution?.bought.base).toBe(halfCoin.base);
    expect(execution?.valueUsdMicros).toBe(300_000_000n);
  });

  it("opens an unstake's unbonding at the venue's ready time, says it, and tells once it is ready", async () => {
    const fake = await stakedFake();
    const bench = await stakeBench(landing(fake));
    const intent = await tapped(bench, stakeRequest("unstake"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("reconciled");
    const rows = await bench.test.stores.unbondings.listOpen(
      { ...open, validator: testValidator },
      live,
    );
    expect(rows.map(({ amount, valueUsdMicros }) => [amount, valueUsdMicros])).toStrictEqual([
      [halfCoin, 300_000_000n],
    ]);
    await expect(stakeReceiptOf(bench, intent, "en")).resolves.toMatch(
      new RegExp(
        `^${done} Unstaked 0.5 FAKE: claim it from Jan 29, 2027, 08:00:01 · https://.+/tx/`,
        "u",
      ),
    );
    await bench.test.clock.advance(2 * testUnbondingSeconds * 1_000 + dayMs);
    await expect(bench.test.engine.tellClaimsReady(live)).resolves.toBe(1);
    await expect(bench.test.engine.tellClaimsReady(live)).resolves.toBe(0);
    expect(noticeKeysOf(bench).filter((key) => key === "notice.claimReady")).toHaveLength(1);
  });

  it("books a claim of a part unstaked elsewhere as coin with no value, once", async () => {
    const fake = await stakedFake();
    const bench = await stakeBench(landing(fake));
    const intent = await tapped(bench, stakeRequest("claim"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("reconciled");
    await driveUntil(bench, intent, { states: [], blocks: 3 });
    expect(await arrivalsOf(bench)).toStrictEqual([
      { received: { asset: testCoin, base: 10n ** 18n }, valueUsdMicros: undefined },
    ]);
  });

  it("books a dropped stake that landed after all once, and leaves its intent failed", async () => {
    const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
    const bench = await stakeBench(landing(testStakingFake()), { limits });
    for (const relay of ["relay-a", "relay-b"]) {
      bench.network.script(relay, { kind: "refuse", reason: "insufficient_funds" });
    }
    const intent = await tapped(bench, stakeRequest("stake"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_onchain");
    for (const relay of ["relay-a", "relay-b"]) {
      bench.network.script(relay, { kind: "accept" });
    }
    await bench.network.send({ chain: benchChain, raw: await speedUpOf(bench, intent) }, live);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(await soldOf(bench)).toStrictEqual([halfCoin]);
    await expect(stateOf(bench, intent)).resolves.toBe("failed_onchain");
  });
});
