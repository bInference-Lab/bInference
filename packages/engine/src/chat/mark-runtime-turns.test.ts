import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testSwap } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { markRuntimeTurns } from "./mark-runtime-turns.js";
import { createRunningTurns } from "./running-turns.js";

const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const token = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000031");
const earlierToken = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000030";

// The runtime as the protocol server signs it in: its token's id, and never a turn of its own.
function runtimeCaller(credential: string): EngineCaller {
  const { turn: _unused, ...signedIn } = testCallers.runtime;
  return { ...signedIn, credential };
}

async function proposeAs(
  caller: EngineCaller,
  setUp: (turns: ReturnType<typeof createRunningTurns>) => void,
) {
  const test = await startTestEngine({ agent: { approvalMode: "auto" } });
  const turns = createRunningTurns();
  turns.startRuntime(token);
  setUp(turns);
  const handlers = markRuntimeTurns(test.engine.handlers, turns);
  const propose = handlers["intent/propose"];
  if (propose === undefined) {
    throw new Error("The engine serves intent/propose.");
  }
  return expectOk(await propose(testCall(testSwap(), caller)));
}

// The runtime's write of the strategy, with the caller claiming a clean turn whatever it is.
async function editAs(running: { readonly hasOutsideContent: boolean }) {
  const test = await startTestEngine();
  const turns = createRunningTurns();
  turns.startRuntime(token);
  turns.start({ agent: testAgent, turn, ...running });
  const edit = markRuntimeTurns(test.engine.handlers, turns)["agent/editFile"];
  const claiming = { ...runtimeCaller(token), turn: { hasOutsideContent: false } };
  const args = { agent: testAgent, file: "STRATEGY.md", text: "Hold for days." } as const;
  return { at: test.clock.now(), written: await edit?.(testCall(args, claiming)) };
}

describe("markRuntimeTurns", () => {
  it("fills in auto mode a proposal from a turn that read no outside content", async () => {
    const view = await proposeAs(runtimeCaller(token), (turns) =>
      turns.start({ agent: testAgent, turn, hasOutsideContent: false }),
    );
    expect([view.state, view.outsideContent]).toStrictEqual(["paper_filled", false]);
  });

  it("marks a proposal from a turn marked since it started, so it waits for a card", async () => {
    const view = await proposeAs(runtimeCaller(token), (turns) => {
      turns.start({ agent: testAgent, turn, hasOutsideContent: false });
      turns.mark(testAgent, turn);
    });
    expect(view.outsideContent).toBe(true);
    expect(view.state).not.toBe("paper_filled");
  });

  it("marks a proposal of the runtime with no running turn", async () => {
    const view = await proposeAs(runtimeCaller(token), () => undefined);
    expect([view.outsideContent, view.state === "paper_filled"]).toStrictEqual([true, false]);
  });

  it("marks a proposal made with an earlier start's token, even one claiming a clean turn", async () => {
    const claiming = { ...runtimeCaller(earlierToken), turn: { hasOutsideContent: false } };
    const view = await proposeAs(claiming, (turns) =>
      turns.start({ agent: testAgent, turn, hasOutsideContent: false }),
    );
    expect(view.outsideContent).toBe(true);
  });

  it("lets the runtime write the strategy from a turn that read no outside content", async () => {
    const { at, written } = await editAs({ hasOutsideContent: false });
    expect(written).toStrictEqual({ ok: true, value: { updatedAt: at } });
  });

  it("refuses the runtime's write of the strategy from a marked turn", async () => {
    const { written } = await editAs({ hasOutsideContent: true });
    expect(written).toStrictEqual({ ok: false, error: "agent.file_untrusted" });
  });

  it("leaves every other handler as it was", async () => {
    const test = await startTestEngine();
    const handlers = markRuntimeTurns(test.engine.handlers, createRunningTurns());
    expect(handlers["intent/get"]).toBe(test.engine.handlers["intent/get"]);
  });
});
