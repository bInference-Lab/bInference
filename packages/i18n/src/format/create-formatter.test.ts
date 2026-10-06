import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createFormatter } from "./create-formatter.js";

// 2026-10-06 12:32:05 UTC.
const moment = Date.UTC(2026, 9, 6, 12, 32, 5);
const english = createFormatter({ locale: "en", timeZone: "Asia/Shanghai" });

describe("createFormatter in English", () => {
  it("formats amounts, money and rates the same way in every language", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    for (const formatter of [english, chinese]) {
      expect(formatter.tokenAmount(500_000_000_000_000_000n, 18)).toBe("0.5");
      expect(formatter.usd(4_000n)).toBe("<$0.01");
      expect(formatter.percent(bpsSchema.parse(50))).toBe("0.50%");
    }
  });

  it("shows times in the owner's timezone on the 24-hour clock", () => {
    expect(english.time(moment)).toBe("20:32:05");
    expect(english.date(moment)).toBe("Oct 6, 2026");
    expect(english.dateTime(moment)).toBe("Oct 6, 2026, 20:32:05");
    expect(createFormatter({ locale: "en", timeZone: "UTC" }).time(moment)).toBe("12:32:05");
  });

  it("refuses a timezone Intl does not know", () => {
    expect(() => createFormatter({ locale: "en", timeZone: "Mars/Base" })).toThrow(
      expect.objectContaining({ code: "i18n.bad_time_zone" }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("refuses %s as a time", (epochMs) => {
    expect(() => english.time(epochMs)).toThrow(expect.objectContaining({ code: "i18n.bad_time" }));
  });
});
