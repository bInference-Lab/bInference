import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

const tokenInfo: TestTool = { name: "token_info", kind: "read" };

// A response that calls `token_info` with the same arguments, under its own call id.
const sameCall = (n: number, args: JsonValue = { chain: "eip155:56", token: "0xabc" }) =>
  callsReply([{ id: `call_${String(n)}`, name: "token_info", args }]);

// A tool whose answer changes at each call, as a price does.
function changingTool(): TestTool {
  const answers = ["1", "2", "3", "4"];
  return {
    ...tokenInfo,
    run: async () => ({ text: `price ${String(answers.shift())}`, isError: false }),
  };
}

describe("the loop guard", () => {
  it("ends a scripted loop on its third repeat with the loop status line", async () => {
    const { turn, transport, recorder } = createTestTurn({
      replies: [sameCall(1), sameCall(2), sameCall(3), sameCall(4)],
      tools: [tokenInfo],
    });

    const report = await turn.run();

    expect(report).toMatchObject({ state: "ended", outcome: "loop", modelCalls: 3, toolCalls: 3 });
    expect(transport.requests).toHaveLength(3);
    expect(recorder.steps.filter((step) => step.kind === "result")).toHaveLength(3);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "loop" } });
    expect(recorder.steps.at(-1)).toStrictEqual({ kind: "end", outcome: "loop" });
  });

  it("counts arguments written in another key order as the same call", async () => {
    const { turn } = createTestTurn({
      replies: [
        sameCall(1, { chain: "eip155:56", token: "0xabc" }),
        sameCall(2, { token: "0xabc", chain: "eip155:56" }),
        sameCall(3, { chain: "eip155:56", token: "0xabc" }),
      ],
      tools: [tokenInfo],
    });
    expect(await turn.run()).toMatchObject({ outcome: "loop" });
  });

  it("lets a call whose result changes run on, and stays off when the config turns it off", async () => {
    const changing = changingTool();
    const replies = [sameCall(1), sameCall(2), sameCall(3), textReply("Done.")];
    const moving = createTestTurn({ replies, tools: [changing] });
    const off = createTestTurn({ replies, tools: [tokenInfo], limits: { loopGuard: false } });

    expect(await moving.turn.run()).toMatchObject({ outcome: "ok", modelCalls: 4 });
    expect(await off.turn.run()).toMatchObject({ outcome: "ok", modelCalls: 4 });
  });
});
