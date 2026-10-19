import { describe, expect, it } from "vitest";
import {
  proposeIntent,
  testCardText,
  testLaunchEngine,
  testSettledLaunch,
} from "./test-launches.js";

describe("a token launch's card in English", () => {
  it("shows every setting of the launch in English", async () => {
    const { test } = await testLaunchEngine();
    const lines = await testCardText(test, await proposeIntent(test, testSettledLaunch), "en");
    expect(lines.slice(1, 12)).toStrictEqual([
      "Launch MCAT (Moon Cat) on fake-curve, paired with FAKE · first buy 0.000000000001 FAKE",
      "New token MCAT (0x000000e1)",
      "First buy gets at least 0.00000000097 MCAT (0x000000e1)",
      "Launch fee 0.000000000000002 FAKE",
      "Description: A cat on the moon",
      "Website: https://moon.example",
      "X: https://x.com/mooncat",
      expect.stringMatching(
        /^Picture sent: PNG, 1 KB, SHA-256 [0-9a-f]{16} · metadata at ipfs:\/\/fake-1$/,
      ),
      "Tax on every trade: 3.00%",
      "Buyback and burn: on",
      "⚠️ The picture and words are already public on fake-curve's storage, and stay public if you cancel",
    ]);
  });
});
