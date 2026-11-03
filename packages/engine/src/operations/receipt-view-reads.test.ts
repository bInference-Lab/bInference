import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

async function proposed(): Promise<{ readonly test: TestEngine; readonly view: IntentView }> {
  const test = await startTestEngine();
  const view = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
  return { test, view };
}

function answerArgs(view: IntentView) {
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("Expected an intent with a card.");
  }
  return { intent: view.intent, card, cardVersion: 1 };
}

async function read(test: TestEngine, view: IntentView) {
  const got = expectOk(await test.engine.handlers["intent/get"](testCall({ intent: view.intent })));
  const listed = expectOk(await test.engine.handlers["intent/list"](testCall({})));
  return { got, listed: listed.items.find((item) => item.intent === view.intent) };
}

describe("the receipt in an intent's view", () => {
  it("is absent while the card is open", async () => {
    const { test, view } = await proposed();
    const { got, listed } = await read(test, view);
    expect([got.receipt, listed?.receipt]).toStrictEqual([undefined, undefined]);
  });

  it("is the paper fill once a confirmed paper card filled, in get and list alike", async () => {
    const { test, view } = await proposed();
    const confirmed = expectOk(
      await test.engine.handlers["intent/confirm"](testCall(answerArgs(view))),
    );
    const { got, listed } = await read(test, view);
    expect(got.receipt?.key).toBe("receipt.paper");
    expect(listed?.receipt).toStrictEqual(got.receipt);
    expect(confirmed.receipt).toStrictEqual(got.receipt);
    expect(Object.keys(got.assets)).toStrictEqual(expect.arrayContaining([testCoin, testToken]));
  });

  it("says a cancelled card was cancelled, and where", async () => {
    const { test, view } = await proposed();
    const { cardVersion: _version, ...args } = answerArgs(view);
    await test.engine.handlers["intent/deny"](testCall(args));
    const { got } = await read(test, view);
    expect(got.receipt).toStrictEqual({
      key: "receipt.denied",
      values: { surface: { type: "choice", choice: "cli" } },
    });
  });
});
