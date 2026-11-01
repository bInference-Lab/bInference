import { describe, expect, it } from "vitest";
import { statusKeysOf } from "./status-keys.js";

describe("statusKeysOf", () => {
  it("names the limit an image passed, or the vision model none was set for", () => {
    const keys = (["tooMany", "tooLarge", "format", "unreadable", "noVision"] as const).map(
      (problem) => statusKeysOf({ line: "image", problem }),
    );
    expect(keys).toStrictEqual([
      [{ key: "turn.image.tooMany", values: { count: 4 } }],
      [{ key: "turn.image.tooLarge", values: { mib: 5 } }],
      [{ key: "turn.image.format" }],
      [{ key: "turn.image.unreadable" }],
      [{ key: "turn.image.noVision" }],
    ]);
  });
});
