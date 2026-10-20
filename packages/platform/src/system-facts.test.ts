import { describe, expect, it } from "vitest";
import { readSystemFacts } from "./system-facts.js";

describe("readSystemFacts", () => {
  it("names this process's Node version and a known OS and CPU type", () => {
    const facts = readSystemFacts();
    expect(facts.node).toMatch(/^v\d+\.\d+\.\d+/);
    expect(["darwin", "linux", "win32"]).toContain(facts.os);
    expect(facts.cpu).not.toBe("");
    expect(facts.osRelease).not.toBe("");
  });
});
