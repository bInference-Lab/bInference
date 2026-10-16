import { idSchema } from "@binference/core";
import type { ScheduleView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";

const prompt = "Review my portfolio.";
const newYork = "America/New_York";
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-0000000000aa");

async function setSchedule(test: TestEngine, cron: string): Promise<ScheduleView> {
  const args = { agent: testAgent, when: { cron }, prompt };
  return expectOk(await test.engine.handlers["schedule/create"](testCall(args)));
}

async function runAt(test: TestEngine, iso: string): Promise<void> {
  await test.clock.advance(Date.parse(iso) - test.clock.now());
  await test.engine.runSchedules(testCall({}));
}

// The wake-ups that wait for the runtime, as their due times; the runtime then takes them.
async function takeWakeUps(test: TestEngine): Promise<readonly string[]> {
  const { agentInbox } = test.stores;
  const untaken = await agentInbox.untaken({ agentId: testAgent, limit: 100 }, testCall({}));
  if (untaken.length > 0) {
    await agentInbox.take(
      { ids: untaken.map(({ id }) => id), atMs: test.clock.now() },
      testCall({}),
    );
  }
  return untaken.map((message) => {
    const { due } = message.payload as { readonly due: number };
    return new Date(due).toISOString();
  });
}

async function stored(test: TestEngine, view: ScheduleView) {
  return test.stores.schedules.get(view.schedule, testCall({}));
}

describe("the schedule queue", () => {
  it("wakes the agent at the wall time in the owner's timezone, across a change of the clocks", async () => {
    const test = await startTestEngine({ timeZone: newYork });
    const schedule = await setSchedule(test, "30 2 * * *");
    await runAt(test, "2027-01-16T07:29:59Z");
    const early = await takeWakeUps(test);
    await runAt(test, "2027-01-16T07:30:00Z");
    const onTime = await takeWakeUps(test);
    // 02:30 does not exist on 14 March: the clocks jump from 02:00 to 03:00.
    await runAt(test, "2027-03-14T06:59:00Z");
    await takeWakeUps(test);
    const beforeJump = (await stored(test, schedule))?.nextAtMs;
    await runAt(test, "2027-03-14T07:00:00Z");
    const atJump = await takeWakeUps(test);
    const afterJump = (await stored(test, schedule))?.nextAtMs;

    expect([early, onTime, atJump]).toStrictEqual([
      [],
      ["2027-01-16T07:30:00.000Z"],
      ["2027-03-14T07:00:00.000Z"],
    ]);
    expect([beforeJump, afterJump]).toStrictEqual([
      Date.parse("2027-03-14T07:00:00Z"),
      Date.parse("2027-03-15T06:30:00Z"),
    ]);
    expect(test.pushes.filter((push) => push.kind === "inbox/scheduleDue")).toHaveLength(3);
  });

  it("runs a schedule that missed many runs while the engine was off once", async () => {
    const test = await startTestEngine({ timeZone: newYork });
    const schedule = await setSchedule(test, "0 9 * * *");
    await runAt(test, "2027-01-20T16:00:00Z");
    const first = await takeWakeUps(test);
    await test.engine.runSchedules(testCall({}));

    expect([first, await takeWakeUps(test)]).toStrictEqual([["2027-01-15T14:00:00.000Z"], []]);
    expect(await stored(test, schedule)).toMatchObject({
      nextAtMs: Date.parse("2027-01-21T14:00:00Z"),
      lastRun: { due: Date.parse("2027-01-15T14:00:00Z"), outcome: "sent" },
    });
  });

  it("adds no second wake-up while the last one waits for the runtime", async () => {
    const test = await startTestEngine({ timeZone: newYork });
    const schedule = await setSchedule(test, "0 * * * *");
    await runAt(test, "2027-01-15T09:00:00Z");
    await runAt(test, "2027-01-15T10:00:00Z");

    expect(await takeWakeUps(test)).toStrictEqual(["2027-01-15T09:00:00.000Z"]);
    expect((await stored(test, schedule))?.lastRun).toMatchObject({ reason: "waiting" });
  });

  it("starts no turn while the budget of the day is spent, and tells the owner once", async () => {
    const test = await startTestEngine({ timeZone: newYork });
    const [first, second] = [
      await setSchedule(test, "0 9 * * *"),
      await setSchedule(test, "0 9 * * *"),
    ];
    const usage = { agent: testAgent, turn, model: "m", inputTokens: 1, outputTokens: 1 };
    const spend = { ...usage, cachedTokens: 0, usdMicros: 5_000_000n };
    await test.engine.handlers["usage/record"]({
      ...testCall(spend, testCallers.runtime),
      key: `${turn}.usage.1`,
    });
    await runAt(test, "2027-01-15T14:00:00Z");

    expect(await takeWakeUps(test)).toStrictEqual([]);
    expect([
      (await stored(test, first))?.lastRun,
      (await stored(test, second))?.lastRun,
    ]).toMatchObject([
      { outcome: "skipped", reason: "budget" },
      { outcome: "skipped", reason: "budget" },
    ]);
    const notices = test.pushes.filter((push) => push.kind === "notice/new");
    const keys = notices.map((push) => JSON.stringify(push.data));
    expect(keys.filter((key) => key.includes("notice.budget"))).toHaveLength(1);
  });

  it("starts no turn for a frozen agent and records the skip", async () => {
    const test = await startTestEngine({ timeZone: newYork });
    const schedule = await setSchedule(test, "0 9 * * *");
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
    await runAt(test, "2027-01-15T14:00:00Z");

    expect(await takeWakeUps(test)).toStrictEqual([]);
    expect((await stored(test, schedule))?.lastRun).toMatchObject({
      outcome: "skipped",
      reason: "frozen",
    });
  });

  it("ends a schedule that runs once after its run", async () => {
    const test = await startTestEngine();
    const at = test.clock.now() + 60_000;
    const args = { agent: testAgent, when: { at }, prompt };
    const once = expectOk(await test.engine.handlers["schedule/create"](testCall(args)));
    await test.clock.advance(120_000);
    await test.engine.runSchedules(testCall({}));

    expect(await takeWakeUps(test)).toHaveLength(1);
    expect(await stored(test, once)).toMatchObject({
      state: "ended",
      lastRun: { outcome: "sent" },
    });
  });
});
