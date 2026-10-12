import { describe, expect, it } from "vitest";
import { ids } from "../examples/wire-values.js";
import { protocolIdSchema } from "../ids/id-prefixes.js";
import { orderProposalAnswer, proposalAnswer } from "./tool-sentences.js";

const intent = protocolIdSchema("intent").parse(ids.intent);

describe("proposalAnswer", () => {
  it.each(["proposed", "quoted", "awaiting_confirmation"] as const)(
    "says an intent %s waits for the owner's confirmation",
    (state) => {
      expect(proposalAnswer({ intent, state })).toBe(
        `Intent ${intent} is waiting for the owner's confirmation in Telegram or the console.`,
      );
    },
  );

  it("names the state and reason of an intent the engine refused", () => {
    const refused = { intent, state: "rejected_policy", outcome: { reason: "daily_cap" } } as const;
    expect(proposalAnswer(refused)).toBe(
      `Intent ${intent} is in state rejected_policy with reason daily_cap.`,
    );
  });

  it("names the state alone when the intent has no reason", () => {
    expect(proposalAnswer({ intent, state: "denied" })).toBe(
      `Intent ${intent} is in state denied.`,
    );
  });
});

describe("orderProposalAnswer", () => {
  const order = protocolIdSchema("autoOrder").parse(ids.order);

  it("says an order whose card is open waits for the owner's confirmation", () => {
    expect(orderProposalAnswer({ order, state: "awaiting_confirmation" })).toBe(
      `Auto order ${order} is waiting for the owner's confirmation in Telegram or the console.`,
    );
  });

  it("names the state of an order past its card", () => {
    expect(orderProposalAnswer({ order, state: "active" })).toBe(
      `Auto order ${order} is in state active.`,
    );
  });
});
