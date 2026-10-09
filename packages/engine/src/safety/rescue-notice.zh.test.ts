import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueNoticeKey } from "./rescue-notice.js";

const alarm = String.fromCodePoint(0x1f534);
const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("the rescue notice in Chinese", () => {
  it("says a confirmed rescue moves everything to the rescue address", () => {
    expect(chinese.message(rescueNoticeKey, { address: "0xabc" })).toBe(
      `${alarm} 已确认紧急转出：正在将全部资产转到 0xabc`,
    );
  });
});
