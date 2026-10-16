import { createIdSource } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { live } from "../contracts/store-fixtures.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import { createScheduleQueue } from "./run-schedules.js";
import type { ScheduleRecord } from "./schedule-record.js";

const hourMs = 3_600_000;

function scheduleOf(n: number, when: ScheduleRecord["when"], zone: string): ScheduleRecord {
  return {
    id: createIdSource({ clock: createManualClock(n), random: createSeededRandom(n) }).next("sch"),
    agentId: testAgent,
    when,
    prompt: "Review my portfolio.",
    state: "active",
    nextAtMs: testNowMs + hourMs,
    zone,
    createdBy: "telegram",
    outsideContent: false,
    createdAtMs: n,
    changedAtMs: n,
  };
}

describe("the schedule queue's zones", () => {
  it("moves the schedules that follow the owner's timezone into a new zone from now, never at once", async () => {
    const clock = createManualClock(testNowMs);
    const stores = createMemoryEngineStores();
    await stores.agents.create(testAgentDraft(), live());
    const zone = { now: "Asia/Shanghai" };
    const follows = scheduleOf(1, { cron: "0 9 * * *" }, "Asia/Shanghai");
    const own = scheduleOf(2, { cron: "0 9 * * *", timezone: "Asia/Shanghai" }, "Asia/Shanghai");
    await stores.schedules.create(follows, live());
    await stores.schedules.create(own, live());
    const queue = createScheduleQueue({
      schedules: stores.schedules,
      agents: stores.agents,
      budget: { open: async () => Promise.resolve(1n) },
      ownerTimeZone: () => zone.now,
      woke: () => undefined,
      ids: createIdSource({ clock, random: createSeededRandom(1) }),
      clock,
    });
    await queue.run(live());
    zone.now = "America/New_York";
    await queue.run(live());
    const [moved, kept] = await Promise.all([
      stores.schedules.get(follows.id, live()),
      stores.schedules.get(own.id, live()),
    ]);

    expect([moved?.nextAtMs, moved?.zone]).toStrictEqual([
      Date.parse("2027-01-15T14:00:00Z"),
      "America/New_York",
    ]);
    expect(kept).toStrictEqual(own);
    expect(await stores.agentInbox.untaken({ limit: 10 }, live())).toStrictEqual([]);
  });
});
