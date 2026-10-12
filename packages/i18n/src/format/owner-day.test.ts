import { describe, expect, it } from "vitest";
import { dayStartOf, monthStartOf, nextDayStartOf } from "./owner-day.js";

const at = (iso: string): number => Date.parse(iso);
const hourMs = 3_600_000;

describe("the owner's day in a timezone", () => {
  it("starts at the zone's midnight and ends at the next one", () => {
    const noon = at("2026-10-12T04:00:00Z");

    expect(dayStartOf(noon, "Asia/Shanghai")).toBe(at("2026-10-11T16:00:00Z"));
    expect(nextDayStartOf(noon, "Asia/Shanghai")).toBe(at("2026-10-12T16:00:00Z"));
    expect(dayStartOf(noon, "UTC")).toBe(at("2026-10-12T00:00:00Z"));
  });

  it("holds its own midnight and ends a millisecond before the next", () => {
    const midnight = at("2026-10-11T16:00:00Z");

    expect(dayStartOf(midnight, "Asia/Shanghai")).toBe(midnight);
    expect(dayStartOf(midnight - 1, "Asia/Shanghai")).toBe(midnight - 24 * hourMs);
    expect(nextDayStartOf(midnight - 1, "Asia/Shanghai")).toBe(midnight);
  });

  it("is 23 hours long when the clocks go forward and 25 when they go back", () => {
    const spring = at("2026-03-08T17:00:00Z");
    const autumn = at("2026-11-01T17:00:00Z");
    const york = "America/New_York";

    expect(nextDayStartOf(spring, york) - dayStartOf(spring, york)).toBe(23 * hourMs);
    expect(dayStartOf(spring, york)).toBe(at("2026-03-08T05:00:00Z"));
    expect(nextDayStartOf(autumn, york) - dayStartOf(autumn, york)).toBe(25 * hourMs);
    expect(nextDayStartOf(autumn, york)).toBe(at("2026-11-02T05:00:00Z"));
  });

  it("starts at 01:00 where the clocks skip midnight", () => {
    const santiago = "America/Santiago";

    expect(nextDayStartOf(at("2026-09-05T15:00:00Z"), santiago)).toBe(at("2026-09-06T04:00:00Z"));
    expect(dayStartOf(at("2026-09-06T15:00:00Z"), santiago)).toBe(at("2026-09-06T04:00:00Z"));
    expect(dayStartOf(at("2026-09-06T03:59:59Z"), santiago)).toBe(at("2026-09-05T04:00:00Z"));
  });

  it("starts the month at the first moment of its first day", () => {
    expect(monthStartOf(at("2026-10-12T04:00:00Z"), "Asia/Shanghai")).toBe(
      at("2026-09-30T16:00:00Z"),
    );
    expect(monthStartOf(at("2026-10-01T03:00:00Z"), "America/New_York")).toBe(
      at("2026-09-01T04:00:00Z"),
    );
  });

  it("refuses a zone it does not know", () => {
    expect(() => dayStartOf(0, "Mars/Olympus")).toThrow(/not a timezone/u);
  });
});
