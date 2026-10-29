import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { unsentReceiptText } from "./unsent-receipt-text.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
const refused = String.fromCodePoint(0x274c);

describe("the receipt of an intent that ended before it sent or filled, in Chinese", () => {
  it("names why, or says it ended unsigned", () => {
    expect([
      unsentReceiptText(chinese, "nothing_to_sell"),
      unsentReceiptText(chinese, undefined),
    ]).toStrictEqual([
      `${refused} 未发送：钱包中这种代币不足`,
      `${refused} 未发送：在签名之前已结束`,
    ]);
  });
});
