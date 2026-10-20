import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { DailySummaryOptions } from "./daily-summaries.js";
import { fixtureDay } from "./test-summary-day.js";
import { fixtureDueMs } from "./test-summary-parts.js";
import { type SummaryRig, startSummaryRig, summariesIn } from "./test-summary-rig.js";

// The live and paper icons the card spec names.
const liveIcon = String.fromCodePoint(0x1f534);
const paperIcon = String.fromCodePoint(0x1f9ea);

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

/** The fixture day's summary, as the owner reads it in English. */
const fixtureSummary = [
  "Daily summary for main, the last 24 hours",
  `${liveIcon} Live: $1,200.00, +$50.00 in 24 hours; realized P&L +$12.40`,
  `${paperIcon} Paper: $600.00, -$12.40 in 24 hours; realized P&L -$3.10`,
  "Auto orders: 3 filled, 3 skipped, 3 open",
  "Model spend: $1.20, against a daily model budget of $5.00",
  "1 card waits for your answer",
  "The agent waits for your answer to its question",
  "1 looser limit takes effect within 24 hours",
  "1 wallet waits behind a stuck transaction",
  "2 skips: the wallet holds too little of this token",
  "1 skip: it would pass your 24-hour cap",
].join("\n");

// Moves the rig's clock to a moment and runs the summaries there.
async function runAt(rig: SummaryRig, atMs: number): Promise<void> {
  await rig.clock.advance(atMs - rig.clock.now());
  await rig.run();
}

async function latestDate(rig: SummaryRig) {
  return (await rig.test.stores.dailySummaries.latest(testAgent, live()))?.date;
}

describe("the daily summary of a fixture day", () => {
  it("tells the day in English, live and paper on lines of their own", async () => {
    const rig = await startSummaryRig();
    await fixtureDay(rig);
    await rig.run();
    expect(summariesIn(rig, "en")).toStrictEqual([fixtureSummary]);
  });

  it("stores the date it is for and the totals it read", async () => {
    const rig = await startSummaryRig();
    await fixtureDay(rig);
    await rig.run();
    expect(await rig.test.stores.dailySummaries.latest(testAgent, live())).toStrictEqual({
      agentId: testAgent,
      date: "2027-01-16",
      atMs: fixtureDueMs,
      outcome: "sent",
      liveUsdMicros: 1_200_000_000n,
      paperUsdMicros: 600_000_000n,
    });
  });

  it("publishes the notice alone: it starts no turn and moves no money", async () => {
    const rig = await startSummaryRig();
    await fixtureDay(rig);
    const intents = await rig.test.stores.intents.list({ states: ["proposed"], limit: 10 }, live());
    const ledger = await rig.test.stores.ledger.list({ after: 0, limit: 100 }, live());
    await rig.run();
    expect(rig.pushes.map(({ topic, kind }) => `${topic} ${kind}`)).toStrictEqual([
      "notice notice/new",
    ]);
    expect(
      await rig.test.stores.intents.list({ states: ["proposed"], limit: 10 }, live()),
    ).toStrictEqual(intents);
    expect(await rig.test.stores.ledger.list({ after: 0, limit: 100 }, live())).toStrictEqual(
      ledger,
    );
    expect(
      await rig.test.stores.agentInbox.untaken({ agentId: testAgent, limit: 10 }, live()),
    ).toStrictEqual([]);
  });
});

