import { describe, expect, it } from "vitest";
import { liquidCardLines, liquidWordsOf, refusedBeforePlan } from "./test-liquid-stakes.js";

const refused = String.fromCodePoint(0x274c);

describe("staking on a liquid pool, in Chinese (decision 0331)", () => {
  it("draws a stake's, an unstake's and a claim's cards with the pool's name and no validator", async () => {
    const [stake, unstake, claim] = await liquidCardLines("zh");

    expect([stake?.[1], unstake?.[1], unstake?.[3], claim?.[1]]).toStrictEqual([
      "在 Pool 质押 0.5 FAKE，至少获得 0.454545 UNL（0x000000e2）",
      "从 Pool 解除质押 0.1 UNL（0x000000e2）",
      "由 Pool 自己的队列放行，可能更久；可以领取时 binference 会通知你",
      "领取你在 Pool 解除质押的 0.11 FAKE",
    ]);
  });

  it("names the pool by its name in the words of a refusal before any plan", async () => {
    const views = await refusedBeforePlan();

    expect(views.map((view) => liquidWordsOf(view, "zh"))).toStrictEqual([
      `${refused} 未发送：该钱包未向 Pool（0x000000e1） 质押任何金额`,
      `${refused} 未发送：超过了该钱包向 Pool（0x000000e1） 质押的价值；请全部解除质押，或减少金额`,
    ]);
  });
});
