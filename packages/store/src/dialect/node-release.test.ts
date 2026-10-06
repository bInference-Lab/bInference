import { describe, expect, it } from "vitest";
import { isNodeReleaseAtLeast, parseNodeRelease } from "./node-release.js";

describe("parseNodeRelease", () => {
  it.each([
    ["26.10.0", { major: 26, minor: 10, patch: 0 }],
    ["v24.20.1", { major: 24, minor: 20, patch: 1 }],
    ["26.6.0+build.1", { major: 26, minor: 6, patch: 0 }],
  ])("reads %s", (text, release) => {
    expect(parseNodeRelease(text)).toStrictEqual(release);
  });

  it.each([undefined, "", "26.6", "26.06.0", "26.6.0-rc.1", "latest"])("refuses %s", (text) => {
    expect(parseNodeRelease(text)).toBeUndefined();
  });
});

describe("isNodeReleaseAtLeast", () => {
  const minimum = { major: 26, minor: 6, patch: 0 };

  it.each([
    ["26.6.0", true],
    ["26.6.1", true],
    ["26.10.0", true],
    ["27.0.0", true],
    ["26.5.9", false],
    ["24.99.0", false],
  ])("compares %s", (text, expected) => {
    expect(isNodeReleaseAtLeast(parseNodeRelease(text), minimum)).toBe(expected);
  });

  it("treats an unknown release as too old", () => {
    expect(isNodeReleaseAtLeast(undefined, minimum)).toBe(false);
  });
});
