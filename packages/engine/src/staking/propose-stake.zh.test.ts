import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall } from "../operations/test-engine.js";
import { stakeRequest, startStakeEngine, testStakingFake, withOwnCap } from "./test-stakes.js";

describe("proposing a stake, in Chinese", () => {
  it("opens a card with the validator, its commission and yearly rate, and the days an unstake waits", async () => {
    const test = await startStakeEngine(withOwnCap(testStakingFake()));

    const view = expectOk(
      await test.engine.handlers["intent/propose"](testCall(stakeRequest("stake"))),
    );

    expect((await testCardText(test, view, "zh")).slice(1, 5)).toStrictEqual([
      "向 Active（0x000000c1） 质押 0.5 FAKE",
      "验证者 Active（0x000000c1） · 佣金 7.00%",
      "年化收益率 3.50%，按其最近一天的收益计算",
      "日后解除质押需等待 7 天才能领取",
    ]);
  });
});
