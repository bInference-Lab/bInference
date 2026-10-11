import { describe, expect, it } from "vitest";
import { restartDelayMs } from "./restart-delay.js";

describe("restartDelayMs", () => {
  it("starts again at once, then waits 2, 4, 8, 16, 32 and 60 seconds, then every 60", () => {
    const waits = Array.from({ length: 9 }, (_, failures) => restartDelayMs(failures));
    expect(waits).toStrictEqual([0, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });
});
