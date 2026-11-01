import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { nextRescueThere, standing, standingWords } from "./test-rescue-notices.js";

const onOther = accountRefSchema.parse("other:3:0x000000d9");
const address = "0x000000d9";
const next = "0x000000d8";
const plain =
  "it holds no code there or on its own chain, so it is most likely a plain wallet with the same key there.";
const step = "save an address you control on Fake Two in the address book with your owner key.";

describe("the rescue address standings' notices", () => {
  it("tells a waiting address's time, and later that bridges may now pay it", () => {
    const waiting = standing("waiting", nextRescueThere);
    expect(standingWords("en", { before: [], after: [waiting] })).toStrictEqual([
      `Once your new rescue address ${next} takes effect at Oct 11, 2026, 09:30:00, bridges from main's wallets may pay it on Fake Two: ${plain}`,
    ]);
    const joined = standing("joined", nextRescueThere);
    expect(standingWords("en", { before: [waiting], after: [joined] })).toStrictEqual([
      `Bridges from main's wallets may now pay your rescue address ${next} on Fake Two: ${plain}`,
    ]);
  });

  it("names each reason the address stays out, with its next step", () => {
    expect(
      standingWords("en", {
        before: [],
        after: [standing("code"), standing("kind", onOther), standing("room", nextRescueThere)],
      }),
    ).toStrictEqual([
      `Bridges from main's wallets do not pay your rescue address ${address} on Fake Two: it holds code there or on its own chain, so the same address there may not be yours. To bridge there, ${step}`,
      `Bridges from main's wallets do not pay your rescue address ${address} on Other Three: a bridge never pays the rescue address on a chain whose addresses are of another kind. To bridge there, save an address you control on Other Three in the address book with your owner key.`,
      `Bridges from main's wallets do not pay your rescue address ${next} on Fake Two: the ceiling lists the most addresses it holds there. To make room, remove an address saved for Fake Two; binference adds the rescue address at the next change of the ceilings.`,
    ]);
    expect(standingWords("en", { before: [], after: [standing("unread")] })).toStrictEqual([
      `Bridges from main's wallets do not pay your rescue address ${address} on Fake Two: binference could not read its code there. binference reads it again at the next change of the ceilings.`,
    ]);
  });

  it("tells nothing for a standing that did not change", () => {
    for (const state of ["joined", "waiting", "code", "unread", "kind", "room"] as const) {
      expect(
        standingWords("en", { before: [standing(state)], after: [standing(state)] }),
      ).toStrictEqual([]);
    }
    expect(
      standingWords("en", { before: [standing("joined")], after: [standing("waiting")] }),
    ).toStrictEqual([]);
  });
});
