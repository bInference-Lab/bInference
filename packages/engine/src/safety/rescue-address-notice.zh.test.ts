import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueAddressCancelledKey, rescueAddressNoticeKey } from "./rescue-address-notice.js";

const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);

describe("the rescue address notice in Chinese", () => {
  it("names the new address and the time it takes effect in the glossary's words", () => {
    const when = chinese.dateTime(atMs);
    expect(chinese.message(rescueAddressNoticeKey, { address: "0xabc", when })).toBe(
      `⚠️ 紧急转出地址将于 ${when} 改为 0xabc。不是你操作？请立即取消。`,
    );
  });

  it("says a change was cancelled", () => {
    expect(chinese.message(rescueAddressCancelledKey, { address: "0xabc" })).toBe(
      "已取消将紧急转出地址改为 0xabc",
    );
  });
});
