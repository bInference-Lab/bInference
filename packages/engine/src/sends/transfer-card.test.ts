import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import { aliceEngine, testRevoke, testSend, transferCard } from "./test-transfers.js";

// The warning icon of spec 4, from its code points: code and tests carry no emojis.
const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

describe("a send's and a revoke's card", () => {
  it("shows a send by name with its whole address, its read, a smart account and another reverse name", async () => {
    const lines = await transferCard(await aliceEngine(), testSend({ name: "alice.bnb" }), "en");
    expect(lines.slice(1)).toStrictEqual([
      "Send 0.001 FAKE to alice.bnb (0x000000f1)",
      "alice.bnb points to 0x000000f1, read at 08:00:00; binference reads it again before it signs",
      "alice.bnb is a smart-account wallet",
      `${warning} This address's reverse record names mallory.bnb, not alice.bnb`,
      'Agent says  "Pay the rent"',
      "Expires at 08:10:00",
    ]);
  });

  it("shows no reverse warning when the reverse record names this name or none", async () => {
    const lines = await transferCard(
      await aliceEngine(false),
      testSend({ name: "alice.bnb" }),
      "en",
    );
    expect(lines.some((line) => line.includes("reverse record"))).toBe(false);
  });

  it("shows a send to an address with the whole address and no name lines", async () => {
    const lines = await transferCard(await aliceEngine(), testSend(), "en");
    expect(lines.slice(1, 3)).toStrictEqual([
      "Send 0.001 FAKE to 0x000000f1",
      'Agent says  "Pay the rent"',
    ]);
  });

  it("shows a revoke's spender and token, and lasts 10 minutes", async () => {
    const lines = await transferCard(await aliceEngine(), testRevoke(testToken), "en");
    expect(lines.slice(1)).toStrictEqual([
      "Remove 0x0000000b's approval for TKN",
      'Agent says  "Clear an old approval"',
      "Expires at 08:10:00",
    ]);
  });
});
