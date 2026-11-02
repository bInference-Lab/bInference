import { accountRefSchema, assetRefSchema, chainRefSchema, isTxHash } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { BridgeDraft } from "../bridges/bridge-record.js";
import { live } from "../contracts/store-fixtures.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testNowMs,
  testSwap,
  testWallet,
} from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { UnbondingDraft } from "../staking/unbonding-record.js";
import { summaryFactsOf } from "./read-summary-facts.js";
import type { SummaryFacts } from "./summary-facts.js";
import { fixtureDay } from "./test-summary-day.js";
import { type DayRig, startDayRig } from "./test-summary-parts.js";

const dayMs = 86_400_000;

// The agent's last 24 hours as its summary reads them at the rig's time.
async function factsNow(rig: DayRig): Promise<SummaryFacts> {
  const settings = await rig.test.stores.agents.get(testAgent, live());
  if (settings === undefined) {
    throw new Error("The rig stores its agent.");
  }
  const nowMs = rig.clock.now();
  return summaryFactsOf(rig.parts, { settings, fromMs: nowMs - dayMs, nowMs, ...live() });
}

describe("the facts of an agent's daily summary", () => {
  it("reads the fixture day: live and paper apart, the day's orders, spend and waits", async () => {
    const rig = await startDayRig();
    await fixtureDay(rig);
    expect(await factsNow(rig)).toStrictEqual({
      live: { totalUsdMicros: 1_200_000_000n, realizedUsdMicros: 12_400_000n, trades: 1 },
      paper: { totalUsdMicros: 600_000_000n, realizedUsdMicros: -3_100_000n, trades: 1 },
      fills: {
        filled: 3,
        skipped: [
          { reason: "nothing_to_sell", count: 2 },
          { reason: "daily_cap", count: 1 },
        ],
      },
      openOrders: 3,
      spendUsdMicros: 1_200_000n,
      budgetUsdMicros: 5_000_000n,
      waits: {
        cards: 1,
        question: true,
        limits: 1,
        heldWallets: 1,
        sendLevel: false,
        rescueAddress: false,
        lateBridges: 0,
        readyClaims: 0,
      },
    });
  });

  it("leaves the live total out when no chain answers, and reads the rest", async () => {
    const rig = await startDayRig({ isChainDown: true });
    await fixtureDay(rig);
    const facts = await factsNow(rig);
    expect(facts.live).toStrictEqual({ realizedUsdMicros: 12_400_000n, trades: 1 });
    expect(facts.paper.totalUsdMicros).toBe(600_000_000n);
  });

  it("reads a question the agent can no longer be answered as not waiting", async () => {
    const rig = await startDayRig();
    await fixtureDay(rig);
    await rig.clock.advance(2 * 3_600_000);
    expect((await factsNow(rig)).waits.question).toBe(false);
  });

  it("reads a looser send level and a new rescue address that wait as waiting", async () => {
    const rig = await startDayRig();
    const { engine, stores } = rig.test;
    await engine.handlers["sendLevel/set"](testCall({ agent: testAgent, level: 2 }));
    await engine.handlers["sendLevel/set"](testCall({ agent: testAgent, level: 0 }));
    const rescue = accountRefSchema.parse("fake:1:0x000000b2");
    await stores.install.changeRescue({ address: rescue, atMs: testNowMs }, live());
    const { waits } = await factsNow(rig);
    expect([waits.sendLevel, waits.rescueAddress]).toStrictEqual([true, true]);
    await rig.clock.advance(dayMs);
    const later = await factsNow(rig);
    expect([later.waits.sendLevel, later.waits.rescueAddress]).toStrictEqual([false, false]);
  });

  it("reads a quiet day as nothing but the holdings", async () => {
    const rig = await startDayRig();
    expect(await factsNow(rig)).toStrictEqual({
      live: { totalUsdMicros: 1_200_000_000n, realizedUsdMicros: 0n, trades: 0 },
      paper: { totalUsdMicros: 600_000_000n, realizedUsdMicros: 0n, trades: 0 },
      fills: { filled: 0, skipped: [] },
      openOrders: 0,
      spendUsdMicros: 0n,
      budgetUsdMicros: 5_000_000n,
      waits: {
        cards: 0,
        question: false,
        limits: 0,
        heldWallets: 0,
        sendLevel: false,
        rescueAddress: false,
        lateBridges: 0,
        readyClaims: 0,
      },
    });
  });

  it("counts the agent's late bridges and its unstakes ready to claim, live and paper", async () => {
    const rig = await startDayRig();
    const [ready, paperReady, later, bridge] = await fourIntents(rig);
    const nowMs = rig.clock.now();
    const { unbondings, bridges } = rig.test.stores;
    const rows: readonly UnbondingDraft[] = [
      unbondingOf(ready, { isPaper: false, readyAtMs: nowMs }),
      unbondingOf(paperReady, { isPaper: true, readyAtMs: nowMs - 1 }),
      unbondingOf(later, { isPaper: false, readyAtMs: nowMs + 1 }),
    ];
    await Promise.all(rows.map(async (row) => unbondings.open(row, live())));
    await bridges.open(bridgeDraft(bridge), live());
    await bridges.move({ intentId: bridge, expectedVersion: 0, atMs: nowMs, to: "late" }, live());
    const { waits } = await factsNow(rig);
    expect([waits.lateBridges, waits.readyClaims]).toStrictEqual([1, 2]);
  });
});

// Four intents of the rig's agent, which unbondings and bridges name.
async function fourIntents(
  rig: DayRig,
): Promise<readonly [Id<"int">, Id<"int">, Id<"int">, Id<"int">]> {
  const propose = async () =>
    expectOk(await rig.test.engine.handlers["intent/propose"](testCall(testSwap()))).intent;
  return [await propose(), await propose(), await propose(), await propose()];
}

function unbondingOf(
  intentId: Id<"int">,
  row: { readonly isPaper: boolean; readonly readyAtMs: number },
): UnbondingDraft {
  return {
    intentId,
    walletId: testWallet,
    venue: "fake-staking",
    requestRef: `r-${intentId}`,
    amount: { asset: testCoin, base: 1n },
    ...row,
  };
}

function bridgeDraft(intentId: Id<"int">): BridgeDraft {
  const depositTx = `0x${"ab".repeat(32)}`;
  if (!isTxHash(depositTx)) {
    throw new Error("The fixture's hash is not one.");
  }
  return {
    intentId,
    venue: "fake-bridge",
    depositTx,
    toChain: chainRefSchema.parse("fake:2"),
    recipient: accountRefSchema.parse("fake:2:0x0000000c"),
    sent: { asset: testCoin, base: 1n },
    minOut: { asset: assetRefSchema.parse("fake:2/slip44:1"), base: 1n },
    sentAtMs: 1,
  };
}
