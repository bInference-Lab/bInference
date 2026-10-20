import { describe, expect, it } from "vitest";
import { cardOf, intentDraft, intentMove } from "../contracts/intent-fixtures.js";
import { live } from "../contracts/store-fixtures.js";
import { testAgent, testWallet } from "../intents/test-intents.js";
import { startTestEngine } from "./test-engine.js";

const hourMs = 3_600_000;

describe("the engine's daily summaries", () => {
  it("sends an agent's summary through the engine's own parts once its time came", async () => {
    const test = await startTestEngine();
    const pair = { agentId: testAgent, walletId: testWallet };
    await test.stores.intents.create(intentDraft(pair, 9), live());
    const opened = { ...intentMove(9, 0, "awaiting_confirmation"), openCard: cardOf(9, 1) };
    await test.stores.intents.transition(opened, live());
    const daily = () =>
      test.pushes.filter(({ data }) => JSON.stringify(data).includes("notice.daily"));
    await test.engine.sendDailySummaries(live());
    expect(daily()).toHaveLength(0);
    await test.clock.advance(hourMs);
    await test.engine.sendDailySummaries(live());
    await test.engine.sendDailySummaries(live());
    expect(daily()).toHaveLength(1);
  });
});
