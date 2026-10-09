import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueNoticeKey } from "./rescue-notice.js";

const alarm = String.fromCodePoint(0x1f534);
const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("the rescue notice", () => {
  it("says a confirmed rescue moves everything to the rescue address", () => {
    expect(english.message(rescueNoticeKey, { address: "0xabc" })).toBe(
      `${alarm} Rescue confirmed: moving everything to 0xabc`,
    );
  });
});
