import type { LogLevel, LogRecord } from "@binference/core";
import { createManualClock, loggerContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFileLogger } from "./file-logger.js";
import { logLineSchema } from "./log-line.schema.js";

const nowMs = 1_800_000_000_000;

/** A log file in memory: the lines appended, and whether it was closed. */
function memoryFile() {
  const lines: string[] = [];
  const state = { isClosed: false };
  return {
    lines,
    state,
    append: (line: string) => lines.push(line),
    close: async () => {
      state.isClosed = true;
      await Promise.resolve();
    },
  };
}

function loggerOn(level: LogLevel = "debug") {
  const file = memoryFile();
  const logger = createFileLogger({
    file,
    level,
    clock: createManualClock(nowMs),
    subsystem: "engine",
  });
  return { file, logger };
}

function recordsOf(lines: readonly string[]): readonly LogRecord[] {
  return lines.map((text) => {
    const line = logLineSchema.parse(JSON.parse(text));
    return {
      level: line.level,
      subsystem: line.subsystem,
      event: line.event,
      fields: line.fields ?? {},
    };
  });
}

describe("the file logger", () => {
  it.each(
    loggerContract({
      create: (subsystem) => {
        const file = memoryFile();
        const logger = createFileLogger({
          file,
          level: "debug",
          clock: createManualClock(nowMs),
          subsystem,
        });
        return { logger, records: () => recordsOf(file.lines) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes one JSON line per record with the time, level, subsystem, event and ids", () => {
    const { file, logger } = loggerOn();
    logger.child("server").info("server.listening", { durationMs: 12 });
    logger.warn("engine.push_failed");
    expect(file.lines).toStrictEqual([
      JSON.stringify({
        time: "2027-01-15T08:00:00.000Z",
        level: "info",
        subsystem: "engine.server",
        event: "server.listening",
        fields: { durationMs: 12 },
      }),
      JSON.stringify({
        time: "2027-01-15T08:00:00.000Z",
        level: "warn",
        subsystem: "engine",
        event: "engine.push_failed",
      }),
    ]);
  });

  it("drops records below the level the config sets", () => {
    const { file, logger } = loggerOn("warn");
    logger.debug("queue.idle");
    logger.info("intent.confirmed");
    logger.warn("relay.slow");
    logger.error("rpc.down");
    expect(recordsOf(file.lines).map((record) => record.level)).toStrictEqual(["warn", "error"]);
  });

  it("closes the log file once its lines are handed over", async () => {
    const { file, logger } = loggerOn();
    logger.info("engine.stopped");
    await logger.close();
    expect(file.state.isClosed).toBe(true);
    expect(file.lines).toHaveLength(1);
  });
});
