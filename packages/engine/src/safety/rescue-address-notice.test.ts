import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueAddressNoticeKey } from "./rescue-address-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);

describe("the rescue address notice", () => {
  it("names the new address and the time it takes effect, and asks to cancel", () => {
    const when = english.dateTime(atMs);
    expect(english.message(rescueAddressNoticeKey, { address: "0xabc", when })).toBe(
      `⚠️ Rescue address changes to 0xabc at ${when}. Not you? Cancel now.`,
    );
  });
});
