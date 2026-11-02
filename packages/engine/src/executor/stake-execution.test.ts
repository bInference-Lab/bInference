import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { stakedFake, stakeRequest } from "../staking/test-stakes.js";
import { driveUntil, tapped } from "./test-executor.js";
import {
  refusable,
  stakeBench,
  stakeEnds,
  stakeReasonOf,
  stakeReceiptOf,
  unstakeElsewhere,
} from "./test-stake-bench.js";

const refused = String.fromCodePoint(0x274c);

describe("a staking move on its wallet's queue (decision 0327)", () => {
  it("tells the owner which validator was jailed after the card", async () => {
    const { answer, venue } = refusable(await stakedFake());
    const bench = await stakeBench(venue);
    const intent = await tapped(bench, stakeRequest("stake"));
    answer.refusal = "validator_jailed";
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReceiptOf(bench, intent, "en")).resolves.toMatch(
      new RegExp(
        `^${refused} Not sent: the validator Active \\(.+\\) is jailed, so it earns nothing$`,
        "u",
      ),
    );
  });

  it("ends failed_check with the venue's reason when the venue refuses it after its card", async () => {
    const { answer, venue } = refusable(await stakedFake());
    const bench = await stakeBench(venue);
    const intent = await tapped(bench, stakeRequest("claim"));
    answer.refusal = "staking_paused";
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReasonOf(bench, intent)).resolves.toBe("staking_paused");
    expect(bench.signed).toHaveLength(0);
  });

  it("ends decode_mismatch when the venue now plans another move than the card's", async () => {
    const { answer, venue } = refusable(await stakedFake());
    const bench = await stakeBench(venue);
    const intent = await tapped(bench, stakeRequest("stake"));
    answer.mangle = (plan) => ({ ...plan, value: { ...plan.value, base: plan.value.base + 1n } });
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReasonOf(bench, intent)).resolves.toBe("decode_mismatch");
    expect(bench.signed).toHaveLength(0);
  });

  it("ends exceeds_staked when the wallet holds fewer receipt units than its unstake burns", async () => {
    const fake = await stakedFake();
    const bench = await stakeBench(fake);
    const amount = { asset: testCoin, base: 8n * 10n ** 17n };
    const intent = await tapped(bench, stakeRequest("unstake", { amount }));
    await unstakeElsewhere(fake, 5n * 10n ** 17n);
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReasonOf(bench, intent)).resolves.toBe("exceeds_staked");
    expect(bench.signed).toHaveLength(0);
  });

  it("signs nothing and waits while the venue does not answer", async () => {
    const { answer, venue } = refusable(await stakedFake());
    const bench = await stakeBench(venue);
    const intent = await tapped(bench, stakeRequest("claim"));
    answer.isDown = true;
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds, blocks: 3 })).resolves.toBe(
      "confirmed",
    );
    expect(bench.signed).toHaveLength(0);
  });
});
