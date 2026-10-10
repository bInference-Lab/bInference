import { describe, expect, it } from "vitest";
import { fixtureId, inOrder } from "../contracts/store-fixtures.js";
import { createMemoryNoticeStore } from "../fakes/memory-notice-store.js";
import { testCall } from "../operations/test-engine.js";
import { createNoticeHandlers } from "./notice-handlers.js";
import { noticeRecordOf } from "./notice-record-of.js";

const live = () => ({ signal: new AbortController().signal });
const notice = { key: "notice.locked", values: {} };

// Notice n, stored at 1,000 + n with a Telegram delivery.
async function handlerOf(numbers: readonly number[]) {
  const store = createMemoryNoticeStore({
    agents: { get: async () => Promise.resolve(undefined) },
  });
  await inOrder(numbers, async (n) => {
    const stamp = { id: fixtureId("ntc", n), atMs: 1_000 + n, surfaces: ["telegram"] as const };
    await store.record(noticeRecordOf(notice, stamp), live());
  });
  return createNoticeHandlers(store)["notice/list"];
}

function view(n: number) {
  return { id: fixtureId("ntc", n), at: 1_000 + n, ...notice, delivered: { telegram: "queued" } };
}

describe("the notice list", () => {
  it("pages through the notices kept, oldest first, with their deliveries", async () => {
    const list = await handlerOf([1, 2, 3]);
    const first = await list(testCall({ limit: 2 }));
    expect(first).toStrictEqual({
      ok: true,
      value: { items: [view(1), view(2)], next: fixtureId("ntc", 2) },
    });
    const second = await list(testCall({ cursor: fixtureId("ntc", 2), limit: 2 }));
    expect(second).toStrictEqual({ ok: true, value: { items: [view(3)] } });
  });

  it("gives the notices after the last one a client has", async () => {
    const list = await handlerOf([1, 2]);
    await expect(list(testCall({ cursor: fixtureId("ntc", 2) }))).resolves.toStrictEqual({
      ok: true,
      value: { items: [] },
    });
  });

  it("refuses a cursor that is no notice's id", async () => {
    const list = await handlerOf([]);
    await expect(list(testCall({ cursor: fixtureId("int", 1) }))).resolves.toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });
});
