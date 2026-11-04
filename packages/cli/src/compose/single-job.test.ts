import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { createSingleJob } from "./single-job.js";

function jobs() {
  const closers = createClosers();
  const single = createSingleJob({
    clock: createManualClock(1_767_261_610_000),
    random: createSeededRandom(3),
    closers,
    name: "installs",
  });
  return { closers, single };
}

describe("a job that runs one at a time", () => {
  it("answers the running job's id to a second start, and a new id once it ended", async () => {
    const { closers, single } = jobs();
    const release: { run?: () => void } = {};
    const held = new Promise<void>((resolve) => {
      release.run = resolve;
    });
    const first = single.start(async () => held);
    const second = single.start(async () => Promise.resolve());
    release.run?.();
    // The closer waits for the job under way to end.
    await closers.closeAll(AbortSignal.timeout(5_000));
    const third = single.start(async () => Promise.resolve());

    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("aborts the job under way at the engine's stop and waits for it", async () => {
    const { closers, single } = jobs();
    const seen: boolean[] = [];
    single.start(
      async (_job, stop) =>
        new Promise<void>((resolve) => {
          stop.addEventListener("abort", () => {
            seen.push(stop.aborted);
            resolve();
          });
        }),
    );
    await closers.closeAll(AbortSignal.timeout(5_000));

    expect(seen).toStrictEqual([true]);
  });
});
