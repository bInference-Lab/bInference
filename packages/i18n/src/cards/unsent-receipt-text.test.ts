import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { reasonNamesOf, unsentReceiptText } from "./unsent-receipt-text.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const refused = String.fromCodePoint(0x274c);

describe("the receipt of an intent that ended before it sent or filled", () => {
  it("names why, as Telegram's copy of the card does", () => {
    expect(unsentReceiptText(english, "nothing_to_sell")).toBe(
      `${refused} Not sent: the wallet holds too little of this token`,
    );
  });

  it("names a send by name's name in the words of its reason", () => {
    expect(unsentReceiptText(english, "name_moved", { name: "alice.bnb" })).toBe(
      `${refused} Not sent: alice.bnb changed since the card: it points elsewhere, to nothing, or its address changed kind; check the name, then propose the send again`,
    );
  });

  it("names a bridge's chain and never tells the owner to save a rescue address with code", () => {
    const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const view = { wallet, outcome: { reason: "rescue_not_plain", chain: "Base" } };
    const text = unsentReceiptText(english, "rescue_not_plain", reasonNamesOf(view));
    expect(text).toBe(
      `${refused} Not sent: your rescue address holds code on Base or on this wallet's chain, so the same address on Base may not be yours and nothing was sent; save an address you control on Base in the address book with your owner key, then bridge to that entry`,
    );
  });

  it("names the wallet whose ceiling a bridge needs written again", () => {
    const named = { chain: "Base", wallet: "wal_1" };
    expect(unsentReceiptText(english, "ceiling_lacks_payee", named)).toContain(
      "`binference ceiling set --wallet wal_1`",
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
