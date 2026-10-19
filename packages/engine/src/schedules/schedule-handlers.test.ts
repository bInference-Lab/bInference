import { idSchema } from "@binference/core";
import type { ScheduleWhen } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";

const prompt = "Review my portfolio.";
// The test clock reads 2027-01-15T08:00Z, 16:00 in Shanghai.
const shanghaiNineTomorrow = Date.parse("2027-01-16T01:00:00Z");

async function setSchedule(test: TestEngine, when: ScheduleWhen, caller?: EngineCaller) {
  return test.engine.handlers["schedule/create"](
    testCall({ agent: testAgent, when, prompt }, caller),
  );
}

function pushed(test: TestEngine, kind: string) {
  return test.pushes.filter((push) => push.kind === kind).map((push) => push.data);
}

describe("schedule/create", () => {
  it("sets a schedule in the owner's timezone, journaled and announced", async () => {
    const test = await startTestEngine({ timeZone: "Asia/Shanghai" });
    const view = expectOk(await setSchedule(test, { cron: "0 9 * * *" }));

    expect(view).toStrictEqual({
      schedule: view.schedule,
      agent: testAgent,
      when: { cron: "0 9 * * *" },
      prompt,
      state: "active",
      nextAt: shanghaiNineTomorrow,
      createdAt: test.clock.now(),
      outsideContent: false,
    });
    expect(pushed(test, "config/changed")).toMatchObject([
      { path: "agents.main.schedules", surface: "cli", after: { schedule: view.schedule } },
    ]);
    expect(pushed(test, "notice/new")).toStrictEqual([
      {
        key: "notice.scheduleSet",
        agent: testAgent,
        values: { agent: "main", by: "cli", prompt },
        times: { next: shanghaiNineTomorrow },
      },
    ]);
  });

  it("marks a schedule an outside client set or a turn that read outside content", async () => {
    const test = await startTestEngine();
    const marked = { ...testCallers.runtime, turn: { hasOutsideContent: true } };
    const views = [
      expectOk(await setSchedule(test, { cron: "0 9 * * *" }, testCallers.runtime)),
      expectOk(await setSchedule(test, { cron: "0 9 * * *" }, marked)),
      expectOk(await setSchedule(test, { cron: "0 9 * * *" }, testCallers.mcp)),
    ];
    const stored = await Promise.all(
      views.map(async ({ schedule }) => test.stores.schedules.get(schedule, testCall({}))),
    );

    expect(stored.map((record) => record?.outsideContent)).toStrictEqual([false, true, true]);
    expect(views.map((view) => view.outsideContent)).toStrictEqual([false, true, true]);
    expect(pushed(test, "notice/new")).toMatchObject([
      { values: { by: "agent" } },
      { values: { by: "agent" } },
      { values: { by: "cli" } },
    ]);
  });

  it("runs once at a time ahead, in a zone of its own", async () => {
    const test = await startTestEngine({ timeZone: "Asia/Shanghai" });
    const at = test.clock.now() + 60_000;
    const once = expectOk(await setSchedule(test, { at }));
    const tokyo = expectOk(await setSchedule(test, { cron: "0 9 * * *", timezone: "Asia/Tokyo" }));

    expect([once.nextAt, tokyo.nextAt]).toStrictEqual([at, Date.parse("2027-01-16T00:00:00Z")]);
  });

  it("refuses a time it cannot read, a long prompt and an unknown agent", async () => {
    const test = await startTestEngine();
    const refused = { ok: false, error: "schedule.bad_when" };

    expect(await setSchedule(test, { cron: "0 9 * *" })).toStrictEqual(refused);
    expect(await setSchedule(test, { cron: "0 0 31 2 *" })).toStrictEqual(refused);
    expect(await setSchedule(test, { cron: "0 9 * * *", timezone: "Mars/Olympus" })).toStrictEqual(
      refused,
    );
    expect(await setSchedule(test, { at: test.clock.now() })).toStrictEqual(refused);
    const long = testCall({
      agent: testAgent,
      when: { cron: "0 9 * * *" },
      prompt: "a".repeat(2_001),
    });
    expect(await test.engine.handlers["schedule/create"](long)).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const stranger = testCall({
      agent: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099"),
      when: { cron: "0 9 * * *" },
      prompt,
    });
    expect(await test.engine.handlers["schedule/create"](stranger)).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(await test.engine.handlers["schedule/list"](testCall({}))).toStrictEqual({
      ok: true,
      value: { items: [] },
    });
  });
});

describe("schedule/list and schedule/cancel", () => {
  it("lists the active schedules and cancels one, journaled and announced", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const first = expectOk(await setSchedule(test, { cron: "0 9 * * *" }));
    const second = expectOk(await setSchedule(test, { cron: "0 18 * * *" }));
    expectOk(await handlers["schedule/cancel"](testCall({ schedule: first.schedule })));

    expect(expectOk(await handlers["schedule/list"](testCall({ agent: testAgent })))).toStrictEqual(
      {
        items: [second],
      },
    );
    expect(await handlers["schedule/cancel"](testCall({ schedule: first.schedule }))).toStrictEqual(
      { ok: false, error: "schedule.not_found" },
    );
    expect(pushed(test, "config/changed").at(-1)).toMatchObject({
      before: { state: "active" },
      after: { state: "cancelled" },
    });
    expect(pushed(test, "notice/new").at(-1)).toStrictEqual({
      key: "notice.scheduleCancelled",
      agent: testAgent,
      values: { agent: "main", by: "cli", prompt },
    });
  });

  it("lets an outside client cancel only the schedules it set", async () => {
    const test = await startTestEngine();
    const cancel = test.engine.handlers["schedule/cancel"];
    const owners = expectOk(await setSchedule(test, { cron: "0 9 * * *" }));
    const its = expectOk(await setSchedule(test, { cron: "0 9 * * *" }, testCallers.mcp));

    expect(await cancel(testCall({ schedule: owners.schedule }, testCallers.mcp))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(await cancel(testCall({ schedule: its.schedule }, testCallers.mcp))).toStrictEqual({
      ok: true,
      value: {},
    });
  });
});
