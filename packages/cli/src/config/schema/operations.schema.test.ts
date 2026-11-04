import { describe, expect, it } from "vitest";
import { networkSchema } from "./operations.schema.js";

describe("networkSchema", () => {
  it("takes up to 256 no-proxy entries, as the agent runtime's settings carry", () => {
    const hosts = Array.from({ length: 256 }, (_, at) => `host${String(at)}.corp.test`);
    expect(networkSchema.safeParse({ noProxy: hosts }).success).toBe(true);
    expect(networkSchema.safeParse({ noProxy: [...hosts, "one-more.corp.test"] }).success).toBe(
      false,
    );
  });

  it.each(["*", "corp.test", "10.0.0.0/8", "[::1]:8545"])("takes the entry %s", (entry) => {
    expect(networkSchema.safeParse({ noProxy: [entry] }).success).toBe(true);
  });

  it.each(["http://corp.test", "1.1", `${"a".repeat(301)}.test`])(
    "refuses the entry %s",
    (entry) => {
      expect(networkSchema.safeParse({ noProxy: [entry] }).success).toBe(false);
    },
  );
});
