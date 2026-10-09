import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lowGasNoticeKey } from "./low-gas-alerts.js";

const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("the low-gas notice in Chinese", () => {
  it("names the wallet and what is left for network fees", () => {
    const balance = `${chinese.tokenAmount(31n * 10n ** 14n, 18)} BNB`;
    expect(chinese.message(lowGasNoticeKey, { wallet: "0xabc", balance })).toBe(
      "⚠️ 0xabc 仅剩 0.0031 BNB 可付网络费。请充值 BNB。",
    );
  });
});
