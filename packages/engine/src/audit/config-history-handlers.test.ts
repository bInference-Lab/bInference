import { describe, expect, it } from "vitest";
import { createMemoryConfigJournal } from "../fakes/memory-config-journal.js";
import { testCall } from "../operations/test-engine.js";
import { createConfigHistoryHandlers } from "./config-history-handlers.js";

const live = () => ({ signal: new AbortController().signal });

const change = {
  by: "tok_1",
  surface: "cli",
  path: "agents.main.mode",
  before: "paper",
  after: "live",
} as const;

// One change at each moment, recorded one after another.
async function journalOf(moments: readonly number[]) {
  const journal = createMemoryConfigJournal();
  await moments.reduce<Promise<unknown>>(
    async (earlier, atMs) => earlier.then(async () => journal.record({ ...change, atMs }, live())),
    Promise.resolve(),
  );
  return createConfigHistoryHandlers(journal)["config/history"];
}

describe("the config history", () => {
  it("pages through every change in the order it was recorded", async () => {
    const history = await journalOf([1, 2, 3]);
    const first = await history(testCall({ limit: 2 }));
    expect(first).toStrictEqual({
      ok: true,
      value: {
        items: [
          { ...change, at: 1 },
          { ...change, at: 2 },
        ],
        next: "2",
      },
    });
    const second = await history(testCall({ cursor: "2", limit: 2 }));
    expect(second).toStrictEqual({ ok: true, value: { items: [{ ...change, at: 3 }] } });
  });

  it("refuses a cursor that is no entry's number", async () => {
    const history = await journalOf([]);
    await expect(history(testCall({ cursor: "-1" }))).resolves.toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });
});
