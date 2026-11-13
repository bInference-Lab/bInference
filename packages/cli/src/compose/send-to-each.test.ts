import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { sendToEach } from "./send-to-each.js";

describe("sendToEach", () => {
  it("hands the push to every place after one throws, and logs the throw", () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const sent: string[] = [];
    sendToEach(
      [
        () => sent.push("server"),
        () => {
          throw new BinferenceError({ code: "telegram.unreachable", message: "down" });
        },
        () => sent.push("browsers"),
      ],
      logger,
    );
    expect(sent).toStrictEqual(["server", "browsers"]);
    expect(
      logger.records().map(({ event, level, fields }) => [event, level, fields]),
    ).toStrictEqual([["engine.push_failed", "warn", { errorCode: "telegram.unreachable" }]]);
  });
});
