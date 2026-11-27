import { describe, expect, it } from "vitest";
import { expectOk, testSwap } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "./test-engine.js";
import { confirmedSwapSettles, settlesOf } from "./test-settled-intents.js";

describe("the settle message of an intent the runtime proposed", () => {
  it("carries the receipt line the owner reads, with exact amounts", async () => {
    expect(await confirmedSwapSettles("en")).toMatchObject([
      {
        intent: { state: "paper_filled", receipt: { key: "receipt.paper" } },
        shownReceipt: expect.stringMatching(
          / Paper fill: 0\.000000000001 FAKE → 2 TKN$/u,
        ) as unknown,
      },
    ]);
  });

  it("carries no receipt line for an intent whose card never closed", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    const swap = testCall(testSwap(), testCallers.runtime);
    expect(expectOk(await test.engine.handlers["intent/propose"](swap)).state).toBe("paper_filled");
    const [settled] = settlesOf(test);
    expect(settled).toMatchObject({ kind: "inbox/intentSettled" });
    expect(settled).not.toHaveProperty("shownReceipt");
  });
});
