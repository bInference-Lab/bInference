import type { JsonValue } from "@binference/core";
import { inboxMessageViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { intentWire } from "../testing/agent-tool-fixtures.js";
import { ownerMessageOf, type TurnMessage } from "./queued-view.js";

const receipt = "Filled: sold 5.58201 USDT for 0.00999745 BNB";

function settleMessage(fields: Record<string, JsonValue> = {}): TurnMessage {
  const wire = {
    message: "msg_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    at: 25,
    kind: "inbox/intentSettled",
    intent: intentWire("reconciled"),
    ...fields,
  };
  return inboxMessageViewSchema.parse(wire) as TurnMessage;
}

describe("a settle message as the model reads it", () => {
  it("names the receipt the owner already reads and counts it as shown", () => {
    const message = ownerMessageOf(settleMessage({ shownReceipt: receipt }));
    expect(message.shown).toStrictEqual([receipt]);
    expect(message.text.split("\n")).toStrictEqual([
      expect.stringMatching(/ you proposed is now reconciled\.$/u),
      `Its card already shows the owner this receipt: ${receipt}`,
      expect.stringMatching(/^Do not restate the receipt, its amounts or the intent's state\./u),
    ]);
  });

  it("stays one line with nothing shown when the engine sent no receipt", () => {
    const message = ownerMessageOf(settleMessage());
    expect(message).not.toHaveProperty("shown");
    expect(message.text).toMatch(
      /^The paper swap intent int_\S+ you proposed is now reconciled\.$/u,
    );
  });
});
