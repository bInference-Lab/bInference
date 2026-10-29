import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { unsentReceiptText } from "./unsent-receipt-text.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const refused = String.fromCodePoint(0x274c);

describe("the receipt of an intent that ended before it sent or filled", () => {
  it("names why, as Telegram's copy of the card does", () => {
    expect(unsentReceiptText(english, "nothing_to_sell")).toBe(
      `${refused} Not sent: the wallet holds too little of this token`,
    );
  });

  it("says it ended unsigned for no reason, or one this version has no words for", () => {
    const unsent = `${refused} Not sent: it ended before it was signed`;
    expect([
      unsentReceiptText(english, undefined),
      unsentReceiptText(english, "a_code_from_a_newer_engine"),
    ]).toStrictEqual([unsent, unsent]);
  });
});
