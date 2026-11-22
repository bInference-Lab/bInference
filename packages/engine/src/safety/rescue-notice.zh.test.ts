import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { rescueNoticeKey } from "./rescue-notice.js";

const alarm = String.fromCodePoint(0x1f534);
const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("the rescue notice in Chinese", () => {
  it("says a confirmed rescue moves everything but the gas reserve, and what each wallet keeps", () => {
    const values = { address: "0xabc", kept: "reserve", reserve: "0.002 BNB" };
    expect(chinese.message(rescueNoticeKey, values)).toBe(
      `${alarm} 已确认紧急转出：正在将全部资产转到 0xabc，但每个钱包留下 0.002 BNB 作为网络费预留`,
    );
  });
});
