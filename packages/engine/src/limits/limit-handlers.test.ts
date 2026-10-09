import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testLimits, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, testCall } from "../operations/test-engine.js";

describe("the limits operation", () => {
  it("answers the agent's limits with the gas reserve per chain", async () => {
    const test = await startTestEngine();
    const answer = await test.engine.handlers["limit/get"](testCall({ agent: testAgent }));

    expect(answer).toStrictEqual({
      ok: true,
      value: {
        agent: testAgent,
        perTradeUsdMicros: testLimits.perTradeUsdMicros,
        rollingDayUsdMicros: testLimits.rollingDayUsdMicros,
        slippageRegistryBps: testLimits.slippageRegistryBps,
        slippageOtherBps: testLimits.slippageOtherBps,
        priceImpactBps: testLimits.priceImpactBps,
        taxBps: testLimits.taxBps,
        liquidityFloorUsdMicros: testLimits.liquidityFloorUsdMicros,
        minHealthFactorBps: 15_000,
        gasReserve: { "fake:1": 10n ** 15n },
        venues: ["fake-swap"],
        allowTokens: [],
        denyTokens: [],
        modelBudgetUsdMicros: testLimits.modelBudgetUsdMicros,
        cardTradeExpirySeconds: 60,
        cardOtherExpirySeconds: 600,
        requoteAfterSeconds: 10,
        requoteToleranceBps: testLimits.requoteToleranceBps,
        orderExpiryDays: 30,
        copyPerBuyUsdMicros: testLimits.copyPerBuyUsdMicros,
        copyPerLeaderDayUsdMicros: testLimits.copyPerLeaderDayUsdMicros,
        changedAt: testNowMs - 1_000,
      },
    });
  });

  it("refuses an unknown agent", async () => {
    const test = await startTestEngine();
    const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");

    expect(await test.engine.handlers["limit/get"](testCall({ agent }))).toStrictEqual(
      err("agent.not_found"),
    );
  });
});
