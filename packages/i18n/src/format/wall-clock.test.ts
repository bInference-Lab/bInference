import { describe, expect, it } from "vitest";
import { wallClockOf } from "./wall-clock.js";

describe("a wall clock in a timezone", () => {
  it("shows the date, time and weekday of a moment in the zone", () => {
    const at = Date.parse("2026-10-10T19:30:05Z");

    expect(wallClockOf(at, "Asia/Shanghai")).toStrictEqual({
      year: 2026,
      month: 10,
      day: 11,
      hour: 3,
      minute: 30,
      second: 5,
      weekday: 0,
    });
    expect(wallClockOf(at, "UTC")).toMatchObject({ day: 10, hour: 19, weekday: 6 });
  });

  it("shows midnight as hour 0", () => {
    expect(wallClockOf(Date.parse("2026-10-11T00:00:00Z"), "UTC")).toMatchObject({ hour: 0 });
  });

  it("refuses a zone it does not know", () => {
    expect(() => wallClockOf(0, "Mars/Olympus")).toThrow(/not a timezone/u);
  });
});
