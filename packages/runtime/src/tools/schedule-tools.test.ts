import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  agent,
  callTool,
  otherAgent,
  outcomeOf,
  schedule,
  scheduleWire,
} from "../testing/agent-tool-fixtures.js";

const refusal = (code: `${string}.${string}`) =>
  new BinferenceError({ code, message: `The engine said ${code}.` });
const prompt = "Report the portfolio in two lines.";

describe("schedule_list", () => {
  it("lists the agent's schedules with their runs in UTC, clean when none is marked", async () => {
    const run = callTool(
      { "schedule/list": { items: [scheduleWire()] } },
      { name: "schedule_list", args: {} },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: `- schedule ${schedule}: cron "0 9 * * 1" in the owner's timezone, next at 2025-10-09T08:53:20.000Z. Prompt: ${prompt}`,
      isError: false,
    });
  });

  it("holds outside content when it lists a schedule set from outside content", async () => {
    const run = callTool(
      { "schedule/list": { items: [scheduleWire(), scheduleWire(agent, true)] } },
      { name: "schedule_list", args: {} },
    );
    const outcome = await outcomeOf(run);
    expect(outcome.outside).toBe(true);
    expect(outcome.text).toMatch(/^\[outside content: /);
    expect(outcome.text).toContain(`- schedule ${schedule} [marked]: `);
  });

  it("says so when the agent has none", async () => {
    const run = callTool({ "schedule/list": { items: [] } }, { name: "schedule_list", args: {} });
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: "This agent has no active schedule.",
      isError: false,
    });
  });
});

describe("schedule_create", () => {
  it("sends a one-time run as epoch milliseconds and says when it runs", async () => {
    const at = {
      schedule,
      agent,
      when: { at: 1_792_458_000_000 },
      prompt,
      state: "active",
      nextAt: 1_792_458_000_000,
      createdAt: 1,
    };
    const run = callTool(
      { "schedule/create": at },
      { name: "schedule_create", args: { when: { at: "2026-10-20T09:00:00+08:00" }, prompt } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toMatchObject([
      { args: { when: { at: 1_792_458_000_000 }, agent } },
    ]);
    expect(outcome.text).toContain("once at 2026-10-20T01:00:00.000Z");
    expect(outcome.text).toContain("the owner is told it was set");
  });

  it.each([
    ["schedule.bad_when", "cannot read this time, or it never runs"],
    ["schedule.too_many", "already has 50 active schedules"],
    ["protocol.bad_args", "refused the schedule's terms"],
  ] as const)("reads %s as nothing stored and what to do next", async (code, words) => {
    const run = callTool(
      { "schedule/create": refusal(code) },
      { name: "schedule_create", args: { when: { cron: "0 9 * * 1" }, prompt } },
    );
    const outcome = await outcomeOf(run);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/^not set, and nothing was stored:/);
    expect(outcome.text).toContain(words);
  });

  it.each([
    ["a prompt over 2,000 characters", { when: { cron: "0 9 * * *" }, prompt: "x".repeat(2_001) }],
    ["a time with no offset", { when: { at: "2026-10-20T09:00:00" }, prompt }],
    ["both a cron and a time", { when: { cron: "0 9 * * *", at: "2026-10-20T09:00:00Z" }, prompt }],
  ])("refuses %s before the engine hears of it", (_case, args) => {
    const run = callTool({}, { name: "schedule_create", args });
    expect(run.refused).toMatch(/^not run: the arguments do not match schedule_create's schema/);
  });
});

describe("schedule_cancel", () => {
  it("answers another agent's schedule as one the agent does not have, and cancels nothing", async () => {
    const run = callTool(
      { "schedule/list": { items: [scheduleWire(otherAgent)] }, "schedule/cancel": {} },
      { name: "schedule_cancel", args: { schedule } },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: `This agent has no active schedule ${schedule}.`,
      isError: true,
    });
    expect(run.client.calls()).toStrictEqual([{ op: "schedule/list", args: { agent } }]);
  });

  it("answers one that ended meanwhile as one the agent does not have", async () => {
    const run = callTool(
      {
        "schedule/list": { items: [scheduleWire()] },
        "schedule/cancel": refusal("schedule.not_found"),
      },
      { name: "schedule_cancel", args: { schedule } },
    );
    await expect(outcomeOf(run)).resolves.toMatchObject({
      isError: true,
      text: `This agent has no active schedule ${schedule}.`,
    });
  });
});
