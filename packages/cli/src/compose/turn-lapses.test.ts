import { idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { EngineCaller } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent as agent } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { bot } from "./test-bot.js";

const live = { signal: new AbortController().signal };
const runtimeOf = (n: number): EngineCaller => ({
  credential: idSchema("tok").parse(`tok_0190f1c2-3a4b-7c5d-8e6f-0000000000${String(n)}`),
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
});
const runtime = runtimeOf(21);
const restarted = runtimeOf(22);
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");

const stopped =
  "Stopped before the answer was complete. A proposal it made may be waiting on a card: check your open cards before you ask again.";

// The engine with the owner's bot, and a turn of the runtime's running.
async function running() {
  const turns = createRunningTurns({ clock: createManualClock(0) });
  const test = await bot({ turns });
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const start = { agent, session, turn, messages: [message], outsideContent: false };
  await test.composed.engine.handlers["turn/start"]({ args: start, caller: runtime, ...live });
  return { test, turns };
}

describe("a running turn the engine ends without the runtime's end", () => {
  it("is logged with its agent and cause, and the owner reads that it stopped", async () => {
    const { test, turns } = await running();
    turns.clearAll();
    await test.telegram.idle();
    const lapsed = test.logger.records().filter((record) => record.event === "chat.turn_lapsed");
    expect(lapsed.map((record) => [record.level, record.fields])).toStrictEqual([
      ["warn", { agentId: agent, traceId: turn, reason: "runtime_exit" }],
    ]);
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual([stopped]);
  });

  it("shows one line for a turn the engine ended, whatever the runtime's repair says", async () => {
    const { test, turns } = await running();
    turns.clearAll();
    await test.telegram.idle();
    turns.startRuntime(idSchema("tok").parse(restarted.credential));
    const { handlers } = test.composed.engine;
    const statusKey = "turn.failed.proposalUnknown";
    await handlers["turn/status"]({ args: { agent, turn, statusKey }, caller: restarted, ...live });
    const end = { agent, turn, outcome: "failed" } as const;
    await handlers["turn/end"]({ args: end, caller: restarted, ...live });
    await test.telegram.idle();
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual([stopped]);
  });

  it("logs a turn of the runtime that failed, with the class its status line names", async () => {
    const { test } = await running();
    const { handlers } = test.composed.engine;
    const statusKey = "turn.failed.billing";
    await handlers["turn/status"]({ args: { agent, turn, statusKey }, caller: runtime, ...live });
    const failed = test.logger.records().filter((record) => record.event === "turn.failed");
    expect(failed.map((record) => [record.level, record.fields])).toStrictEqual([
      ["warn", { agentId: agent, traceId: turn, reason: "billing" }],
    ]);
  });

  it("shows the repair's line when the engine stopped with the runtime and ended nothing", async () => {
    const turns = createRunningTurns({ clock: createManualClock(0) });
    const test = await bot({ turns });
    turns.startRuntime(idSchema("tok").parse(restarted.credential));
    const { handlers } = test.composed.engine;
    const statusKey = "turn.failed.engine";
    await handlers["turn/status"]({ args: { agent, turn, statusKey }, caller: restarted, ...live });
    const end = { agent, turn, outcome: "failed" } as const;
    await handlers["turn/end"]({ args: end, caller: restarted, ...live });
    await test.telegram.idle();
    expect(test.botApi.sent().map(({ text }) => text)).toStrictEqual([
      "Stopped: the agent lost its link to the engine. It starts again by itself.",
    ]);
  });
});
