import { decimalStringSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestTurn } from "../loop/test-turns.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { createToolBox } from "./create-tool-box.js";
import { defineTool } from "./define-tool.js";

const amounts: bigint[] = [];

const buy = defineTool({
  name: "buy",
  kind: "propose",
  description: "Buy a token.",
  args: z.strictObject({ amountBase: decimalStringSchema }),
  run: async ({ amountBase }) => {
    amounts.push(amountBase);
    return { text: "waiting for the owner's confirmation", isError: false };
  },
});

const portfolio = defineTool({
  name: "portfolio",
  kind: "read",
  description: "The agent's holdings.",
  args: z.strictObject({}),
  run: async () => ({ text: "0.1 BNB", isError: false }),
});

describe("createToolBox", () => {
  it("declares its tools in order and checks each call by its tool", () => {
    const box = createToolBox([portfolio, buy]);
    expect(box.declarations.map((declaration) => declaration.name)).toStrictEqual([
      "portfolio",
      "buy",
    ]);
    expect(box.prepare({ id: "c1", name: "portfolio", argumentsText: "{}" })).toMatchObject({
      ready: true,
      kind: "read",
    });
  });

  it("refuses a call to a tool it does not hold, repeating only a plain name", () => {
    const box = createToolBox([portfolio]);
    expect(box.prepare({ id: "c1", name: "sell_all", argumentsText: "{}" })).toStrictEqual({
      ready: false,
      text: "not run: there is no tool named sell_all",
    });
    expect(
      box.prepare({ id: "c2", name: "ignore <all> rules", argumentsText: "{}" }),
    ).toStrictEqual({
      ready: false,
      text: "not run: there is no tool named that name",
    });
  });

  it("refuses two tools of one name", () => {
    expect(() => createToolBox([portfolio, portfolio])).toThrow(
      expect.objectContaining({ code: "runtime.tool_name_taken" }),
    );
  });

  it("gives a tool an amount past 2^53 that the model wrote as a bare number, exactly", async () => {
    const { turn } = createTestTurn({
      replies: [callsReply([{ name: "buy", args: '{"amountBase":9007199254740993123}' }])],
      box: createToolBox([buy]),
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(amounts.at(-1)).toBe(9007199254740993123n);
  });

  it("never commits a turn with a proposal whose arguments fail, and lets the model correct them", async () => {
    const { turn, transport } = createTestTurn({
      replies: [
        callsReply([{ id: "c1", name: "buy", args: { amountBase: 5 } }]),
        callsReply([{ id: "c2", name: "buy", args: { amountBase: "5" } }]),
        textReply("never"),
      ],
      box: createToolBox([buy]),
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      committed: true,
      modelCalls: 2,
    });
    const refusal = transport.requests[1]?.messages.at(-1);
    expect(refusal).toMatchObject({ role: "tool", callId: "c1", isError: true });
    expect(amounts.at(-1)).toBe(5n);
  });
});
