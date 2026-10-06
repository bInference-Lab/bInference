import { describe, expect, it } from "vitest";
import { botUpdateSourceContract } from "../contracts/bot-update-source-contract.js";
import { createRelayUpdateSource } from "./relay-update-source.js";

const live = { signal: new AbortController().signal };

describe("relay update source", () => {
  it.each(
    botUpdateSourceContract({
      create: () => {
        const source = createRelayUpdateSource();
        return { source, post: (update) => source.deliver(update) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps the first copy of an update the platform posts twice", async () => {
    const source = createRelayUpdateSource();
    source.deliver({ updateId: 5, payload: "first" });
    source.deliver({ updateId: 5, payload: "again" });
    await expect(source.next(live)).resolves.toStrictEqual([{ updateId: 5, payload: "first" }]);
  });

  it("drops a repeat of an update it already acknowledged", async () => {
    const source = createRelayUpdateSource();
    source.deliver({ updateId: 5, payload: "first" });
    await source.acknowledge(5, live);
    source.deliver({ updateId: 5, payload: "again" });
    source.deliver({ updateId: 6, payload: "next" });
    await expect(source.next(live)).resolves.toStrictEqual([{ updateId: 6, payload: "next" }]);
  });

  it("refuses a post past 1,000 held updates until the engine acknowledges some", async () => {
    const source = createRelayUpdateSource();
    for (const updateId of Array.from({ length: 1_000 }, (_, index) => index)) {
      source.deliver({ updateId, payload: null });
    }
    expect(() => source.deliver({ updateId: 1_000, payload: null })).toThrow(
      expect.objectContaining({ code: "engine.relay_full", retryable: true }),
    );
    await source.acknowledge(0, live);
    source.deliver({ updateId: 1_000, payload: null });
    await expect(source.next({ ...live, limit: 1_000 })).resolves.toHaveLength(1_000);
  });

  it("orders updates the relay received out of order", async () => {
    const source = createRelayUpdateSource();
    source.deliver({ updateId: 8, payload: null });
    source.deliver({ updateId: 7, payload: null });
    const updates = await source.next(live);
    expect(updates.map((update) => update.updateId)).toStrictEqual([7, 8]);
  });
});
