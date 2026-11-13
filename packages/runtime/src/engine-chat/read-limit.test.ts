import { describe, expect, it } from "vitest";
import { createReadLimit } from "./read-limit.js";

const live = (): AbortSignal => new AbortController().signal;

// Reads that wait until the test ends them, each named as it starts.
function heldReads() {
  const started: string[] = [];
  const ends = new Map<string, (outcome: "done" | "failed") => void>();
  const read = (name: string) => async (): Promise<string> =>
    new Promise((resolve, reject) => {
      started.push(name);
      ends.set(name, (outcome) =>
        outcome === "done" ? resolve(name) : reject(new Error(`${name} failed`)),
      );
    });
  const end = async (name: string, outcome: "done" | "failed" = "done"): Promise<void> => {
    ends.get(name)?.(outcome);
    for (let round = 0; round < 10; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one turn of the microtask queue each
      await Promise.resolve();
    }
  };
  return { started, read, end };
}

describe("createReadLimit", () => {
  it("runs at most its reads at once, and the rest in order as earlier ones end", async () => {
    const limit = createReadLimit(2);
    const { started, read, end } = heldReads();
    const runs = ["a", "b", "c", "d"].map(async (name) => limit.run(read(name), live()));
    await end("none");
    const atFirst = [...started];
    await end("b");
    const afterOne = [...started];
    await end("a", "failed");
    expect([atFirst, afterOne, started]).toStrictEqual([
      ["a", "b"],
      ["a", "b", "c"],
      ["a", "b", "c", "d"],
    ]);
    await end("c");
    await end("d");
    expect(await Promise.allSettled(runs)).toHaveLength(4);
  });

  it("drops a waiting read whose signal aborts, and starts the next in its place", async () => {
    const limit = createReadLimit(1);
    const { started, read, end } = heldReads();
    const first = limit.run(read("a"), live());
    const stop = new AbortController();
    const dropped = limit.run(read("b"), stop.signal).catch((error: unknown) => error);
    const third = limit.run(read("c"), live());
    stop.abort(new Error("the tool's time is up"));
    expect(await dropped).toBe(stop.signal.reason);
    await end("a");
    expect(started).toStrictEqual(["a", "c"]);
    await end("c");
    expect(await Promise.all([first, third])).toStrictEqual(["a", "c"]);
  });
});
