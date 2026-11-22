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

  it("words a spent credit on the gateway apart from a provider's spending limit", () => {
    const failed = { line: "failed", failure: "billing" } as const;
    expect([statusKeysOf({ ...failed, onGateway: true }), statusKeysOf(failed)]).toStrictEqual([
      [{ key: "turn.failed.gatewayBilling" }],
      [{ key: "turn.failed.billing" }],
    ]);
  });
});
