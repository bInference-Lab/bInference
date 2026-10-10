import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

async function proposed(test: TestEngine) {
  const view = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
  if (view.card === undefined) {
    throw new Error("Expected the intent's card.");
  }
  return { ...view, card: view.card };
}

describe("an intent's card for a surface without buttons", () => {
  it("answers the open card version line by line, with every asset it names", async () => {
    const test = await startTestEngine();
    const view = await proposed(test);

    const drawn = expectOk(
      await test.engine.handlers["intent/card"](testCall({ intent: view.intent })),
    );

    expect(drawn).toMatchObject({ card: view.card.card, version: 1 });
    expect(drawn.expiresAt).toBe(view.card.expiresAt);
    expect(drawn.lines.map((line) => line.key)).toContain("card.swap.action");
    expect(drawn.lines.at(0)?.key).toBe("card.header");
    expect(drawn.assets[testCoin]?.decimals).toBe(18);
  });

  it("is the wrong state once the card closed, and not found for an unknown intent", async () => {
    const test = await startTestEngine();
    const view = await proposed(test);
    const { card } = view.card;
    expectOk(await test.engine.handlers["intent/deny"](testCall({ intent: view.intent, card })));
    const unknown = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");

    expect(
      await test.engine.handlers["intent/card"](testCall({ intent: view.intent })),
    ).toStrictEqual(err("intent.wrong_state"));
    expect(await test.engine.handlers["intent/card"](testCall({ intent: unknown }))).toStrictEqual(
      err("intent.not_found"),
    );
  });
});
