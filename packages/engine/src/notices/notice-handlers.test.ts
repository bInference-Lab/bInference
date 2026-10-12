import { describe, expect, it } from "vitest";
import { fixtureId, inOrder } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryNoticeStore } from "../fakes/memory-notice-store.js";
import { testAgent, testAgentDraft, testCoin } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { Notice } from "../pushes/notice-push.js";
import { createNoticeHandlers } from "./notice-handlers.js";
import { noticeRecordOf } from "./notice-record-of.js";

const live = () => ({ signal: new AbortController().signal });
const notice = { key: "notice.locked", values: {} };

// Notice n, stored at 1,000 + n with a Telegram delivery.
async function handlerOf(numbers: readonly number[], kept: Notice = notice) {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live());
  const store = createMemoryNoticeStore({ agents });
  await inOrder(numbers, async (n) => {
    const stamp = { id: fixtureId("ntc", n), atMs: 1_000 + n, surfaces: ["telegram"] as const };
    await store.record(noticeRecordOf(kept, stamp), live());
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

  it("keeps a notice's agent, intent, times and amounts in its view", async () => {
    const full: Notice = {
      key: "notice.lowGas",
      agent: testAgent,
      intent: fixtureId("int", 7),
      values: { wallet: "0x000000a1" },
      times: { when: 5_000 },
      amounts: { balance: { asset: testCoin, base: 12n } },
    };
    const list = await handlerOf([1], full);
    await expect(list(testCall({}))).resolves.toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            id: fixtureId("ntc", 1),
            at: 1_001,
            key: "notice.lowGas",
            agent: testAgent,
            intent: fixtureId("int", 7),
            values: { wallet: "0x000000a1" },
            times: { when: 5_000 },
            amounts: { balance: { asset: testCoin, base: 12n } },
            delivered: { telegram: "queued" },
          },
        ],
      },
    });
  });

  it("keeps a notice's parts and the messages that follow it in its view", async () => {
    const orderKind = { key: "order.kind", values: { kind: "stopLoss" } };
    const woke = { key: "alert.woke", values: { agent: "main" } };
    const fill: Notice = { key: "notice.fill", values: {}, parts: { orderKind }, after: [woke] };
    const list = await handlerOf([1], fill);
    await expect(list(testCall({}))).resolves.toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            id: fixtureId("ntc", 1),
            at: 1_001,
            key: "notice.fill",
            values: {},
            parts: { orderKind },
            after: [woke],
            delivered: { telegram: "queued" },
          },
        ],
      },
    });
  });
});
