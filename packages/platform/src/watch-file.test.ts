import { watch } from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type FileWatch, watchFile } from "./watch-file.js";

const folders: string[] = [];
const watches: FileWatch[] = [];

afterEach(async () => {
  watches.splice(0).forEach((watching) => watching.close());
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

async function newFolder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "bnf-watch-"));
  folders.push(made);
  return made;
}

// Resolves at the first change the watch hears, or rejects once 10 seconds pass without one.
function nextChange(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const limit = AbortSignal.timeout(10_000);
    limit.addEventListener("abort", () => reject(new Error(`No change seen on ${path}.`)), {
      once: true,
    });
    watches.push(
      watchFile(path, { onChange: () => resolve(), onError: reject, clock: createManualClock() }),
    );
  });
}

// The OS's watch, which fails with EMFILE `count` times before it works, as on a machine whose
// file watches ran out for a while.
function failingFirst(count: number): typeof watch {
  let left = count;
  return ((...args: Parameters<typeof watch>) => {
    if (left > 0) {
      left -= 1;
      throw Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" });
    }
    return watch(...args);
  }) as typeof watch;
}

/** A watch over a given OS watch: the steps it degraded through and the changes it heard. */
interface Watched {
  readonly steps: readonly string[];
  count(): number;
  /** Resolves once the watch has heard `count` changes in all. */
  changedAfter(count: number): Promise<void>;
}

function watchWith(path: string, clock: ManualClock, native: typeof watch): Watched {
  const steps: string[] = [];
  const state: { changes: number; waiter?: { count: number; resolve: () => void } } = {
    changes: 0,
  };
  const onChange = (): void => {
    state.changes += 1;
    if (state.waiter !== undefined && state.changes >= state.waiter.count) {
      state.waiter.resolve();
    }
  };
  const onDegraded = (step: string): void => {
    steps.push(step);
  };
  const options = { onChange, onError: () => undefined, onDegraded, clock, nativeWatch: native };
  watches.push(watchFile(path, options));
  return {
    steps,
    count: () => state.changes,
    changedAfter: async (count) =>
      new Promise((resolve) => {
        if (state.changes >= count) {
          resolve();
          return;
        }
        state.waiter = { count, resolve };
      }),
  };
}

describe("a file watch", () => {
  it("hears a write to the file in place", async () => {
    const config = join(await newFolder(), "config.json5");
    await writeFile(config, "{}\n");
    const changed = nextChange(config);
    await writeFile(config, "{ logging: {} }\n");
    await expect(changed).resolves.toBeUndefined();
  });

  it("hears a new file renamed over it, as an editor saves", async () => {
    const at = await newFolder();
    const config = join(at, "config.json5");
    await writeFile(config, "{}\n");
    const changed = nextChange(config);
    await writeFile(join(at, "config.json5.tmp"), "{ logging: {} }\n");
    await rename(join(at, "config.json5.tmp"), config);
    await expect(changed).resolves.toBeUndefined();
  });

  it("names the fault when the folder cannot be watched", () => {
    const missing = join(tmpdir(), "bnf-watch-missing", "deeper", "config.json5");
    expect(() =>
      watchFile(missing, {
        onChange: () => undefined,
        onError: () => undefined,
        clock: createManualClock(),
      }),
    ).toThrow(expect.objectContaining({ code: "platform.watch_failed" }));
  });

  it("tries the OS's file events again, then checks the file on a timer, and still hears it", async () => {
    const config = join(await newFolder(), "config.json5");
    await writeFile(config, "{}\n");
    const clock = createManualClock(0);
    const watched = watchWith(config, clock, failingFirst(Number.POSITIVE_INFINITY));
    await clock.advance(500);
    await clock.advance(2_000);
    await clock.advance(5_000);
    expect([watched.steps, watched.count()]).toStrictEqual([
      ["retrying", "retrying", "retrying", "poll"],
      4,
    ]);
    await writeFile(config, "{ logging: {} }\n");
    await expect(watched.changedAfter(5)).resolves.toBeUndefined();
  });

  it("goes back to the OS's file events when a new attempt works", async () => {
    const config = join(await newFolder(), "config.json5");
    await writeFile(config, "{}\n");
    const clock = createManualClock(0);
    const watched = watchWith(config, clock, failingFirst(1));
    await clock.advance(500);
    expect([watched.steps, watched.count()]).toStrictEqual([["retrying"], 1]);
    await writeFile(config, "{ logging: {} }\n");
    await expect(watched.changedAfter(2)).resolves.toBeUndefined();
  });
});
