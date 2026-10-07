import { describe, expect, it } from "vitest";
import { cardCopySchema } from "./card-copy.js";

const copy = {
  ref: "q3Zr_x9-AbCdEfGh",
  intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  cardVersion: 1,
  chatId: 7_100_000_001,
  messageId: 1001,
};

describe("cardCopySchema", () => {
  it("parses a card copy as a store keeps it", () => {
    expect(cardCopySchema.parse(copy)).toStrictEqual(copy);
  });

  it.each([
    ["a reference that is not 12 bytes in base64url", { ...copy, ref: "short" }],
    [
      "an intent id of another kind",
      { ...copy, intent: "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001" },
    ],
    ["a card version below 1", { ...copy, cardVersion: 0 }],
    ["a field it does not know", { ...copy, text: "card" }],
  ])("refuses %s", (_name, value) => {
    expect(cardCopySchema.safeParse(value).success).toBe(false);
  });
});
