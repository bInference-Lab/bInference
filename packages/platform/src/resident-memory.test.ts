import process from "node:process";
import { describe, expect, it } from "vitest";
import { createPlatform } from "./create-platform.js";

const { residentBytes } = createPlatform();
const signal = AbortSignal.timeout(20_000);

describe("residentBytes", () => {
  it("reads this process's resident memory as the OS counts it", async () => {
    const bytes = await residentBytes(process.pid, signal);

    expect(bytes).toBeGreaterThan(10 * 1_048_576);
    expect(bytes).toBeLessThan(process.memoryUsage().rss * 2);
  });

  it("answers none for a process that does not run", async () => {
    await expect(residentBytes(2 ** 22 + 7, signal)).resolves.toBeUndefined();
  });
});
