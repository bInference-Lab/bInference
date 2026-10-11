import { describe, expect, it } from "vitest";
import { readCardClick, readCardPush, readIntentQuery } from "./card-push.schema";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const words = { title: "A card waits", body: "Open the console." };

describe("card push messages", () => {
  it("reads a card push and drops any field it does not know", () => {
    const text = JSON.stringify({ v: 1, kind: "closed", intent, card, ...words, amount: "1" });
    expect(readCardPush(text)).toStrictEqual({ v: 1, kind: "closed", intent, card, ...words });
  });

  it.each([
    ["text that is no JSON", "{"],
    ["another version", JSON.stringify({ v: 2, kind: "opened", intent, card, ...words })],
    [
      "an id of another kind",
      JSON.stringify({ v: 1, kind: "opened", intent: card, card, ...words }),
    ],
  ])("refuses %s", (_, text) => {
    expect(readCardPush(text)).toBeUndefined();
  });

  it("reads the intent of a click and of an address", () => {
    expect(readCardClick({ type: "card", intent })).toBe(intent);
    expect(readCardClick({ type: "other", intent })).toBeUndefined();
    expect(readIntentQuery(`?intent=${intent}`)).toBe(intent);
    expect(readIntentQuery("?intent=../ledger")).toBeUndefined();
    expect(readIntentQuery("")).toBeUndefined();
  });
});
