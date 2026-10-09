import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { lowGasNoticeKey } from "./low-gas-alerts.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("the low-gas notice", () => {
  it("names the wallet and what is left for network fees", () => {
    const balance = `${english.tokenAmount(31n * 10n ** 14n, 18)} BNB`;
    expect(english.message(lowGasNoticeKey, { wallet: "0xabc", balance })).toBe(
      "⚠️ 0xabc has 0.0031 BNB left for network fees. Add BNB.",
    );
  });
});
