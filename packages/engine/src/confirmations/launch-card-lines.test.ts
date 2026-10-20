import { assetRefSchema } from "@binference/chain";
import { cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { launchDetailLines } from "./launch-card-lines.js";

const recipient = "0x00000000000000000000000000000000000000AA";
const bnb = assetRefSchema.parse("eip155:56/slip44:714");
const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
const display = { formatter, assets: {} };

describe("a token launch's setting lines", () => {
  it("shows an account setting's address whole, since the launch pays it", () => {
    const lines = launchDetailLines({
      venue: "flap",
      pair: bnb,
      links: [],
      settings: [{ name: "taxRecipient", type: "account", value: `eip155:56:${recipient}` }],
    });
    expect(lines.map((line) => cardLineText(line, display))).toStrictEqual([
      `Tax paid to ${recipient}`,
    ]);
  });

  it("shows an amount setting as an amount of the pair", () => {
    const lines = launchDetailLines({
      venue: "brew",
      pair: bnb,
      links: [],
      settings: [{ name: "taxBps", type: "amount", value: "8000000000000000000" }],
    });
    expect(lines).toStrictEqual([
      {
        key: "launch.option.taxBps",
        values: { value: { type: "amount", amount: { asset: bnb, base: 8n * 10n ** 18n } } },
      },
    ]);
  });
});
