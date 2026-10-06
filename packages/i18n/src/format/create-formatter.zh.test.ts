import { describe, expect, it } from "vitest";
import { createFormatter } from "./create-formatter.js";

// 2026-10-06 12:32:05 UTC.
const moment = Date.UTC(2026, 9, 6, 12, 32, 5);
const chinese = createFormatter({ locale: "zh", timeZone: "Asia/Shanghai" });

describe("createFormatter in Chinese", () => {
  it("fills a message's arguments", () => {
    expect(chinese.message("reason.daily_cap", { used: "$612.40", cap: "$1,000.00" })).toBe(
      "将超过你的 24 小时上限（已用 $612.40，上限 $1,000.00）",
    );
  });

  it("formats the spec's example error", () => {
    expect(chinese.message("error.engine.locked")).toBe(
      "binference 已锁定。请在本机运行 `binference unlock`。",
    );
  });

  it("writes the day the Chinese way and the time on the 24-hour clock", () => {
    expect(chinese.time(moment)).toBe("20:32:05");
    expect(chinese.date(moment)).toBe("2026年10月6日");
    expect(chinese.dateTime(moment)).toBe("2026年10月6日 20:32:05");
  });
});
