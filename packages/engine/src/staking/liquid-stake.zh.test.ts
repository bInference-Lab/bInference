import { describe, expect, it } from "vitest";
import { liquidWordsOf, refusedBeforePlan } from "./test-liquid-stakes.js";

const refused = String.fromCodePoint(0x274c);

describe("staking on a liquid pool, in Chinese (decision 0331)", () => {
  it("names the pool by its name in the words of a refusal before any plan", async () => {
    const views = await refusedBeforePlan();

    expect(views.map((view) => liquidWordsOf(view, "zh"))).toStrictEqual([
      `${refused} 未发送：该钱包未向 Pool（0x000000e1） 质押任何金额`,
      `${refused} 未发送：超过了该钱包向 Pool（0x000000e1） 质押的价值；请全部解除质押，或减少金额`,
    ]);
  });
});
