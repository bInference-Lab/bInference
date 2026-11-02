import { describe, expect, it } from "vitest";
import { stakedFake, stakeRequest } from "../staking/test-stakes.js";
import { driveUntil, tapped } from "./test-executor.js";
import { refusable, stakeBench, stakeEnds, stakeReceiptOf } from "./test-stake-bench.js";

const refused = String.fromCodePoint(0x274c);

describe("a staking move on its wallet's queue, in Chinese (decision 0327)", () => {
  it("tells the owner which validator was jailed after the card", async () => {
    const { answer, venue } = refusable(await stakedFake());
    const bench = await stakeBench(venue);
    const intent = await tapped(bench, stakeRequest("stake"));
    answer.refusal = "validator_jailed";
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReceiptOf(bench, intent, "zh")).resolves.toMatch(
      new RegExp(`^${refused} 未发送：验证者 Active（.+） 已被监禁，不会产生收益$`, "u"),
    );
  });
});
