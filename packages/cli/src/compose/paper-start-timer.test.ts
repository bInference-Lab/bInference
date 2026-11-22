import { BinferenceError, idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { PaperStartPass } from "@binference/engine";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startPaperStartTimer } from "./paper-start-timer.js";

const minuteMs = 60_000;
const first = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const second = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");

// A timer whose passes answer `passes` in turn, then nothing, or fail when there is none.
function timerWith(passes: readonly (PaperStartPass | "fails")[]) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const ran: number[] = [];
  startPaperStartTimer({
    startPaper: async () => {
      const pass = passes[ran.length] ?? { started: [], waiting: [] };
      ran.push(clock.now());
      return pass === "fails"
        ? Promise.reject(new BinferenceError({ code: "store.unavailable", message: "Gone." }))
        : Promise.resolve(pass);
    },
    clock,
    closers,
    logger,
  });
  const logged = () =>
    logger
      .records()
      .map((record) => [record.event, record.fields.agentId ?? record.fields.errorCode]);
  return { clock, closers, ran, logged };
}

describe("the paper start timer", () => {
  it("starts the paper portfolios at once, then every minute, until its closer runs", async () => {
    const { clock, closers, ran } = timerWith([]);
    await clock.advance(0);
    await clock.advance(minuteMs);
    expect(ran).toStrictEqual([0, minuteMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(minuteMs);
    expect(ran).toHaveLength(2);
  });

  it("logs each agent it started and each one that still waits, by id", async () => {
    const { clock, closers, logged } = timerWith([
      { started: [first], waiting: [second] },
      { started: [second], waiting: [] },
    ]);
    await clock.advance(0);
    await clock.advance(minuteMs);
    expect(logged()).toStrictEqual([
      ["engine.paper_started", first],
      ["engine.paper_start_waits", second],
      ["engine.paper_started", second],
    ]);
    await closers.closeAll(new AbortController().signal);
  });

  it("logs a pass that fails, and runs again a minute later", async () => {
    const { clock, closers, ran, logged } = timerWith(["fails", { started: [first], waiting: [] }]);
    await clock.advance(0);
    await clock.advance(minuteMs);
    expect(ran).toHaveLength(2);
    expect(logged()).toStrictEqual([
      ["engine.paper_start_failed", "store.unavailable"],
      ["engine.paper_started", first],
    ]);
    await closers.closeAll(new AbortController().signal);
  });
});
