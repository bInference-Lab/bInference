import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { writeNotice } from "./write-notice.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
const pepe = assetRefSchema.parse("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");
const lowGas = {
  key: "notice.lowGas",
  values: { wallet: "Main" },
  amounts: { balance: { asset: pepe, base: 15n * 10n ** 17n } },
};

describe("a notice as every surface writes it", () => {
  it("writes an amount by the info the surface finds for its token", () => {
    const info = { symbol: "PEPE", name: "Pepe", decimals: 18, verified: true };
    const text = writeNotice(lowGas, { formatter, assetInfo: () => info });
    expect(text).toBe("⚠️ Main has 1.5 PEPE left for network fees. Add BNB.");
  });

  it("writes an amount of a token nothing knows in base units, with its short address", () => {
    const text = writeNotice(lowGas, { formatter, assetInfo: () => undefined });
    expect(text).toContain("1500000000000000000 0x6982…1933");
  });

  it("puts each message that follows the notice on a line of its own", () => {
    const alert = {
      key: "notice.alertWallet",
      values: { wallet: "Whale", side: "sell", amount: "2M PEPE", share: "40%", value: "$22.10" },
      after: [{ key: "alert.woke", values: { agent: "main" } }],
    };
    const lines = writeNotice(alert, { formatter, assetInfo: () => undefined }).split("\n");
    expect(lines).toStrictEqual([
      "Whale sold 2M PEPE, 40% of its holding, for $22.10",
      "main is looking into it.",
    ]);
  });
});
