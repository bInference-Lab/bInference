import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import type { SendLevel } from "../policy/policy-rules.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { AgentStore } from "../ports.js";
import { saveTestAddress, sendRefusals } from "./test-sends.js";

const live = { signal: new AbortController().signal };
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
// The Mini App holds `confirm` and `loosen`; these callers hold one of the two.
const braking: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "mini", version: "test" },
  scopes: ["read", "confirm"],
};
const loosening: EngineCaller = { ...braking, scopes: ["read", "loosen"] };

function setLevel(test: TestEngine, level: SendLevel, caller = testCallers.cli) {
  return test.engine.handlers["sendLevel/set"](testCall({ agent: testAgent, level }, caller));
}

function getLevel(test: TestEngine) {
  return test.engine.handlers["sendLevel/get"](testCall({ agent: testAgent }));
}

function cancelPending(test: TestEngine, caller = testCallers.cli) {
  return test.engine.handlers["sendLevel/cancelPending"](testCall({ agent: testAgent }, caller));
}

function notices(test: TestEngine): readonly unknown[] {
  return test.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
}

// An agent store whose first `losses` send level writes lose their race to another change.
function racing(losses: number): (store: AgentStore) => AgentStore {
  let lost = 0;
  return (store) => ({
    ...store,
    async setSendLevel(change, options) {
      if (lost < losses) {
        lost += 1;
        await store.setSendLevel({ ...change, level: 0 }, options);
      }
      return store.setSendLevel(change, options);
    },
  });
}

describe("a looser send level", () => {
  it("is refused for a send until 24 hours after the owner asked for it", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 3 } });
    await saveTestAddress(test);
    expectOk(await setLevel(test, 1));

    await test.clock.advance(looseningWaitMs - 1);
    expect(await sendRefusals(test)).toStrictEqual(["send_level"]);
    await test.clock.advance(1);
    expect(await sendRefusals(test)).toStrictEqual([]);
  });

  it("waits 24 hours and is announced with the time it takes effect", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 3 } });
    const effectiveAt = testNowMs + looseningWaitMs;
    const pending = { level: 0, effectiveAt };

    expect(await setLevel(test, 0, loosening)).toStrictEqual({
      ok: true,
      value: { level: 3, pending },
    });
    expect(await getLevel(test)).toStrictEqual({ ok: true, value: { level: 3, pending } });
    expect(notices(test)).toStrictEqual([
      {
        key: "notice.sendLevel",
        agent: testAgent,
        values: { from: "3", to: "0", pending: "yes" },
        times: { when: effectiveAt },
      },
    ]);
    await test.clock.advance(looseningWaitMs);
    expect(await getLevel(test)).toStrictEqual({ ok: true, value: { level: 0 } });
  });

  it("keeps its time when it is asked for again, and announces nothing new", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });
    expectOk(await setLevel(test, 1));
    await test.clock.advance(60_000);
    const again = expectOk(await setLevel(test, 1));

    expect(again.pending?.effectiveAt).toBe(testNowMs + looseningWaitMs);
    expect(notices(test)).toHaveLength(1);
  });

  it("needs the loosen scope, which braking alone does not give", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });

    expect(await setLevel(test, 1, braking)).toStrictEqual(err("auth.scope"));
    expect(await getLevel(test)).toStrictEqual({ ok: true, value: { level: 2 } });
    expect(test.pushes).toStrictEqual([]);
  });

  it("is cancelled with the confirm scope, and the level stays", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 3 } });
    await saveTestAddress(test);
    expectOk(await setLevel(test, 0));

    expect(await cancelPending(test, braking)).toStrictEqual({ ok: true, value: { level: 3 } });
    await test.clock.advance(looseningWaitMs);
    expect(await getLevel(test)).toStrictEqual({ ok: true, value: { level: 3 } });
    expect(await sendRefusals(test)).toStrictEqual(["send_level"]);
  });

  it("is dropped by a stricter level, which applies at once, and both are announced", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });
    expectOk(await setLevel(test, 0));

    expect(await setLevel(test, 3, braking)).toStrictEqual({ ok: true, value: { level: 3 } });
    expect(notices(test).slice(1)).toStrictEqual([
      {
        key: "notice.sendLevel",
        agent: testAgent,
        values: { from: "2", to: "3", pending: "no" },
      },
      { key: "notice.sendLevelCancelled", agent: testAgent, values: { to: "0", level: "3" } },
    ]);
    await test.clock.advance(looseningWaitMs);
    expect(await getLevel(test)).toStrictEqual({ ok: true, value: { level: 3 } });
  });
});

describe("the send level operations", () => {
  it("move to a stricter level at once with the confirm scope and announce it", async () => {
    const test = await startTestEngine();

    expect(await setLevel(test, 2, braking)).toStrictEqual({ ok: true, value: { level: 2 } });
    expect(notices(test)).toStrictEqual([
      {
        key: "notice.sendLevel",
        agent: testAgent,
        values: { from: "0", to: "2", pending: "no" },
      },
    ]);
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(entries).toMatchObject([
      {
        atMs: testNowMs,
        by: braking.credential,
        surface: "mini",
        path: "agents.main.sendLevel",
        before: { level: 0 },
        after: { level: 2 },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(1);
  });

  it("journal and announce a cancelled loosening, naming the level that stays", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 1 } });
    expectOk(await setLevel(test, 0));
    expectOk(await cancelPending(test));

    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    const pending = { level: 0, effectiveAt: testNowMs + looseningWaitMs };
    expect(entries.map(({ before, after }) => ({ before, after }))).toStrictEqual([
      { before: { level: 1 }, after: { level: 1, pending } },
      { before: { level: 1, pending }, after: { level: 1 } },
    ]);
    expect(notices(test).at(-1)).toStrictEqual({
      key: "notice.sendLevelCancelled",
      agent: testAgent,
      values: { to: "0", level: "1" },
    });
  });

  it("change nothing for the level in effect or a cancel with nothing waiting", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });

    expect(await setLevel(test, 2, braking)).toStrictEqual({ ok: true, value: { level: 2 } });
    expect(await cancelPending(test)).toStrictEqual({ ok: true, value: { level: 2 } });
    expect(test.pushes).toStrictEqual([]);
  });

  it("refuse an unknown agent", async () => {
    const test = await startTestEngine();
    const call = testCall({ agent: unknownAgent });

    expect(await test.engine.handlers["sendLevel/get"](call)).toStrictEqual(err("agent.not_found"));
    const set = testCall({ agent: unknownAgent, level: 3 as const });
    expect(await test.engine.handlers["sendLevel/set"](set)).toStrictEqual(err("agent.not_found"));
  });

  it("read the level again after a write lost its race, and give up after three", async () => {
    const won = await startTestEngine({ agents: racing(2) });
    expect(await setLevel(won, 1)).toStrictEqual({ ok: true, value: { level: 1 } });

    const lost = await startTestEngine({ agents: racing(3) });
    await expect(setLevel(lost, 1)).rejects.toMatchObject({ code: "engine.agent_stale" });
  });
});
