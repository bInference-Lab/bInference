import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createFormatter } from "./create-formatter.js";

// 2026-10-06 12:32:05 UTC.
const moment = Date.UTC(2026, 9, 6, 12, 32, 5);
const english = createFormatter({ locale: "en", timeZone: "Asia/Shanghai" });

describe("createFormatter in English", () => {
  it("fills a message's arguments", () => {
    expect(english.message("reason.daily_cap", { used: "$612.40", cap: "$1,000.00" })).toBe(
      "it would pass your 24-hour cap ($612.40 of $1,000.00 used)",
    );
  });

  it("formats a message with no arguments", () => {
    expect(english.message("error.engine.locked")).toBe(
      "binference is locked. Run `binference unlock` on the machine.",
    );
  });

  it("formats the same message twice from its compiled form", () => {
    const values = { used: "$1.00", cap: "$2.00" };
    expect(english.message("reason.daily_cap", values)).toBe(
      english.message("reason.daily_cap", values),
    );
  });

  it("refuses a key no file holds", () => {
    expect(() => english.message("reason.not_a_reason")).toThrow(
      expect.objectContaining({ code: "i18n.unknown_message" }),
    );
  });

  it("refuses values that leave out an argument", () => {
    expect(() => english.message("reason.daily_cap", { used: "$1.00" })).toThrow(
      expect.objectContaining({ code: "i18n.bad_values" }),
    );
  });

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
