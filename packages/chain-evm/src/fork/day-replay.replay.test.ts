import { setTimeout as wait } from "node:timers/promises";
import { bpsPerWhole, type Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import { recordedDay } from "../replay/recorded-days.js";
import { type ReplayStep, replaySteps } from "../replay/replay-steps.js";
import { type DayReplay, prepareDayReplay, type ReplayedBlock } from "./day-replay.js";
import { withFork } from "./with-fork.js";

// A recorded day of BTCB, ETH and Cake against WBNB on their PancakeSwap v2 pairs, replayed on
// today's pairs. Every pool moves to its recorded price as a share of its price today, whenever it
// moved 5 bps from where the replay last put it; quiet stretches cost no block.
const stepBps = 5;
const steps = replaySteps(recordedDay, stepBps);

const wallClock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => {
    await wait(delayMs, undefined, { signal });
  },
};

// What two replays must share: the blocks, the recorded blocks they replay, and the prices.
function shapeOf(blocks: readonly ReplayedBlock[]) {
  return blocks.map(({ number, offset, prices }) => ({ number, offset, prices }));
}

// The moves of a step whose pool stands more than a basis point from its recorded share of its
// start price after the step's block: price / start against the scale, compared exactly.
function missesOf(replay: DayReplay, step: ReplayStep, block: ReplayedBlock | undefined) {
  return step.moves.filter(({ pool, scale }) => {
    const start = replay.pools[pool]?.start;
    const price = block?.prices[pool];
    if (start === undefined || price === undefined) {
      return true;
    }
    const replayed = price.reserveQuote * start.reserveToken * scale.denominator;
    const recorded = start.reserveQuote * price.reserveToken * scale.numerator;
    const gap = replayed > recorded ? replayed - recorded : recorded - replayed;
    return gap * BigInt(bpsPerWhole) > recorded;
  });
}

describe("a recorded day replayed on a BSC fork", () => {
  it("mines the same blocks with the same prices when the day is replayed twice", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const replay = await prepareDayReplay({
        fork,
        path: recordedDay,
        steps,
        clock: wallClock,
        signal,
      });
      const snapshot = await fork.call("evm_snapshot", []);
      const first = await replay.run({ paceMs: 0, signal });
      await fork.call("evm_revert", [snapshot]);
      const second = await replay.run({ paceMs: 0, signal });

      expect(first.map(({ number }) => number - fork.block)).toStrictEqual(
        steps.map((_, index) => BigInt(index + 1)),
      );
      expect(shapeOf(second)).toStrictEqual(shapeOf(first));
    }));

  it("puts each pool it moves within a basis point of its recorded share of today's price", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const replay = await prepareDayReplay({
        fork,
        path: recordedDay,
        steps,
        clock: wallClock,
        signal,
      });
      const blocks = await replay.run({ paceMs: 0, signal });

      expect(steps.length).toBeGreaterThan(100);
      expect(steps.flatMap((step, index) => missesOf(replay, step, blocks[index]))).toStrictEqual(
        [],
      );
    }));
});
