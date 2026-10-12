import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  callTool,
  intent,
  intentWire,
  order,
  orderWire,
  otherAgent,
  stopLoss,
  swapTerms,
} from "../testing/agent-tool-fixtures.js";

const swap = { name: "swap", args: swapTerms };
const createOrder = { name: "order_create", args: { order: stopLoss } };
const cancel = { name: "order_cancel", args: { order } };
const waits = "is waiting for the owner's confirmation in Telegram or the console.";

function engineError(code: `${string}.${string}`): BinferenceError {
  return new BinferenceError({ code, message: `The engine says ${code}.` });
}

describe("a propose tool", () => {
  it("answers the intent's id and that it waits for the owner", async () => {
    const run = callTool({ "intent/propose": intentWire("awaiting_confirmation") }, swap);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `Intent ${intent} ${waits}`,
      isError: false,
    });
  });

  it("answers an intent the engine refused by policy as a refusal, with its reason", async () => {
    const refused = { ...intentWire("rejected_policy"), outcome: { reason: "daily_cap" } };
    const run = callTool({ "intent/propose": refused }, swap);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `Intent ${intent} is in state rejected_policy with reason daily_cap.`,
      isError: true,
    });
  });

  it("answers an auto mode fill with the intent's state, not as a refusal", async () => {
    const run = callTool({ "intent/propose": intentWire("paper_filled") }, swap);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `Intent ${intent} is in state paper_filled.`,
      isError: false,
    });
  });

  it.each(["agent.frozen", "protocol.bad_args", "wallet.not_found"] as const)(
    "answers the engine's %s refusal as a result the model reads",
    async (code) => {
      const run = callTool({ "intent/propose": engineError(code) }, swap);
      await expect(run.outcome).resolves.toStrictEqual({
        text: `swap failed with ${code}: The engine says ${code}.`,
        isError: true,
      });
    },
  );

  it.each([
    "client.disconnected",
    "client.closed",
    "core.timeout",
    "engine.timeout",
    "engine.stopping",
    "auth.revoked",
    "internal.error",
  ] as const)("throws %s, whose outcome is unknown, so the loop never resends", async (code) => {
    const run = callTool({ "intent/propose": engineError(code) }, swap);
    await expect(run.outcome).rejects.toMatchObject({ code });
  });

  it("answers an auto order's id and that its card waits for the owner", async () => {
    const run = callTool({ "order/create": orderWire("awaiting_confirmation") }, createOrder);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `Auto order ${order} ${waits}`,
      isError: false,
    });
  });

  it("answers the engine's refusal of an auto order as a result", async () => {
    const run = callTool({ "order/create": engineError("agent.frozen") }, createOrder);
    await expect(run.outcome).resolves.toMatchObject({ isError: true });
  });

  it("throws on an auto order whose outcome is unknown", async () => {
    const run = callTool({ "order/create": engineError("client.disconnected") }, createOrder);
    await expect(run.outcome).rejects.toMatchObject({ code: "client.disconnected" });
  });
});

describe("order_cancel", () => {
  it("cancels an order of its agent", async () => {
    const answers = { "order/get": orderWire("active"), "order/cancel": orderWire("cancelled") };
    const run = callTool(answers, cancel);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `Auto order ${order} is cancelled.`,
      isError: false,
    });
  });

  it("never cancels an order of another agent", async () => {
    const run = callTool({ "order/get": orderWire("active", otherAgent) }, cancel);
    await expect(run.outcome).resolves.toStrictEqual({
      text: `This agent has no auto order ${order}.`,
      isError: true,
    });
    expect(run.client.calls().map(({ op }) => op)).toStrictEqual(["order/get"]);
  });

  it("answers an engine failure as a result", async () => {
    const run = callTool({ "order/get": engineError("order.not_found") }, cancel);
    await expect(run.outcome).resolves.toStrictEqual({
      text: "order_cancel failed with order.not_found: The engine says order.not_found.",
      isError: true,
    });
  });
});
