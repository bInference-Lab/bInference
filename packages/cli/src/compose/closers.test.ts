import { EventEmitter } from "node:events";
import { createManualClock } from "@binference/core/testing";
import { createShutdown } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";

const signal = new AbortController().signal;

describe("the closers", () => {
  it("close the parts last opened first, and go on past one that fails", async () => {
    const closed: string[] = [];
    const closers = createClosers();
    closers.add("lock", async () => {
      closed.push("lock");
      await Promise.resolve();
    });
    closers.add("store", async () => Promise.reject(new Error("stuck")));
    closers.add("server", async () => {
      closed.push("server");
      await Promise.resolve();
    });
    await closers.closeAll(signal);
    expect(closed).toStrictEqual(["server", "lock"]);
  });

  it("hand the shutdown sequence its steps in the reverse order", async () => {
    const closers = createClosers();
    ["lock", "logs", "store", "server"].forEach((name) =>
      closers.add(name, async () => Promise.resolve()),
    );
    const shutdown = createShutdown({
      clock: createManualClock(),
      budgetMs: 1_000,
      events: new EventEmitter(),
      signals: [],
    });
    closers.handTo(shutdown);
    const report = await shutdown.stop("request");
    shutdown.dispose();
    expect(report.steps.map((step) => step.name)).toStrictEqual([
      "server",
      "store",
      "logs",
      "lock",
    ]);
  });

  it("refuse a part past their bound", () => {
    const closers = createClosers();
    Array.from({ length: 32 }, (_, index) =>
      closers.add(`part${String(index)}`, async () => undefined),
    );
    expect(() => closers.add("one more", async () => undefined)).toThrow(
      expect.objectContaining({ code: "cli.too_many_parts" }),
    );
  });
});
