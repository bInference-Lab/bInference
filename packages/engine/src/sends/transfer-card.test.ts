import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { testSaved } from "../send-levels/test-sends.js";
import { aliceEngine, testNames, testRevoke, testSend, transferCard } from "./test-transfers.js";

// The warning icon of spec 4, from its code points: code and tests carry no emojis.
const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;
const newAddress = `${warning} You have never sent to this address`;
const coin = { asset: testCoin, base: 10n ** 15n };

describe("a send's and a revoke's card", () => {
  it("shows a send by name with its whole address, its read, a smart account and another reverse name", async () => {
    const lines = await transferCard(await aliceEngine(), testSend({ name: "alice.bnb" }), "en");
    expect(lines.slice(1)).toStrictEqual([
      "Send 0.001 FAKE to alice.bnb (0x000000f1)",
      "alice.bnb points to 0x000000f1, read at 08:00:00; binference reads it again before it signs",
      "alice.bnb is a smart-account wallet",
      newAddress,
      `${warning} This address's reverse record names mallory.bnb, not alice.bnb`,
      'Agent says  "Pay the rent"',
      "Expires at 08:10:00",
    ]);
  });

  it("shows no reverse warning when the reverse record names this name or none", async () => {
    const lines = await transferCard(
      await aliceEngine({ reverse: false }),
      testSend({ name: "alice.bnb" }),
      "en",
    );
    expect(lines.filter((line) => line.includes("reverse record"))).toStrictEqual([]);
  });

  it("shows a long name whole, up to the 255 characters a name may hold", async () => {
    const long = `${"a".repeat(247)}.bnb`;
    const names = testNames();
    names.set(long, { address: testSaved.account });
    const lines = await transferCard(await aliceEngine({ names }), testSend({ name: long }), "en");
    expect(lines[1]).toBe(`Send 0.001 FAKE to ${long} (0x000000f1)`);
  });

  it("shows a saved address after its label, with the new-address warning", async () => {
    const lines = await transferCard(await aliceEngine(), testSend(), "en");
    expect(lines.slice(1, 4)).toStrictEqual([
      "Send 0.001 FAKE to savings (0x000000f1)",
      newAddress,
      'Agent says  "Pay the rent"',
    ]);
  });

  it("names the rescue address as yours", async () => {
    const rescue = accountRefSchema.parse("fake:1:0x000000a1");
    const test = await aliceEngine({ sends: [{ to: rescue, amount: coin }] });
    const atMs = testNowMs - 2 * looseningWaitMs;
    await test.stores.install.changeRescue({ address: rescue, atMs }, live());
    const lines = await transferCard(test, testSend({ address: rescue }), "en");
    expect(lines[1]).toBe("Send 0.001 FAKE to your rescue address (0x000000a1)");
  });

  it("shows a revoke's spender by its registry name and address, and lasts 10 minutes", async () => {
    const lines = await transferCard(await aliceEngine(), testRevoke(testToken), "en");
    expect(lines.slice(1)).toStrictEqual([
      "Remove fake-swap router (0x0000000b)'s approval for TKN",
      'Agent says  "Clear an old approval"',
      "Expires at 08:10:00",
    ]);
  });
});

function live() {
  return { signal: new AbortController().signal };
}
