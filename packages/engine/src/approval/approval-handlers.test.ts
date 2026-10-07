import { err, type Id } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import { expectOk, testAgent, testNowMs, testSwap } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { autoModeGrantOf } from "./auto-mode-grant-of.js";
import { type AutoModeGrant, checkAutoModeGrant } from "./auto-mode-grant.js";
import { testSnapshot } from "./test-snapshot.js";

const live = { signal: new AbortController().signal };
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
const device = "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001";
// The Mini App holds `confirm` and `loosen`; these callers hold one of the two.
const braking: EngineCaller = {
  credential: device,
  client: { kind: "console", version: "test" },
  scopes: ["read", "confirm"],
};
const loosening: EngineCaller = { ...braking, scopes: ["read", "loosen"] };
const mini: EngineCaller = {
  ...braking,
  client: { kind: "mini", version: "test" },
  scopes: ["read", "chat", "confirm", "loosen"],
};

function setMode(test: TestEngine, mode: "manual" | "auto", caller = testCallers.cli) {
  return test.engine.handlers["approval/set"](testCall({ agent: testAgent, mode }, caller));
}

async function storedMode(test: TestEngine): Promise<ApprovalModeRecord> {
  const settings = await test.stores.agents.get(testAgent, live);
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  return settings.approvalMode;
}

async function grantOf(test: TestEngine, intent: Id<"int">): Promise<AutoModeGrant> {
  const grant = autoModeGrantOf(await testSnapshot(test, intent), { networkFeeCapNativeBase: 1n });
  if (grant === undefined) {
    throw new Error(`Expected an auto grant for intent ${intent}.`);
  }
  return grant;
}

function modeNotice(mode: string, surface: string): EnginePush {
  const values = { agent: "main", mode, surface };
  return {
    topic: "notice",
    kind: "notice/new",
    data: { key: "notice.approvalMode", agent: testAgent, values },
  };
}

// A test engine whose agent, in auto mode, is switched to manual from the console the moment an
// intent reaches `simulated`.
async function switchingAtSimulated(): Promise<TestEngine> {
  const holder: { test?: TestEngine } = {};
  const intents = atSimulated(async () => {
    if (holder.test !== undefined) {
      expectOk(await setMode(holder.test, "manual", braking));
    }
  });
  holder.test = await startTestEngine({ agent: { approvalMode: "auto" }, intents });
  return holder.test;
}

async function proposeByRuntime(test: TestEngine): Promise<IntentView> {
  const call = testCall(testSwap(), testCallers.runtime);
  return expectOk(await test.engine.handlers["intent/propose"](call));
}

// An agent store whose first `losses` approval mode writes lose their race to another switch.
function racing(losses: number): (store: AgentStore) => AgentStore {
  return (store) => {
    let lost = 0;
    return {
      ...store,
      async setApprovalMode(change, options) {
        if (lost < losses) {
          lost += 1;
          await store.setApprovalMode({ ...change, mode: "manual" }, options);
        }
        return store.setApprovalMode(change, options);
      },
    };
  };
}

// An intent store that runs `hook` once an intent has moved to `simulated`.
function atSimulated(hook: () => Promise<void>): (store: IntentStore) => IntentStore {
  return (store) => ({
    ...store,
    async transition(change, options) {
      const commit = await store.transition(change, options);
      if (change.state === "simulated") {
        await hook();
      }
      return commit;
    },
  });
}

