import { describe, expect, it } from "vitest";
import { isOlderVersion } from "./version-order.js";

describe("the order of plugin versions", () => {
  it.each([
    ["1.2.3", "1.2.4", true],
    ["1.9.0", "1.10.0", true],
    ["0.9.9", "1.0.0", true],
    ["1.0.0-rc.1", "1.0.0", true],
    ["1.0.0-alpha", "1.0.0-alpha.1", true],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", true],
    ["1.0.0-beta.2", "1.0.0-beta.11", true],
    ["not-a-version", "1.0.0", true],
    ["1.2.4", "1.2.3", false],
    ["1.0.0", "1.0.0-rc.1", false],
    ["1.0.0+build.2", "1.0.0+build.1", false],
    ["1.2.3", "1.2.3", false],
  ] as const)("reads %s before %s: %s", (version, installed, older) => {
    expect(isOlderVersion(version, installed)).toBe(older);
  });
});
