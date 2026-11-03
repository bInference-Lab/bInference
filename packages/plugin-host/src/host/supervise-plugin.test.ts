import { err, ok, type Result } from "@binference/core";
import { createManualClock, createMemoryLogger, type ManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { RunningPlugin } from "./open-plugin.js";
import type { PluginEnd } from "./plugin-channel.js";
import { supervisePlugin } from "./supervise-plugin.js";

// A plugin whose every start the test ends by hand, and the times of its starts.
function scriptedPlugin(clock: ManualClock) {
  const starts: number[] = [];
  const crashes: number[] = [];
  const ends: ((end: PluginEnd) => void)[] = [];
  const open = async (signal: AbortSignal): Promise<Result<RunningPlugin, PluginEnd>> => {
    starts.push(clock.now());
    const ended = new Promise<PluginEnd>((resolve) => {
      ends.push(resolve);
      signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    });
    return ok({ call: async () => ok("answer"), ended, stop: () => undefined });
  };
  const crash = (): void => {
    crashes.push(clock.now());
    ends.at(-1)?.("exited");
  };
  // How long each start waited after the crash before it.
  const waits = (): readonly number[] =>
    starts.slice(1).map((start, index) => start - (crashes[index] ?? 0));
  return { open, starts, crash, waits };
}

function supervised() {
  const clock = createManualClock(0);
  const plugin = scriptedPlugin(clock);
  const turnedOff: string[] = [];
  const stop = new AbortController();
  const supervisor = supervisePlugin(
    {
      plugin: "fear-index",
      open: plugin.open,
      clock,
      logger: createMemoryLogger({ subsystem: "plugins" }),
      onTurnedOff: () => turnedOff.push("fear-index"),
      onEnded: () => undefined,
    },
    stop.signal,
  );
  return { clock, plugin, turnedOff, stop, supervisor };
}

// Lets each run last `runMs`, crashes it, then waits `waitMs` for the next start, `times` times.
async function crashRuns(
  run: ReturnType<typeof supervised>,
  pattern: { readonly runMs: number; readonly waitMs: number },
  times: number,
): Promise<void> {
  if (times === 0) {
    return;
  }
  await run.clock.advance(pattern.runMs);
  run.plugin.crash();
  await run.clock.advance(pattern.waitMs);
  await crashRuns(run, pattern, times - 1);
}

describe("supervisePlugin", () => {
  it("starts a plugin that crashed again after 1, 2, 4 and 8 seconds", async () => {
    const run = supervised();
    await run.supervisor.firstStart;
    await crashRuns(run, { runMs: 0, waitMs: 8_000 }, 4);
    run.stop.abort();

    expect(run.plugin.waits()).toStrictEqual([1_000, 2_000, 4_000, 8_000]);
    await expect(run.supervisor.done).resolves.toBe("stopped");
  });

  it("turns a plugin off at its 5th crash within 10 minutes", async () => {
    const run = supervised();
    await run.supervisor.firstStart;
    await crashRuns(run, { runMs: 0, waitMs: 8_000 }, 4);
    run.plugin.crash();

    await expect(run.supervisor.done).resolves.toBe("crashes");
    expect(run.turnedOff).toStrictEqual(["fear-index"]);
    expect(run.plugin.starts).toHaveLength(5);
    await expect(
      run.supervisor.call("probe", {}, AbortSignal.timeout(1_000)),
    ).resolves.toStrictEqual(err("not_running"));
  });

  it("doubles the wait up to 5 minutes for a plugin that crashes every 3 minutes", async () => {
    const run = supervised();
    await run.supervisor.firstStart;
    await crashRuns(run, { runMs: 180_000, waitMs: 300_000 }, 11);
    run.stop.abort();

    expect(run.plugin.waits()).toStrictEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000,
    ]);
    expect(run.turnedOff).toStrictEqual([]);
  });

  it("waits 1 second again once a run lasted 10 minutes", async () => {
    const run = supervised();
    await run.supervisor.firstStart;
    await crashRuns(run, { runMs: 0, waitMs: 2_000 }, 2);
    await crashRuns(run, { runMs: 600_000, waitMs: 1_000 }, 1);
    run.stop.abort();

    expect(run.plugin.waits()).toStrictEqual([1_000, 2_000, 1_000]);
  });

  it("calls the running plugin and answers not_running while it waits to start again", async () => {
    const run = supervised();
    await run.supervisor.firstStart;
    const signal = AbortSignal.timeout(1_000);

    await expect(run.supervisor.call("probe", {}, signal)).resolves.toStrictEqual(ok("answer"));
    run.plugin.crash();
    await run.clock.advance(0);
    await expect(run.supervisor.call("probe", {}, signal)).resolves.toStrictEqual(
      err("not_running"),
    );
    run.stop.abort();
  });
});
