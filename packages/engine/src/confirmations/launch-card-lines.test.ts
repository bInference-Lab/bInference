import { cardLineText, createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { launchDetailLines } from "./launch-card-lines.js";

const recipient = "0x00000000000000000000000000000000000000AA";
const display = { formatter: createFormatter({ locale: "en", timeZone: "UTC" }), assets: {} };

describe("a token launch's setting lines", () => {
  it("shows an account setting's address whole, since the launch pays it", () => {
    const lines = launchDetailLines({
      venue: "flap",
      links: [],
      settings: [{ name: "taxRecipient", type: "account", value: `eip155:56:${recipient}` }],
    });
    expect(lines.map((line) => cardLineText(line, display))).toStrictEqual([
      `Tax paid to ${recipient}`,
    ]);
  });
});
