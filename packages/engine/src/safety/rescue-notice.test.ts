import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueNoticeKey } from "./rescue-notice.js";

const alarm = String.fromCodePoint(0x1f534);
const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("the rescue notice", () => {
  it("says a confirmed rescue moves everything but the gas reserve, and what each wallet keeps", () => {
    const values = { address: "0xabc", kept: "reserve", reserve: "0.002 BNB" };
    expect(english.message(rescueNoticeKey, values)).toBe(
      `${alarm} Rescue confirmed: moving everything to 0xabc, but 0.002 BNB stays in each wallet to pay network fees`,
    );
  });

  it("names no reserve for a rescue that keeps none", () => {
    expect(english.message(rescueNoticeKey, { address: "0xabc", kept: "none" })).toBe(
      `${alarm} Rescue confirmed: moving everything to 0xabc`,
    );
  });
});
