import { describe, expect, it } from "vitest";
import { deviceOnlyOperations, isDeviceOnly } from "./device-only-operations.js";
import { operations } from "./operations.js";

describe("device-only operations", () => {
  it("bind a browser push subscription to the device that registers or removes it", () => {
    expect([...deviceOnlyOperations]).toStrictEqual(["webPush/register", "webPush/unregister"]);
    expect(isDeviceOnly("webPush/status")).toBe(false);
  });

  it("are writes of the confirm scope that any transport carries", () => {
    const rows = [...deviceOnlyOperations].map(
      (name) => `${operations[name].kind} ${operations[name].scope} ${operations[name].transport}`,
    );
    expect(new Set(rows)).toStrictEqual(new Set(["write confirm any"]));
  });
});
