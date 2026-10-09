import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { limitChangeCancelledKey, limitChangeKey } from "./limit-notices.js";

const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);

describe("the limit change notice in Chinese", () => {
  it("names the limit and the surface, and says when a looser limit changes", () => {
    const when = chinese.dateTime(atMs);
    const later = { surface: "console", limit: "rollingDayUsdMicros", pending: "yes", when };
    const now = { surface: "telegram", limit: "slippageOtherBps", pending: "no" };
    expect([
      chinese.message(limitChangeKey, later),
      chinese.message(limitChangeKey, now),
    ]).toStrictEqual([
      `控制台 修改了限额：24 小时上限将于 ${when} 更改。不是你操作？请立即取消。`,
      "Telegram 修改了限额：其他代币的滑点上限已立即更改",
    ]);
  });

  it("says which looser limit was cancelled", () => {
    expect(chinese.message(limitChangeCancelledKey, { limit: "venues" })).toBe(
      "已取消对可用平台的修改，当前限额保持不变",
    );
  });
});
