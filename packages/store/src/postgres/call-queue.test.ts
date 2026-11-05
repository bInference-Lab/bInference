import { describe, expect, it } from "vitest";
import { createCallQueue } from "./call-queue.js";

function ignore(): void {
  // Replaced before the test calls it.
}

describe("a call queue", () => {
  it("runs each call after the one before it ended, a failed one too", async () => {
    const queue = createCallQueue(10, "test calls");
    const order: string[] = [];
    const first = queue.run(async () => {
      await Promise.resolve();
      order.push("first");
      throw new Error("first failed");
    });
    const second = queue.run(async () => {
      order.push("second");
      return Promise.resolve(2);
    });

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe(2);
    await queue.drained();
    expect(order).toStrictEqual(["first", "second"]);
  });

  it("refuses a call past its bound and takes calls again once one ended", async () => {
    const queue = createCallQueue(1, "test calls");
    let release = ignore;
    const held = queue.run(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await expect(queue.run(async () => Promise.resolve())).rejects.toMatchObject({
      code: "store.queue_full",
      retryable: true,
      details: { limit: 1 },
    });
    release();
    await held;
    await expect(queue.run(async () => Promise.resolve(3))).resolves.toBe(3);
  });
});
