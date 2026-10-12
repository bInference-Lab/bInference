import { createIdSource } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { NoticeStore } from "@binference/engine/notices";
import {
  createMemoryAgentStore,
  createMemoryNoticeStore,
  testAgent,
  testAgentDraft,
  testNowMs,
} from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { createNoticeLog } from "./notice-log.js";

const live = { signal: new AbortController().signal };
const frozen = {
  topic: "notice",
  kind: "notice/new",
  data: { key: "notice.frozen", agent: testAgent, values: { agent: "main", surface: "cli" } },
} as const;
const unsettled = (): void => undefined;
const noAgents = { get: async () => Promise.resolve(undefined) };
const mutedAlways = async (): Promise<boolean> => Promise.resolve(true);
const settingsGone = async (): Promise<boolean> => Promise.reject(new Error("The store is gone."));

// A notice store whose agents include the test agent.
async function storeWithAgent(): Promise<NoticeStore> {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live);
  return createMemoryNoticeStore({ agents });
}

function logOf(store: NoticeStore) {
  const clock = createManualClock(testNowMs);
  const logger = createMemoryLogger({ subsystem: "engine" });
  const ids = createIdSource({ clock, random: createSeededRandom(3) });
  const log = createNoticeLog({ store, surfaces: ["telegram"], ids, clock, logger });
  return { log, logger };
}

describe("the notice log", () => {
  it("stores a notice with its delivery queued and pushes its id and time", async () => {
    const store = await storeWithAgent();
    const { log } = logOf(store);
    const pushed = log.take(frozen);
    await log.idle();
    const [record] = await store.list({ limit: 10 }, live);
    expect(pushed).toStrictEqual({
      ...frozen,
      data: { id: record?.id, at: testNowMs, ...frozen.data },
    });
    expect(record).toMatchObject({
      atMs: testNowMs,
      kind: "frozen",
      level: "critical",
      delivered: { telegram: "queued" },
    });
    const queued = await store.queued({ surface: "telegram", limit: 10 }, live);
    expect(queued.map((delivery) => delivery.record.id)).toStrictEqual([record?.id]);
  });

  it("passes every other push on as it is and stores nothing for it", async () => {
    const store = createMemoryNoticeStore({ agents: noAgents });
    const { log } = logOf(store);
    const receipt = { ...frozen, data: { key: "receipt.paper", values: {} } };
    const changed = {
      topic: "intent",
      kind: "intent/changed",
      data: { state: "confirmed" },
    } as const;
    expect(log.take(receipt)).toBe(receipt);
    expect(log.take(changed)).toBe(changed);
    await log.idle();
    expect(await store.list({ limit: 10 }, live)).toStrictEqual([]);
  });

  it("logs a notice the store refuses and still pushes it with its id", async () => {
    const { log, logger } = logOf(createMemoryNoticeStore({ agents: noAgents }));
    const pushed = log.take(frozen);
    await log.idle();
    expect(pushed.data).toMatchObject({ key: "notice.frozen", at: testNowMs });
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "engine.notice_not_stored",
        fields: { agentId: testAgent, errorCode: "store.constraint" },
      }),
    );
  });

  it("stores no more than 1,000 notices waiting for a stuck store", async () => {
    let release = unsettled;
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: NoticeStore = {
      ...createMemoryNoticeStore({ agents: noAgents }),
      record: async () => stuck,
    };
    const { log, logger } = logOf(store);
    for (let n = 0; n <= 1_000; n += 1) {
      log.take(frozen);
    }
    expect(logger.records()).toStrictEqual([
      expect.objectContaining({ fields: { agentId: testAgent, errorCode: "busy" } }),
    ]);
    release();
    await log.idle();
  });

  it("stores a muted notice with no delivery, and pushes it like any other", async () => {
    const store = await storeWithAgent();
    const clock = createManualClock(testNowMs);
    const logger = createMemoryLogger({ subsystem: "engine" });
    const ids = createIdSource({ clock, random: createSeededRandom(3) });
    const isMuted = mutedAlways;
    const log = createNoticeLog({ store, surfaces: ["telegram"], isMuted, ids, clock, logger });
    const pushed = log.take(frozen);
    await log.idle();
    const [record] = await store.list({ limit: 10 }, live);
    expect(pushed.data).toMatchObject({ id: record?.id });
    expect(record?.delivered).toStrictEqual({});
    await expect(store.queued({ surface: "telegram", limit: 10 }, live)).resolves.toStrictEqual([]);
  });

  it("delivers a notice whose settings it could not read, and logs the failure", async () => {
    const store = await storeWithAgent();
    const clock = createManualClock(testNowMs);
    const logger = createMemoryLogger({ subsystem: "engine" });
    const ids = createIdSource({ clock, random: createSeededRandom(3) });
    const isMuted = settingsGone;
    const log = createNoticeLog({ store, surfaces: ["telegram"], isMuted, ids, clock, logger });
    log.take(frozen);
    await log.idle();
    const [record] = await store.list({ limit: 10 }, live);
    expect(record?.delivered).toStrictEqual({ telegram: "queued" });
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "engine.notice_settings_unread",
        fields: { agentId: testAgent, errorCode: "unexpected" },
      }),
    );
  });
});
