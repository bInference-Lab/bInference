import { err, type Id } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { AgentDraft } from "../agents/agent-record.js";
import { expectOk, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall, testCallers } from "./test-engine.js";

interface Locked {
  readonly test: TestEngine;
  /** Unlocks the engine, as `binference unlock` does. */
  readonly unlock: () => void;
}

async function lockedEngine(agent: Partial<AgentDraft>): Promise<Locked> {
  const lock = { isLocked: true };
  const test = await startTestEngine({ agent, isLocked: () => lock.isLocked });
  return {
    test,
    unlock: () => {
      lock.isLocked = false;
    },
  };
}

async function propose(test: TestEngine, caller = testCallers.cli): Promise<IntentView> {
  return expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap(), caller)));
}

async function confirm(test: TestEngine, view: IntentView) {
  const card = view.card?.card as Id<"crd">;
  const args = { intent: view.intent, card, cardVersion: 1 };
  return test.engine.handlers["intent/confirm"](testCall(args));
}

describe("a locked engine", () => {
  it("refuses the owner's confirm of a live intent and signs once unlocked", async () => {
    const { test, unlock } = await lockedEngine({ mode: "live" });
    const view = await propose(test);
    expect(await confirm(test, view)).toStrictEqual(err("engine.locked"));
    const read = expectOk(await test.engine.handlers["intent/get"](testCall(view)));
    expect(read.state).toBe("awaiting_confirmation");
    expect(test.executor.taken()).toStrictEqual([]);
    unlock();
    expect(expectOk(await confirm(test, view)).state).toBe("confirmed");
    expect(test.executor.taken()).toStrictEqual([view.intent]);
  });

  it("refuses a Telegram tap on a live intent's Confirm the same way", async () => {
    const { test } = await lockedEngine({ mode: "live" });
    const view = await propose(test);
    const answer = {
      intent: view.intent,
      decision: "confirm",
      cardVersion: 1,
      answeredBy: { surface: "telegram", by: "tg:1" },
    } as const;
    const answered = expectOk(
      await test.engine.answer(answer, { signal: AbortSignal.timeout(1_000) }),
    );
    expect([answered.outcome.verdict, answered.intent.record.state]).toStrictEqual([
      "locked",
      "awaiting_confirmation",
    ]);
  });

  it("takes a Cancel on a live intent, which signs nothing", async () => {
    const { test } = await lockedEngine({ mode: "live" });
    const view = await propose(test);
    const args = { intent: view.intent, card: view.card?.card as Id<"crd"> };
    const denied = expectOk(await test.engine.handlers["intent/deny"](testCall(args)));
    expect(denied.state).toBe("denied");
  });

  it("confirms and fills a paper intent, which signs nothing", async () => {
    const { test } = await lockedEngine({ mode: "paper" });
    const view = await propose(test);
    expect(expectOk(await confirm(test, view)).state).toBe("paper_filled");
  });

  it("holds auto mode for a live intent: it opens a card and nothing reaches the wallet queue", async () => {
    const { test } = await lockedEngine({ mode: "live", approvalMode: "auto" });
    const view = await propose(test, testCallers.runtime);
    expect(view.state).toBe("awaiting_confirmation");
    expect(test.executor.taken()).toStrictEqual([]);
  });

  it("lets auto mode fill a paper intent at once", async () => {
    const { test } = await lockedEngine({ mode: "paper", approvalMode: "auto" });
    const view = await propose(test, testCallers.runtime);
    expect([view.state, view.card]).toStrictEqual(["paper_filled", undefined]);
  });
});
