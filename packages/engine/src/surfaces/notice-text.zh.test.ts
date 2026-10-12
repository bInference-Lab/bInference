import { assetRefSchema } from "@binference/chain";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testChains } from "../operations/test-engine.js";
import { noticePush, noticeSchema } from "../pushes/notice-push.js";
import { noticeText } from "./notice-text.js";

const display = {
  formatter: createFormatter({ locale: "zh", timeZone: "UTC" }),
  chains: testChains(),
};
const pepe = assetRefSchema.parse("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");

describe("a notice as the owner reads it in Chinese", () => {
  it("names an unlisted token by the symbol its notice carries, with its short address", () => {
    const push = noticePush({
      key: "notice.lowGas",
      values: { wallet: "0x0000000c" },
      amounts: { balance: { asset: pepe, base: 15n * 10n ** 17n } },
      assets: { [pepe]: { symbol: "PEPE", name: "Pepe", decimals: 18, verified: false } },
    });
    const received = noticeSchema.parse(JSON.parse(JSON.stringify(push.data)));
    expect(noticeText(received, display)).toContain("1.5 PEPE（0x6982…1933）");
  });
});
