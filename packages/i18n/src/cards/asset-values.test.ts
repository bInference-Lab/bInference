import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { amountValue, assetValue } from "./asset-values.js";
import { cardLineText } from "./card-text.js";

const known = assetRefSchema.parse("fake:1/erc20:0x00000000000000000000000000000000000000aa");
const unknown = assetRefSchema.parse("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");
const assets = { [known]: { symbol: "TKN", name: "Token", decimals: 2, verified: true } };
const display = { formatter: createFormatter({ locale: "en", timeZone: "UTC" }), assets };

describe("an asset and an amount as a list names them", () => {
  it("names an asset by its symbol, and one with no info by its short address", () => {
    expect(assetValue(known, assets)).toStrictEqual({ type: "asset", asset: known });
    expect(assetValue(unknown, assets)).toStrictEqual({ type: "text", text: "0x6982…1933" });
  });

  it("names an amount in the token's units, and one with no info in base units", () => {
    const line = (asset: typeof known) => ({
      key: "positions.claimable",
      values: { amount: amountValue({ asset, base: 150n }, assets) },
    });
    expect(cardLineText(line(known), display)).toBe("1.5 TKN ready to claim");
    expect(cardLineText(line(unknown), display)).toBe(
      "150 base units of 0x6982…1933 ready to claim",
    );
  });
});
