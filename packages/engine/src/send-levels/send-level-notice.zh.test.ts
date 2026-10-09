import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { sendLevelCancelledKey, sendLevelNoticeKey } from "./send-level-notice.js";

const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);

describe("the send level notice in Chinese", () => {
  it("says when a looser level takes effect, and that a stricter one applies now", () => {
    const when = chinese.dateTime(atMs);
    const later = { from: "3", to: "1", pending: "yes", when };
    const now = { from: "0", to: "2", pending: "no" };
    expect([
      chinese.message(sendLevelNoticeKey, later),
      chinese.message(sendLevelNoticeKey, now),
    ]).toStrictEqual([`转账级别 3 → 1，将于 ${when} 生效`, "转账级别 0 → 2，立即生效"]);
  });

  it("says a looser level was cancelled and which level stays", () => {
    expect(chinese.message(sendLevelCancelledKey, { to: "0", level: "1" })).toBe(
      "已取消将转账级别改为 0，仍为 1",
    );
  });
});
