import { describe, expect, it } from "vitest";
import { loggerContract } from "../contracts/logger-contract.js";
import { createMemoryLogger } from "./memory-logger.js";

describe("memory logger", () => {
  it.each(
    loggerContract({
      create: (subsystem) => {
        const logger = createMemoryLogger({ subsystem });
        return { logger, records: logger.records };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("drops the oldest record when it is full", () => {
    const logger = createMemoryLogger({ subsystem: "engine", maxRecords: 2 });
    logger.info("one");
    logger.info("two");
    logger.info("three");
    expect(logger.records().map((record) => record.event)).toStrictEqual(["two", "three"]);
  });
});
