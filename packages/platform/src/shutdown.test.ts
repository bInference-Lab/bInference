import { EventEmitter } from "node:events";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createPlatform } from "./create-platform.js";
import { createShutdown, type ShutdownStep } from "./shutdown.js";

function recorder() {
  const ran: string[] = [];
  const step =
    (name: string): ShutdownStep =>
    async () => {
      await Promise.resolve();
      ran.push(name);
    };
  return { ran, step };
}

const done = async (): Promise<void> => Promise.resolve();

function setup() {
  const clock = createManualClock(1_000);
  const events = new EventEmitter();
  const shutdown = createShutdown({
    clock,
    budgetMs: 30_000,
    events,
    signals: ["SIGINT", "SIGTERM"],
  });
  return { clock, events, shutdown };
}

describe("shutdown", () => {
  it("runs the steps in the order they were added when a stop signal arrives", async () => {
    const { events, shutdown } = setup();
    const { ran, step } = recorder();
    shutdown.add("stop intents", step("stop intents"));
    shutdown.add("finish broadcasts", step("finish broadcasts"));
    shutdown.add("close databases", step("close databases"));

    events.emit("SIGTERM", "SIGTERM");
    const report = await shutdown.finished;

    expect(ran).toStrictEqual(["stop intents", "finish broadcasts", "close databases"]);
    expect(report).toStrictEqual({
      trigger: "SIGTERM",
      steps: [
        { name: "stop intents", outcome: "done" },
        { name: "finish broadcasts", outcome: "done" },
        { name: "close databases", outcome: "done" },
      ],
    });
  });

  it("runs the sequence once, however many stop events arrive", async () => {
    const { events, shutdown } = setup();
    const { ran, step } = recorder();
    shutdown.add("close databases", step("close databases"));

    events.emit("SIGINT", "SIGINT");
    events.emit("SIGTERM", "SIGTERM");
    const requested = await shutdown.stop("request");

    expect(ran).toStrictEqual(["close databases"]);
    expect(requested.trigger).toBe("SIGINT");
  });

  it("keeps going after a step fails", async () => {
    const { shutdown } = setup();
    const { ran, step } = recorder();
    shutdown.add("stop channels", async () => {
      await Promise.reject(new Error("socket gone"));
    });
    shutdown.add("close databases", step("close databases"));

    const report = await shutdown.stop("request");

    expect(ran).toStrictEqual(["close databases"]);
    expect(report.steps).toStrictEqual([
      { name: "stop channels", outcome: "failed" },
      { name: "close databases", outcome: "done" },
    ]);
  });

  it("stops waiting at the budget and skips the steps left", async () => {
    const { clock, shutdown } = setup();
    const seen: AbortSignal[] = [];
    shutdown.add("finish broadcasts", async (signal) => {
      seen.push(signal);
      await new Promise<void>(() => undefined);
    });
    shutdown.add("close databases", async () => {
      await Promise.resolve();
    });

    const stopping = shutdown.stop("request");
    await clock.advance(30_000);
    const report = await stopping;

    expect(seen.map((signal) => signal.aborted)).toStrictEqual([true]);
    expect(report.steps).toStrictEqual([
      { name: "finish broadcasts", outcome: "timed_out" },
      { name: "close databases", outcome: "skipped" },
    ]);
  });

  it("refuses a step added once the sequence has started", async () => {
    const { shutdown } = setup();
    await shutdown.stop("request");

    expect(() => {
      shutdown.add("late", done);
    }).toThrow(expect.objectContaining({ code: "platform.shutdown_started" }));
  });

  it("holds at most 64 steps", () => {
    const { shutdown } = setup();
    Array.from({ length: 64 }, (_, index) => `step ${String(index)}`).forEach((name) => {
      shutdown.add(name, done);
    });

    expect(() => {
      shutdown.add("one more", done);
    }).toThrow(expect.objectContaining({ code: "platform.too_many_steps" }));
  });

  it("stops listening for signals once disposed", () => {
    const { events, shutdown } = setup();

    shutdown.dispose();

    expect(events.listenerCount("SIGINT") + events.listenerCount("SIGTERM")).toBe(0);
  });
});

describe.skipIf(process.platform === "win32")("shutdown on macOS and Linux", () => {
  it("runs the steps in order when the process gets SIGTERM", async () => {
    const { stopSignals } = createPlatform();
    const shutdown = createShutdown({
      clock: createManualClock(),
      budgetMs: 30_000,
      events: process,
      signals: stopSignals,
    });
    const { ran, step } = recorder();
    shutdown.add("stop intents", step("stop intents"));
    shutdown.add("close databases", step("close databases"));

    process.kill(process.pid, "SIGTERM");
    const report = await shutdown.finished;
    shutdown.dispose();

    expect(stopSignals).toStrictEqual(["SIGINT", "SIGTERM"]);
    expect(report.trigger).toBe("SIGTERM");
    expect(ran).toStrictEqual(["stop intents", "close databases"]);
  });
});

describe.runIf(process.platform === "win32")("shutdown on Windows", () => {
  it("runs the steps in order on Ctrl+Break", async () => {
    const { stopSignals } = createPlatform();
    const shutdown = createShutdown({
      clock: createManualClock(),
      budgetMs: 30_000,
      events: process,
      signals: stopSignals,
    });
    const { ran, step } = recorder();
    shutdown.add("stop intents", step("stop intents"));
    shutdown.add("close databases", step("close databases"));

    // Node turns a console Ctrl+Break into this event; Windows has no way to send it to itself.
    process.emit("SIGBREAK", "SIGBREAK");
    const report = await shutdown.finished;
    shutdown.dispose();

    expect(stopSignals).toStrictEqual(["SIGINT", "SIGBREAK"]);
    expect(report.trigger).toBe("SIGBREAK");
    expect(ran).toStrictEqual(["stop intents", "close databases"]);
  });
});
