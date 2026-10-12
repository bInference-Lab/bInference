import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";

const runtime = testCallers.runtime;
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const otherAgentClient: EngineCaller = {
  ...runtime,
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000077",
};
const usage = {
  agent: testAgent,
  turn,
  model: "anthropic/claude-sonnet-4-6",
  inputTokens: 12_000,
  outputTokens: 500,
  cachedTokens: 8_000,
  usdMicros: 23_400n,
};

describe("the runtime's usage in the engine", () => {
  it("takes each model call's usage from the runtime and answers the budget left", async () => {
    const test = await startTestEngine();
    const recorded = await test.engine.handlers["usage/record"](testCall(usage, runtime));
    expect(recorded).toStrictEqual({ ok: true, value: { budgetLeftMicros: 5_000_000n } });
  });

  it("refuses usage from any client but the runtime, and of an agent it does not hold", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    expect(await handlers["usage/record"](testCall(usage, otherAgentClient))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(
      await handlers["usage/record"](testCall({ ...usage, agent: stranger }, runtime)),
    ).toStrictEqual({ ok: false, error: "agent.not_found" });
  });
});
