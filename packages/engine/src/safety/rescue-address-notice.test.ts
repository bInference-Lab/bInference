import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  ceilingOutdatedKey,
  rescueAddressCancelledKey,
  rescueAddressNoticeKey,
} from "./rescue-address-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);

describe("the rescue address notice", () => {
  it("names the new address and the time it takes effect, and asks to cancel", () => {
    const when = english.dateTime(atMs);
    expect(english.message(rescueAddressNoticeKey, { address: "0xabc", when })).toBe(
      `⚠️ Rescue address changes to 0xabc at ${when}. Not you? Cancel now.`,
    );
  });

  it("says a change was cancelled", () => {
    expect(english.message(rescueAddressCancelledKey, { address: "0xabc" })).toBe(
      "Rescue address change to 0xabc cancelled",
    );
  });

  it("says the ceilings still let sends pay an old address, and how to fix it", () => {
    expect(english.message(ceilingOutdatedKey, { address: "0xabc" })).toBe(
      "⚠️ The wallets' ceilings still let sends pay 0xabc. Run `binference rescue set` with the owner key to update them.",
    );
  });
});
