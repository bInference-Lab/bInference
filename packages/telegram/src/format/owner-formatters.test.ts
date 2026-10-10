import { describe, expect, it } from "vitest";
import { createOwnerFormatters } from "./owner-formatters.js";

describe("the owner's formatters", () => {
  it("builds one formatter for each language and timezone and gives it again", () => {
    const formatters = createOwnerFormatters();
    const english = formatters({ locale: "en", timeZone: "UTC" });
    expect(formatters({ locale: "en", timeZone: "UTC" })).toBe(english);
    expect(formatters({ locale: "zh", timeZone: "UTC" }).locale).toBe("zh");
    expect(formatters({ locale: "en", timeZone: "Asia/Shanghai" })).not.toBe(english);
  });

  it("keeps four formatters and builds the oldest again once a fifth came", () => {
    const formatters = createOwnerFormatters();
    const first = formatters({ locale: "en", timeZone: "UTC" });
    for (const timeZone of ["Asia/Shanghai", "Europe/Berlin", "America/New_York", "Asia/Tokyo"]) {
      formatters({ locale: "en", timeZone });
    }
    expect(formatters({ locale: "en", timeZone: "UTC" })).not.toBe(first);
  });
});