describe("the daily summary's time", () => {
  it("waits for 09:00 on the owner's wall clock, then goes once that date", async () => {
    const rig = await startSummaryRig({ startMs: fixtureDueMs - 60_000 });
    await fixtureDay(rig);
    await rig.run();
    expect(rig.pushes).toHaveLength(0);
    await runAt(rig, fixtureDueMs);
    await runAt(rig, fixtureDueMs + 60_000);
    await runAt(rig, fixtureDueMs + 14 * hourMs);
    expect(rig.pushes).toHaveLength(1);
  });

  it("goes once a day across a restart", async () => {
    const rig = await startSummaryRig();
    await fixtureDay(rig);
    await rig.run();
    rig.restart();
    await runAt(rig, fixtureDueMs + 60_000);
    expect(rig.pushes).toHaveLength(1);
    await runAt(rig, fixtureDueMs + dayMs);
    expect(rig.pushes).toHaveLength(2);
    expect(await latestDate(rig)).toBe("2027-01-17");
  });

  it("sends a summary missed while off at the first run of the same date, never later", async () => {
    const rig = await startSummaryRig({ startMs: fixtureDueMs + 13 * hourMs });
    await fixtureDay(rig);
    await rig.run();
    expect(rig.pushes).toHaveLength(1);
    expect(await latestDate(rig)).toBe("2027-01-16");
    await runAt(rig, fixtureDueMs + dayMs - 30 * 60_000);
    expect(rig.pushes).toHaveLength(1);
    await runAt(rig, fixtureDueMs + 2 * dayMs + hourMs);
    expect(rig.pushes).toHaveLength(2);
    expect(await latestDate(rig)).toBe("2027-01-18");
  });

  it("goes at the time of day the agent's notice settings name", async () => {
    const rig = await startSummaryRig({ startMs: fixtureDueMs });
    await fixtureDay(rig);
    const moved = { agent: testAgent, dailySummaryTime: "18:30" };
    await rig.test.engine.handlers["notice/setSettings"](testCall(moved));
    await rig.run();
    expect(rig.pushes).toHaveLength(0);
    await runAt(rig, fixtureDueMs + 9.5 * hourMs);
    expect(rig.pushes).toHaveLength(1);
  });
});

describe("the daily summary of an agent with nothing to tell", () => {
  it("sends nothing for an idle agent, and keeps its totals for the next day", async () => {
    const rig = await startSummaryRig();
    await rig.run();
    expect(rig.pushes).toHaveLength(0);
    expect(await rig.test.stores.dailySummaries.latest(testAgent, live())).toStrictEqual({
      agentId: testAgent,
      date: "2027-01-16",
      atMs: fixtureDueMs,
      outcome: "idle",
      liveUsdMicros: 1_200_000_000n,
      paperUsdMicros: 600_000_000n,
    });
  });

  it("says when the live balances could not be read, and tells the rest", async () => {
    const rig = await startSummaryRig({ isChainDown: true });
    await fixtureDay(rig);
    await rig.run();
    const [summary] = summariesIn(rig, "en");
    expect(summary?.split("\n").slice(0, 3)).toStrictEqual([
      "Daily summary for main, the last 24 hours",
      `${liveIcon} Live: the balances could not be read now; realized P&L +$12.40`,
      `${paperIcon} Paper: $600.00, -$12.40 in 24 hours; realized P&L -$3.10`,
    ]);
    expect((await rig.test.stores.dailySummaries.latest(testAgent, live()))?.liveUsdMicros).toBe(
      undefined,
    );
  });
});

// The summaries' parts with an agent listed that is gone when its settings are read, first, and
// the test agent's latest summary failing to read.
function failingFor(fault: Readonly<BinferenceError>) {
  return (options: DailySummaryOptions): DailySummaryOptions => ({
    ...options,
    agents: {
      list: async (call) => {
        const agents = await options.agents.list(call);
        return [...agents.map((agent) => ({ ...agent, id: fixtureId("agt", 8) })), ...agents];
      },
      get: async (id, call) => options.agents.get(id, call),
    },
    summaries: {
      ...options.summaries,
      latest: async (id, call) =>
        id === testAgent ? Promise.reject(fault) : options.summaries.latest(id, call),
    },
  });
}

describe("a daily summary that cannot be read", () => {
  it("leaves the other agents' summaries to go, then throws the fault", async () => {
    const other = fixtureId("agt", 7);
    const fault = new BinferenceError({ code: "store.unavailable", message: "The store is gone." });
    const rig = await startSummaryRig({ wrap: failingFor(fault) });
    await rig.test.stores.agents.create(testAgentDraft({ id: other, name: "second" }), live());
    await rig.test.stores.questions.ask(
      {
        id: fixtureId("qst", 2),
        agentId: other,
        sessionId: fixtureId("ses", 2),
        turnId: fixtureId("trn", 3),
        text: "Buy more?",
        choices: ["Yes", "No"],
        ref: "questionref0002x",
        state: "open",
        createdAtMs: fixtureDueMs - hourMs,
        closesAtMs: fixtureDueMs + hourMs,
      },
      live(),
    );
    await expect(rig.run()).rejects.toBe(fault);
    expect(summariesIn(rig, "en")).toStrictEqual([
      "Daily summary for second, the last 24 hours\nModel spend: $0.00, against a daily model budget of $5.00\nThe agent waits for your answer to its question",
    ]);
  });
});
