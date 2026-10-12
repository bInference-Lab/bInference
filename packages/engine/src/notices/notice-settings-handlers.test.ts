import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import { mutableNoticeKinds } from "./notice-settings.js";

const live = { signal: new AbortController().signal };
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
const mutable = [...mutableNoticeKinds];

async function setSettings(
  test: TestEngine,
  change: { readonly muted?: readonly string[]; readonly dailySummaryTime?: string },
) {
  return test.engine.handlers["notice/setSettings"](testCall({ agent: testAgent, ...change }));
}

async function stored(test: TestEngine) {
  return (await test.stores.agents.get(testAgent, live))?.agent;
}

describe("an agent's notice settings", () => {
  it("answers every kind on and the summary at 09:00 for an agent with no settings yet", async () => {
    const test = await startTestEngine();
    const got = await test.engine.handlers["notice/getSettings"](testCall({ agent: testAgent }));
    expect(expectOk(got)).toStrictEqual({ muted: [], mutable, dailySummaryTime: "09:00" });
  });

  it("mutes the kinds it names and keeps the summary's time", async () => {
    const test = await startTestEngine();
    const set = expectOk(await setSettings(test, { muted: ["fill", "lowGas"] }));
    expect(set).toStrictEqual({ muted: ["fill", "lowGas"], mutable, dailySummaryTime: "09:00" });
    expect((await stored(test))?.notifications).toStrictEqual({
      muted: ["fill", "lowGas"],
      dailySummaryTime: "09:00",
    });
    const moved = expectOk(await setSettings(test, { dailySummaryTime: "07:30" }));
    expect(moved).toStrictEqual({ muted: ["fill", "lowGas"], mutable, dailySummaryTime: "07:30" });
    expect(expectOk(await setSettings(test, { muted: [] })).muted).toStrictEqual([]);
  });

  it.each([[["frozen"]], [["signInsLocked"]], [["fill", "fill"]], [["quiet"]]])(
    "refuses to mute %j: a security notice, a kind twice or an unknown kind",
    async (muted: readonly string[]) => {
      const test = await startTestEngine();
      expect(await setSettings(test, { muted })).toStrictEqual(err("protocol.bad_args"));
      expect((await stored(test))?.version).toBe(0);
    },
  );

  it("refuses a summary time that is not HH:mm", async () => {
    const test = await startTestEngine();
    const set = await setSettings(test, { dailySummaryTime: "24:00" });
    expect(set).toStrictEqual(err("protocol.bad_args"));
  });

  it("refuses an agent it does not hold", async () => {
    const test = await startTestEngine();
    const call = testCall({ agent: unknownAgent, muted: ["fill"] });
    await expect(test.engine.handlers["notice/setSettings"](call)).resolves.toStrictEqual(
      err("agent.not_found"),
    );
  });

  it("journals each change with who made it, and pushes it", async () => {
    const test = await startTestEngine();
    expectOk(await setSettings(test, { muted: ["update"] }));
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(entries).toStrictEqual([
      {
        id: 1,
        atMs: testNowMs,
        by: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
        surface: "cli",
        path: "agents.main.notifications",
        before: { muted: [], dailySummaryTime: "09:00" },
        after: { muted: ["update"], dailySummaryTime: "09:00" },
      },
    ]);
    const config = test.pushes.filter((push) => push.topic === "config");
    expect(config.map((push) => push.data)).toStrictEqual(entries);
    expect(test.pushes.filter((push) => push.topic === "notice")).toStrictEqual([]);
  });
});
