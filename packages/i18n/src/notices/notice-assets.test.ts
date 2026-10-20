import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { noticeAssetsToRead } from "./notice-assets.js";
import { noticeTableCoin } from "./notice-table-parts.js";

const token = assetRefSchema.parse("fake:1/erc20:0x00000000000000000000000000000000000000aa");
const amount = (asset: typeof token) => ({ asset, base: 1n });

describe("the assets a notice names", () => {
  it("reads the amounts of its parts and of the messages after it, each once", () => {
    const notice = {
      key: "notice.fill",
      values: {},
      amounts: { spent: amount(noticeTableCoin) },
      parts: { result: { key: "fill.sell", values: {}, amounts: { got: amount(token) } } },
      after: [{ key: "fill.sell", values: {}, amounts: { again: amount(noticeTableCoin) } }],
    };
    expect(noticeAssetsToRead(notice)).toStrictEqual([noticeTableCoin, token]);
  });

  it("leaves out an asset whose info the notice carries", () => {
    const notice = {
      key: "notice.fill",
      values: {},
      amounts: { spent: amount(noticeTableCoin), got: amount(token) },
      assets: { [token]: { symbol: "NEW", name: "New", decimals: 9, verified: false } },
    };
    expect(noticeAssetsToRead(notice)).toStrictEqual([noticeTableCoin]);
  });

  it("names nothing for a notice without amounts", () => {
    expect(noticeAssetsToRead({ key: "notice.locked", values: {} })).toStrictEqual([]);
  });
});
