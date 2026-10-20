import { describe, expect, it } from "vitest";
import { live } from "../contracts/store-fixtures.js";
import { testAgent } from "../intents/test-intents.js";
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
      waits: { cards: 1, question: true, limits: 1, heldWallets: 1 },
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

  it("reads a quiet day as nothing but the holdings", async () => {
    const rig = await startDayRig();
    expect(await factsNow(rig)).toStrictEqual({
      live: { totalUsdMicros: 1_200_000_000n, realizedUsdMicros: 0n, trades: 0 },
      paper: { totalUsdMicros: 600_000_000n, realizedUsdMicros: 0n, trades: 0 },
      fills: { filled: 0, skipped: [] },
      openOrders: 0,
      spendUsdMicros: 0n,
      budgetUsdMicros: 5_000_000n,
      waits: { cards: 0, question: false, limits: 0, heldWallets: 0 },
    });
  });
});