describe("the approval mode operations", () => {
  it("answers the agent's mode and when it last changed", async () => {
    const test = await startTestEngine();
    const read = await test.engine.handlers["approval/get"](testCall({ agent: testAgent }));
    expect(read).toStrictEqual({
      ok: true,
      value: { mode: "manual", changedAt: testNowMs - 1_000 },
    });
  });

  it("switches to auto from a caller with loosen, and records the surface", async () => {
    const test = await startTestEngine();
    await test.clock.advance(5_000);
    const view = expectOk(await setMode(test, "auto", mini));
    expect(view).toStrictEqual({ mode: "auto", changedAt: testNowMs + 5_000 });
    expect(await storedMode(test)).toStrictEqual({
      agentId: testAgent,
      mode: "auto",
      changedBySurface: "mini",
      changedAtMs: testNowMs + 5_000,
      version: 1,
    });
  });

  it("needs loosen for auto and confirm for manual", async () => {
    const test = await startTestEngine();
    expect(await setMode(test, "auto", braking)).toStrictEqual(err("auth.scope"));
    expect(await setMode(test, "auto", testCallers.mcp)).toStrictEqual(err("auth.scope"));
    expectOk(await setMode(test, "auto", loosening));
    expect(await setMode(test, "manual", loosening)).toStrictEqual(err("auth.scope"));
    expect(await setMode(test, "manual", testCallers.runtime)).toStrictEqual(err("auth.scope"));
    expect(expectOk(await setMode(test, "manual", braking)).mode).toBe("manual");
    expect((await storedMode(test)).version).toBe(2);
  });

  it("journals each switch, pushes it and announces it to the owner", async () => {
    const test = await startTestEngine();
    expectOk(await setMode(test, "auto"));
    expectOk(await setMode(test, "manual", braking));
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    const change = { atMs: testNowMs, path: "agents.main.approvalMode" };
    expect(entries).toStrictEqual([
      {
        ...change,
        id: 1,
        by: testCallers.cli.credential,
        surface: "cli",
        before: "manual",
        after: "auto",
      },
      { ...change, id: 2, by: device, surface: "console", before: "auto", after: "manual" },
    ]);
    const config = test.pushes.filter((push) => push.topic === "config");
    expect(config.map((push) => [push.kind, push.data])).toStrictEqual(
      entries.map((entry) => ["config/changed", entry]),
    );
    const notices = test.pushes.filter((push) => push.topic === "notice");
    expect(notices).toStrictEqual([modeNotice("auto", "cli"), modeNotice("manual", "console")]);
  });

  it("changes nothing when the agent is in the mode already", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    const view = expectOk(await setMode(test, "auto"));
    expect(view).toStrictEqual({ mode: "auto", changedAt: testNowMs - 1_000 });
    expect((await storedMode(test)).version).toBe(0);
    expect(test.pushes.filter((push) => push.topic !== "intent")).toStrictEqual([]);
  });

  it("refuses an agent it does not hold", async () => {
    const test = await startTestEngine();
    const unknown = testCall({ agent: unknownAgent, mode: "auto" as const });
    expect([
      await test.engine.handlers["approval/get"](testCall({ agent: unknownAgent })),
      await test.engine.handlers["approval/set"](unknown),
    ]).toStrictEqual([err("agent.not_found"), err("agent.not_found")]);
  });

  it("reads the mode again after a lost race, and faults after three", async () => {
    const once = await startTestEngine({ agents: racing(1) });
    expect(expectOk(await setMode(once, "auto")).mode).toBe("auto");
    expect((await storedMode(once)).version).toBe(2);
    const always = await startTestEngine({ agents: racing(3) });
    await expect(setMode(always, "auto")).rejects.toMatchObject({
      code: "engine.agent_stale",
      message: `The approval mode of agent ${testAgent} kept changing under the switch.`,
      retryable: true,
      details: { agent: testAgent },
    });
  });
});

describe("a switch to manual", () => {
  it("ends the grant of an unsigned auto trade, and the next trade opens a card", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const first = await proposeByRuntime(test);
    expect([first.state, first.card]).toStrictEqual(["confirmed", undefined]);
    const grant = await grantOf(test, first.intent);
    const signing = {
      intent: first.intent,
      termsHash: grant.termsHash,
      feePerGasNativeBase: 1n,
      nowMs: test.clock.now(),
    };
    const before = await storedMode(test);
    expect(checkAutoModeGrant(grant, { ...signing, approvalMode: before }).ok).toBe(true);
    expectOk(await setMode(test, "manual", braking));
    const after = await storedMode(test);
    expect(checkAutoModeGrant(grant, { ...signing, approvalMode: after })).toStrictEqual(
      err("manual"),
    );
    const next = await proposeByRuntime(test);
    expect([next.state, next.card?.version]).toStrictEqual(["awaiting_confirmation", 1]);
  });

  it("asks for a tap on a trade already running when the switch lands", async () => {
    const view = await proposeByRuntime(await switchingAtSimulated());
    expect([view.state, view.card?.version]).toStrictEqual(["awaiting_confirmation", 1]);
  });
});
