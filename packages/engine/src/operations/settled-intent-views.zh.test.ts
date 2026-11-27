import { describe, expect, it } from "vitest";
import { confirmedSwapSettles } from "./test-settled-intents.js";

describe("the settle message of an intent the runtime proposed, for an owner who reads Chinese", () => {
  it("carries the receipt line in Chinese, as the owner's surfaces draw it", async () => {
    expect(await confirmedSwapSettles("zh")).toMatchObject([
      {
        shownReceipt: expect.stringMatching(/ 模拟成交：0\.000000000001 FAKE → 2 TKN$/u) as unknown,
      },
    ]);
  });
});
